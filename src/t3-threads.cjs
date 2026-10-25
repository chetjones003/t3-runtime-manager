const PROTOCOL_HEADER = 'x-t3-orchestration-protocol';
const PROTOCOL_VERSION = '2';
const READ_SCOPE = 'orchestration:read';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function localOrigin(runtime) {
  if (!runtime || typeof runtime.origin !== 'string') return null;
  try {
    const url = new URL(runtime.origin);
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function threadUrl(origin, environmentId, threadId) {
  return `${origin}/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
}

function deriveThreadState(thread) {
  if (thread.activeRunId || thread.status === 'running' || thread.status === 'pending') {
    return 'working';
  }
  if (
    thread.pendingRuntimeRequest ||
    thread.hasActionableProposedPlan ||
    thread.status === 'waiting'
  ) {
    return 'waiting';
  }
  if (thread.status === 'failed') return 'failed';
  if (thread.status === 'interrupted' || thread.status === 'cancelled') return 'stopped';
  return 'idle';
}

// A thread is active when T3 would list it outside the Settled and Snoozed sections.
function isActiveThread(thread, now) {
  if (thread.settledOverride === 'settled') return false;
  const snoozedUntil = thread.snoozedUntil ? Date.parse(thread.snoozedUntil) : NaN;
  return !(snoozedUntil > now);
}

// Keeps the threads T3 lists as active: top-level, not settled, snoozed or archived, with a live worktree.
function normalizeShellSnapshot(snapshot, { pathExists, now = Date.now() }) {
  const projects = new Map(
    (Array.isArray(snapshot?.projects) ? snapshot.projects : []).map((project) => [
      project.id,
      project,
    ]),
  );
  const threads = [];
  const seen = new Set();
  for (const thread of Array.isArray(snapshot?.threads) ? snapshot.threads : []) {
    if (
      thread.archivedAt ||
      thread.deletedAt ||
      thread.lineage?.parentThreadId ||
      !isActiveThread(thread, now) ||
      typeof thread.id !== 'string' ||
      typeof thread.worktreePath !== 'string' ||
      !thread.worktreePath.trim() ||
      !pathExists(thread.worktreePath) ||
      seen.has(thread.id)
    ) {
      continue;
    }
    seen.add(thread.id);
    const project = projects.get(thread.projectId);
    threads.push({
      id: thread.id,
      projectId: thread.projectId,
      projectTitle: project?.title ?? 'Unknown project',
      title: typeof thread.title === 'string' && thread.title ? thread.title : 'Untitled thread',
      branch: typeof thread.branch === 'string' ? thread.branch : '',
      worktree: thread.worktreePath,
      state: deriveThreadState(thread),
      createdAt: thread.createdAt ?? null,
      updatedAt: thread.updatedAt ?? null,
    });
  }
  threads.sort(
    (a, b) =>
      String(b.createdAt ?? b.updatedAt).localeCompare(String(a.createdAt ?? a.updatedAt)) ||
      a.id.localeCompare(b.id),
  );
  return { threads };
}

class T3AuthError extends Error {}

async function exchangePairingCode({ origin, code, fetchImpl = fetch }) {
  const response = await fetchImpl(`${origin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: code,
      subject_token_type: 'urn:t3:params:oauth:token-type:environment-bootstrap',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: READ_SCOPE,
      client_label: 'T3 Runtime Manager',
      client_device_type: 'desktop',
      client_os: process.platform === 'darwin' ? 'macos' : process.platform,
    }).toString(),
  });
  if (response.status === 400 || response.status === 401) {
    throw new T3AuthError('The pairing code was not accepted. Create a new one in T3.');
  }
  if (!response.ok) throw new Error(`T3 token exchange failed (${response.status}).`);
  const token = await response.json();
  if (token.token_type !== 'Bearer' || typeof token.access_token !== 'string') {
    throw new Error('T3 returned an unsupported token type.');
  }
  return {
    accessToken: token.access_token,
    expiresAt: Date.now() + (Number(token.expires_in) || 0) * 1000,
  };
}

async function fetchShellSnapshot({ origin, accessToken, fetchImpl = fetch }) {
  const response = await fetchImpl(`${origin}/api/orchestration/shell`, {
    headers: { authorization: `Bearer ${accessToken}`, [PROTOCOL_HEADER]: PROTOCOL_VERSION },
  });
  if (response.status === 401) throw new T3AuthError('T3 rejected the stored token.');
  if (!response.ok) throw new Error(`T3 thread request failed (${response.status}).`);
  return response.json();
}

module.exports = {
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  READ_SCOPE,
  T3AuthError,
  deriveThreadState,
  exchangePairingCode,
  fetchShellSnapshot,
  localOrigin,
  normalizeShellSnapshot,
  threadUrl,
};
