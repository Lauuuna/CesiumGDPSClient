const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');
const { autoUpdater } = require('electron-updater');

const BASE_URL = 'https://lauuuna.github.io/CesiumGDPS/CesiumGDPS/';
const MANIFEST_URL = BASE_URL + 'manifest.json';
const CONCURRENCY = 8;

let mainWindow;

const state = {
    isPaused: false,
    activeRequests: []
};

const EXCLUDED_PATHS = [
    'geode/unzipped/'
];

const keepAliveAgent = new https.Agent({
    keepAlive: true,
    maxSockets: CONCURRENCY + 4,
    keepAliveMsecs: 20000,
    freeSocketTimeout: 20000
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 600,
        minWidth: 800,
        minHeight: 500,
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'build', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
    createWindow();
    initAutoUpdater();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

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

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            headers: { 'User-Agent': 'CesiumLauncher/1.0' }
        };

        client.get(options, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchJSON(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
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
        autoUpdater.checkForUpdates();
    }, 3000);
}

ipcMain.handle('shell:openExternal', (event, url) => {
    shell.openExternal(url);
});

ipcMain.handle('app:restart', () => {
    autoUpdater.quitAndInstall();
});

ipcMain.handle('game:checkInstall', (event, installDir) => {
    return fs.existsSync(path.join(installDir, 'CesiumGDPS.exe'));
});

ipcMain.handle('game:checkUpdate', async (event, installDir) => {
    try {
        const manifest = await fetchJSON(MANIFEST_URL);
        const remoteVersion = manifest.version || '0.0.0';
        const localVersion = getLocalVersion(installDir);
        return { updateAvailable: remoteVersion !== localVersion, remoteVersion, localVersion };
    } catch (error) {
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

        for (const relPath of files) {
            while (state.isPaused) await new Promise(r => setTimeout(r, 200));

            const fileUrl = new URL(relPath.replace(/\\/g, '/'), BASE_URL).href;
            const localPath = path.join(installDir, relPath);
            fs.mkdirSync(path.dirname(localPath), { recursive: true });

            try {
                await downloadFile(fileUrl, localPath);
                fixed++;
            } catch (err) {
                console.log(`Failed to fix ${relPath}: ${err.message}`);
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
                text: `Проверка целостности (${checked}/${total})`,
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
    return canceled ? null : filePaths[0];
});

ipcMain.handle('game:pause', () => {
    state.isPaused = true;
});

ipcMain.handle('game:resume', () => {
    state.isPaused = false;
});

ipcMain.handle('game:startUpdate', async (event, installDir, skipCheck) => {
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
                while (state.isPaused) await new Promise(r => setTimeout(r, 200));

                const [relPath, expectedHash] = entries[i];
                const localPath = path.join(installDir, relPath);
                let needsUpdate = true;

                if (fs.existsSync(localPath)) {
                    const hash = await getFileHash(localPath);
                    if (hash === expectedHash) needsUpdate = false;
                }
                if (needsUpdate) filesToUpdate.push(relPath);

                const checkPct = Math.round(((i + 1) / totalEntries) * 30);
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

        async function downloadWorker() {
            while (filesToUpdate.length > 0) {
                while (state.isPaused) {
                    speedTracker.time = Date.now();
                    speedTracker.lastBytes = speedTracker.totalBytes;
                    await new Promise(r => setTimeout(r, 200));
                }

                const relPath = filesToUpdate.shift();
                const localPath = path.join(installDir, relPath);
                const fileUrl = new URL(relPath.replace(/\\/g, '/'), BASE_URL).href;

                fs.mkdirSync(path.dirname(localPath), { recursive: true });

                try {
                    await downloadFile(fileUrl, localPath, (chunkSize) => {
                        speedTracker.totalBytes += chunkSize;
                    });
                } catch (err) {
                    console.log(`Skipped ${relPath}: ${err.message}`);
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
                const pct = 30 + Math.round((completedDownloads / downloadCount) * 70);

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

ipcMain.handle('game:launch', (event, installDir) => {
    const exePath = path.join(installDir, 'CesiumGDPS.exe');
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