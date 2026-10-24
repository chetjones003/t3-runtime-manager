const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  CHECK_INTERVAL_MS,
  LATEST_RELEASE_URL,
  createUpdateService,
  isNewerVersion,
  releaseNotesUrl,
  pickInstallerAsset,
} = require('../electron/update-service.cjs');

const installerBytes = Buffer.from('fake installer');
const installerAsset = {
  name: 'T3.Runtime.Manager.Setup.0.2.0.exe',
  browser_download_url:
    'https://github.com/chetjones003/t3-runtime-manager/releases/download/v0.2.0/T3.Runtime.Manager.Setup.0.2.0.exe',
  size: installerBytes.length,
  digest: 'sha256:' + crypto.createHash('sha256').update(installerBytes).digest('hex'),
};
const release = {
  tag_name: 'v0.2.0',
  body: '## What changed\n* Added updates',
  html_url: 'https://github.com/chetjones003/t3-runtime-manager/releases/tag/v0.2.0',
  published_at: '2026-10-20T00:00:00Z',
  assets: [{ name: 'T3.Runtime.Manager-0.2.0-win.zip', browser_download_url: 'x' }, installerAsset],
};

function fakeFetch({ latest = release, bytes = installerBytes, notesFile = null } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === LATEST_RELEASE_URL) return { ok: true, json: async () => latest };
    if (url === releaseNotesUrl(latest.tag_name)) {
      return notesFile === null
        ? { ok: false, status: 404 }
        : { ok: true, text: async () => notesFile };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(bytes.length) },
      body: (async function* () {
        yield bytes.subarray(0, 4);
        yield bytes.subarray(4);
      })(),
    };
  };
  return { fetchImpl, calls };
}

function makeService(overrides = {}) {
  const spawned = [];
  let quits = 0;
  const states = [];
  const service = createUpdateService({
    currentVersion: '0.1.5',
    platform: 'win32',
    spawn: (file, args, options) => {
      spawned.push({ file, args, options });
      return { unref() {} };
    },
    quit: () => {
      quits += 1;
    },
    onState: (state) => states.push(state),
    downloadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'update-test-')),
    ...overrides,
  });
  return { service, spawned, states, quits: () => quits };
}

test('compares semantic versions', () => {
  assert.equal(isNewerVersion('0.1.10', '0.1.9'), true);
  assert.equal(isNewerVersion('v1.0.0', '0.9.9'), true);
  assert.equal(isNewerVersion('0.1.5', '0.1.5'), false);
  assert.equal(isNewerVersion('0.1.4', '0.1.5'), false);
  assert.equal(isNewerVersion('garbage', '0.1.5'), false);
});

test('picks the NSIS installer only on Windows', () => {
  assert.equal(pickInstallerAsset(release.assets, 'win32'), installerAsset);
  assert.equal(pickInstallerAsset(release.assets, 'darwin'), null);
});

test('reports an available update with release notes', async () => {
  const { service } = makeService({ fetchImpl: fakeFetch().fetchImpl });
  const state = await service.check();
  assert.equal(state.status, 'available');
  assert.equal(state.canInstall, true);
  assert.equal(state.checking, false);
  assert.deepEqual(state.latest, {
    version: '0.2.0',
    notes: release.body,
    url: release.html_url,
    publishedAt: release.published_at,
  });
});

test('shows the release notes file section for the version being installed', async () => {
  const notesFile = [
    '# Release notes',
    '',
    '## v0.2.0',
    '',
    '- New update button',
    '',
    '## v0.1.5',
    '',
    '- Older change',
  ].join('\n');
  const { fetchImpl, calls } = fakeFetch({ notesFile });
  const { service } = makeService({ fetchImpl });
  const state = await service.check();
  assert.equal(state.latest.notes, '- New update button');
  assert.ok(calls.includes(releaseNotesUrl('v0.2.0')));

  // Later checks for the same version reuse the notes instead of downloading them again.
  await service.check();
  assert.equal(calls.filter((url) => url === releaseNotesUrl('v0.2.0')).length, 1);
});

test('falls back to the GitHub release description when the file has no section', async () => {
  const { service } = makeService({
    fetchImpl: fakeFetch({ notesFile: '# Release notes\n\n## v0.1.5\n\n- Older' }).fetchImpl,
  });
  const state = await service.check();
  assert.equal(state.latest.notes, release.body);
});

test('stays idle when already on the latest version', async () => {
  const { service } = makeService({
    currentVersion: '0.2.0',
    fetchImpl: fakeFetch().fetchImpl,
  });
  const state = await service.check();
  assert.equal(state.status, 'idle');
  assert.equal(state.latest, null);
});

test('failed checks are silent and keep the last result', async () => {
  let fail = false;
  const { fetchImpl } = fakeFetch();
  const { service } = makeService({
    fetchImpl: async (url) => {
      if (fail) throw new Error('offline');
      return fetchImpl(url);
    },
  });
  await service.check();
  fail = true;
  const state = await service.check();
  assert.equal(state.status, 'available');
  assert.equal(state.error, 'offline');
});

test('downloads, verifies, runs the installer silently, and quits', async () => {
  const { service, spawned, quits } = makeService({ fetchImpl: fakeFetch().fetchImpl });
  await service.check();
  const state = await service.install();
  assert.equal(state.status, 'installing');
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].args, ['/S', '--updated', '--force-run']);
  assert.equal(spawned[0].options.detached, true);
  assert.deepEqual(fs.readFileSync(spawned[0].file), installerBytes);
  assert.equal(quits(), 1);
});

test('rejects a download whose checksum does not match', async () => {
  const { service, spawned, quits } = makeService({
    fetchImpl: fakeFetch({ bytes: Buffer.from('tampered bytes') }).fetchImpl,
  });
  await service.check();
  const state = await service.install();
  assert.equal(state.status, 'available');
  assert.match(state.error, /checksum/);
  assert.equal(spawned.length, 0);
  assert.equal(quits(), 0);
});

test('never installs from an untrusted download host', async () => {
  const latest = {
    ...release,
    assets: [{ ...installerAsset, browser_download_url: 'https://evil.example/Setup.exe' }],
  };
  const { service, spawned } = makeService({ fetchImpl: fakeFetch({ latest }).fetchImpl });
  const checked = await service.check();
  assert.equal(checked.canInstall, false);
  await service.install();
  assert.equal(spawned.length, 0);
});

test('development builds see updates but cannot install them', async () => {
  const { service, spawned } = makeService({
    canInstall: false,
    fetchImpl: fakeFetch().fetchImpl,
  });
  const state = await service.check();
  assert.equal(state.status, 'available');
  assert.equal(state.canInstall, false);
  await service.install();
  assert.equal(spawned.length, 0);
});

test('checks on start and then every hour', async () => {
  const intervals = [];
  const { fetchImpl, calls } = fakeFetch();
  const { service } = makeService({
    fetchImpl,
    setIntervalImpl: (fn, ms) => {
      intervals.push({ fn, ms });
      return 1;
    },
    clearIntervalImpl: () => {},
  });
  service.start();
  assert.equal(calls.length, 1);
  assert.equal(intervals[0].ms, CHECK_INTERVAL_MS);
  assert.equal(CHECK_INTERVAL_MS, 60 * 60 * 1000);
  service.stop();
});
