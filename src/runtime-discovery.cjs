const path = require('node:path');

function normalizePath(value, platform) {
  if (platform === 'win32')
    return value
      .replaceAll('/', '\\')
      .replace(/[\\]+$/, '')
      .toLowerCase();
  if (platform === 'darwin')
    // The default APFS volume is case-insensitive, and /tmp, /var and /etc are symlinks into /private.
    return value
      .replace(/[\\/]+$/, '')
      .replace(/^\/private(?=\/(?:tmp|var|etc)(?:\/|$))/, '')
      .toLowerCase();
  return value.replace(/[\\/]+$/, '');
}

function pathIsInsideWorktree(candidate, worktreePath, platform) {
  if (!candidate) return false;
  const text = normalizePath(candidate, platform);
  const needle = normalizePath(worktreePath, platform);
  let index = text.indexOf(needle);

  while (index !== -1) {
    const before = text[index - 1];
    const after = text[index + needle.length];
    const startsAtBoundary = index === 0 || /[\s"'=]/.test(before);
    const endsAtBoundary = after === undefined || /[\\/\s"']/.test(after);
    if (startsAtBoundary && endsAtBoundary) return true;
    index = text.indexOf(needle, index + 1);
  }

  return false;
}

function processReferencesWorktree(process, worktreePath, platform) {
  return (
    pathIsInsideWorktree(process.executablePath, worktreePath, platform) ||
    pathIsInsideWorktree(process.commandLine, worktreePath, platform)
  );
}

function listenersForProcess(pid, listeners) {
  return listeners
    .filter((listener) => Number(listener.pid) === pid)
    .map((listener) => ({ address: listener.address, port: Number(listener.port) }));
}

function classifyRuntime(process, ownedListeners, platform) {
  const metadata =
    `${process.name || ''} ${process.executablePath || ''} ${process.commandLine || ''}`.toLowerCase();
  const isDevServer =
    /\b(vite|next(?:\.js)?|webpack(?:-dev-server)?|react-scripts|parcel|astro|nuxt|svelte-kit)\b/.test(
      metadata,
    );
  if (isDevServer) return { kind: 'browser-dev-server', label: 'Browser dev server' };
  if (platform === 'darwin' && /\.app\/Contents\/MacOS\//.test(process.executablePath || ''))
    return { kind: 'desktop-app', label: 'macOS app' };
  if (platform === 'win32' && /\.exe$/i.test(process.executablePath || ''))
    return { kind: 'desktop-app', label: 'Windows app' };
  return { kind: 'process', label: ownedListeners.length ? 'Listening process' : 'Process' };
}

function missingFieldsFor(process) {
  return [
    ['executablePath', 'executable path'],
    ['commandLine', 'command line'],
  ]
    .filter(([field]) => !process[field])
    .map(([, label]) => label);
}

function safeProcess(process, evidence = []) {
  return {
    pid: process.pid,
    parentPid: process.parentPid ?? null,
    name: process.name || path.basename(process.executablePath || '') || `Process ${process.pid}`,
    executablePath: process.executablePath || null,
    evidence,
    missingFields: missingFieldsFor(process),
  };
}

function collectHelpers(rootPid, childrenByParent, isExcluded, listeners, matchFor) {
  const helpers = [];
  const visited = new Set([rootPid]);
  const pending = [rootPid];

  while (pending.length) {
    const parentPid = pending.shift();
    for (const child of childrenByParent.get(parentPid) ?? []) {
      const childPid = Number(child.pid);
      if (visited.has(childPid)) continue;
      visited.add(childPid);

      if (isExcluded(childPid)) continue;
      const childMatch = matchFor?.(childPid);
      helpers.push({
        ...safeProcess(child, childMatch?.evidence ?? ['Child process lineage']),
        confidence: childMatch ? 'direct' : 'lineage',
        listeners: listenersForProcess(childPid, listeners),
      });
      pending.push(childPid);
    }
  }

  return helpers;
}

function candidateEntry(process, evidence, reason, confidence, listeners, platform, extra = {}) {
  const ownedListeners = listenersForProcess(Number(process.pid), listeners);
  const classification = classifyRuntime(process, ownedListeners, platform);
  return {
    process: safeProcess(process, evidence),
    reason,
    confidence,
    kind: classification.kind,
    kindLabel: classification.label,
    status: ownedListeners.length ? 'listening' : 'running',
    listeners: ownedListeners,
    helpers: [],
    ...extra,
  };
}

function normalizeRuntimeScan({
  worktrees,
  processes,
  listeners,
  limitations = [],
  platform = process.platform,
}) {
  const matches = new Map();
  const ambiguous = [];
  const ambiguousPids = new Set();
  const childrenByParent = new Map();
  const processesByPid = new Map();
  for (const process of processes) {
    const parentPid = Number(process.parentPid);
    const children = childrenByParent.get(parentPid) ?? [];
    children.push(process);
    childrenByParent.set(parentPid, children);
    processesByPid.set(Number(process.pid), process);
  }

  for (const process of processes) {
    const worktreeMatches = worktrees.filter((worktree) =>
      processReferencesWorktree(process, worktree.path, platform),
    );
    if (worktreeMatches.length === 1) {
      const evidence = [];
      if (pathIsInsideWorktree(process.executablePath, worktreeMatches[0].path, platform))
        evidence.push('Executable path references this worktree');
      if (pathIsInsideWorktree(process.commandLine, worktreeMatches[0].path, platform))
        evidence.push('Command line references this worktree');
      matches.set(Number(process.pid), { process, worktree: worktreeMatches[0], evidence });
    } else if (worktreeMatches.length > 1) {
      ambiguousPids.add(Number(process.pid));
      ambiguous.push(
        candidateEntry(
          process,
          ['Executable path or command line references multiple configured worktrees'],
          'ambiguous-worktree',
          'ambiguous',
          listeners,
          platform,
          { candidateWorktreeIds: worktreeMatches.map(({ id }) => id) },
        ),
      );
    }
  }

  const runtimes = [];
  for (const [pid, match] of matches) {
    const ownedListeners = listenersForProcess(pid, listeners);
    const hasMatchedParent = matches.has(Number(match.process.parentPid));
    if (hasMatchedParent && ownedListeners.length === 0) continue;

    const classification = classifyRuntime(match.process, ownedListeners, platform);
    const helperProcesses = collectHelpers(
      pid,
      childrenByParent,
      (childPid) =>
        ambiguousPids.has(childPid) ||
        (matches.has(childPid) && matches.get(childPid).worktree.id !== match.worktree.id),
      listeners,
      (childPid) => matches.get(childPid),
    );

    runtimes.push({
      id: `process-${pid}`,
      worktreeId: match.worktree.id,
      worktreePath: match.worktree.path,
      kind: classification.kind,
      kindLabel: classification.label,
      status: ownedListeners.length ? 'listening' : 'running',
      confidence: 'direct',
      evidence: match.evidence,
      process: safeProcess(match.process, match.evidence),
      helpers: helperProcesses,
      listeners: ownedListeners,
    });
  }

  const candidates = new Map();
  for (const process of processes) {
    const pid = Number(process.pid);
    if (matches.has(pid) || ambiguousPids.has(pid)) continue;
    const ownedListeners = listenersForProcess(pid, listeners);
    const classification = classifyRuntime(process, ownedListeners, platform);
    if (!ownedListeners.length && classification.kind !== 'browser-dev-server') continue;
    candidates.set(
      pid,
      candidateEntry(
        process,
        [
          ...(ownedListeners.length
            ? ['Owns a TCP listening endpoint; no unique worktree path match']
            : []),
          ...(classification.kind === 'browser-dev-server'
            ? ['Process metadata identifies a browser development server']
            : []),
        ],
        'no-worktree-match',
        'low',
        listeners,
      ),
    );
  }

  const hasCandidateAncestor = (pid) => {
    const seen = new Set([pid]);
    let parentPid = Number(processesByPid.get(pid)?.parentPid);
    while (processesByPid.has(parentPid) && !seen.has(parentPid)) {
      if (candidates.has(parentPid) || ambiguousPids.has(parentPid)) return true;
      seen.add(parentPid);
      parentPid = Number(processesByPid.get(parentPid).parentPid);
    }
    return false;
  };
  const unmatched = [];
  for (const [pid, candidate] of candidates) {
    if (hasCandidateAncestor(pid)) continue;
    candidate.helpers = collectHelpers(
      pid,
      childrenByParent,
      (childPid) => ambiguousPids.has(childPid) || matches.has(childPid),
      listeners,
    );
    unmatched.push(candidate);
  }
  for (const entry of ambiguous) {
    entry.helpers = collectHelpers(
      Number(entry.process.pid),
      childrenByParent,
      (childPid) => ambiguousPids.has(childPid) || matches.has(childPid),
      listeners,
    );
  }
  unmatched.push(...ambiguous);
  unmatched.sort((a, b) => a.process.pid - b.process.pid);

  const missingExecutablePaths = processes.filter((item) => !item.executablePath).length;
  const missingCommandLines = processes.filter((item) => !item.commandLine).length;
  const fieldLimitations = [];
  if (missingExecutablePaths)
    fieldLimitations.push(
      `Executable path metadata was unavailable for ${missingExecutablePaths} process records.`,
    );
  if (missingCommandLines)
    fieldLimitations.push(
      `Command line metadata was unavailable for ${missingCommandLines} process records.`,
    );
  const processPids = new Set(processes.map((item) => Number(item.pid)));
  const listenersWithoutProcess = listeners.filter(
    (listener) => !processPids.has(Number(listener.pid)),
  ).length;
  if (listenersWithoutProcess)
    fieldLimitations.push(
      `Process records were unavailable for ${listenersWithoutProcess} listening endpoint owners.`,
    );

  const allLimitations = [...limitations, ...fieldLimitations];
  return {
    runtimes,
    unmatched,
    limitations: allLimitations,
    state: allLimitations.length ? 'partial' : 'complete',
  };
}

module.exports = { normalizeRuntimeScan };
