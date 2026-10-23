const { classifyRuntime } = require('./runtime-discovery.cjs');

const MAX_DEPTH = 64;
const MAX_PROCESSES_PER_APP = 200;

// Agent CLIs drive a thread but are not the thread's runtime.
const AGENT_NAME = /^(claude|codex|gemini|opencode|cursor-agent|aider)(\.exe)?$/i;
const TERMINAL_HOST_NAME =
  /^(windowsterminal|wt|conhost|openconsole|explorer|terminal|iterm2?|konsole|xterm|gnome-terminal.*|tmux|screen|sshd|launchd|systemd|init)(\.exe)?$/i;
const SHELL_NAME = /^(cmd|powershell|pwsh|bash|sh|zsh|fish)(\.exe)?$/i;
const NON_INTERACTIVE_SHELL = /(^|\s)(-c|-command|-encodedcommand|-file|\/c|\/k)(\s|$)/i;

function isBoundary(process) {
  const name = process.name ?? '';
  if (AGENT_NAME.test(name) || TERMINAL_HOST_NAME.test(name)) return true;
  // A shell that was handed a command is part of the launch; an interactive one is a terminal.
  return SHELL_NAME.test(name) && !NON_INTERACTIVE_SHELL.test(process.commandLine ?? '');
}

// The highest ancestor below the first agent, terminal or interactive shell: everything a single
// launch started shares it.
function launchRoot(pid, processesByPid) {
  let current = processesByPid.get(pid);
  const seen = new Set([pid]);
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const parent = processesByPid.get(Number(current.parentPid));
    if (!parent || seen.has(Number(parent.pid)) || isBoundary(parent)) return current;
    seen.add(Number(parent.pid));
    current = parent;
  }
  return current;
}

function descendantsOf(rootPid, childrenByParent) {
  const found = [];
  const seen = new Set([rootPid]);
  const pending = [rootPid];
  while (pending.length && found.length < MAX_PROCESSES_PER_APP) {
    for (const child of childrenByParent.get(pending.shift()) ?? []) {
      const childPid = Number(child.pid);
      if (seen.has(childPid) || AGENT_NAME.test(child.name ?? '')) continue;
      seen.add(childPid);
      found.push(child);
      pending.push(childPid);
    }
  }
  return found;
}

function listenersOf(pid, listeners) {
  return listeners
    .filter((listener) => Number(listener.pid) === pid)
    .map((listener) => ({ address: listener.address, port: Number(listener.port) }));
}

function publicProcess(process, extra = {}) {
  return {
    pid: Number(process.pid),
    parentPid: process.parentPid ?? null,
    name: process.name || `Process ${process.pid}`,
    executablePath: process.executablePath || null,
    windowTitle: process.windowTitle || null,
    missingFields: [],
    evidence: [],
    ...extra,
  };
}

function choosePrimary(members, listeners, platform) {
  const windowed = members.find((member) => member.windowTitle);
  if (windowed) return windowed;
  const classified = members.map((member) => ({
    member,
    kind: classifyRuntime(member, listenersOf(Number(member.pid), listeners), platform).kind,
    listening: listenersOf(Number(member.pid), listeners).length > 0,
  }));
  return (
    classified.find((entry) => entry.kind === 'browser-dev-server' && entry.listening)?.member ??
    classified.find((entry) => entry.listening)?.member ??
    members[0]
  );
}

// Collapses a scan's per-process runtimes into one entry per launched app, named by its window,
// with the launcher chain and dev servers as supporting processes. Agent processes are dropped.
function groupRuntimeApps({ runtimes, processes, listeners, platform }) {
  const processesByPid = new Map(processes.map((process) => [Number(process.pid), process]));
  const childrenByParent = new Map();
  for (const process of processes) {
    const parentPid = Number(process.parentPid);
    childrenByParent.set(parentPid, [...(childrenByParent.get(parentPid) ?? []), process]);
  }

  const groups = new Map();
  for (const runtime of runtimes) {
    const process = processesByPid.get(runtime.process.pid);
    if (!process || AGENT_NAME.test(process.name ?? '')) continue;
    const root = launchRoot(Number(process.pid), processesByPid);
    const key = `${runtime.worktreeId}\u0000${root.pid}`;
    const group = groups.get(key) ?? { root, worktreeId: runtime.worktreeId, evidence: new Set() };
    runtime.evidence.forEach((item) => group.evidence.add(item));
    groups.set(key, group);
  }

  const apps = [];
  for (const group of groups.values()) {
    const members = [group.root, ...descendantsOf(Number(group.root.pid), childrenByParent)];
    const primary = choosePrimary(members, listeners, platform);
    const groupListeners = members.flatMap((member) => listenersOf(Number(member.pid), listeners));
    const primaryListeners = listenersOf(Number(primary.pid), listeners);
    const classification = primary.windowTitle
      ? { kind: 'desktop-app', label: platform === 'darwin' ? 'macOS app' : 'Windows app' }
      : classifyRuntime(primary, primaryListeners, platform);
    const devServerPort = groupListeners[0]?.port;
    const name =
      primary.windowTitle ||
      (classification.kind === 'browser-dev-server' && devServerPort
        ? `${classification.label} :${devServerPort}`
        : primary.name);

    apps.push({
      // Keep runtime IDs stable across scans; selection and HWND associations are keyed by ID.
      id: `app-${encodeURIComponent(group.worktreeId)}-${group.root.pid}`,
      worktreeId: group.worktreeId,
      name,
      kind: classification.kind,
      kindLabel: classification.label,
      status: groupListeners.length ? 'listening' : 'running',
      evidence: [...group.evidence],
      process: publicProcess(primary, { evidence: [...group.evidence] }),
      helpers: members
        .filter((member) => member !== primary)
        .map((member) =>
          publicProcess(member, {
            confidence: 'lineage',
            listeners: listenersOf(Number(member.pid), listeners),
          }),
        ),
      listeners: groupListeners,
    });
  }

  const rank = (app) => (app.process.windowTitle ? 0 : app.listeners.length ? 1 : 2);
  return apps.sort((a, b) => rank(a) - rank(b) || a.process.pid - b.process.pid);
}

module.exports = { groupRuntimeApps, isBoundary };
