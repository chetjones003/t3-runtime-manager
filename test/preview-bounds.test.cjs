const test = require('node:test');
const assert = require('node:assert/strict');
const { fitPreviewBounds, placePreviewHost } = require('../src/preview-bounds.cjs');

test('preview bounds preserve the native window aspect ratio and center it in the viewport', () => {
  assert.deepEqual(
    fitPreviewBounds({ x: 40, y: 80, width: 1600, height: 900 }, { width: 1280, height: 800 }),
    { x: 120, y: 80, width: 1440, height: 900 },
  );
});

test('invalid or too-small preview surfaces are not sent to the native window host', () => {
  assert.equal(
    fitPreviewBounds({ x: 0, y: 0, width: 90, height: 300 }, { width: 500, height: 300 }),
    null,
  );
  assert.equal(
    fitPreviewBounds({ x: 0, y: 0, width: 300, height: 200 }, { width: 0, height: 1 }),
    null,
  );
});

test('preview placement uses Electron content-area coordinates, including negative monitor origins', () => {
  assert.deepEqual(
    placePreviewHost({ x: -1920, y: 80 }, { x: 250, y: 130, width: 960, height: 600 }),
    { x: -1670, y: 210, width: 960, height: 600 },
  );
});
