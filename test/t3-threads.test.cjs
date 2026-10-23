const test = require('node:test');
const assert = require('node:assert/strict');
const snapshot = require('./fixtures/t3-shell-snapshot.json');
const {
  T3AuthError,
  exchangePairingCode,
  fetchShellSnapshot,
  localOrigin,
  normalizeShellSnapshot,
  threadUrl,
} = require('../src/t3-threads.cjs');

const existing = new Set([
  '/wt/importer',
  '/wt/question',
  '/wt/broken',
  '/wt/old',
  '/wt/settled',
  '/wt/snoozed',
]);
const pathExists = (value) => existing.has(value);

test('threads keep only active top-level threads with live worktrees and derive their state', () => {
  const result = normalizeShellSnapshot(snapshot, { pathExists });

  assert.deepEqual(
    result.threads.map(({ id, state, projectTitle }) => ({ id, state, projectTitle })),
    [
      { id: 't-waiting', state: 'waiting', projectTitle: 'Alpha App' },
      { id: 't-working', state: 'working', projectTitle: 'Alpha App' },
      { id: 't-failed', state: 'failed', projectTitle: 'Beta App' },
    ],
  );
});

test('malformed snapshots produce an empty result', () => {
  assert.deepEqual(normalizeShellSnapshot({}, { pathExists }), { threads: [] });
  assert.deepEqual(normalizeShellSnapshot(null, { pathExists }), { threads: [] });
});

test('only loopback http origins are accepted from the server runtime file', () => {
  assert.equal(localOrigin({ origin: 'http://127.0.0.1:3773' }), 'http://127.0.0.1:3773');
  assert.equal(localOrigin({ origin: 'http://localhost:3773' }), 'http://localhost:3773');
  assert.equal(localOrigin({ origin: 'http://evil.example:3773' }), null);
  assert.equal(localOrigin({ origin: 'https://127.0.0.1:3773' }), null);
  assert.equal(localOrigin({}), null);
});

test('thread links are built from the environment and thread ids', () => {
  assert.equal(
    threadUrl('http://127.0.0.1:3773', 'env-1', 'thread/1'),
    'http://127.0.0.1:3773/env-1/thread%2F1',
  );
});

test('the pairing exchange posts a read-scoped token-exchange form', async () => {
  let request;
  const result = await exchangePairingCode({
    origin: 'http://127.0.0.1:3773',
    code: 'ABC123',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'secret-token', token_type: 'Bearer', expires_in: 60 }),
      };
    },
  });

  const body = new URLSearchParams(request.init.body);
  assert.equal(request.url, 'http://127.0.0.1:3773/oauth/token');
  assert.equal(request.init.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(body.get('subject_token'), 'ABC123');
  assert.equal(body.get('scope'), 'orchestration:read');
  assert.equal(result.accessToken, 'secret-token');
  assert.ok(result.expiresAt > Date.now());
});

test('a rejected pairing code and a rejected token are auth errors', async () => {
  const reject = async () => ({ ok: false, status: 401 });
  await assert.rejects(
    exchangePairingCode({ origin: 'http://127.0.0.1:1', code: 'x', fetchImpl: reject }),
    T3AuthError,
  );
  await assert.rejects(
    fetchShellSnapshot({ origin: 'http://127.0.0.1:1', accessToken: 't', fetchImpl: reject }),
    T3AuthError,
  );
});

test('snapshot requests send the bearer token and protocol header', async () => {
  let init;
  await fetchShellSnapshot({
    origin: 'http://127.0.0.1:3773',
    accessToken: 'tok',
    fetchImpl: async (url, options) => {
      init = options;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  assert.equal(init.headers.authorization, 'Bearer tok');
  assert.equal(init.headers['x-t3-orchestration-protocol'], '2');
});
