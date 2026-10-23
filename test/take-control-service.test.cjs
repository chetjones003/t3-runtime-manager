const test = require('node:test');
const assert = require('node:assert/strict');
const { createTakeControlService } = require('../electron/take-control-service.cjs');

const runtime = (overrides = {}) => ({
  id: 'process-100',
  process: { pid: 100, name: 'app.exe' },
  listeners: [],
  helpers: [],
  ...overrides,
});

function makeService({ platform = 'win32', focused = false, throws = false } = {}) {
  const calls = { focus: [], opened: [] };
  const service = createTakeControlService({
    platform,
    focusWindow: async (targets) => {
      calls.focus.push(targets);
      if (throws) throw new Error('powershell failed');
      return focused;
    },
    openExternal: async (url) => calls.opened.push(url),
  });
  return { service, calls };
}

test('only runtimes from the latest scan can be controlled', async () => {
  const { service } = makeService();
  await assert.rejects(service.takeControl('process-100'), /no longer in the latest scan/);
  service.remember([runtime()]);
  await service.remember([runtime({ id: 'process-200' })]);
  await assert.rejects(service.takeControl('process-100'), /no longer in the latest scan/);
});

test('a window that can be focused is focused and no URL is opened', async () => {
  const { service, calls } = makeService({ focused: true });
  service.remember([runtime({ listeners: [{ address: '::', port: 5178 }] })]);

  assert.deepEqual(await service.takeControl('process-100'), { action: 'focused' });
  assert.deepEqual(calls.focus, [[{ pid: 100, name: 'app.exe' }]]);
  assert.deepEqual(calls.opened, []);
});

test('a runtime without a window opens its loopback listener URL', async () => {
  const { service, calls } = makeService({ focused: false });
  service.remember([runtime({ listeners: [{ address: '::', port: 5178 }] })]);

  assert.deepEqual(await service.takeControl('process-100'), { action: 'opened-url' });
  assert.deepEqual(calls.opened, ['http://127.0.0.1:5178']);
});

test('a failing focus attempt falls back to the URL and then to none', async () => {
  const { service, calls } = makeService({ throws: true });
  service.remember([
    runtime({ listeners: [{ address: '::', port: 5178 }] }),
    runtime({ id: 'process-101', process: { pid: 101, name: 'cli.exe' } }),
  ]);

  assert.deepEqual(await service.takeControl('process-100'), { action: 'opened-url' });
  assert.deepEqual(await service.takeControl('process-101'), { action: 'none' });
  assert.equal(calls.opened.length, 1);
});

test('other platforms report unsupported unless the runtime has a URL', async () => {
  const { service, calls } = makeService({ platform: 'linux' });
  service.remember([
    runtime({ listeners: [{ address: '127.0.0.1', port: 3000 }] }),
    runtime({ id: 'process-101', process: { pid: 101, name: 'cli' } }),
  ]);

  assert.deepEqual(await service.takeControl('process-101'), { action: 'unsupported' });
  assert.deepEqual(await service.takeControl('process-100'), { action: 'opened-url' });
  assert.deepEqual(calls.focus, []);
});

function makePreviewService({ platform = 'win32', handle = null, throws = false } = {}) {
  const service = createTakeControlService({
    platform,
    findWindow: async () => {
      if (throws) throw new Error('powershell failed');
      return handle;
    },
    openExternal: async () => {},
  });
  return service;
}

test('the preview prefers the runtime window, then its loopback page, then nothing', async () => {
  const withWindow = makePreviewService({ handle: '4242' });
  withWindow.remember([runtime({ listeners: [{ address: '::', port: 5178 }] })]);
  assert.deepEqual(await withWindow.getPreview('process-100'), { kind: 'window', handle: '4242' });

  const pageOnly = makePreviewService({ handle: null });
  pageOnly.remember([runtime({ listeners: [{ address: '::', port: 5178 }] })]);
  assert.deepEqual(await pageOnly.getPreview('process-100'), {
    kind: 'url',
    url: 'http://127.0.0.1:5178',
  });

  const neither = makePreviewService({ handle: null });
  neither.remember([runtime()]);
  assert.deepEqual(await neither.getPreview('process-100'), { kind: 'none' });
});

test('a failing window lookup falls back to the page and unknown runtimes are rejected', async () => {
  const service = makePreviewService({ throws: true });
  service.remember([runtime({ listeners: [{ address: '127.0.0.1', port: 3000 }] })]);
  assert.deepEqual(await service.getPreview('process-100'), {
    kind: 'url',
    url: 'http://127.0.0.1:3000',
  });
  await assert.rejects(service.getPreview('process-999'), /no longer in the latest scan/);
});

test('other platforms preview only loopback pages', async () => {
  const service = makePreviewService({ platform: 'darwin', handle: '1' });
  service.remember([runtime()]);
  assert.deepEqual(await service.getPreview('process-100'), { kind: 'unsupported' });
});
