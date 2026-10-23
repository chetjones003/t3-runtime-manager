const MAX_TARGETS = 64;

function loopbackUrl(listener) {
  if (!listener || !Number.isInteger(listener.port) || listener.port < 1 || listener.port > 65535) {
    return null;
  }
  const address = String(listener.address ?? '');
  const host = address === '::1' || address === '[::1]' ? '[::1]' : '127.0.0.1';
  // Wildcard (0.0.0.0, ::) and loopback listeners are reachable through loopback; other bound
  // addresses are left alone rather than guessed.
  const reachable =
    ['', '0.0.0.0', '::', '[::]', '127.0.0.1', '::1', '[::1]', 'localhost'].includes(address) ||
    address.startsWith('127.');
  return reachable ? `http://${host}:${listener.port}` : null;
}

// What Take Control may act on for one runtime: its own process first, then its helpers, and the
// first loopback URL among their listeners as the fallback for runtimes without a window.
function planTakeControl(runtime) {
  const processes = [
    { pid: runtime.process.pid, name: runtime.process.name },
    ...runtime.helpers.map((helper) => ({ pid: helper.pid, name: helper.name })),
  ].filter(
    (target) =>
      Number.isInteger(target.pid) &&
      target.pid > 0 &&
      typeof target.name === 'string' &&
      /^[\w .()-]{1,128}$/.test(target.name),
  );

  const listeners = [
    ...runtime.listeners,
    ...runtime.helpers.flatMap((helper) => helper.listeners),
  ];
  const url = listeners.map(loopbackUrl).find(Boolean) ?? null;
  // A preview must belong to the app represented by this runtime. Searching helper
  // processes can embed a shell or terminal window into an unrelated app card.
  const windowTargets =
    runtime.process.windowTitle || runtime.kind === 'desktop-app'
      ? processes.filter((target) => target.pid === runtime.process.pid).slice(0, 1)
      : [];
  return { targets: processes.slice(0, MAX_TARGETS), windowTargets, url };
}

module.exports = { loopbackUrl, planTakeControl };
