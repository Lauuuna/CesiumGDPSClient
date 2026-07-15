const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const logger = require('./logger');
const config = require('./config');
const settings = require('./settings');
const discord = require('./discord');
const autoUpdater = require('./updater');
const { Downloader, fetchJSON, formatTime } = require('./downloader');
const gameManager = require('./game-manager');
const backgrounds = require('./backgrounds');

let mainWindow;
let updateCheckCache = { time: 0, result: null };
const downloader = new Downloader();

// Dashboard now opens in external browser — no session config needed.

function createWindow() {
  logger.info('Creating main window');
  const saved = settings.getAll();
  const wb = saved.windowBounds || {};

  mainWindow = new BrowserWindow({
    width: wb.width || 1100,
    height: wb.height || 720,
    x: wb.x,
    y: wb.y,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#121212',
    icon: config.BUILD_ICON,
    webPreferences: {
      preload: config.PRELOAD_PATH,
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  let saveTimeout;
  const persistBounds = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized()) {
        settings.set('windowBounds', mainWindow.getBounds());
      }
    }, 400);
  };

  mainWindow.on('resize', persistBounds);
  mainWindow.on('move', persistBounds);

  mainWindow.loadFile(config.INDEX_HTML);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle('window:minimize', () => { mainWindow?.minimize(); });
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.handle('window:close', () => { mainWindow?.close(); });

  ipcMain.handle('auto-updater:setEnabled', (_, enabled) => {
    autoUpdater.setEnabled(enabled);
  });

  ipcMain.handle('rpc:setActivity', (_, { state, details }) => {
    discord.setActivity({ state, details });
  });

  ipcMain.handle('shell:openExternal', (_, url) => {
    shell.openExternal(url);
  });

  ipcMain.handle('app:restart', () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle('game:checkInstall', (_, installDir) => {
    const exists = gameManager.checkInstall(installDir);
    logger.debug('checkInstall:', installDir, exists);
    return exists;
  });

  ipcMain.handle('game:checkUpdate', async (_, installDir) => {
    logger.debug('checkUpdate:', installDir);
    try {
      const manifest = await fetchJSON(config.MANIFEST_URL);
      const remoteVersion = manifest.version || '0.0.0';
      const localVersion = gameManager.getLocalVersion(installDir);
      logger.debug('Versions: local', localVersion, 'remote', remoteVersion);
      return { updateAvailable: remoteVersion !== localVersion, remoteVersion, localVersion };
    } catch (error) {
      logger.warn('checkUpdate failed:', error.message);
      return { updateAvailable: false, error: error.message };
    }
  });

  ipcMain.handle('game:deleteGame', async (_, installDir) => {
    return await gameManager.deleteGame(installDir);
  });

  ipcMain.handle('game:fixFiles', async (event, installDir, files) => {
    const sendEvent = (channel, data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        event.sender.send(channel, data);
      }
    };
    return await downloader.fixFiles(installDir, files, sendEvent);
  });

  ipcMain.handle('game:verifyIntegrity', async (event, installDir) => {
    const sendEvent = (channel, data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        event.sender.send(channel, data);
      }
    };
    return await downloader.verifyIntegrity(installDir, sendEvent);
  });

  ipcMain.handle('dialog:selectDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (canceled) return null;

    const selectedPath = filePaths[0];
    if (selectedPath.includes(' ')) {
      dialog.showErrorBox(
        'Invalid path',
        'Installation path must not contain spaces for safety reasons. Please choose another folder.'
      );
      return null;
    }
    return selectedPath;
  });

  ipcMain.handle('game:pause', () => {
    downloader.pause();
  });

  ipcMain.handle('game:resume', () => {
    downloader.resume();
  });

  ipcMain.handle('game:startUpdate', async (event, installDir, skipCheck) => {
    logger.info('startUpdate:', installDir, 'skipCheck:', skipCheck);
    const sendEvent = (channel, data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        event.sender.send(channel, data);
      }
    };

    try {
      sendEvent('update-progress', { text: 'Загрузка манифеста...', percent: 0 });
      const manifest = await fetchJSON(config.MANIFEST_URL);
      return await downloader.startUpdate(installDir, manifest, skipCheck, sendEvent);
    } catch (error) {
      logger.error('startUpdate failed:', error.message);
      sendEvent('update-error', error.message);
      return { status: 'error', message: error.message };
    }
  });

  ipcMain.handle('download:cancel', () => {
    downloader.cancel();
    return { success: true };
  });

  ipcMain.handle('session:getState', () => {
    if (downloader.session) {
      const s = downloader.session;
      return {
        exists: true,
        manifestVersion: s.manifestVersion,
        totalFiles: s.totalFiles,
        completedFiles: s.completedFiles.length,
        remaining: s.remaining,
        timestamp: s.timestamp,
      };
    }
    try {
      const fs = require('fs');
      if (!fs.existsSync(config.SESSION_PATH)) return { exists: false };
      const data = JSON.parse(fs.readFileSync(config.SESSION_PATH, 'utf-8'));
      const remaining = (data.totalFiles || 0) - (data.completedFiles || []).length;
      return {
        exists: true,
        manifestVersion: data.manifestVersion,
        totalFiles: data.totalFiles,
        completedFiles: (data.completedFiles || []).length,
        remaining,
        timestamp: data.timestamp,
      };
    } catch {
      return { exists: false };
    }
  });

  ipcMain.handle('session:clear', () => {
    if (downloader.session) {
      downloader.session.clear();
    }
    return { success: true };
  });

  ipcMain.handle('stats:get', () => {
    return gameManager.stats.getStats();
  });

  ipcMain.handle('stats:reset', () => {
    gameManager.stats.reset();
    return { success: true };
  });

  ipcMain.handle('game:launch', (event, installDir) => {
    const result = gameManager.launchGame(installDir, (code) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        event.sender.send('game:closed', code);
      }
    });

    if (!result.success) {
      dialog.showErrorBox('Error', result.error || 'CesiumGDPS.exe not found!');
      return false;
    }
    return true;
  });

  ipcMain.handle('client:checkForUpdates', async () => {
    const currentVersion = app.getVersion();
    const now = Date.now();

    if (updateCheckCache.result && (now - updateCheckCache.time) < config.UPDATE_CACHE_TTL) {
      return { ...updateCheckCache.result, currentVersion };
    }

    try {
      const releases = await fetchJSON(
        'https://api.github.com/repos/Lauuuna/CesiumGDPSClient/releases',
        { Accept: 'application/vnd.github.v3+json' }
      );
      const latest = releases.find(r => !r.draft && !r.prerelease && r.tag_name);
      if (!latest) {
        const result = { currentVersion, available: false, error: 'No releases found' };
        updateCheckCache = { time: now, result };
        return result;
      }

      const remoteVersion = latest.tag_name.replace(/^v/, '');
      const result = { currentVersion, remoteVersion, available: remoteVersion !== currentVersion };
      updateCheckCache = { time: now, result };
      return result;
    } catch (err) {
      if (updateCheckCache.result) {
        return { ...updateCheckCache.result, currentVersion };
      }
      return { currentVersion, available: false, error: err.message };
    }
  });

  ipcMain.handle('client:fetchLocalBackground', () => {
    return backgrounds.fetchRandom();
  });

  ipcMain.handle('client:listBackgrounds', () => {
    return backgrounds.list();
  });

  ipcMain.handle('client:toggleBackground', (_, { name, enabled }) => {
    return backgrounds.toggle(name, enabled);
  });

  ipcMain.handle('client:getBackgroundFile', (_, filename) => {
    return backgrounds.getFile(filename);
  });

  ipcMain.handle('client:importBackground', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (canceled || filePaths.length === 0) return { error: 'cancelled' };
    return backgrounds.importFile(filePaths[0]);
  });

  /**
   * When Dashboard opens, focus the main window so the webview's
   * Turnstile iframe can receive proper focus/blur events.
   * Cloudflare challenges rely on hasFocus() returning true.
   */
  ipcMain.handle('dashboard:focus', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Focus the main window — propagates to the active webview
      mainWindow.focus();
      mainWindow.webContents.focus();
    }
  });
}

function init() {
  logger.info(`App starting v${app.getVersion()}`);

  app.whenReady().then(() => {
    logger.init(config.LOG_DIR);
    createWindow();
    autoUpdater.setMainWindow(mainWindow);
    autoUpdater.init();
    discord.connect();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    if (downloader.isRunning) {
      downloader.cancel();
    }
  });

  registerIpcHandlers();
}

module.exports = { init };
