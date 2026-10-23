const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { collectWindowsRuntimeData } = require('./windows-runtime-collector.cjs');
const { normalizeRuntimeScan } = require('../src/runtime-discovery.cjs');

let mainWindow;

function validateWorktrees(worktrees) {
  if (!Array.isArray(worktrees) || worktrees.length > 100) {
    throw new Error('Invalid worktree list.');
  }

  const ids = new Set();
  return worktrees.map((worktree) => {
    if (
      !worktree ||
      typeof worktree.id !== 'string' ||
      typeof worktree.path !== 'string' ||
      worktree.id.length > 200 ||
      worktree.path.length > 4096 ||
      !worktree.path.trim() ||
      ids.has(worktree.id)
    ) {
      throw new Error('Invalid worktree list.');
    }
    ids.add(worktree.id);
    return { id: worktree.id, path: worktree.path };
  });
}

ipcMain.handle('runtime-discovery:scan', async (event, requestedWorktrees) => {
  const senderUrl = event.senderFrame?.url;
  const trustedUrl = app.isPackaged
    ? senderUrl === pathToFileURL(path.join(__dirname, '../dist/index.html')).href
    : (() => {
        try {
          const url = new URL(senderUrl);
          return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '5178';
        } catch {
          return false;
        }
      })();

  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    !trustedUrl
  ) {
    throw new Error('Runtime discovery is only available to the cockpit window.');
  }

  const worktrees = validateWorktrees(requestedWorktrees);
  const collected = await collectWindowsRuntimeData();
  const scan = normalizeRuntimeScan({ ...collected, worktrees, platform: process.platform });
  return {
    ...scan,
    platform: process.platform,
    scannedAt: new Date().toISOString(),
  };
});

app.setName('ThreadAppManager');
app.setPath('userData', path.join(app.getPath('appData'), 'ThreadAppManager'));

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
