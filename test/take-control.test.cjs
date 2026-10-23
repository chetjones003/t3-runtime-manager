const test = require('node:test');
const assert = require('node:assert/strict');
const { loopbackUrl, planTakeControl } = require('../src/take-control.cjs');

test('wildcard and loopback listeners map to a loopback URL; other addresses do not', () => {
  assert.equal(loopbackUrl({ address: '0.0.0.0', port: 4173 }), 'http://127.0.0.1:4173');
  assert.equal(loopbackUrl({ address: '::', port: 4173 }), 'http://127.0.0.1:4173');
  assert.equal(loopbackUrl({ address: '127.0.0.1', port: 5178 }), 'http://127.0.0.1:5178');
  assert.equal(loopbackUrl({ address: '::1', port: 5178 }), 'http://[::1]:5178');
  assert.equal(loopbackUrl({ address: '192.168.1.20', port: 5178 }), null);
  assert.equal(loopbackUrl({ address: '127.0.0.1', port: 0 }), null);
  assert.equal(loopbackUrl({ address: '127.0.0.1', port: 70000 }), null);
  assert.equal(loopbackUrl(null), null);
});

test('the plan targets the runtime process first, then helpers, with a listener URL fallback', () => {
  const plan = planTakeControl({
    process: { pid: 100, name: 'node.exe' },
    listeners: [],
    helpers: [
      { pid: 101, name: 'node.exe', listeners: [{ address: '192.168.1.20', port: 1 }] },
      { pid: 102, name: 'esbuild.exe', listeners: [{ address: '::', port: 5178 }] },
    ],
  });

  assert.deepEqual(plan.targets, [
    { pid: 100, name: 'node.exe' },
    { pid: 101, name: 'node.exe' },
    { pid: 102, name: 'esbuild.exe' },
  ]);
  assert.equal(plan.url, 'http://127.0.0.1:5178');
});

test('the plan drops invalid pids and unsafe process names and has no URL without listeners', () => {
  const plan = planTakeControl({
    process: { pid: 100, name: 'app.exe' },
    listeners: [],
    helpers: [
      { pid: -1, name: 'bad.exe', listeners: [] },
      { pid: 7, name: 'x"; Remove-Item *', listeners: [] },
    ],
  });
  assert.deepEqual(plan.targets, [{ pid: 100, name: 'app.exe' }]);
  assert.equal(plan.url, null);
});
