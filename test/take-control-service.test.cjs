const test = require('node:test');
const assert = require('node:assert/strict');
const { createTakeControlService } = require('../electron/take-control-service.cjs');

const runtime = (overrides = {}) => ({
  id: 'process-100',
  process: { pid: 100, name: 'app.exe', windowTitle: 'App window' },
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
  assert.deepEqual(await withWindow.getPreview('process-100'), {
    kind: 'window',
    handle: '4242',
    width: 1280,
    height: 800,
  });

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

test('native preview embeds in its host, resizes the HWND, hides the previous window, and restores both', async () => {
  const calls = [];
  const service = createTakeControlService({
    platform: 'win32',
    openExternal: async () => {},
    runWindowScriptImpl: async (mode, targets, input) => {
      calls.push({ mode, targets, input });
      if (mode === 'embed')
        return JSON.stringify({
          handle: targets[0].pid === 100 ? '4242' : '4343',
          parent: '0',
          style: 1,
          x: 10,
          y: 20,
          width: 1280,
          height: 800,
        });
      return {
        'show-embed': 'shown',
        'update-embed': 'updated',
        'hide-embed': 'hidden',
        'restore-embed': 'restored',
      }[mode];
    },
  });
  const second = runtime({
    id: 'process-200',
    process: { pid: 200, name: 'other.exe', windowTitle: 'Other window' },
  });
  service.remember([runtime(), second]);
  const bounds = { x: 30, y: 40, width: 800, height: 500 };

  assert.equal(await service.embedWindow('process-100', '500', bounds), true);
  assert.equal(await service.updateEmbeddedWindow('process-100', { ...bounds, width: 900 }), true);
  assert.equal(await service.embedWindow('process-200', '500', bounds), true);
  assert.ok(calls.some(({ mode, input }) => mode === 'hide-embed' && input.handle === '4242'));
  assert.deepEqual(await service.getPreview('process-200'), {
    kind: 'window',
    handle: '4343',
    width: 1280,
    height: 800,
  });

  await service.restoreAllEmbeds();
  assert.equal(calls.filter(({ mode }) => mode === 'restore-embed').length, 2);
});
