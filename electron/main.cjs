const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  safeStorage,
  session,
  shell,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { collectRuntimeData } = require('./runtime-collector.cjs');
const { normalizeRuntimeScan } = require('../src/runtime-discovery.cjs');
const { groupRuntimeApps } = require('../src/thread-apps.cjs');
const { createT3Service } = require('./t3-service.cjs');
const { createTakeControlService } = require('./take-control-service.cjs');

let mainWindow;
const pendingDisplaySources = new Map();

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

ipcMain.handle('runtime:preview-input', (event, runtimeId, input) => {
  assertTrustedSender(event, 'Preview input');
  if (typeof runtimeId !== 'string' || runtimeId.length > 200) throw new Error('Invalid runtime.');
  return takeControl.sendPreviewInput(runtimeId, input);
});

ipcMain.handle('window:control', (event, action) => {
  assertTrustedSender(event, 'Window controls');
  if (process.platform !== 'win32' || !mainWindow) return false;
  if (action === 'state') return mainWindow.isMaximized();
  if (action === 'minimize') {
    mainWindow.minimize();
    return false;
  }
  if (action === 'toggle-maximize') {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  }
  if (action === 'close') {
    mainWindow.close();
    return true;
  }
  throw new Error('Invalid window control action.');
});

ipcMain.handle('runtime:embed-window', (event, runtimeId, bounds) => {
  assertTrustedSender(event, 'Runtime window embedding');
  if (typeof runtimeId !== 'string' || runtimeId.length > 200) throw new Error('Invalid runtime.');
  const hostHandle = ownWindowHandle();
  if (!hostHandle) throw new Error('The manager window is unavailable.');
  return takeControl.embedWindow(runtimeId, hostHandle, bounds);
});

ipcMain.handle('runtime:update-embedded-window', (event, runtimeId, bounds) => {
  assertTrustedSender(event, 'Embedded window sizing');
  if (typeof runtimeId !== 'string' || runtimeId.length > 200) throw new Error('Invalid runtime.');
  return takeControl.updateEmbeddedWindow(runtimeId, bounds);
});

ipcMain.handle('runtime:restore-embedded-window', (event, runtimeId) => {
  assertTrustedSender(event, 'Embedded window restore');
  if (typeof runtimeId !== 'string' || runtimeId.length > 200) throw new Error('Invalid runtime.');
  return takeControl.restoreEmbeddedWindow(runtimeId);
});

function ownWindowHandle() {
  if (!mainWindow || process.platform !== 'win32') return null;
  const buffer = mainWindow.getNativeWindowHandle();
  return buffer.length >= 8 ? String(buffer.readBigUInt64LE(0)) : String(buffer.readUInt32LE(0));
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

  const preview = await takeControl.getPreview(runtimeId);
  if (preview.kind !== 'window') return preview;
  // Mirroring this window into itself would only show an endless tunnel of itself.
  if (preview.handle === ownWindowHandle()) return { kind: 'self' };

  let source;
  // A hidden Qt window may need a moment after ShowWindow before Windows exposes it
  // through the desktop capture API.
  for (let attempt = 0; attempt < 5 && !source; attempt += 1) {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
    });
    source = sources.find((candidate) => candidate.id.startsWith(`window:${preview.handle}:`));
    if (!source && attempt < 4) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!source) return { kind: 'none' };
  pendingDisplaySources.set(event.sender.id, source);
  return { kind: 'window', sourceId: source.id };
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
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1400, Math.max(920, workArea.width - 40));
  const height = Math.min(900, Math.max(650, workArea.height - 40));
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(920, width),
    minHeight: Math.min(650, height),
    backgroundColor: '#0b0e13',
    icon: path.join(__dirname, '../assets/icon.png'),
    title: 'T3 Runtime Manager',
    frame: process.platform !== 'win32',
    autoHideMenuBar: process.platform === 'win32',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (process.platform === 'win32') {
    mainWindow.setMenuBarVisibility(false);
    const publishWindowState = () =>
      mainWindow?.webContents.send('window:state', mainWindow.isMaximized());
    mainWindow.on('maximize', publishWindowState);
    mainWindow.on('unmaximize', publishWindowState);
  }

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
    takeControl.restoreAllEmbeds().finally(() => mainWindow?.destroy());
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.t3code.runtimemanager');

  const mayCaptureDisplay = (webContents, permission, requestingUrl, isMainFrame) =>
    permission === 'display-capture' &&
    isMainFrame === true &&
    Boolean(mainWindow && webContents === mainWindow.webContents) &&
    isTrustedCockpitUrl(requestingUrl);

  session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) =>
    mayCaptureDisplay(webContents, permission, details?.requestingUrl, details?.isMainFrame),
  );
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) =>
    callback(
      mayCaptureDisplay(webContents, permission, details?.requestingUrl, details?.isMainFrame),
    ),
  );
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (
        !mainWindow ||
        request.frame !== mainWindow.webContents.mainFrame ||
        !isTrustedCockpitUrl(request.securityOrigin) ||
        !request.videoRequested
      ) {
        callback(null);
        return;
      }
      const source = mainWindow && pendingDisplaySources.get(mainWindow.webContents.id);
      if (mainWindow) pendingDisplaySources.delete(mainWindow.webContents.id);
      if (!source) {
        callback(null);
        return;
      }
      callback({ video: source });
    },
    { useSystemPicker: false },
  );
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
