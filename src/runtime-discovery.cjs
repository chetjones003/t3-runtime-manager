const path = require('node:path');

function normalizePath(value, platform) {
  if (platform === 'win32')
    return value
      .replaceAll('/', '\\')
      .replace(/[\\]+$/, '')
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

function classifyRuntime(process, listeners) {
  const metadata =
    `${process.name || ''} ${process.executablePath || ''} ${process.commandLine || ''}`.toLowerCase();
  const isDevServer =
    /\b(vite|next(?:\.js)?|webpack(?:-dev-server)?|react-scripts|parcel|astro|nuxt|svelte-kit)\b/.test(
      metadata,
    );
  if (isDevServer) return { kind: 'browser-dev-server', label: 'Browser dev server' };
  if (/\.exe$/i.test(process.executablePath || ''))
    return { kind: 'desktop-app', label: 'Windows app' };
  return { kind: 'process', label: 'Process' };
}

function safeProcess(process, evidence = []) {
  return {
    pid: process.pid,
    parentPid: process.parentPid ?? null,
    name: process.name || path.basename(process.executablePath || '') || `Process ${process.pid}`,
    executablePath: process.executablePath || null,
    evidence,
  };
}

function collectHelpers(rootPid, worktreeId, childrenByParent, matches, ambiguousPids) {
  const helpers = [];
  const visited = new Set([rootPid]);
  const pending = [rootPid];

  while (pending.length) {
    const parentPid = pending.shift();
    for (const child of childrenByParent.get(parentPid) ?? []) {
      const childPid = Number(child.pid);
      if (visited.has(childPid)) continue;
      visited.add(childPid);

      const childMatch = matches.get(childPid);
      if (ambiguousPids.has(childPid) || (childMatch && childMatch.worktree.id !== worktreeId))
        continue;
      const evidence = childMatch?.evidence ?? ['Child process lineage'];
      helpers.push(safeProcess(child, evidence));
      pending.push(childPid);
    }
  }

  return helpers;
}

function normalizeRuntimeScan({
  worktrees,
  processes,
  listeners,
  limitations = [],
  platform = process.platform,
}) {
  const matches = new Map();
  const unmatched = [];
  const ambiguousPids = new Set();
  const childrenByParent = new Map();
  for (const process of processes) {
    const parentPid = Number(process.parentPid);
    const children = childrenByParent.get(parentPid) ?? [];
    children.push(process);
    childrenByParent.set(parentPid, children);
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
      const ownedListeners = listenersForProcess(Number(process.pid), listeners);
      const classification = classifyRuntime(process, ownedListeners);
      unmatched.push({
        process: safeProcess(process, [
          'Executable path or command line references multiple configured worktrees',
        ]),
        reason: 'ambiguous-worktree',
        kind: classification.kind,
        kindLabel: classification.label,
        status: ownedListeners.length ? 'listening' : 'running',
        listeners: ownedListeners,
      });
    }
  }

  const runtimes = [];
  for (const [pid, match] of matches) {
    const ownedListeners = listenersForProcess(pid, listeners);
    const hasMatchedParent = matches.has(Number(match.process.parentPid));
    if (hasMatchedParent && ownedListeners.length === 0) continue;

    const classification = classifyRuntime(match.process, ownedListeners);
    const helperProcesses = collectHelpers(
      pid,
      match.worktree.id,
      childrenByParent,
      matches,
      ambiguousPids,
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

  const matchedPids = new Set(matches.keys());
  for (const process of processes) {
    const pid = Number(process.pid);
    if (matchedPids.has(pid) || unmatched.some((candidate) => candidate.process.pid === pid))
      continue;
    const ownedListeners = listenersForProcess(pid, listeners);
    const classification = classifyRuntime(process, ownedListeners);
    if (ownedListeners.length || classification.kind === 'browser-dev-server') {
      unmatched.push({
        process: safeProcess(process, [
          ...(ownedListeners.length
            ? ['Owns a TCP listening endpoint; no unique worktree path match']
            : []),
          ...(classification.kind === 'browser-dev-server'
            ? ['Process metadata identifies a browser development server']
            : []),
        ]),
        reason: 'no-worktree-match',
        kind: classification.kind,
        kindLabel: classification.label,
        status: ownedListeners.length ? 'listening' : 'running',
        listeners: ownedListeners,
      });
    }
  }

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

  return { runtimes, unmatched, limitations: [...limitations, ...fieldLimitations] };
}

module.exports = { normalizeRuntimeScan };
