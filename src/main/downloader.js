const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { EventEmitter } = require('events');
const config = require('./config');
const logger = require('./logger');

const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: config.CONCURRENCY + 4,
  keepAliveMsecs: 20000,
  freeSocketTimeout: 20000,
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${Math.round(seconds)}с`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}м ${s}с`;
}

function getFileHash(filePath) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => resolve(null));
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function fetchJSON(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { 'User-Agent': 'CesiumLauncher/1.0', ...extraHeaders },
    };

    client.get(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJSON(res.headers.location, extraHeaders).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        let msg = `HTTP ${res.statusCode}`;
        if (res.statusCode === 403) msg += ' — rate limit exceeded';
        return reject(new Error(msg));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON')); }
      });
    }).on('error', reject);
  });
}

class DownloadSession {
  constructor(installDir, manifestVersion, totalFiles) {
    this.installDir = installDir;
    this.manifestVersion = manifestVersion;
    this.timestamp = Date.now();
    this.totalFiles = totalFiles;
    this.completedFiles = [];
    this.pendingFiles = [];
  }

  markCompleted(relPath) {
    if (!this.completedFiles.includes(relPath)) {
      this.completedFiles.push(relPath);
    }
    this.pendingFiles = this.pendingFiles.filter(f => f !== relPath);
    this.save();
  }

  markPending(relPaths) {
    for (const p of relPaths) {
      if (!this.pendingFiles.includes(p) && !this.completedFiles.includes(p)) {
        this.pendingFiles.push(p);
      }
    }
    this.save();
  }

  get remaining() {
    return this.totalFiles - this.completedFiles.length;
  }

  isComplete(relPath) {
    return this.completedFiles.includes(relPath);
  }

  save() {
    try {
      const data = {
        installDir: this.installDir,
        manifestVersion: this.manifestVersion,
        timestamp: this.timestamp,
        totalFiles: this.totalFiles,
        completedFiles: this.completedFiles,
        pendingFiles: this.pendingFiles,
      };
      fs.writeFileSync(config.SESSION_PATH, JSON.stringify(data, null, 2));
    } catch (err) {
      logger.error('Failed to save download session:', err.message);
    }
  }

  clear() {
    try {
      if (fs.existsSync(config.SESSION_PATH)) {
        fs.unlinkSync(config.SESSION_PATH);
      }
    } catch {}
  }

  static load(installDir, manifestVersion) {
    try {
      if (!fs.existsSync(config.SESSION_PATH)) return null;
      const data = JSON.parse(fs.readFileSync(config.SESSION_PATH, 'utf-8'));
      if (data.installDir !== installDir) return null;
      if (data.manifestVersion !== manifestVersion) return null;
      const session = new DownloadSession(data.installDir, data.manifestVersion, data.totalFiles);
      session.timestamp = data.timestamp;
      session.completedFiles = data.completedFiles || [];
      session.pendingFiles = data.pendingFiles || [];
      logger.info(`Session restored: ${session.completedFiles.length}/${session.totalFiles} files completed`);
      return session;
    } catch {
      return null;
    }
  }
}

class Downloader {
  constructor() {
    this._abortController = null;
    this._session = null;
    this._isRunning = false;
    this._pauseEvents = new EventEmitter();
    this._isPaused = false;
  }

  get session() {
    return this._session;
  }

  get isRunning() {
    return this._isRunning;
  }

  pause() {
    this._isPaused = true;
  }

  resume() {
    this._isPaused = false;
    this._pauseEvents.emit('resumed');
  }

  cancel() {
    if (this._abortController) {
      logger.info('Download cancelled by user');
      this._abortController.abort();
      this._abortController = null;
    }
    if (this._session) {
      this._session.save();
    }
  }

  async _waitIfPaused() {
    while (this._isPaused) {
      await new Promise(resolve => this._pauseEvents.once('resumed', resolve));
    }
  }

  _downloadFile(url, dest, signal, onChunk) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      const file = fs.createWriteStream(dest);
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        agent: keepAliveAgent,
        headers: { 'User-Agent': 'CesiumLauncher/1.0' },
        signal,
      };

      const req = client.get(options, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          fs.unlink(dest, () => {});
          return this._downloadFile(response.headers.location, dest, signal, onChunk)
            .then(resolve).catch(reject);
        }
        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          return reject(new Error(`HTTP ${response.statusCode}`));
        }

        response.on('data', (chunk) => {
          if (onChunk) onChunk(chunk.length);
        });

        response.pipe(file);
        file.on('finish', () => file.close(resolve));
      });

      req.on('error', (err) => {
        if (err.name === 'AbortError') {
          file.close();
          fs.unlink(dest, () => {});
          return reject(new Error('ABORTED'));
        }
        file.close();
        fs.unlink(dest, () => reject(err));
      });
    });
  }

  async startUpdate(installDir, manifest, skipCheck, sendEvent) {
    this._abortController = new AbortController();
    const signal = this._abortController.signal;
    this._isRunning = true;
    this._isPaused = false;

    try {
      if (!fs.existsSync(installDir)) {
        fs.mkdirSync(installDir, { recursive: true });
      }

      const remoteVersion = manifest.version || '0.0.0';
      const entries = Object.entries(manifest.files || {});
      const totalEntries = entries.length;

      this._session = DownloadSession.load(installDir, remoteVersion);
      if (!this._session) {
        this._session = new DownloadSession(installDir, remoteVersion, entries.length);
        this._session.save();
      }

      let filesToUpdate = [];

      if (skipCheck) {
        for (const [relPath] of entries) {
          if (signal.aborted) throw new Error('ABORTED');
          await this._waitIfPaused();
          if (!this._session.isComplete(relPath)) {
            const localPath = path.join(installDir, relPath);
            if (!fs.existsSync(localPath)) {
              filesToUpdate.push(relPath);
            } else {
              this._session.markCompleted(relPath);
            }
          }
        }
      } else {
        let lastSentPct = -1;
        for (let i = 0; i < totalEntries; i++) {
          if (signal.aborted) throw new Error('ABORTED');
          await this._waitIfPaused();

          const [relPath, expectedHash] = entries[i];

          if (this._session.isComplete(relPath)) continue;

          const localPath = path.join(installDir, relPath);
          let needsUpdate = true;

          if (fs.existsSync(localPath)) {
            const hash = await getFileHash(localPath);
            if (hash === expectedHash) {
              needsUpdate = false;
              this._session.markCompleted(relPath);
            }
          }
          if (needsUpdate) {
            filesToUpdate.push(relPath);
            this._session.markPending([relPath]);
          }

          const checkPct = Math.round(((i + 1) / totalEntries) * config.CHECK_PERCENT);
          if (checkPct !== lastSentPct) {
            lastSentPct = checkPct;
            sendEvent('update-progress', {
              text: `Проверка файлов (${i + 1}/${totalEntries})`,
              percent: checkPct,
            });
          }
        }
      }

      this._session.pendingFiles = filesToUpdate;
      this._session.save();

      if (filesToUpdate.length === 0) {
        fs.writeFileSync(path.join(installDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        fs.writeFileSync(path.join(installDir, 'version.json'), JSON.stringify({ version: remoteVersion }));
        this._session.clear();
        sendEvent('update-progress', { text: 'Готово!', percent: 100 });
        setTimeout(() => sendEvent('update-complete'), 600);
        return { status: 'ready' };
      }

      sendEvent('update-state', 'downloading');

      const downloadCount = filesToUpdate.length;
      let completedDownloads = 0;
      const startTime = Date.now();

      const speedTracker = {
        totalBytes: 0,
        lastBytes: 0,
        time: Date.now(),
        str: '0 B/s',
      };

      let failedDownloads = [];

      const downloadWorker = async () => {
        while (filesToUpdate.length > 0 && !signal.aborted) {
          await this._waitIfPaused();

          if (signal.aborted) return;

          const relPath = filesToUpdate.shift();
          const localPath = path.join(installDir, relPath);
          const fileUrl = new URL(relPath.replace(/\\/g, '/'), config.BASE_URL).href;

          fs.mkdirSync(path.dirname(localPath), { recursive: true });

          try {
            await this._downloadFile(fileUrl, localPath, signal, (chunkSize) => {
              speedTracker.totalBytes += chunkSize;
            });
            this._session.markCompleted(relPath);
          } catch (err) {
            if (err.message === 'ABORTED') return;
            failedDownloads.push(relPath);
          }

          completedDownloads++;

          const now = Date.now();
          const speedElapsed = now - speedTracker.time;
          if (speedElapsed >= 200) {
            const bytesDelta = speedTracker.totalBytes - speedTracker.lastBytes;
            const bps = Math.round(bytesDelta / speedElapsed * 1000);
            speedTracker.str = formatBytes(bps) + '/s';
            speedTracker.lastBytes = speedTracker.totalBytes;
            speedTracker.time = now;
          }

          const totalElapsed = now - startTime;
          const avgPerFile = totalElapsed / completedDownloads;
          const etaSec = Math.round(avgPerFile * (filesToUpdate.length) / 1000);
          const pct = config.CHECK_PERCENT + Math.round((completedDownloads / downloadCount) * config.DOWNLOAD_PERCENT);

          let speedStr = speedTracker.str;
          if (speedTracker.totalBytes > 0 && totalElapsed > 1000) {
            const totalBps = Math.round(speedTracker.totalBytes / totalElapsed * 1000);
            speedStr = formatBytes(totalBps) + '/s';
          }

          sendEvent('update-progress', {
            text: `${pct}% — ${speedStr}${etaSec > 0 ? ' — ' + formatTime(etaSec) : ''}`,
            percent: pct,
          });
        }
      };

      const workers = [];
      for (let i = 0; i < Math.min(config.CONCURRENCY, downloadCount); i++) {
        workers.push(downloadWorker());
      }
      await Promise.all(workers);

      if (signal.aborted) throw new Error('ABORTED');

      if (failedDownloads.length > 0) {
        logger.warn(`Failed to download ${failedDownloads.length} files:`, failedDownloads.join(', '));
      }

      fs.writeFileSync(path.join(installDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      fs.writeFileSync(path.join(installDir, 'version.json'), JSON.stringify({ version: remoteVersion }));
      this._session.clear();

      sendEvent('update-progress', { text: 'Готово!', percent: 100 });
      setTimeout(() => sendEvent('update-complete'), 600);
      return { status: 'ready' };

    } catch (error) {
      if (error.message === 'ABORTED') {
        if (this._session) this._session.save();
        sendEvent('update-cancelled');
        return { status: 'cancelled' };
      }
      logger.error('Update failed:', error.message);
      sendEvent('update-error', error.message);
      return { status: 'error', message: error.message };
    } finally {
      this._isRunning = false;
      this._abortController = null;
    }
  }

  async verifyIntegrity(installDir, sendEvent) {
    try {
      const localManifestPath = path.join(installDir, 'manifest.json');
      let manifest;

      if (fs.existsSync(localManifestPath)) {
        manifest = JSON.parse(fs.readFileSync(localManifestPath, 'utf-8'));
      } else {
        manifest = await fetchJSON(config.MANIFEST_URL);
      }

      const entries = Object.entries(manifest.files || {}).filter(([relPath]) => {
        const normalized = relPath.replace(/\\/g, '/').toLowerCase();
        return !config.EXCLUDED_PATHS.some(excl => normalized.startsWith(excl));
      });
      const total = entries.length;
      let checked = 0;
      let corrupted = [];

      for (const [relPath, expectedHash] of entries) {
        const localPath = path.join(installDir, relPath);
        const exists = fs.existsSync(localPath);

        if (!exists) {
          corrupted.push(relPath);
        } else {
          const hash = await getFileHash(localPath);
          if (hash !== expectedHash) corrupted.push(relPath);
        }

        checked++;
        const pct = Math.round((checked / total) * 100);
        sendEvent('update-progress', {
          text: `Проверка целостности (${checked}/${total})`,
          percent: pct,
        });
      }

      if (corrupted.length === 0) {
        return { success: true, message: `Все ${total} файлов в порядке.` };
      }
      return { success: false, message: `Повреждено: ${corrupted.length} из ${total}`, files: corrupted };
    } catch (error) {
      return { success: false, message: 'Ошибка проверки: ' + error.message };
    }
  }

  async fixFiles(installDir, files, sendEvent) {
    try {
      this._abortController = new AbortController();
      const signal = this._abortController.signal;

      const localManifestPath = path.join(installDir, 'manifest.json');
      let manifest;
      if (fs.existsSync(localManifestPath)) {
        manifest = JSON.parse(fs.readFileSync(localManifestPath, 'utf-8'));
      } else {
        manifest = await fetchJSON(config.MANIFEST_URL);
      }

      const total = files.length;
      let fixed = 0;
      let failedFixes = [];

      for (const relPath of files) {
        if (signal.aborted) throw new Error('ABORTED');
        await this._waitIfPaused();

        const fileUrl = new URL(relPath.replace(/\\/g, '/'), config.BASE_URL).href;
        const localPath = path.join(installDir, relPath);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });

        try {
          await this._downloadFile(fileUrl, localPath, signal);
          fixed++;
        } catch (err) {
          if (err.message === 'ABORTED') throw err;
          failedFixes.push(relPath);
        }

        const pct = Math.round(((fixed + 1) / total) * 100);
        sendEvent('update-progress', {
          text: `Восстановление файлов (${fixed}/${total})`,
          percent: pct,
        });
      }

      if (manifest && manifest.files) {
        const updatedFiles = { ...manifest.files };
        for (const relPath of files) {
          if (updatedFiles[relPath]) {
            const hash = await getFileHash(path.join(installDir, relPath));
            if (hash) updatedFiles[relPath] = hash;
          }
        }
        manifest.files = updatedFiles;
        fs.writeFileSync(localManifestPath, JSON.stringify(manifest, null, 2));
      }

      if (failedFixes.length > 0) {
        logger.warn(`Failed to fix ${failedFixes.length} files:`, failedFixes.join(', '));
      }

      return { success: true, fixed, total };
    } catch (error) {
      if (error.message === 'ABORTED') return { success: false, error: 'cancelled' };
      return { success: false, error: error.message };
    } finally {
      this._abortController = null;
    }
  }
}

module.exports = { Downloader, DownloadSession, fetchJSON, formatBytes, formatTime };
