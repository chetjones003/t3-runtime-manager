const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { notesFor } = require('../src/release-notes.cjs');

const LATEST_RELEASE_URL =
  'https://api.github.com/repos/chetjones003/t3-runtime-manager/releases/latest';
const releaseNotesUrl = (tag) =>
  `https://raw.githubusercontent.com/chetjones003/t3-runtime-manager/${encodeURIComponent(tag)}/RELEASE_NOTES.md`;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const TRUSTED_DOWNLOAD_HOSTS = new Set(['github.com']);

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? '').trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

function isNewerVersion(candidate, current) {
  const next = parseVersion(candidate);
  const now = parseVersion(current);
  if (!next || !now) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== now[index]) return next[index] > now[index];
  }
  return false;
}

// Only the Windows NSIS installer can update in place silently today.
function pickInstallerAsset(assets, platform) {
  if (platform !== 'win32' || !Array.isArray(assets)) return null;
  return (
    assets.find(
      (asset) =>
        typeof asset?.name === 'string' &&
        /Setup.*\.exe$/i.test(asset.name) &&
        typeof asset.browser_download_url === 'string',
    ) ?? null
  );
}

function isTrustedDownloadUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && TRUSTED_DOWNLOAD_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function createUpdateService({
  currentVersion,
  platform = process.platform,
  canInstall = true,
  fetchImpl = fetch,
  spawn,
  quit,
  onState = () => {},
  downloadDir = path.join(os.tmpdir(), 't3-runtime-manager-update'),
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
}) {
  let state = {
    status: 'idle',
    checking: false,
    currentVersion,
    latest: null,
    progress: 0,
    error: '',
  };
  let asset = null;
  let checking = null;
  let downloadAbort = null;
  let timer = null;

  function setState(patch) {
    state = { ...state, ...patch };
    onState(getState());
  }

  function getState() {
    return { ...state, canInstall: canInstall && Boolean(asset) };
  }

  // Prefer the version's own section of RELEASE_NOTES.md at its tag; older releases predate the file.
  async function readReleaseNotes(tag, version, fallback) {
    try {
      const response = await fetchImpl(releaseNotesUrl(tag), {
        headers: { 'User-Agent': 'T3-Runtime-Manager' },
      });
      if (response.ok) {
        const notes = notesFor(await response.text(), version);
        if (notes) return notes;
      }
    } catch {
      // Fall back to the GitHub release description.
    }
    return typeof fallback === 'string' ? fallback : '';
  }

  async function check() {
    if (checking) return checking;
    if (['downloading', 'installing'].includes(state.status)) return getState();
    setState({ checking: true });
    checking = (async () => {
      try {
        const response = await fetchImpl(LATEST_RELEASE_URL, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'T3-Runtime-Manager' },
        });
        if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
        const release = await response.json();
        const version = String(release.tag_name ?? '').replace(/^v/, '');
        if (!isNewerVersion(version, currentVersion)) {
          asset = null;
          setState({ status: 'idle', latest: null, error: '' });
          return getState();
        }
        const installer = pickInstallerAsset(release.assets, platform);
        asset =
          installer && isTrustedDownloadUrl(installer.browser_download_url) ? installer : null;
        const notes =
          state.latest?.version === version
            ? state.latest.notes
            : await readReleaseNotes(release.tag_name, version, release.body);
        setState({
          status: 'available',
          error: '',
          latest: {
            version,
            notes,
            url: typeof release.html_url === 'string' ? release.html_url : '',
            publishedAt: release.published_at ?? null,
          },
        });
      } catch (error) {
        // Background checks stay silent: keep the last known result and record the reason.
        setState({ error: error.message || 'Update check failed.' });
      } finally {
        checking = null;
        setState({ checking: false });
      }
      return getState();
    })();
    return checking;
  }

  async function download(controller) {
    fs.mkdirSync(downloadDir, { recursive: true });
    const target = path.join(downloadDir, path.basename(asset.name));
    const response = await fetchImpl(asset.browser_download_url, {
      headers: { 'User-Agent': 'T3-Runtime-Manager' },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`);

    const total = Number(response.headers.get('content-length')) || asset.size || 0;
    const hash = crypto.createHash('sha256');
    const file = fs.createWriteStream(target);
    let received = 0;
    try {
      for await (const chunk of response.body) {
        hash.update(chunk);
        received += chunk.length;
        if (!file.write(chunk)) await new Promise((resolve) => file.once('drain', resolve));
        if (total) setState({ progress: Math.min(1, received / total) });
      }
    } finally {
      await new Promise((resolve) => file.end(resolve));
    }

    const expected = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest ?? '')?.[1];
    if (expected && hash.digest('hex') !== expected.toLowerCase()) {
      fs.rmSync(target, { force: true });
      throw new Error('The downloaded installer did not match its published checksum.');
    }
    return target;
  }

  async function install() {
    if (state.status !== 'available' || !canInstall || !asset) return getState();
    const controller = new AbortController();
    downloadAbort = controller;
    setState({ status: 'downloading', progress: 0, error: '' });
    try {
      const installer = await download(controller);
      setState({ status: 'installing', progress: 1 });
      // --updated and --force-run make the NSIS installer run silently and relaunch the app.
      const child = spawn(installer, ['/S', '--updated', '--force-run'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref?.();
      quit();
    } catch (error) {
      setState({
        status: 'available',
        progress: 0,
        error: controller.signal.aborted ? '' : error.message || 'The update could not install.',
      });
    } finally {
      downloadAbort = null;
    }
    return getState();
  }

  function cancel() {
    downloadAbort?.abort();
  }

  function start() {
    check();
    timer = setIntervalImpl(check, CHECK_INTERVAL_MS);
  }

  function stop() {
    if (timer) clearIntervalImpl(timer);
    timer = null;
    cancel();
  }

  return { getState, check, install, cancel, start, stop };
}

module.exports = {
  CHECK_INTERVAL_MS,
  LATEST_RELEASE_URL,
  createUpdateService,
  releaseNotesUrl,
  isNewerVersion,
  isTrustedDownloadUrl,
  pickInstallerAsset,
};
