const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'threadAppManager',
  Object.freeze({
    discoverRuntimes: (worktrees) => ipcRenderer.invoke('runtime-discovery:scan', worktrees),
    getRuntimePreview: (runtimeId) => ipcRenderer.invoke('runtime:preview', runtimeId),
    embedRuntimeWindow: (runtimeId, bounds) =>
      ipcRenderer.invoke('runtime:embed-window', runtimeId, bounds),
    updateEmbeddedRuntimeWindow: (runtimeId, bounds) =>
      ipcRenderer.invoke('runtime:update-embedded-window', runtimeId, bounds),
    hideRuntimePreview: () => ipcRenderer.invoke('runtime:hide-preview'),
    takeControl: (runtimeId) => ipcRenderer.invoke('runtime:take-control', runtimeId),
    getT3Threads: () => ipcRenderer.invoke('t3:threads'),
    connectT3: (code) => ipcRenderer.invoke('t3:connect', code),
    openT3Thread: (threadId) => ipcRenderer.invoke('t3:open-thread', threadId),
  }),
);
