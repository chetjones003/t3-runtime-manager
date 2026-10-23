const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('threadAppManager', Object.freeze({
  discoverRuntimes: (worktrees) => ipcRenderer.invoke('runtime-discovery:scan', worktrees),
}));
