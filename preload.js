const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),

    setAutoCheckUpdates: (enabled) => ipcRenderer.invoke('auto-updater:setEnabled', enabled),
    checkForClientUpdates: () => ipcRenderer.invoke('client:checkForUpdates'),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    restartAndUpdate: () => ipcRenderer.invoke('app:restart'),
    checkInstall: (dir) => ipcRenderer.invoke('game:checkInstall', dir),
    checkUpdate: (dir) => ipcRenderer.invoke('game:checkUpdate', dir),
    deleteGame: (dir) => ipcRenderer.invoke('game:deleteGame', dir),
    fixFiles: (dir, files) => ipcRenderer.invoke('game:fixFiles', dir, files),
    verifyIntegrity: (dir) => ipcRenderer.invoke('game:verifyIntegrity', dir),
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
    pauseUpdate: () => ipcRenderer.invoke('game:pause'),
    resumeUpdate: () => ipcRenderer.invoke('game:resume'),
    startUpdate: (dir, skip) => ipcRenderer.invoke('game:startUpdate', dir, skip),
    launchGame: (dir) => ipcRenderer.invoke('game:launch', dir),
    setRpcActivity: (activity) => ipcRenderer.invoke('rpc:setActivity', activity),
    fetchLocalBackground: () => ipcRenderer.invoke('client:fetchLocalBackground'),
    listBackgrounds: () => ipcRenderer.invoke('client:listBackgrounds'),
    toggleBackground: (name, enabled) => ipcRenderer.invoke('client:toggleBackground', { name, enabled }),
    getBackgroundFile: (filename) => ipcRenderer.invoke('client:getBackgroundFile', filename),
    importBackground: () => ipcRenderer.invoke('client:importBackground'),

    onUpdateState: (callback) => ipcRenderer.on('update-state', (e, state) => callback(state)),
    onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (e, data) => callback(data)),
    onUpdateComplete: (callback) => ipcRenderer.on('update-complete', () => callback()),
    onUpdateError: (callback) => ipcRenderer.on('update-error', (e, err) => callback(err)),
    onGameClosed: (callback) => ipcRenderer.on('game:closed', (e, code) => callback(code)),
    onAutoUpdaterStatus: (callback) => ipcRenderer.on('auto-updater:status', (e, data) => callback(data)),
    onAutoUpdaterError: (callback) => ipcRenderer.on('auto-updater:error', (e, err) => callback(err))
});
