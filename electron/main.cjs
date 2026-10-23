const { app, BrowserWindow } = require('electron');
const path = require('node:path');

app.setName('ThreadAppManager');
app.setPath('userData', path.join(app.getPath('appData'), 'ThreadAppManager'));

function createWindow() {
  const window = new BrowserWindow({
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
    },
  });

  if (process.argv.includes('--dev')) {
    window.loadURL('http://127.0.0.1:5178');
  } else {
    window.loadFile(path.join(__dirname, '../dist/index.html'));
  }
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
