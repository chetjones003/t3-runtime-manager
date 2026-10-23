const { execFile } = require('node:child_process');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const collectorScript = path.join(__dirname, 'collect-windows-runtimes.ps1');

async function collectWindowsRuntimeData() {
  if (process.platform !== 'win32') {
    return {
      processes: [],
      listeners: [],
      limitations: ['Windows runtime discovery is not available on this operating system.'],
    };
  }

  let stdout;
  try {
    const script = await readFile(collectorScript, 'utf8');
    ({ stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ], {
      windowsHide: true,
      timeout: 20000,
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8',
    }));
  } catch {
    throw new Error('The Windows process and listener scan could not complete.');
  }

  try {
    const data = JSON.parse(stdout);
    return {
      processes: Array.isArray(data.processes) ? data.processes : [],
      listeners: Array.isArray(data.listeners) ? data.listeners : [],
      limitations: Array.isArray(data.limitations) ? data.limitations : [],
    };
  } catch {
    throw new Error('Windows discovery returned invalid scan data.');
  }
}

module.exports = { collectWindowsRuntimeData };
