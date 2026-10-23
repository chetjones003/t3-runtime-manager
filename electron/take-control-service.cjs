const { execFile } = require('node:child_process');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { planTakeControl } = require('../src/take-control.cjs');

const execFileAsync = promisify(execFile);
const windowScript = path.join(__dirname, 'focus-windows-window.ps1');
const TARGETS_PATTERN = /^\d{1,10}:[\w .()-]{1,128}(,\d{1,10}:[\w .()-]{1,128})*$/;

// Runs the Win32 window script for the first target process that owns a window.
async function runWindowScript(mode, targets, input) {
  const encoded = targets.map(({ pid, name }) => `${pid}:${name}`).join(',');
  if (
    ![
      'focus',
      'find',
      'embed',
      'show-embed',
      'update-embed',
      'hide-embed',
      'restore-embed',
    ].includes(mode) ||
    !TARGETS_PATTERN.test(encoded)
  )
    return 'none';
  const script = await readFile(windowScript, 'utf8');
  const windowVariables =
    mode === 'embed'
      ? `$HostHandle = '${input.hostHandle}'\n$EmbedX = ${input.x}\n$EmbedY = ${input.y}\n$EmbedWidth = ${input.width}\n$EmbedHeight = ${input.height}\n`
      : mode === 'hide-embed' || mode === 'show-embed'
        ? `$EmbeddedHandle = '${input.handle}'\n`
        : mode === 'update-embed'
          ? `$EmbeddedHandle = '${input.handle}'\n$HostHandle = '${input.hostHandle}'\n$EmbedX = ${input.x}\n$EmbedY = ${input.y}\n$EmbedWidth = ${input.width}\n$EmbedHeight = ${input.height}\n`
          : mode === 'restore-embed'
            ? `$EmbeddedHandle = '${input.handle}'\n$OriginalState = '${JSON.stringify(input.state)}'\n`
            : '';
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$Mode = '${mode}'\n$Targets = '${encoded}'\n${windowVariables}${script}`,
    ],
    { windowsHide: true, timeout: 10000, encoding: 'utf8' },
  );
  return stdout.trim();
}

const focusWindowsProcessWindow = async (targets) =>
  (await runWindowScript('focus', targets)) === 'focused';

const findWindowsProcessWindow = async (targets) => {
  const result = await runWindowScript('find', targets);
  try {
    const window = JSON.parse(result);
    return /^\d{1,20}$/.test(window.handle) ? window : null;
  } catch {
    return null;
  }
};

// Remembers the processes of the latest scan so the renderer can only name a runtime id,
// never an arbitrary process.
function createTakeControlService({
  platform = process.platform,
  focusWindow = focusWindowsProcessWindow,
  findWindow = findWindowsProcessWindow,
  openExternal,
  runWindowScriptImpl = runWindowScript,
}) {
  let latest = new Map();
  const embeds = new Map();
  let activeRuntimeId = null;

  function remember(runtimes) {
    latest = new Map(runtimes.map((runtime) => [runtime.id, planTakeControl(runtime)]));
  }

  function planFor(runtimeId) {
    const plan = latest.get(runtimeId);
    if (!plan) throw new Error('That runtime is no longer in the latest scan.');
    return plan;
  }

  async function takeControl(runtimeId) {
    const plan = planFor(runtimeId);

    const embedded = embeds.get(runtimeId);
    if (embedded) return { action: 'embedded' };

    if (platform === 'win32' && plan.targets.length > 0) {
      let focused = false;
      try {
        focused = await focusWindow(plan.targets);
      } catch {
        focused = false;
      }
      if (focused) return { action: 'focused' };
    }
    if (plan.url) {
      await openExternal(plan.url);
      return { action: 'opened-url' };
    }
    return { action: platform === 'win32' ? 'none' : 'unsupported' };
  }

  function validEmbedBounds(bounds) {
    return (
      bounds &&
      ['x', 'y', 'width', 'height'].every((key) => Number.isInteger(bounds[key])) &&
      bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.width >= 100 &&
      bounds.height >= 100 &&
      bounds.x <= 10000 &&
      bounds.y <= 10000 &&
      bounds.width <= 10000 &&
      bounds.height <= 10000
    );
  }

  async function updateEmbeddedWindow(runtimeId, bounds) {
    if (platform !== 'win32' || !validEmbedBounds(bounds))
      throw new Error('Invalid embedded window bounds.');
    const embedded = embeds.get(runtimeId);
    if (!embedded) return false;
    const updated =
      (await runWindowScriptImpl('update-embed', embedded.targets, {
        handle: embedded.handle,
        hostHandle: embedded.hostHandle,
        ...bounds,
      })) === 'updated';
    if (updated) embedded.lastBounds = bounds;
    return updated;
  }

  async function embedWindow(runtimeId, hostHandle, bounds) {
    if (platform !== 'win32' || !/^\d{1,20}$/.test(hostHandle) || !validEmbedBounds(bounds)) {
      throw new Error('Invalid window embedding request.');
    }
    const plan = planFor(runtimeId);
    if (!plan.targets.length) return false;
    if (!plan.windowTargets?.length) return false;
    if (activeRuntimeId && activeRuntimeId !== runtimeId) {
      const previous = embeds.get(activeRuntimeId);
      if (previous)
        await runWindowScriptImpl('hide-embed', previous.targets, { handle: previous.handle });
    }
    let embedded = embeds.get(runtimeId);
    if (embedded && embedded.hostHandle !== hostHandle) {
      await restoreEmbeddedWindow(runtimeId);
      embedded = null;
    }
    if (!embedded) {
      const result = await runWindowScriptImpl('embed', plan.windowTargets, {
        hostHandle,
        ...bounds,
      });
      let state;
      try {
        state = JSON.parse(result);
      } catch {
        return false;
      }
      if (!state?.handle || !Number.isInteger(state.width) || !Number.isInteger(state.height))
        return false;
      embedded = { targets: plan.windowTargets, handle: state.handle, hostHandle, state };
      embeds.set(runtimeId, embedded);
    }
    const shown = await runWindowScriptImpl('show-embed', embedded.targets, {
      handle: embedded.handle,
    });
    if (shown !== 'shown') return false;
    activeRuntimeId = runtimeId;
    return updateEmbeddedWindow(runtimeId, bounds);
  }

  async function restoreEmbeddedWindow(runtimeId) {
    const embedded = embeds.get(runtimeId);
    if (!embedded) return true;
    embeds.delete(runtimeId);
    if (activeRuntimeId === runtimeId) activeRuntimeId = null;
    try {
      return (
        (await runWindowScriptImpl('restore-embed', embedded.targets, {
          handle: embedded.handle,
          state: embedded.state,
        })) === 'restored'
      );
    } catch {
      return false;
    }
  }

  async function restoreAllEmbeds() {
    await Promise.all([...embeds.keys()].map(restoreEmbeddedWindow));
  }

  // What the preview area can show for a runtime: its window if it owns one, else its loopback
  // page, else nothing.
  async function getPreview(runtimeId) {
    const plan = planFor(runtimeId);
    const embedded = embeds.get(runtimeId);
    if (embedded)
      return {
        kind: 'window',
        handle: embedded.handle,
        width: embedded.state.width,
        height: embedded.state.height,
      };
    let windowLookupError;

    if (platform === 'win32' && plan.windowTargets?.length > 0) {
      try {
        const found = await findWindow(plan.windowTargets);
        if (found) {
          const window =
            typeof found === 'string' ? { handle: found, width: 1280, height: 800 } : found;
          return { kind: 'window', ...window };
        }
      } catch (error) {
        windowLookupError = error;
      }
    }
    if (plan.url) return { kind: 'url', url: plan.url };
    if (windowLookupError) {
      return {
        kind: 'error',
        detail:
          windowLookupError instanceof Error
            ? windowLookupError.message
            : String(windowLookupError),
      };
    }
    return { kind: platform === 'win32' ? 'none' : 'unsupported' };
  }

  return {
    remember,
    takeControl,
    getPreview,
    embedWindow,
    updateEmbeddedWindow,
    restoreEmbeddedWindow,
    restoreAllEmbeds,
  };
}

module.exports = { createTakeControlService };
