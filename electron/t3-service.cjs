const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  T3AuthError,
  exchangePairingCode,
  fetchShellSnapshot,
  localOrigin,
  normalizeShellSnapshot,
  threadUrl,
} = require('../src/t3-threads.cjs');

const MAX_CODE_LENGTH = 512;

function defaultT3Home() {
  return path.join(os.homedir(), '.t3', 'userdata');
}

// tokenStore: { load(): string | null, save(token), clear() } holding the serialized token.
function createT3Service({
  t3Home = defaultT3Home(),
  tokenStore,
  fetchImpl = fetch,
  openExternal,
  pathExists = fs.existsSync,
}) {
  let token = null;
  let tokenLoaded = false;
  let knownThreadIds = new Set();

  function readServer() {
    try {
      const runtime = JSON.parse(fs.readFileSync(path.join(t3Home, 'server-runtime.json'), 'utf8'));
      const origin = localOrigin(runtime);
      const environmentId = fs.readFileSync(path.join(t3Home, 'environment-id'), 'utf8').trim();
      return origin && environmentId ? { origin, environmentId } : null;
    } catch {
      return null;
    }
  }

  async function loadToken() {
    if (tokenLoaded) return token;
    try {
      const stored = await tokenStore.load();
      token = stored ? JSON.parse(stored) : null;
    } catch {
      token = null;
    }
    tokenLoaded = true;
    return token;
  }

  async function setToken(next) {
    token = next;
    tokenLoaded = true;
    if (next) await tokenStore.save(JSON.stringify(next));
    else await tokenStore.clear();
  }

  async function getThreads() {
    const server = readServer();
    if (!server) return { state: 'unreachable' };
    const current = await loadToken();
    if (!current || current.expiresAt <= Date.now()) return { state: 'needs-connect' };
    try {
      const snapshot = await fetchShellSnapshot({
        origin: server.origin,
        accessToken: current.accessToken,
        fetchImpl,
      });
      const result = normalizeShellSnapshot(snapshot, { pathExists });
      knownThreadIds = new Set(result.threads.map((thread) => thread.id));
      return { state: 'ok', fetchedAt: new Date().toISOString(), ...result };
    } catch (error) {
      if (error instanceof T3AuthError) {
        await setToken(null);
        return { state: 'needs-connect', expired: true };
      }
      return { state: 'unreachable' };
    }
  }

  async function connect(code) {
    if (typeof code !== 'string' || !code.trim() || code.length > MAX_CODE_LENGTH) {
      return { state: 'needs-connect', error: 'Enter the pairing code from T3.' };
    }
    const server = readServer();
    if (!server) return { state: 'unreachable' };
    try {
      await setToken(
        await exchangePairingCode({ origin: server.origin, code: code.trim(), fetchImpl }),
      );
    } catch (error) {
      return {
        state: error instanceof T3AuthError ? 'needs-connect' : 'unreachable',
        error: error instanceof T3AuthError ? error.message : undefined,
      };
    }
    return getThreads();
  }

  async function openThread(threadId) {
    const server = readServer();
    if (!server || !knownThreadIds.has(threadId)) {
      throw new Error('That thread is not available.');
    }
    await openExternal(threadUrl(server.origin, server.environmentId, threadId));
  }

  // Connection details for the settings window. The access token itself never leaves this process.
  async function getConnection() {
    const server = readServer();
    const current = await loadToken();
    return {
      origin: server?.origin ?? null,
      environmentId: server?.environmentId ?? null,
      paired: Boolean(current),
      expiresAt: current ? current.expiresAt : null,
    };
  }

  async function disconnect() {
    await setToken(null);
    knownThreadIds = new Set();
    return getConnection();
  }

  return { getThreads, connect, openThread, getConnection, disconnect };
}

module.exports = { createT3Service };
