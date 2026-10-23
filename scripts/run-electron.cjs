const { spawn } = require('node:child_process');
const path = require('node:path');

const electronPath = require('electron');
const projectPath = path.resolve(__dirname, '..');
const args = [projectPath, ...process.argv.slice(2)];
const env = { ...process.env };

// Some agent runtimes set this flag globally for their own Electron-based tooling.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, args, { stdio: 'inherit', env });
child.on('error', (error) => {
  console.error('Could not start Electron:', error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
