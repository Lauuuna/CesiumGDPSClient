const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');
const { EventEmitter } = require('events');
const { autoUpdater } = require('electron-updater');
const DiscordRPC = require('discord-rpc');

const BASE_URL = 'https://lauuuna.github.io/CesiumGDPS/CesiumGDPS/';
const MANIFEST_URL = BASE_URL + 'manifest.json';
const CONCURRENCY = 8;

let mainWindow;
let autoCheckUpdatesEnabled = true;

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
        }
    } catch (e) { /* ignore */ }
    return {};
}

function saveSettings(update) {
    try {
        const existing = loadSettings();
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ ...existing, ...update }, null, 2));
    } catch (e) { /* ignore */ }
}

const state = {
    isPaused: false,
    activeRequests: []
};
const pauseEvents = new EventEmitter();

async function waitIfPaused() {
    while (state.isPaused) {
        await new Promise(resolve => pauseEvents.once('resumed', resolve));
    }
}

const EXCLUDED_PATHS = [
    'geode/unzipped/'
];
const CHECK_PERCENT = 30;
const DOWNLOAD_PERCENT = 70;

const keepAliveAgent = new https.Agent({
    keepAlive: true,
    maxSockets: CONCURRENCY + 4,
    keepAliveMsecs: 20000,
    freeSocketTimeout: 20000
});

// --- Discord RPC ---

const BACKGROUNDS_DIR = path.join(__dirname, 'src', 'backgrounds');
const clientId = '1526608832116297759';
try { DiscordRPC.register(clientId); } catch (e) { /* ignore */ }
let rpc = null;
let rpcRetryTimer = null;
const startTimestamp = new Date();

function updateDiscordActivity(state, details) {
    if (!rpc) return;
    rpc.setActivity({
        details: details || 'CesiumGDPS',
        state: state || 'Idle',
        startTimestamp,
        buttons: [
            { label: 'Discord', url: 'https://discord.gg/jd6EAGpaVg' }
        ]
    }).catch(() => {});
}

function initDiscordRPC() {
    if (rpc) {
        try { rpc.destroy(); } catch (e) { /* ignore */ }
        rpc = null;
    }

    const newRpc = new DiscordRPC.Client({ transport: 'ipc' });

    newRpc.on('ready', () => {
        console.log('[main] discord rpc connected');
        rpc = newRpc;
        updateDiscordActivity('Просматривает клиент');
    });

    newRpc.on('disconnected', () => {
        console.log('[main] discord rpc disconnected');
        if (rpc === newRpc) rpc = null;
    });

    newRpc.login({ clientId }).catch((err) => {
        console.log('[main] discord rpc login failed:', err.message || err);
        if (rpc === newRpc) rpc = null;
        try { newRpc.destroy(); } catch (e) { /* ignore */ }
        rpcRetryTimer = setTimeout(initDiscordRPC, 15000);
    });
}

function createWindow() {
    console.log('[main] create window');
    const saved = loadSettings();
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
        icon: path.join(__dirname, 'build', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    let saveTimeout;
    const persistBounds = () => {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            if (mainWindow && !mainWindow.isMaximized()) {
                saveSettings({ windowBounds: mainWindow.getBounds() });
            }
        }, 400);
    };

    mainWindow.on('resize', persistBounds);
    mainWindow.on('move', persistBounds);

    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
    console.log('[main] app ready v' + app.getVersion());
    createWindow();
    initAutoUpdater();
    initDiscordRPC();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.handle('window:close', () => { if (mainWindow) mainWindow.close(); });

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

function downloadFile(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        const file = fs.createWriteStream(dest);
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            agent: keepAliveAgent,
            headers: { 'User-Agent': 'CesiumLauncher/1.0' }
        };

        const req = client.get(options, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                file.close();
                fs.unlink(dest, () => {});
                return downloadFile(response.headers.location, dest, onProgress).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) {
                file.close();
                fs.unlink(dest, () => {});
                return reject(new Error(`HTTP ${response.statusCode}`));
            }

            response.on('data', (chunk) => {
                if (onProgress) onProgress(chunk.length);
            });

            response.pipe(file);
            file.on('finish', () => file.close(resolve));
        });

        req.on('error', (err) => {
            file.close();
            fs.unlink(dest, () => reject(err));
        });

        state.activeRequests.push(req);
        req.on('close', () => {
            const idx = state.activeRequests.indexOf(req);
            if (idx !== -1) state.activeRequests.splice(idx, 1);
        });
    });
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
            headers: {
                'User-Agent': 'CesiumLauncher/1.0',
                ...extraHeaders
            }
        };

        client.get(options, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchJSON(res.headers.location, extraHeaders).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                let msg = `HTTP ${res.statusCode}`;
                if (res.statusCode === 403) msg += ' — превышен лимит запросов, попробуйте позже';
                return reject(new Error(msg));
            }

            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Invalid JSON'));
                }
            });
        }).on('error', reject);
    });
}

function cleanupRequests() {
    for (const req of state.activeRequests) req.destroy();
    state.activeRequests = [];
}

// --- Game helpers ---

async function deleteDirectoryWithRetry(dirPath, maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            fs.rmSync(dirPath, { recursive: true, force: true });
            return { success: true };
        } catch (err) {
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 1000 * attempt));
            } else {
                return { success: false, error: err.message };
            }
        }
    }
}

function getLocalVersion(installDir) {
    const versionFile = path.join(installDir, 'version.json');
    if (fs.existsSync(versionFile)) {
        try {
            return JSON.parse(fs.readFileSync(versionFile, 'utf8')).version || '0.0.0';
        } catch (e) { /* corrupted, use default */ }
    }
    return '0.0.0';
}

const EXPECTED_SAVED_JSON = {
    "current": 0,
    "server": "https://www.boomlings.com/database/",
    "servers": [{
        "id": 0,
        "name": "CesiumGDPS",
        "url": "https://cesium.okzzdev.me/",
        "saveDir": "CesiumGDPS"
    }],
    "1.4.0-migration": true,
    "server-order": [0],
    "ss-rainbow": false,
    "secret-settings": false
};

function ensureSavedJson() {
    const savedPath = path.join(process.env.LOCALAPPDATA, 'CesiumGDPS', 'geode', 'mods', 'km7dev.gdps-switcher', 'saved.json');
    const dir = path.dirname(savedPath);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    let current = null;
    if (fs.existsSync(savedPath)) {
        try {
            current = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
        } catch (e) { /* corrupted, will overwrite */ }
    }

    const expected = JSON.stringify(EXPECTED_SAVED_JSON, null, 4);
    const actual = current ? JSON.stringify(current, null, 4) : null;

    if (actual !== expected) {
        fs.writeFileSync(savedPath, expected, 'utf8');
        return true;
    }
    return false;
}

function initAutoUpdater() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
        mainWindow.webContents.send('auto-updater:status', { status: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
        mainWindow.webContents.send('auto-updater:status', { status: 'available', info });
    });

    autoUpdater.on('update-not-available', () => {
        mainWindow.webContents.send('auto-updater:status', { status: 'not-available' });
    });

    autoUpdater.on('download-progress', (progress) => {
        mainWindow.webContents.send('auto-updater:progress', progress);
    });

    autoUpdater.on('update-downloaded', (info) => {
        mainWindow.webContents.send('auto-updater:status', { status: 'downloaded', info });
    });

    autoUpdater.on('error', (err) => {
        mainWindow.webContents.send('auto-updater:error', err.message);
    });

    setTimeout(() => {
        if (autoCheckUpdatesEnabled) {
            autoUpdater.checkForUpdates().catch(err => {
                console.warn('Auto-update check failed:', err.message);
            });
        }
    }, 3000);
}

let updateCheckCache = { time: 0, result: null };
const UPDATE_CACHE_TTL = 300000;

ipcMain.handle('client:checkForUpdates', async () => {
    const currentVersion = app.getVersion();
    const now = Date.now();

    if (updateCheckCache.result && (now - updateCheckCache.time) < UPDATE_CACHE_TTL) {
        return { ...updateCheckCache.result, currentVersion };
    }

    try {
        const releases = await fetchJSON('https://api.github.com/repos/Lauuuna/CesiumGDPSClient/releases', {
            'Accept': 'application/vnd.github.v3+json'
        });
        const latest = releases.find(r => !r.draft && !r.prerelease && r.tag_name);
        if (!latest) {
            const result = { currentVersion, available: false, error: 'Релизы не найдены' };
            updateCheckCache = { time: now, result };
            return result;
        }

        const remoteVersion = latest.tag_name.replace(/^v/, '');
        const result = {
            currentVersion,
            remoteVersion,
            available: remoteVersion !== currentVersion
        };
        updateCheckCache = { time: now, result };
        return result;
    } catch (err) {
        if (updateCheckCache.result) {
            return { ...updateCheckCache.result, currentVersion };
        }
        return { currentVersion, available: false, error: err.message };
    }
});

// --- IPC: app lifecycle ---

ipcMain.handle('auto-updater:setEnabled', (event, enabled) => {
    autoCheckUpdatesEnabled = enabled;
});

ipcMain.handle('rpc:setActivity', (event, { state, details }) => {
    updateDiscordActivity(state, details);
});

ipcMain.handle('shell:openExternal', (event, url) => {
    shell.openExternal(url);
});

ipcMain.handle('app:restart', () => {
    autoUpdater.quitAndInstall();
});

// --- IPC: game management ---

ipcMain.handle('game:checkInstall', (event, installDir) => {
    const exists = fs.existsSync(path.join(installDir, 'CesiumGDPS.exe'));
    console.log('[main] checkInstall:', installDir, exists);
    return exists;
});

ipcMain.handle('game:checkUpdate', async (event, installDir) => {
    console.log('[main] checkUpdate:', installDir);
    try {
        const manifest = await fetchJSON(MANIFEST_URL);
        const remoteVersion = manifest.version || '0.0.0';
        const localVersion = getLocalVersion(installDir);
        console.log('[main] checkUpdate: local', localVersion, 'remote', remoteVersion);
        return { updateAvailable: remoteVersion !== localVersion, remoteVersion, localVersion };
    } catch (error) {
        console.log('[main] checkUpdate: error', error.message);
        return { updateAvailable: false, error: error.message };
    }
});

ipcMain.handle('game:deleteGame', async (event, installDir) => {
    return await deleteDirectoryWithRetry(installDir);
});

ipcMain.handle('game:fixFiles', async (event, installDir, files) => {
    try {
        state.isPaused = false;
        const total = files.length;
        let fixed = 0;

        const localManifestPath = path.join(installDir, 'manifest.json');
        let manifest;
        if (fs.existsSync(localManifestPath)) {
            manifest = JSON.parse(fs.readFileSync(localManifestPath, 'utf8'));
        } else {
            manifest = await fetchJSON(MANIFEST_URL);
        }

        let failedFixes = [];

        for (const relPath of files) {
            await waitIfPaused();

            const fileUrl = new URL(relPath.replace(/\\/g, '/'), BASE_URL).href;
            const localPath = path.join(installDir, relPath);
            fs.mkdirSync(path.dirname(localPath), { recursive: true });

            try {
                await downloadFile(fileUrl, localPath);
                fixed++;
            } catch (err) {
                failedFixes.push(relPath);
            }

            const pct = Math.round(((fixed + 1) / total) * 100);
            event.sender.send('update-progress', {
                text: `Восстановление файлов (${fixed}/${total})`,
                percent: pct
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
            console.warn(`Не удалось восстановить ${failedFixes.length} файлов:`, failedFixes.join(', '));
        }

        return { success: true, fixed, total };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('game:verifyIntegrity', async (event, installDir) => {
    try {
        let manifest;
        const localManifestPath = path.join(installDir, 'manifest.json');

        if (fs.existsSync(localManifestPath)) {
            manifest = JSON.parse(fs.readFileSync(localManifestPath, 'utf8'));
        } else {
            manifest = await fetchJSON(MANIFEST_URL);
        }

        const entries = Object.entries(manifest.files || {}).filter(([relPath]) => {
            const normalized = relPath.replace(/\\/g, '/').toLowerCase();
            return !EXCLUDED_PATHS.some(excl => normalized.startsWith(excl));
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
            event.sender.send('update-progress', {
                text: `Проверка целостности игры (${checked}/${total})`,
                percent: pct
            });
        }

        if (corrupted.length === 0) {
            return { success: true, message: `Все ${total} файлов в порядке.` };
        } else {
            return { success: false, message: `Повреждено файлов: ${corrupted.length} из ${total}`, files: corrupted };
        }
    } catch (error) {
        return { success: false, message: 'Ошибка проверки: ' + error.message };
    }
});

ipcMain.handle('dialog:selectDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (canceled) return null;
    
    const selectedPath = filePaths[0];
    
    if (selectedPath.includes(' ')) {
        dialog.showErrorBox('Недопустимый путь', 'Путь установки не должен содержать пробелы в целях безопасности. Пожалуйста, выберите другую папку.');
        return null;
    }
    
    return selectedPath;
});

ipcMain.handle('game:pause', () => {
    state.isPaused = true;
});

ipcMain.handle('game:resume', () => {
    state.isPaused = false;
    pauseEvents.emit('resumed');
});

ipcMain.handle('game:startUpdate', async (event, installDir, skipCheck) => {
    console.log('[main] startUpdate:', installDir, 'skipCheck:', skipCheck);
    try {
        state.isPaused = false;
        state.activeRequests = [];

        if (!fs.existsSync(installDir)) {
            fs.mkdirSync(installDir, { recursive: true });
        }

        event.sender.send('update-progress', { text: 'Загрузка манифеста...', percent: 0 });
        const manifest = await fetchJSON(MANIFEST_URL);
        const remoteVersion = manifest.version || '0.0.0';
        const entries = Object.entries(manifest.files || {});
        const totalEntries = entries.length;

        let filesToUpdate = [];

        if (skipCheck) {
            for (const [relPath] of entries) {
                const localPath = path.join(installDir, relPath);
                if (!fs.existsSync(localPath)) {
                    filesToUpdate.push(relPath);
                }
            }
        } else {
            let lastSentPct = -1;
            for (let i = 0; i < totalEntries; i++) {
                await waitIfPaused();

                const [relPath, expectedHash] = entries[i];
                const localPath = path.join(installDir, relPath);
                let needsUpdate = true;

                if (fs.existsSync(localPath)) {
                    const hash = await getFileHash(localPath);
                    if (hash === expectedHash) needsUpdate = false;
                }
                if (needsUpdate) filesToUpdate.push(relPath);

                const checkPct = Math.round(((i + 1) / totalEntries) * CHECK_PERCENT);
                if (checkPct !== lastSentPct) {
                    lastSentPct = checkPct;
                    event.sender.send('update-progress', {
                        text: `Проверка файлов (${i + 1}/${totalEntries})`,
                        percent: checkPct
                    });
                }
            }
        }

        if (filesToUpdate.length === 0) {
            fs.writeFileSync(path.join(installDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
            fs.writeFileSync(path.join(installDir, 'version.json'), JSON.stringify({ version: remoteVersion }));
            event.sender.send('update-progress', { text: 'Готово!', percent: 100 });
            setTimeout(() => event.sender.send('update-complete'), 600);
            return { status: 'ready' };
        }

        event.sender.send('update-state', 'downloading');

        const downloadCount = filesToUpdate.length;
        let completedDownloads = 0;
        const startTime = Date.now();

        const speedTracker = {
            totalBytes: 0,
            lastBytes: 0,
            time: Date.now(),
            str: '0 B/s'
        };

        let failedDownloads = [];

        async function downloadWorker() {
            while (filesToUpdate.length > 0) {
                await waitIfPaused();

                const relPath = filesToUpdate.shift();
                const localPath = path.join(installDir, relPath);
                const fileUrl = new URL(relPath.replace(/\\/g, '/'), BASE_URL).href;

                fs.mkdirSync(path.dirname(localPath), { recursive: true });

                try {
                    await downloadFile(fileUrl, localPath, (chunkSize) => {
                        speedTracker.totalBytes += chunkSize;
                    });
                } catch (err) {
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
                const etaSec = Math.round(avgPerFile * (downloadCount - completedDownloads) / 1000);
                const pct = CHECK_PERCENT + Math.round((completedDownloads / downloadCount) * DOWNLOAD_PERCENT);

                let speedStr = speedTracker.str;
                if (speedTracker.totalBytes > 0 && totalElapsed > 1000) {
                    const totalBps = Math.round(speedTracker.totalBytes / totalElapsed * 1000);
                    speedStr = formatBytes(totalBps) + '/s';
                }

                event.sender.send('update-progress', {
                    text: `${pct}% — ${speedStr}${etaSec > 0 ? ' — ' + formatTime(etaSec) : ''}`,
                    percent: pct
                });
            }
        }

        const workers = [];
        for (let i = 0; i < Math.min(CONCURRENCY, downloadCount); i++) {
            workers.push(downloadWorker());
        }
        await Promise.all(workers);

        if (failedDownloads.length > 0) {
            console.warn(`Не удалось загрузить ${failedDownloads.length} файлов:`, failedDownloads.join(', '));
        }

        fs.writeFileSync(path.join(installDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        fs.writeFileSync(path.join(installDir, 'version.json'), JSON.stringify({ version: remoteVersion }));

        event.sender.send('update-progress', { text: 'Готово!', percent: 100 });
        setTimeout(() => event.sender.send('update-complete'), 600);
        return { status: 'ready' };

    } catch (error) {
        cleanupRequests();
        console.error(error);
        event.sender.send('update-error', error.message);
        return { status: 'error', message: error.message };
    }
});

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

ipcMain.handle('client:fetchLocalBackground', async () => {
    try {
        if (!fs.existsSync(BACKGROUNDS_DIR)) {
            return { error: 'backgrounds directory not found' };
        }
        const files = fs.readdirSync(BACKGROUNDS_DIR)
            .filter(f => IMAGE_EXTS.includes(path.extname(f).toLowerCase()));
        if (files.length === 0) {
            return { error: 'no images in backgrounds folder' };
        }

        const saved = loadSettings();
        const enabledBgMap = saved.enabledBackgrounds || {};
        const pool = files.filter(f => enabledBgMap[f] !== false);
        if (pool.length === 0) {
            return { error: 'no enabled backgrounds' };
        }

        const file = path.join(BACKGROUNDS_DIR, pool[Math.floor(Math.random() * pool.length)]);
        const data = fs.readFileSync(file);
        const ext = path.extname(file).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        console.log('[main] background: loaded', path.basename(file));
        return { dataUrl: `data:${mime};base64,${data.toString('base64')}` };
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('client:listBackgrounds', () => {
    try {
        if (!fs.existsSync(BACKGROUNDS_DIR)) {
            return { backgrounds: [] };
        }
        const files = fs.readdirSync(BACKGROUNDS_DIR)
            .filter(f => IMAGE_EXTS.includes(path.extname(f).toLowerCase()))
            .sort();

        const saved = loadSettings();
        const enabledBgMap = saved.enabledBackgrounds || {};

        return {
            backgrounds: files.map(name => ({
                name,
                enabled: enabledBgMap[name] !== false
            }))
        };
    } catch (err) {
        return { error: err.message, backgrounds: [] };
    }
});

ipcMain.handle('client:toggleBackground', (event, { name, enabled }) => {
    try {
        const saved = loadSettings();
        const enabledBgMap = saved.enabledBackgrounds || {};
        enabledBgMap[name] = enabled;
        saveSettings({ enabledBackgrounds: enabledBgMap });
        return { success: true };
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('client:getBackgroundFile', async (event, filename) => {
    try {
        const filePath = path.join(BACKGROUNDS_DIR, filename);
        if (!fs.existsSync(filePath)) return { error: 'file not found' };
        const ext = path.extname(filePath).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        const data = fs.readFileSync(filePath);
        return { dataUrl: `data:${mime};base64,${data.toString('base64')}` };
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('client:importBackground', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Изображения', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    });
    if (canceled || filePaths.length === 0) return { error: 'cancelled' };

    const srcPath = filePaths[0];
    const ext = path.extname(srcPath).toLowerCase();
    if (!IMAGE_EXTS.includes(ext)) {
        return { error: 'Неподдерживаемый формат изображения' };
    }

    const baseName = path.basename(srcPath);
    let name = baseName;
    let destPath = path.join(BACKGROUNDS_DIR, name);
    let counter = 1;
    while (fs.existsSync(destPath)) {
        const parsed = path.parse(baseName);
        name = `${parsed.name}_${counter}${parsed.ext}`;
        destPath = path.join(BACKGROUNDS_DIR, name);
        counter++;
    }

    try {
        fs.copyFileSync(srcPath, destPath);
        return { success: true, name };
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('game:launch', (event, installDir) => {
    const exePath = path.join(installDir, 'CesiumGDPS.exe');
    console.log('[main] launch:', exePath);
    if (!fs.existsSync(exePath)) {
        dialog.showErrorBox('Ошибка', 'CesiumGDPS.exe не найден!');
        return false;
    }

    ensureSavedJson();

    const child = exec(`"${exePath}"`, { cwd: installDir });
    child.on('error', (err) => {
        console.error('Launch error:', err.message);
    });
    child.on('close', (code) => {
        event.sender.send('game:closed', code);
    });

    return true;
});