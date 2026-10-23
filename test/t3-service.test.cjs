const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const snapshot = require('./fixtures/t3-shell-snapshot.json');
const { createT3Service } = require('../electron/t3-service.cjs');

function makeHome({ running = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 't3-home-'));
  if (running) {
    fs.writeFileSync(
      path.join(home, 'server-runtime.json'),
      JSON.stringify({ origin: 'http://127.0.0.1:3773' }),
    );
    fs.writeFileSync(path.join(home, 'environment-id'), 'env-1\n');
  }
  return home;
}

function memoryStore(initial = null) {
  let value = initial;
  return {
    load: () => value,
    save: (next) => {
      value = next;
    },
    clear: () => {
      value = null;
    },
    peek: () => value,
  };
}

const serverFetch =
  ({ tokenOk = true } = {}) =>
  async (url) => {
    if (url.endsWith('/oauth/token')) {
      return tokenOk
        ? {
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }),
          }
        : { ok: false, status: 401 };
    }
    return tokenOk
      ? { ok: true, status: 200, json: async () => snapshot }
      : { ok: false, status: 401 };
  };

const liveToken = () => JSON.stringify({ accessToken: 'tok', expiresAt: Date.now() + 60_000 });
const pathExists = (value) => value !== '/wt/gone' && value.startsWith('/wt/');

test('the service reports T3 as unreachable when the server file is missing', async () => {
  const service = createT3Service({
    t3Home: makeHome({ running: false }),
    tokenStore: memoryStore(),
  });
  assert.deepEqual(await service.getThreads(), { state: 'unreachable' });
});

test('the service asks to connect until a token exists, then lists threads after pairing', async () => {
  const store = memoryStore();
  const service = createT3Service({
    t3Home: makeHome(),
    tokenStore: store,
    fetchImpl: serverFetch(),
    pathExists,
  });

  assert.deepEqual(await service.getThreads(), { state: 'needs-connect' });
  const result = await service.connect('ABC123');
  assert.equal(result.state, 'ok');
  assert.equal(result.threads.length, 3);
  assert.ok(store.peek());
});

test('a bad pairing code keeps the app in needs-connect with a message', async () => {
  const service = createT3Service({
    t3Home: makeHome(),
    tokenStore: memoryStore(),
    fetchImpl: serverFetch({ tokenOk: false }),
    pathExists,
  });
  const result = await service.connect('nope');
  assert.equal(result.state, 'needs-connect');
  assert.match(result.error, /not accepted/);
});

test('a rejected stored token is cleared and requires reconnecting', async () => {
  const store = memoryStore(liveToken());
  const service = createT3Service({
    t3Home: makeHome(),
    tokenStore: store,
    fetchImpl: serverFetch({ tokenOk: false }),
    pathExists,
  });
  assert.deepEqual(await service.getThreads(), { state: 'needs-connect', expired: true });
  assert.equal(store.peek(), null);
});

test('network failures report unreachable without discarding the token', async () => {
  const store = memoryStore(liveToken());
  const service = createT3Service({
    t3Home: makeHome(),
    tokenStore: store,
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
    pathExists,
  });
  assert.deepEqual(await service.getThreads(), { state: 'unreachable' });
  assert.ok(store.peek());
});

test('only threads from the latest listing can be opened, using a service-built URL', async () => {
  const opened = [];
  const service = createT3Service({
    t3Home: makeHome(),
    tokenStore: memoryStore(liveToken()),
    fetchImpl: serverFetch(),
    openExternal: async (url) => opened.push(url),
    pathExists,
  });

  await assert.rejects(service.openThread('t-working'), /not available/);
  await service.getThreads();
  await service.openThread('t-working');
  assert.deepEqual(opened, ['http://127.0.0.1:3773/env-1/t-working']);
  await assert.rejects(service.openThread('javascript:alert(1)'), /not available/);
});
