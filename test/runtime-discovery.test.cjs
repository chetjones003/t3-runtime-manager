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
