const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/windows-runtime-scan.json');
const { normalizeRuntimeScan } = require('../src/runtime-discovery.cjs');

test('the scan links direct worktree references and groups listeners and helpers without exposing command lines', () => {
  const result = normalizeRuntimeScan({ ...fixture, platform: 'win32' });

  assert.deepEqual(
    result.runtimes.map(({ worktreeId, kind, status, listeners, process, helpers }) => ({
      worktreeId,
      kind,
      status,
      listeners,
      pid: process.pid,
      helpers: helpers.map(({ pid }) => pid),
    })),
    [
      {
        worktreeId: 'alpha',
        kind: 'browser-dev-server',
        status: 'listening',
        listeners: [
          { address: '127.0.0.1', port: 4173 },
          { address: '::', port: 4173 },
        ],
        pid: 4100,
        helpers: [4101, 4102],
      },
      {
        worktreeId: 'alpha',
        kind: 'desktop-app',
        status: 'running',
        listeners: [],
        pid: 4150,
        helpers: [],
      },
      {
        worktreeId: 'beta',
        kind: 'desktop-app',
        status: 'running',
        listeners: [],
        pid: 5200,
        helpers: [],
      },
    ],
  );
  assert.equal(JSON.stringify(result).includes('commandLine'), false);
  assert.equal(JSON.stringify(result).includes('node C:\\dev\\alpha\\node_modules'), false);
  assert.deepEqual(
    result.unmatched.map(({ process }) => process.pid),
    [6300, 6400],
  );
  assert.equal(result.unmatched[1].kind, 'browser-dev-server');
  assert.equal(result.unmatched[1].status, 'running');
  assert.deepEqual(result.limitations, [
    'Executable path metadata was unavailable for 1 process records.',
    'Command line metadata was unavailable for 1 process records.',
  ]);
});

test('the scan leaves conflicting worktree references unmatched', () => {
  const scan = {
    worktrees: [
      { id: 'one', path: 'C:\\dev\\app' },
      { id: 'two', path: 'C:\\dev\\app' },
    ],
    processes: [
      {
        pid: 12,
        parentPid: 1,
        name: 'app.exe',
        executablePath: 'C:\\dev\\app\\app.exe',
        commandLine: null,
      },
    ],
    listeners: [],
  };

  const result = normalizeRuntimeScan({ ...scan, platform: 'win32' });
  assert.deepEqual(result.runtimes, []);
  assert.equal(result.unmatched[0].reason, 'ambiguous-worktree');
  assert.equal(result.unmatched[0].process.pid, 12);
});

test('the scan excludes a path that only shares a worktree prefix', () => {
  const scan = {
    worktrees: [{ id: 'one', path: 'C:\\dev\\app' }],
    processes: [
      {
        pid: 9,
        name: 'node.exe',
        executablePath: null,
        commandLine: 'node C:\\dev\\app-preview\\server.js',
      },
    ],
    listeners: [{ pid: 9, address: '0.0.0.0', port: 3000 }],
  };

  const result = normalizeRuntimeScan({ ...scan, platform: 'win32' });
  assert.deepEqual(result.runtimes, []);
  assert.equal(result.unmatched[0].process.pid, 9);
});

const proc = (pid, parentPid, name, executablePath, commandLine) => ({
  pid,
  parentPid,
  name,
  executablePath,
  commandLine,
});

test('direct path matches report direct confidence and lineage helpers report weaker confidence', () => {
  const result = normalizeRuntimeScan({ ...fixture, platform: 'win32' });
  const vite = result.runtimes.find(({ process }) => process.pid === 4100);

  assert.equal(vite.confidence, 'direct');
  assert.deepEqual(
    vite.helpers.map(({ pid, confidence }) => [pid, confidence]),
    [
      [4101, 'direct'],
      [4102, 'lineage'],
    ],
  );
  assert.deepEqual(vite.helpers[1].evidence, ['Child process lineage']);
});

test('ambiguous candidates list the conflicting worktrees and are not assigned', () => {
  const result = normalizeRuntimeScan({
    worktrees: [
      { id: 'one', path: 'C:\\dev\\app' },
      { id: 'two', path: 'C:\\dev\\app\\nested' },
      { id: 'three', path: 'C:\\dev\\other' },
    ],
    processes: [proc(12, 1, 'app.exe', 'C:\\dev\\app\\nested\\app.exe', null)],
    listeners: [],
    platform: 'win32',
  });

  assert.deepEqual(result.runtimes, []);
  assert.equal(result.unmatched[0].reason, 'ambiguous-worktree');
  assert.equal(result.unmatched[0].confidence, 'ambiguous');
  assert.deepEqual(result.unmatched[0].candidateWorktreeIds, ['one', 'two']);
});

test('unmatched helper processes group under the app process instead of becoming roots', () => {
  const result = normalizeRuntimeScan({
    worktrees: [{ id: 'one', path: 'C:\\dev\\app' }],
    processes: [
      proc(50, 1, 'vite.exe', 'C:\\tools\\vite.exe', 'vite'),
      proc(51, 50, 'esbuild.exe', 'C:\\tools\\esbuild.exe', 'esbuild'),
      proc(52, 51, 'worker.exe', null, null),
      proc(60, 1, 'cmd.exe', 'C:\\Windows\\System32\\cmd.exe', 'cmd'),
      proc(61, 60, 'server.exe', 'C:\\tools\\server.exe', 'server'),
    ],
    listeners: [
      { pid: 50, address: '127.0.0.1', port: 5173 },
      { pid: 51, address: '127.0.0.1', port: 5174 },
      { pid: 61, address: '0.0.0.0', port: 8080 },
    ],
    platform: 'win32',
  });

  assert.deepEqual(
    result.unmatched.map(({ process, helpers, confidence }) => ({
      pid: process.pid,
      helpers: helpers.map(({ pid }) => pid),
      confidence,
    })),
    [
      { pid: 50, helpers: [51, 52], confidence: 'low' },
      { pid: 61, helpers: [], confidence: 'low' },
    ],
  );
  assert.deepEqual(result.unmatched[0].helpers[0].listeners, [
    { address: '127.0.0.1', port: 5174 },
  ]);
});

test('a listener is a browser dev server only when process metadata says so', () => {
  const result = normalizeRuntimeScan({
    worktrees: [],
    processes: [
      proc(1, 0, 'node.exe', 'C:\\node.exe', 'node vite.js'),
      proc(2, 0, 'mystery.exe', null, null),
    ],
    listeners: [
      { pid: 1, address: '::', port: 1 },
      { pid: 2, address: '::', port: 2 },
    ],
    platform: 'win32',
  });

  assert.deepEqual(
    result.unmatched.map(({ kind, kindLabel }) => [kind, kindLabel]),
    [
      ['browser-dev-server', 'Browser dev server'],
      ['process', 'Listening process'],
    ],
  );
});

test('missing fields are reported per process and the scan state reflects partial results', () => {
  const partial = normalizeRuntimeScan({
    worktrees: [],
    processes: [proc(2, 0, 'mystery.exe', null, null)],
    listeners: [{ pid: 2, address: '::', port: 2 }],
    platform: 'win32',
  });
  assert.deepEqual(partial.unmatched[0].process.missingFields, ['executable path', 'command line']);
  assert.equal(partial.state, 'partial');

  const complete = normalizeRuntimeScan({
    worktrees: [],
    processes: [proc(3, 0, 'a.exe', 'C:\\a.exe', 'a')],
    listeners: [],
    platform: 'win32',
  });
  assert.equal(complete.state, 'complete');
  assert.deepEqual(complete.unmatched, []);
});

test('unrelated system processes stay hidden and evidence never contains command lines', () => {
  const result = normalizeRuntimeScan({
    worktrees: [{ id: 'one', path: 'C:\\dev\\app' }],
    processes: [
      proc(4, 0, 'svchost.exe', 'C:\\Windows\\svchost.exe', 'svchost -k secret-token'),
      proc(5, 0, 'node.exe', 'C:\\node.exe', 'node C:\\dev\\app\\x.js --key=secret-token'),
    ],
    listeners: [],
    platform: 'win32',
  });
  assert.deepEqual(result.unmatched, []);
  assert.equal(JSON.stringify(result).includes('secret-token'), false);
});
