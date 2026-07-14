const fs = require('fs');
const config = require('./config');
const logger = require('./logger');

class Settings {
  constructor() {
    this._cache = null;
  }

  _loadRaw() {
    try {
      if (fs.existsSync(config.SETTINGS_PATH)) {
        return JSON.parse(fs.readFileSync(config.SETTINGS_PATH, 'utf-8'));
      }
    } catch (err) {
      logger.warn('Failed to load settings, using defaults:', err.message);
    }
    return {};
  }

  getAll() {
    if (!this._cache) this._cache = this._loadRaw();
    return { ...this._cache };
  }

  get(key, defaultValue) {
    const all = this.getAll();
    return all[key] !== undefined ? all[key] : defaultValue;
  }

  merge(updates) {
    const current = this._loadRaw();
    const merged = { ...current, ...updates };
    this._cache = merged;
    try {
      fs.writeFileSync(config.SETTINGS_PATH, JSON.stringify(merged, null, 2));
    } catch (err) {
      logger.error('Failed to save settings:', err.message);
    }
  }

  set(key, value) {
    this.merge({ [key]: value });
  }
}

module.exports = new Settings();
