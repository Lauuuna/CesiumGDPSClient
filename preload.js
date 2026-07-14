const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
    startUpdate: (installDir, skipCheck) => ipcRenderer.invoke('game:startUpdate', installDir, skipCheck),
    launchGame: (installDir) => ipcRenderer.invoke('game:launch', installDir),
    checkInstall: (installDir) => ipcRenderer.invoke('game:checkInstall', installDir),
    checkUpdate: (installDir) => ipcRenderer.invoke('game:checkUpdate', installDir),
    deleteGame: (installDir) => ipcRenderer.invoke('game:deleteGame', installDir),
    verifyIntegrity: (installDir) => ipcRenderer.invoke('game:verifyIntegrity', installDir),
    fixFiles: (installDir, files) => ipcRenderer.invoke('game:fixFiles', installDir, files),

    pauseUpdate: () => ipcRenderer.invoke('game:pause'),
    resumeUpdate: () => ipcRenderer.invoke('game:resume'),

    onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (event, data) => callback(data)),
    onUpdateComplete: (callback) => ipcRenderer.on('update-complete', () => callback()),
    onUpdateError: (callback) => ipcRenderer.on('update-error', (event, error) => callback(error)),
    onUpdateState: (callback) => ipcRenderer.on('update-state', (event, state) => callback(state)),
    onGameClosed: (callback) => ipcRenderer.on('game:closed', (event, code) => callback(code)),

    checkForClientUpdates: () => ipcRenderer.invoke('client:checkForUpdates'),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    restartAndUpdate: () => ipcRenderer.invoke('app:restart'),

    onAutoUpdaterStatus: (callback) => ipcRenderer.on('auto-updater:status', (event, data) => callback(data)),
    onAutoUpdaterProgress: (callback) => ipcRenderer.on('auto-updater:progress', (event, data) => callback(data)),
    onAutoUpdaterError: (callback) => ipcRenderer.on('auto-updater:error', (event, data) => callback(data)),
});
