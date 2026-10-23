const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRuntimeScan } = require('../src/runtime-discovery.cjs');
const { groupRuntimeApps, isBoundary } = require('../src/thread-apps.cjs');

const WT = 'C:\\wt\\app';
const OTHER = 'C:\\wt\\other';
const worktrees = [
  { id: 'alpha', path: WT },
  { id: 'beta', path: OTHER },
];

const proc = (pid, parentPid, name, extra = {}) => ({
  pid,
  parentPid,
  name,
  executablePath: `C:\\bin\\${name}`,
  commandLine: name,
  ...extra,
});

// claude -> bash -c -> npm -> concurrently -> { vite, run-electron -> electron -> renderer }
// plus an unrelated dev server started from an interactive terminal tab.
const processes = [
  proc(1, 0, 'WindowsTerminal.exe'),
  proc(2, 1, 'pwsh.exe', { commandLine: 'pwsh.exe' }),
  proc(3, 2, 'node.exe', { commandLine: `node ${WT}\\node_modules\\vite\\bin\\vite.js` }),
  proc(10, 1, 'claude.exe', { commandLine: `claude --cwd ${WT}` }),
  proc(20, 10, 'bash.exe', { commandLine: 'bash.exe -c npm run dev' }),
  proc(30, 20, 'node.exe', { commandLine: 'node npm-cli.js run dev' }),
  proc(40, 30, 'node.exe', { commandLine: `node ${WT}\\node_modules\\concurrently\\index.js` }),
  proc(50, 40, 'node.exe', { commandLine: `node ${WT}\\node_modules\\vite\\bin\\vite.js` }),
  proc(60, 40, 'node.exe', { commandLine: 'node scripts/run-electron.cjs' }),
  proc(70, 60, 'electron.exe', {
    executablePath: `${WT}\\node_modules\\electron\\dist\\electron.exe`,
    commandLine: `electron.exe ${WT}`,
    windowTitle: 'Thread App Manager',
  }),
  proc(71, 70, 'electron.exe', {
    executablePath: `${WT}\\node_modules\\electron\\dist\\electron.exe`,
  }),
  proc(80, 1, 'node.exe', { commandLine: `node ${OTHER}\\server.js` }),
];
const listeners = [
  { pid: 50, address: '127.0.0.1', port: 5178 },
  { pid: 3, address: '::', port: 4173 },
];

function groupedApps() {
  const scan = normalizeRuntimeScan({ worktrees, processes, listeners, platform: 'win32' });
  return groupRuntimeApps({ runtimes: scan.runtimes, processes, listeners, platform: 'win32' });
}

test('the agent is hidden and a launched app is named by its window with its launcher chain', () => {
  const apps = groupedApps().filter((app) => app.worktreeId === 'alpha');
  assert.equal(
    apps.some((app) => app.process.name === 'claude.exe'),
    false,
  );

  const [electronApp, terminalServer] = apps;
  assert.equal(electronApp.name, 'Thread App Manager');
  assert.equal(electronApp.kind, 'desktop-app');
  assert.equal(electronApp.process.pid, 70);
  assert.deepEqual(electronApp.listeners, [{ address: '127.0.0.1', port: 5178 }]);
  assert.deepEqual(
    electronApp.helpers.map(({ pid }) => pid).sort((a, b) => a - b),
    [20, 30, 40, 50, 60, 71],
  );
  assert.equal(electronApp.status, 'listening');

  assert.equal(terminalServer.name, 'Browser dev server :4173');
  assert.equal(terminalServer.process.pid, 3);
  assert.deepEqual(terminalServer.helpers, []);
});

test('apps keep their own worktree and unique ids', () => {
  const apps = groupedApps();
  assert.deepEqual(apps.map(({ worktreeId }) => worktreeId).sort(), ['alpha', 'alpha', 'beta']);
  assert.equal(new Set(apps.map(({ id }) => id)).size, apps.length);
  assert.ok(apps.every((app) => !('commandLine' in app.process)));
});

test('agents, terminals and interactive shells are boundaries but launched shells are not', () => {
  assert.equal(isBoundary({ name: 'claude.exe' }), true);
  assert.equal(isBoundary({ name: 'WindowsTerminal.exe' }), true);
  assert.equal(isBoundary({ name: 'pwsh.exe', commandLine: 'pwsh.exe' }), true);
  assert.equal(isBoundary({ name: 'bash.exe', commandLine: 'bash.exe -c npm run dev' }), false);
  assert.equal(isBoundary({ name: 'cmd.exe', commandLine: 'cmd.exe /d /s /c vite' }), false);
  assert.equal(isBoundary({ name: 'node.exe', commandLine: 'node app.js' }), false);
});

test('a runtime launched straight from an agent without a window falls back to its process name', () => {
  const lone = [proc(10, 1, 'claude.exe'), proc(11, 10, 'worker.exe', { commandLine: WT })];
  const scan = normalizeRuntimeScan({
    worktrees: [{ id: 'alpha', path: WT }],
    processes: lone,
    listeners: [],
    platform: 'win32',
  });
  const apps = groupRuntimeApps({
    runtimes: scan.runtimes,
    processes: lone,
    listeners: [],
    platform: 'win32',
  });
  assert.deepEqual(
    apps.map(({ name, kind }) => ({ name, kind })),
    [{ name: 'worker.exe', kind: 'desktop-app' }],
  );
});

test('a desktop app sorts ahead of compiler helpers and is selected as the preview', () => {
  const runtimeProcesses = [
    proc(100, 1, 'bash.exe', { commandLine: 'bash.exe -c npm run dev' }),
    proc(101, 100, 'cl.exe', {
      executablePath: 'C:\\Program Files\\Microsoft Visual Studio\\cl.exe',
      commandLine: `cl.exe /c ${WT}\\src\\main.cpp`,
    }),
    proc(200, 1, 'bash.exe', { commandLine: 'bash.exe -c GoSurvey.exe' }),
    proc(201, 200, 'GoSurvey.exe', {
      executablePath: `${WT}\\build\\GoSurvey.exe`,
      commandLine: `${WT}\\build\\GoSurvey.exe`,
    }),
  ];
  const scan = normalizeRuntimeScan({
    worktrees: [{ id: 'alpha', path: WT }],
    processes: runtimeProcesses,
    listeners: [],
    platform: 'win32',
  });
  const apps = groupRuntimeApps({
    runtimes: scan.runtimes,
    processes: runtimeProcesses,
    listeners: [],
    platform: 'win32',
  });

  assert.equal(apps[0].process.name, 'GoSurvey.exe');
  assert.equal(apps[0].kind, 'desktop-app');
  assert.equal(apps[1].process.name, 'cl.exe');
  assert.equal(apps[1].kind, 'process');
});
