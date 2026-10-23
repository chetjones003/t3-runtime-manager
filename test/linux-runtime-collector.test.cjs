const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/linux-runtime-scan.json');
const { normalizeRuntimeScan } = require('../src/runtime-discovery.cjs');
const {
  collectLinuxRuntimeData,
  parseCmdline,
  parseProcNetTcp,
  parseProcStat,
} = require('../electron/linux-runtime-collector.cjs');

const tcp = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1092 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 11111 1 0000000000000000 100 0 0 10 0
   1: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 22222 1 0000000000000000 100 0 0 10 0
   2: 0100007F:1092 0100007F:9999 01 00000000:00000000 00:00000000 00000000  1000        0 33333 1 0000000000000000 100 0 0 10 0
`;
const tcp6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000001000000:1092 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 44444 1 0000000000000000 100 0 0 10 0
   1: 00000000000000000000000000000000:0050 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 55555 1 0000000000000000 100 0 0 10 0
`;

test('/proc stat parsing keeps command names containing spaces and parentheses', () => {
  assert.deepEqual(parseProcStat('4100 (node (v22) x) S 1 4100 4100 0 -1'), {
    name: 'node (v22) x',
    parentPid: 1,
  });
  assert.equal(parseProcStat('garbage'), null);
});

test('cmdline NUL separators are joined and empty cmdlines become null', () => {
  assert.equal(
    parseCmdline('node\u0000/home/dev/alpha/vite.js\u0000--port\u00004173\u0000'),
    'node /home/dev/alpha/vite.js --port 4173',
  );
  assert.equal(parseCmdline(''), null);
});

test('/proc/net/tcp output yields listening sockets only, with decoded addresses', () => {
  assert.deepEqual(parseProcNetTcp(tcp), [
    { address: '127.0.0.1', port: 4242, inode: 11111 },
    { address: '0.0.0.0', port: 8080, inode: 22222 },
  ]);
  assert.deepEqual(parseProcNetTcp(tcp6), [
    { address: '::1', port: 4242, inode: 44444 },
    { address: '::', port: 80, inode: 55555 },
  ]);
});

function fakeFs(files, links, dirs) {
  const fail = (code) => Object.assign(new Error(code), { code });
  return {
    readFile: async (p) => (p in files ? files[p] : Promise.reject(fail('EACCES'))),
    readlink: async (p) => (p in links ? links[p] : Promise.reject(fail('EACCES'))),
    readdir: async (p) => (p in dirs ? dirs[p] : Promise.reject(fail('EACCES'))),
  };
}

const procFs = () =>
  fakeFs(
    {
      '/proc/1/stat': '1 (systemd) S 0 1',
      '/proc/1/cmdline': '/sbin/init\u0000',
      '/proc/4100/stat': '4100 (node) S 1 4100',
      '/proc/4100/cmdline': 'node\u0000/home/dev/alpha/vite.js\u0000',
      '/proc/5000/stat': '5000 (other) S 1 5000',
      '/proc/net/tcp': tcp,
    },
    {
      '/proc/4100/exe': '/usr/bin/node',
      '/proc/4100/fd/3': 'socket:[11111]',
      '/proc/4100/fd/4': 'pipe:[1]',
    },
    { '/proc': ['1', '4100', '5000', 'self', 'net'], '/proc/4100/fd': ['3', '4'] },
  );

test('the collector reads /proc, maps socket inodes to owners and reports partial visibility', async () => {
  const data = await collectLinuxRuntimeData({ platform: 'linux', fsApi: procFs() });
  assert.deepEqual(data.processes, [
    { pid: 1, parentPid: 0, name: 'systemd', executablePath: null, commandLine: '/sbin/init' },
    {
      pid: 4100,
      parentPid: 1,
      name: 'node',
      executablePath: '/usr/bin/node',
      commandLine: 'node /home/dev/alpha/vite.js',
    },
    { pid: 5000, parentPid: 1, name: 'other', executablePath: null, commandLine: null },
  ]);
  assert.deepEqual(data.listeners, [{ pid: 4100, address: '127.0.0.1', port: 4242 }]);
  assert.equal(data.limitations.length, 1);
  assert.match(data.limitations[0], /listener ownership is partial/);
});

test('the collector throws when /proc is unreadable and is inert off Linux', async () => {
  await assert.rejects(collectLinuxRuntimeData({ platform: 'linux', fsApi: fakeFs({}, {}, {}) }));
  const other = await collectLinuxRuntimeData({ platform: 'darwin' });
  assert.equal(other.processes.length, 0);
  assert.equal(other.limitations.length, 1);
});

test('Linux scans use the shared matching, classification and grouping', () => {
  const result = normalizeRuntimeScan({ ...fixture, platform: 'linux' });
  assert.deepEqual(
    result.runtimes.map(({ worktreeId, kind, status, confidence, process, helpers }) => ({
      worktreeId,
      kind,
      status,
      confidence,
      pid: process.pid,
      helpers: helpers.map(({ pid }) => pid),
    })),
    [
      {
        worktreeId: 'alpha',
        kind: 'browser-dev-server',
        status: 'listening',
        confidence: 'direct',
        pid: 4100,
        helpers: [4101],
      },
    ],
  );
  assert.deepEqual(
    result.unmatched.map(({ process, confidence }) => [process.pid, confidence]),
    [
      [6300, 'low'],
      [6500, 'ambiguous'],
    ],
  );
  assert.equal(JSON.stringify(result).includes('commandLine'), false);
  assert.equal(result.state, 'partial');
  assert.ok(result.limitations.some((text) => text.includes('Executable path metadata')));
});

test('Linux matching is case-sensitive', () => {
  const result = normalizeRuntimeScan({
    worktrees: [{ id: 'alpha', path: '/home/dev/Alpha' }],
    processes: [
      { pid: 10, parentPid: 1, name: 't', executablePath: '/home/dev/alpha/t', commandLine: null },
    ],
    listeners: [],
    platform: 'linux',
  });
  assert.equal(result.runtimes.length, 0);
});
