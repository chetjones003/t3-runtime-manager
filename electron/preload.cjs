const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'threadAppManager',
  Object.freeze({
    discoverRuntimes: (worktrees) => ipcRenderer.invoke('runtime-discovery:scan', worktrees),
    getRuntimePreview: (runtimeId) => ipcRenderer.invoke('runtime:preview', runtimeId),
    sendPreviewInput: (runtimeId, input) =>
      ipcRenderer.invoke('runtime:preview-input', runtimeId, input),
    presentRuntimeWindow: (runtimeId, bounds, visible) =>
      ipcRenderer.invoke('runtime:present-window', runtimeId, bounds, visible),
    restorePresentedRuntimeWindow: (runtimeId) =>
      ipcRenderer.invoke('runtime:restore-presented-window', runtimeId),
    takeControl: (runtimeId) => ipcRenderer.invoke('runtime:take-control', runtimeId),
    getT3Threads: () => ipcRenderer.invoke('t3:threads'),
    connectT3: (code) => ipcRenderer.invoke('t3:connect', code),
    getT3Connection: () => ipcRenderer.invoke('t3:connection'),
    disconnectT3: () => ipcRenderer.invoke('t3:disconnect'),
    openT3Thread: (threadId) => ipcRenderer.invoke('t3:open-thread', threadId),
    getUpdateState: () => ipcRenderer.invoke('update:state'),
    checkForUpdates: () => ipcRenderer.invoke('update:check'),
    installUpdate: () => ipcRenderer.invoke('update:install'),
    cancelUpdate: () => ipcRenderer.invoke('update:cancel'),
    openReleasePage: () => ipcRenderer.invoke('update:open-release'),
    onUpdateState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('update:state', listener);
      return () => ipcRenderer.removeListener('update:state', listener);
    },
    platform: process.platform,
    controlWindow: (action) => ipcRenderer.invoke('window:control', action),
    setWindowFullscreen: (fullscreen) => ipcRenderer.invoke('window:fullscreen', fullscreen),
    onWindowState: (callback) => {
      const listener = (_event, maximized) => callback(maximized);
      ipcRenderer.on('window:state', listener);
      return () => ipcRenderer.removeListener('window:state', listener);
    },
  }),
);
