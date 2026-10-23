const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/macos-runtime-scan.json');
const { normalizeRuntimeScan } = require('../src/runtime-discovery.cjs');
const {
  collectMacosRuntimeData,
  parseLsofListeners,
  parseMacosProcesses,
} = require('../electron/macos-runtime-collector.cjs');

const psCommands = `    1     0 /sbin/launchd
 4100     1 node /Users/dev/alpha/node_modules/vite/bin/vite.js --port 4173
 5200     1 /Users/dev/beta/build/My App.app/Contents/MacOS/My App
 6400     1 (kernel_task)
`;
const psComm = `    1 /sbin/launchd
 4100 /usr/local/bin/node
 5200 /Users/dev/beta/build/My App.app/Contents/MacOS/My App
 6400 kernel_task
`;
const lsof = `p4100
f12
n127.0.0.1:4173
f13
n[::1]:4173
p6300
n*:8080
n*:*
`;

test('ps output is parsed into process records, keeping paths with spaces', () => {
  const processes = parseMacosProcesses(psCommands, psComm);
  assert.deepEqual(processes[1], {
    pid: 4100,
    parentPid: 1,
    name: 'node',
    executablePath: '/usr/local/bin/node',
    commandLine: 'node /Users/dev/alpha/node_modules/vite/bin/vite.js --port 4173',
  });
  assert.equal(
    processes[2].executablePath,
    '/Users/dev/beta/build/My App.app/Contents/MacOS/My App',
  );
  assert.equal(processes[2].name, 'My App');
  assert.equal(processes[3].executablePath, null);
  assert.equal(processes[3].name, 'kernel_task');
});

test('lsof field output is parsed into listeners per owning process', () => {
  assert.deepEqual(parseLsofListeners(lsof), [
    { pid: 4100, address: '127.0.0.1', port: 4173 },
    { pid: 4100, address: '::1', port: 4173 },
    { pid: 6300, address: '0.0.0.0', port: 8080 },
  ]);
});

test('the collector runs ps and lsof and tolerates lsof exiting non-zero with partial output', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (file.endsWith('lsof')) throw Object.assign(new Error('exit 1'), { code: 1, stdout: lsof });
    return { stdout: args.includes('pid=,ppid=,command=') ? psCommands : psComm };
  };
  const data = await collectMacosRuntimeData({ platform: 'darwin', exec });
  assert.equal(data.processes.length, 4);
  assert.equal(data.listeners.length, 3);
  assert.deepEqual(data.limitations, []);
  assert.equal(calls.length, 3);
});

test('a failing listener scan yields a partial result instead of failing', async () => {
  const exec = async (file, args) => {
    if (file.endsWith('lsof')) throw new Error('denied');
    return { stdout: args.includes('pid=,ppid=,command=') ? psCommands : psComm };
  };
  const data = await collectMacosRuntimeData({ platform: 'darwin', exec });
  assert.equal(data.listeners.length, 0);
  assert.deepEqual(data.limitations, [
    'macOS TCP listener ownership is unavailable for this scan.',
  ]);
});

test('the collector throws when nothing could be collected and is inert off macOS', async () => {
  const exec = async () => {
    throw new Error('nope');
  };
  await assert.rejects(collectMacosRuntimeData({ platform: 'darwin', exec }));
  const other = await collectMacosRuntimeData({ platform: 'linux', exec });
  assert.equal(other.processes.length, 0);
  assert.equal(other.limitations.length, 1);
});

test('macOS scans use the shared matching, classification and grouping', () => {
  const result = normalizeRuntimeScan({ ...fixture, platform: 'darwin' });
  assert.deepEqual(
    result.runtimes.map(
      ({ worktreeId, kind, kindLabel, status, confidence, process, helpers }) => ({
        worktreeId,
        kind,
        kindLabel,
        status,
        confidence,
        pid: process.pid,
        helpers: helpers.map(({ pid }) => pid),
      }),
    ),
    [
      {
        worktreeId: 'alpha',
        kind: 'browser-dev-server',
        kindLabel: 'Browser dev server',
        status: 'listening',
        confidence: 'direct',
        pid: 4100,
        helpers: [4101],
      },
      {
        worktreeId: 'beta',
        kind: 'desktop-app',
        kindLabel: 'macOS app',
        status: 'running',
        confidence: 'direct',
        pid: 5200,
        helpers: [],
      },
    ],
  );
  assert.deepEqual(
    result.unmatched.map(({ process }) => process.pid),
    [6300],
  );
  assert.equal(JSON.stringify(result).includes('commandLine'), false);
  assert.equal(result.state, 'partial');
  assert.ok(result.limitations.some((text) => text.includes('Executable path metadata')));
  assert.ok(result.limitations.some((text) => text.includes('listening endpoint owners')));
});

test('macOS matching ignores case and resolves the /private symlink aliases', () => {
  const result = normalizeRuntimeScan({
    worktrees: [{ id: 'alpha', path: '/tmp/Alpha' }],
    processes: [
      {
        pid: 10,
        parentPid: 1,
        name: 'tool',
        executablePath: '/private/tmp/alpha/bin/tool',
        commandLine: null,
      },
    ],
    listeners: [],
    platform: 'darwin',
  });
  assert.deepEqual(
    result.runtimes.map(({ worktreeId }) => worktreeId),
    ['alpha'],
  );
});

test('real macOS ps output captured on a GitHub runner parses, including non-path comm values and racing pids', () => {
  const dir = path.join(__dirname, 'fixtures', 'macos-captured');
  const processes = parseMacosProcesses(
    fs.readFileSync(path.join(dir, 'ps-command.txt'), 'utf8'),
    fs.readFileSync(path.join(dir, 'ps-comm.txt'), 'utf8'),
  );

  assert.deepEqual(
    processes.map(({ pid, name, executablePath }) => ({ pid, name, executablePath })),
    [
      { pid: 1, name: 'launchd', executablePath: '/sbin/launchd' },
      { pid: 86, name: 'logd', executablePath: '/usr/libexec/logd' },
      { pid: 252, name: 'Core Audio Driver (NullAudio.driver)', executablePath: null },
      { pid: 985, name: '', executablePath: null },
    ],
  );
  assert.equal(processes[3].commandLine, 'ps -axww -o pid=,ppid=,command=');
});
