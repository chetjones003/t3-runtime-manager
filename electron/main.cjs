const { app, BrowserWindow, ipcMain, safeStorage, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { collectRuntimeData } = require('./runtime-collector.cjs');
const { normalizeRuntimeScan } = require('../src/runtime-discovery.cjs');
const { groupRuntimeApps } = require('../src/thread-apps.cjs');
const { placePreviewHost } = require('../src/preview-bounds.cjs');
const { createT3Service } = require('./t3-service.cjs');
const { createTakeControlService } = require('./take-control-service.cjs');

let mainWindow;
let previewHostWindow;
let previewBounds;
let previewHostReady;
let activePreviewRuntimeId;
let pendingNativeResize;
let nativeResizeTimer;
let nativeResizeRunning = false;

function validateWorktrees(worktrees) {
  if (!Array.isArray(worktrees)) throw new Error('Invalid worktree list: expected an array.');
  if (worktrees.length > 500) throw new Error('Invalid worktree list: more than 500 entries.');

  const ids = new Set();
  return worktrees.map((worktree) => {
    if (!worktree || typeof worktree.id !== 'string' || typeof worktree.path !== 'string') {
      throw new Error('Invalid worktree list: each entry needs a string id and path.');
    }
    if (worktree.id.length > 512 || worktree.path.length > 4096 || !worktree.path.trim()) {
      throw new Error(
        `Invalid worktree list: an id or path has an unsupported length (${worktree.id.length}, ${worktree.path.length}).`,
      );
    }
    if (ids.has(worktree.id)) throw new Error('Invalid worktree list: duplicate thread id.');
    ids.add(worktree.id);
    return { id: worktree.id, path: worktree.path };
  });
}

const takeControl = createTakeControlService({ openExternal: (url) => shell.openExternal(url) });

ipcMain.handle('runtime:take-control', (event, runtimeId) => {
  assertTrustedSender(event, 'Take Control');
  if (typeof runtimeId !== 'string' || runtimeId.length > 200) throw new Error('Invalid runtime.');
  return takeControl.takeControl(runtimeId);
});

ipcMain.handle('runtime:embed-window', async (event, runtimeId, bounds) => {
  assertTrustedSender(event, 'Runtime window embedding');
  if (typeof runtimeId !== 'string' || runtimeId.length > 200) throw new Error('Invalid runtime.');
  if (!validPreviewBounds(bounds)) throw new Error('Invalid preview bounds.');
  const hostHandle = await showPreviewHost(bounds);
  if (!hostHandle) throw new Error('The native preview host is unavailable.');
  const embedded = await takeControl.embedWindow(runtimeId, hostHandle, bounds);
  if (embedded) activePreviewRuntimeId = runtimeId;
  return embedded;
});

ipcMain.handle('runtime:update-embedded-window', (event, runtimeId, bounds) => {
  assertTrustedSender(event, 'Embedded window sizing');
  if (typeof runtimeId !== 'string' || runtimeId.length > 200) throw new Error('Invalid runtime.');
  if (!validPreviewBounds(bounds)) throw new Error('Invalid preview bounds.');
  positionPreviewHost(bounds);
  activePreviewRuntimeId = runtimeId;
  return scheduleNativeResize(runtimeId, bounds);
});

ipcMain.handle('runtime:hide-preview', (event) => {
  assertTrustedSender(event, 'Runtime preview');
  previewHostWindow?.hide();
  previewBounds = null;
  activePreviewRuntimeId = null;
});

function nativeHandle(window) {
  if (!window || process.platform !== 'win32') return null;
  const buffer = window.getNativeWindowHandle();
  return buffer.length >= 8 ? String(buffer.readBigUInt64LE(0)) : String(buffer.readUInt32LE(0));
}

function validPreviewBounds(bounds) {
  return (
    bounds &&
    ['x', 'y', 'width', 'height'].every((key) => Number.isInteger(bounds[key])) &&
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.x <= 10000 &&
    bounds.y <= 10000 &&
    bounds.width >= 100 &&
    bounds.height >= 100 &&
    bounds.width <= 10000 &&
    bounds.height <= 10000
  );
}

function previewScreenBounds(bounds) {
  const content = mainWindow.getContentBounds();
  return placePreviewHost(content, bounds);
}

function positionPreviewHost(bounds) {
  if (!previewHostWindow || previewHostWindow.isDestroyed() || !mainWindow) return false;
  previewBounds = bounds;
  previewHostWindow.setBounds(previewScreenBounds(bounds), false);
  return true;
}

function repositionPreviewHost() {
  if (!previewBounds || !activePreviewRuntimeId || !positionPreviewHost(previewBounds)) return;
  scheduleNativeResize(activePreviewRuntimeId, previewBounds).catch(() => {});
}

function scheduleNativeResize(runtimeId, bounds) {
  return new Promise((resolve) => {
    if (pendingNativeResize) {
      pendingNativeResize.runtimeId = runtimeId;
      pendingNativeResize.bounds = bounds;
      pendingNativeResize.waiters.push(resolve);
    } else {
      pendingNativeResize = { runtimeId, bounds, waiters: [resolve] };
    }
    if (nativeResizeTimer) clearTimeout(nativeResizeTimer);
    if (!nativeResizeRunning) nativeResizeTimer = setTimeout(flushNativeResize, 40);
  });
}

async function flushNativeResize() {
  nativeResizeTimer = null;
  if (nativeResizeRunning || !pendingNativeResize) return;
  nativeResizeRunning = true;
  const job = pendingNativeResize;
  pendingNativeResize = null;
  let updated = false;
  try {
    updated = await takeControl.updateEmbeddedWindow(job.runtimeId, job.bounds);
  } catch {
    updated = false;
  }
  job.waiters.forEach((resolve) => resolve(updated));
  nativeResizeRunning = false;
  if (pendingNativeResize && !nativeResizeTimer)
    nativeResizeTimer = setTimeout(flushNativeResize, 40);
}

async function showPreviewHost(bounds) {
  if (process.platform !== 'win32' || !mainWindow) return null;
  if (!previewHostWindow || previewHostWindow.isDestroyed()) {
    previewHostWindow = new BrowserWindow({
      parent: mainWindow,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      skipTaskbar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    previewHostReady = previewHostWindow.loadURL(
      'data:text/html,<html><head><style>html,body{margin:0;width:100%25;height:100%25;background:transparent;overflow:hidden}</style></head><body></body></html>',
    );
    previewHostWindow.on('closed', () => {
      previewHostWindow = null;
      previewHostReady = null;
    });
  }
  await previewHostReady;
  positionPreviewHost(bounds);
  previewHostWindow.showInactive();
  return nativeHandle(previewHostWindow);
}

function isTrustedCockpitUrl(senderUrl) {
  if (app.isPackaged) {
    return senderUrl === pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
  }
  try {
    const url = new URL(senderUrl);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '5178';
  } catch {
    return false;
  }
}

ipcMain.handle('runtime:preview', async (event, runtimeId) => {
  assertTrustedSender(event, 'Runtime preview');
  if (typeof runtimeId !== 'string' || runtimeId.length > 200) throw new Error('Invalid runtime.');

  return takeControl.getPreview(runtimeId);
});

function assertTrustedSender(event, feature) {
  const senderUrl = event.senderFrame?.url;

  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedCockpitUrl(senderUrl)
  ) {
    throw new Error(`${feature} is only available to the cockpit window.`);
  }
}

ipcMain.handle('runtime-discovery:scan', async (event, requestedWorktrees) => {
  assertTrustedSender(event, 'Runtime discovery');

  const worktrees = validateWorktrees(requestedWorktrees);
  const collected = await collectRuntimeData();
  const scan = normalizeRuntimeScan({ ...collected, worktrees, platform: process.platform });
  const apps = groupRuntimeApps({
    runtimes: scan.runtimes,
    processes: collected.processes,
    listeners: collected.listeners,
    platform: process.platform,
  });
  takeControl.remember(apps);
  return {
    runtimes: apps,
    limitations: scan.limitations,
    state: scan.state,
    platform: process.platform,
    scannedAt: new Date().toISOString(),
  };
});

app.setName('ThreadAppManager');
app.setPath('userData', path.join(app.getPath('appData'), 'ThreadAppManager'));

// The T3 token is only persisted when the OS can encrypt it; otherwise it lives in memory.
const tokenFile = () => path.join(app.getPath('userData'), 't3-token.bin');
const t3Service = createT3Service({
  tokenStore: {
    async load() {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) return null;
      try {
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(
          fs.readFileSync(tokenFile()),
        );
        if (shouldReEncrypt)
          fs.writeFileSync(tokenFile(), await safeStorage.encryptStringAsync(result));
        return result;
      } catch {
        return null;
      }
    },
    async save(value) {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) return;
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      fs.writeFileSync(tokenFile(), await safeStorage.encryptStringAsync(value));
    },
    clear() {
      fs.rmSync(tokenFile(), { force: true });
    },
  },
  openExternal: (url) => shell.openExternal(url),
});

ipcMain.handle('t3:threads', (event) => {
  assertTrustedSender(event, 'T3 threads');
  return t3Service.getThreads();
});

ipcMain.handle('t3:connect', (event, code) => {
  assertTrustedSender(event, 'T3 connect');
  return t3Service.connect(code);
});

ipcMain.handle('t3:open-thread', (event, threadId) => {
  assertTrustedSender(event, 'T3 thread links');
  if (typeof threadId !== 'string' || threadId.length > 200) throw new Error('Invalid thread.');
  return t3Service.openThread(threadId);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 920,
    minHeight: 650,
    backgroundColor: '#0b0e13',
    title: 'Thread App Manager',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (process.argv.includes('--dev')) {
    mainWindow.loadURL('http://127.0.0.1:5178');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  let closing = false;
  mainWindow.on('close', (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    takeControl.restoreAllEmbeds().finally(() => {
      previewHostWindow?.destroy();
      mainWindow?.destroy();
    });
  });

  mainWindow.on('closed', () => {
    previewHostWindow?.destroy();
    mainWindow = null;
  });
  mainWindow.on('move', () => {
    if (previewBounds) positionPreviewHost(previewBounds);
  });
  mainWindow.on('resize', repositionPreviewHost);
}

app.whenReady().then(() => {
  createWindow();
  screen.on('display-metrics-changed', repositionPreviewHost);
  screen.on('display-added', repositionPreviewHost);
  screen.on('display-removed', repositionPreviewHost);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
