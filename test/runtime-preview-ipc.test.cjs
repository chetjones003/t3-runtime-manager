const test = require('node:test');
const assert = require('node:assert/strict');
const { registerRuntimePreviewIpc } = require('../electron/runtime-preview-ipc.cjs');
const { startRuntimePreview } = require('../src/runtime-preview.mjs');

function makePreviewIpc({
  sources,
  handle = '4242',
  preview,
  ownHandle = null,
  mainWindowAvailable = true,
  mainWindowUrl = 'file:///app/dist/index.html',
} = {}) {
  const handlers = new Map();
  const calls = { sources: [], display: [] };
  const webContents = { id: 7, mainFrame: {}, getURL: () => mainWindowUrl };
  const mainWindow = { webContents };
  let displayHandler;

  const previewHandler = registerRuntimePreviewIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    takeControl: {
      getPreview: async () => preview ?? { kind: 'window', handle },
    },
    desktopCapturer: {
      getSources: async (options) => {
        calls.sources.push(options);
        return sources ?? [{ id: `window:${handle}:0` }];
      },
    },
    getMainWindow: () => (mainWindowAvailable ? mainWindow : null),
    ownWindowHandle: () => ownHandle,
    assertTrustedSender: () => {},
    isTrustedCockpitUrl: (url) => url === 'file:///app/dist/index.html',
    delay: async () => {},
  });
  displayHandler = previewHandler.handleDisplayMediaRequest;

  return {
    calls,
    invoke: (channel, event, ...args) => handlers.get(channel)(event, ...args),
    requestDisplay: (request) =>
      new Promise((resolve) => {
        displayHandler(request, (result) => {
          calls.display.push(result);
          resolve(result);
        });
      }),
    webContents,
  };
}

test('preview IPC resolves a runtime window and supplies that source to display capture', async () => {
  const previewIpc = makePreviewIpc();
  const event = { sender: { id: 7 } };

  const result = await previewIpc.invoke('runtime:preview', event, 'process-100');
  assert.deepEqual(result, { kind: 'window', sourceId: 'window:4242:0' });

  const capture = await previewIpc.requestDisplay({
    frame: previewIpc.webContents.mainFrame,
    securityOrigin: 'file:///',
    videoRequested: true,
  });
  assert.deepEqual(capture, { video: { id: 'window:4242:0' } });
});

test('preview IPC requests source metadata without thumbnail image capture', async () => {
  const previewIpc = makePreviewIpc();
  await previewIpc.invoke('runtime:preview', { sender: { id: 7 } }, 'process-100');

  assert.deepEqual(previewIpc.calls.sources, [
    { types: ['window'], thumbnailSize: { width: 0, height: 0 } },
  ]);
});

test('renderer capture uses browser-safe constraints and captures the IPC-selected window', async () => {
  const previewIpc = makePreviewIpc();
  const captureOptions = [];
  const appliedConstraints = [];
  const expectedStream = {
    id: 'captured-window-stream',
    getVideoTracks: () => [
      {
        applyConstraints: async (constraints) => appliedConstraints.push(constraints),
      },
    ],
  };

  const result = await startRuntimePreview('process-100', {
    getRuntimePreview: (runtimeId) =>
      previewIpc.invoke('runtime:preview', { sender: { id: 7 } }, runtimeId),
    getDisplayMedia: async (options) => {
      captureOptions.push(options);
      const capture = await previewIpc.requestDisplay({
        frame: previewIpc.webContents.mainFrame,
        securityOrigin: 'file:///',
        videoRequested: true,
      });
      assert.ok(capture.video);
      return expectedStream;
    },
  });

  assert.deepEqual(captureOptions, [{ audio: false, video: true }]);
  assert.deepEqual(appliedConstraints, [
    { cursor: { exact: 'never' }, frameRate: { ideal: 15, max: 15 } },
  ]);
  assert.deepEqual(result, {
    preview: { kind: 'window', sourceId: 'window:4242:0' },
    stream: expectedStream,
  });
});

test('renderer does not request capture for unavailable previews or missing source ids', async () => {
  const calls = [];
  const result = await startRuntimePreview('process-100', {
    getRuntimePreview: async () => ({ kind: 'none' }),
    getDisplayMedia: async (options) => calls.push(options),
  });
  assert.deepEqual(result, { preview: { kind: 'none' }, stream: null });
  assert.deepEqual(calls, []);

  await assert.rejects(
    startRuntimePreview('process-100', {
      getRuntimePreview: async () => ({ kind: 'window' }),
      getDisplayMedia: async (options) => calls.push(options),
    }),
    /Electron did not provide a capture source/,
  );
  assert.deepEqual(calls, []);
});

test('renderer keeps preview startup usable when cursor constraints are unsupported', async () => {
  const appliedConstraints = [];
  const stream = {
    getVideoTracks: () => [
      {
        applyConstraints: async (constraints) => {
          appliedConstraints.push(constraints);
          if (constraints.cursor) throw new Error('Unsupported cursor constraint');
        },
      },
    ],
  };

  const result = await startRuntimePreview('process-100', {
    getRuntimePreview: async () => ({ kind: 'window', sourceId: 'window:4242:0' }),
    getDisplayMedia: async () => stream,
  });

  assert.equal(result.stream, stream);
  assert.deepEqual(appliedConstraints, [
    { cursor: { exact: 'never' }, frameRate: { ideal: 15, max: 15 } },
    { frameRate: { ideal: 15, max: 15 } },
  ]);
});

test('display capture rejects untrusted requests and serves the selected source to repeat requests', async () => {
  const previewIpc = makePreviewIpc();
  await previewIpc.invoke('runtime:preview', { sender: { id: 7 } }, 'process-100');

  const wrongFrame = await previewIpc.requestDisplay({
    frame: {},
    securityOrigin: 'file:///app/dist/index.html',
    videoRequested: true,
  });
  assert.equal(wrongFrame, null);

  const noVideo = await previewIpc.requestDisplay({
    frame: previewIpc.webContents.mainFrame,
    securityOrigin: 'file:///app/dist/index.html',
    videoRequested: false,
  });
  assert.equal(noVideo, null);

  const untrustedPage = makePreviewIpc({ mainWindowUrl: 'https://untrusted.example' });
  await untrustedPage.invoke('runtime:preview', { sender: { id: 7 } }, 'process-100');
  const untrusted = await untrustedPage.requestDisplay({
    frame: untrustedPage.webContents.mainFrame,
    securityOrigin: 'https://untrusted.example',
    videoRequested: true,
  });
  assert.equal(untrusted, null);

  const approved = await previewIpc.requestDisplay({
    frame: previewIpc.webContents.mainFrame,
    securityOrigin: 'file:///app/dist/index.html',
    videoRequested: true,
  });
  assert.deepEqual(approved, { video: { id: 'window:4242:0' } });

  // React StrictMode starts the preview twice; the second capture must not be refused.
  const secondUse = await previewIpc.requestDisplay({
    frame: previewIpc.webContents.mainFrame,
    securityOrigin: 'file:///app/dist/index.html',
    videoRequested: true,
  });
  assert.deepEqual(secondUse, { video: { id: 'window:4242:0' } });

  const fresh = makePreviewIpc();
  const missingSource = await fresh.requestDisplay({
    frame: fresh.webContents.mainFrame,
    securityOrigin: 'file:///app/dist/index.html',
    videoRequested: true,
  });
  assert.equal(missingSource, null);
});

test('preview IPC skips self-capture and reports none after the target stays unavailable', async () => {
  const selfPreview = makePreviewIpc({
    preview: { kind: 'window', handle: '4242' },
    ownHandle: '4242',
  });
  assert.deepEqual(
    await selfPreview.invoke('runtime:preview', { sender: { id: 7 } }, 'process-100'),
    { kind: 'self' },
  );
  assert.equal(selfPreview.calls.sources.length, 0);

  const unavailablePreview = makePreviewIpc({ sources: [] });
  assert.deepEqual(
    await unavailablePreview.invoke('runtime:preview', { sender: { id: 7 } }, 'process-100'),
    { kind: 'none' },
  );
  assert.equal(unavailablePreview.calls.sources.length, 5);
});

test('preview IPC rejects malformed runtime ids and display requests after the manager closes', async () => {
  const previewIpc = makePreviewIpc();
  await assert.rejects(
    previewIpc.invoke('runtime:preview', { sender: { id: 7 } }, 'x'.repeat(201)),
    /Invalid runtime/,
  );

  const closedManager = makePreviewIpc({ mainWindowAvailable: false });
  const result = await closedManager.requestDisplay({
    frame: closedManager.webContents.mainFrame,
    securityOrigin: 'file:///app/dist/index.html',
    videoRequested: true,
  });
  assert.equal(result, null);
});

test('overlapping preview starts both receive a capture stream', async () => {
  const previewIpc = makePreviewIpc();
  const start = () =>
    startRuntimePreview('process-100', {
      getRuntimePreview: (runtimeId) =>
        previewIpc.invoke('runtime:preview', { sender: { id: 7 } }, runtimeId),
      getDisplayMedia: async () => {
        const capture = await previewIpc.requestDisplay({
          frame: previewIpc.webContents.mainFrame,
          securityOrigin: 'file:///',
          videoRequested: true,
        });
        if (!capture) throw new Error('Invalid capture constraints');
        return { getVideoTracks: () => [] };
      },
    });

  const [first, second] = await Promise.all([start(), start()]);
  assert.ok(first.stream);
  assert.ok(second.stream);
});

test('a preview without a window clears the previously selected source', async () => {
  const preview = { kind: 'window', handle: '4242' };
  const previewIpc = makePreviewIpc({ preview });
  const event = { sender: { id: 7 } };
  const request = {
    frame: previewIpc.webContents.mainFrame,
    securityOrigin: 'file:///',
    videoRequested: true,
  };

  await previewIpc.invoke('runtime:preview', event, 'process-100');
  assert.deepEqual(await previewIpc.requestDisplay(request), { video: { id: 'window:4242:0' } });

  preview.kind = 'page';
  await previewIpc.invoke('runtime:preview', event, 'process-200');
  assert.equal(await previewIpc.requestDisplay(request), null);
});
