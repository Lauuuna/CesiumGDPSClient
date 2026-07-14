const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const config = require('./config');
const logger = require('./logger');

const EXPECTED_SAVED_JSON = {
  current: 0,
  server: 'https://www.boomlings.com/database/',
  servers: [{
    id: 0,
    name: 'CesiumGDPS',
    url: 'https://cesium.okzzdev.me/',
    saveDir: 'CesiumGDPS',
  }],
  '1.4.0-migration': true,
  'server-order': [0],
  'ss-rainbow': false,
  'secret-settings': false,
};

class GameStats {
  constructor() {
    this._sessionStart = null;
    this._data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(config.STATS_PATH)) {
        return JSON.parse(fs.readFileSync(config.STATS_PATH, 'utf-8'));
      }
    } catch (err) {
      logger.warn('Failed to load game stats:', err.message);
    }
    return { totalPlayTime: 0, sessions: [], daily: {}, lastPlayed: null, firstPlayed: null };
  }

  _save() {
    try {
      fs.writeFileSync(config.STATS_PATH, JSON.stringify(this._data, null, 2));
    } catch (err) {
      logger.error('Failed to save game stats:', err.message);
    }
  }

  startSession() {
    this._sessionStart = Date.now();
    logger.info('Game session started');
  }

  endSession() {
    if (!this._sessionStart) return;
    const duration = Date.now() - this._sessionStart;
    const startDate = new Date(this._sessionStart);
    const today = startDate.toISOString().split('T')[0];

    this._data.sessions.push({
      start: this._sessionStart,
      duration,
      date: today,
    });
    this._data.totalPlayTime += duration;
    this._data.daily[today] = (this._data.daily[today] || 0) + duration;
    this._data.lastPlayed = this._sessionStart;
    if (!this._data.firstPlayed) this._data.firstPlayed = this._sessionStart;

    const hours = Math.floor(duration / 3600000);
    const minutes = Math.floor((duration % 3600000) / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    logger.info(`Game session ended: ${hours}h ${minutes}m ${seconds}s`);

    this._sessionStart = null;
    this._save();
  }

  getStats() {
    const totalHours = this._data.totalPlayTime / 3600000;
    const recentDays = Object.entries(this._data.daily)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 30)
      .map(([date, ms]) => ({ date, hours: +(ms / 3600000).toFixed(2) }));

    return {
      totalPlayTime: this._data.totalPlayTime,
      totalHours: +totalHours.toFixed(1),
      sessionCount: this._data.sessions.length,
      lastPlayed: this._data.lastPlayed,
      firstPlayed: this._data.firstPlayed,
      recentDays,
      lastSessionDuration: this._data.sessions.length > 0
        ? this._data.sessions[this._data.sessions.length - 1].duration
        : 0,
    };
  }

  reset() {
    this._data = { totalPlayTime: 0, sessions: [], daily: {}, lastPlayed: null, firstPlayed: null };
    this._save();
  }
}

class GameManager {
  constructor() {
    this.stats = new GameStats();
  }

  getLocalVersion(installDir) {
    const versionFile = path.join(installDir, 'version.json');
    if (fs.existsSync(versionFile)) {
      try {
        return JSON.parse(fs.readFileSync(versionFile, 'utf-8')).version || '0.0.0';
      } catch {}
    }
    return '0.0.0';
  }

  checkInstall(installDir) {
    return fs.existsSync(path.join(installDir, 'CesiumGDPS.exe'));
  }

  ensureSavedJson() {
    const savedPath = path.join(process.env.LOCALAPPDATA, 'CesiumGDPS', 'geode', 'mods', 'km7dev.gdps-switcher', 'saved.json');
    const dir = path.dirname(savedPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let current = null;
    if (fs.existsSync(savedPath)) {
      try {
        current = JSON.parse(fs.readFileSync(savedPath, 'utf-8'));
      } catch {}
    }

    const expected = JSON.stringify(EXPECTED_SAVED_JSON, null, 4);
    const actual = current ? JSON.stringify(current, null, 4) : null;

    if (actual !== expected) {
      fs.writeFileSync(savedPath, expected, 'utf-8');
      return true;
    }
    return false;
  }

  async deleteGame(installDir) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        fs.rmSync(installDir, { recursive: true, force: true });
        logger.info('Game deleted:', installDir);
        return { success: true };
      } catch (err) {
        if (attempt < 5) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        } else {
          return { success: false, error: err.message };
        }
      }
    }
  }

  launchGame(installDir, onClose) {
    const exePath = path.join(installDir, 'CesiumGDPS.exe');
    if (!fs.existsSync(exePath)) {
      return { success: false, error: 'CesiumGDPS.exe not found' };
    }

    this.ensureSavedJson();
    this.stats.startSession();

    const child = exec(`"${exePath}"`, { cwd: installDir });
    child.on('error', (err) => {
      logger.error('Launch error:', err.message);
    });
    child.on('close', (code) => {
      logger.info(`Game closed with code ${code}`);
      this.stats.endSession();
      if (onClose) onClose(code);
    });

    return { success: true };
  }
}

module.exports = new GameManager();
