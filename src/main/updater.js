const { autoUpdater } = require('electron-updater');
const config = require('./config');
const logger = require('./logger');

class AutoUpdater {
  constructor() {
    this._enabled = true;
    this._mainWindow = null;
  }

  setMainWindow(win) {
    this._mainWindow = win;
  }

  setEnabled(enabled) {
    this._enabled = enabled;
  }

  init() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      logger.debug('Auto-updater: checking');
      this._send('auto-updater:status', { status: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
      logger.info('Auto-updater: update available', info.version);
      this._send('auto-updater:status', { status: 'available', info });
    });

    autoUpdater.on('update-not-available', () => {
      logger.debug('Auto-updater: no update');
      this._send('auto-updater:status', { status: 'not-available' });
    });

    autoUpdater.on('download-progress', (progress) => {
      this._send('auto-updater:progress', progress);
    });

    autoUpdater.on('update-downloaded', (info) => {
      logger.info('Auto-updater: update downloaded', info.version);
      this._send('auto-updater:status', { status: 'downloaded', info });
      setTimeout(() => autoUpdater.quitAndInstall(), 1000);
    });

    autoUpdater.on('error', (err) => {
      logger.warn('Auto-updater error:', err.message);
      this._send('auto-updater:error', err.message);
    });

    setTimeout(() => {
      if (this._enabled) {
        autoUpdater.checkForUpdates().catch(err => {
          logger.warn('Auto-update check failed:', err.message);
        });
      }
    }, 3000);
  }

  quitAndInstall() {
    autoUpdater.quitAndInstall();
  }

  _send(channel, data) {
    if (this._mainWindow && !this._mainWindow.isDestroyed()) {
      this._mainWindow.webContents.send(channel, data);
    }
  }
}

module.exports = new AutoUpdater();
