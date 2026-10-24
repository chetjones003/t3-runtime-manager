const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'threadAppManager',
  Object.freeze({
    discoverRuntimes: (worktrees) => ipcRenderer.invoke('runtime-discovery:scan', worktrees),
    getRuntimePreview: (runtimeId) => ipcRenderer.invoke('runtime:preview', runtimeId),
    sendPreviewInput: (runtimeId, input) =>
      ipcRenderer.invoke('runtime:preview-input', runtimeId, input),
    embedRuntimeWindow: (runtimeId, bounds) =>
      ipcRenderer.invoke('runtime:embed-window', runtimeId, bounds),
    updateEmbeddedRuntimeWindow: (runtimeId, bounds) =>
      ipcRenderer.invoke('runtime:update-embedded-window', runtimeId, bounds),
    restoreEmbeddedRuntimeWindow: (runtimeId) =>
      ipcRenderer.invoke('runtime:restore-embedded-window', runtimeId),
    parkEmbeddedRuntimeWindow: (runtimeId) =>
      ipcRenderer.invoke('runtime:park-embedded-window', runtimeId),
    prepareEmbeddedRuntimeWindows: (runtimeIds) =>
      ipcRenderer.invoke('runtime:prepare-embedded-windows', runtimeIds),
    takeControl: (runtimeId) => ipcRenderer.invoke('runtime:take-control', runtimeId),
    getT3Threads: () => ipcRenderer.invoke('t3:threads'),
    connectT3: (code) => ipcRenderer.invoke('t3:connect', code),
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
    onWindowState: (callback) => {
      const listener = (_event, maximized) => callback(maximized);
      ipcRenderer.on('window:state', listener);
      return () => ipcRenderer.removeListener('window:state', listener);
    },
  }),
);
