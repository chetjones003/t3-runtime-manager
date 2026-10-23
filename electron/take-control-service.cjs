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
      'mouse',
      'key',
      'embed',
      'embed-hidden',
      'update-embed',
      'hide-embed',
      'restore-embed',
    ].includes(mode) ||
    !TARGETS_PATTERN.test(encoded)
  )
    return 'none';
  const script = await readFile(windowScript, 'utf8');
  const mouseVariables =
    mode === 'mouse'
      ? `$MouseType = '${input.type}'\n$MouseX = ${input.x}\n$MouseY = ${input.y}\n$MouseButton = '${input.button}'\n$MouseFlags = ${input.buttons}\n$MouseDelta = ${input.delta}\n$PreviewHandle = '${input.handle ?? ''}'\n`
      : mode === 'key'
        ? `$KeyCode = ${input.keyCode}\n$CharCodes = @(${input.charCodes.join(',')})\n$Modifiers = ${input.modifiers}\n`
        : mode === 'embed' || mode === 'embed-hidden'
          ? `$HostHandle = '${input.hostHandle}'\n$EmbedX = ${input.x}\n$EmbedY = ${input.y}\n$EmbedWidth = ${input.width}\n$EmbedHeight = ${input.height}\n`
          : mode === 'hide-embed'
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
      `$Mode = '${mode}'\n$Targets = '${encoded}'\n${mouseVariables}${script}`,
    ],
    { windowsHide: true, timeout: 10000, encoding: 'utf8' },
  );
  return stdout.trim();
}

const focusWindowsProcessWindow = async (targets) =>
  (await runWindowScript('focus', targets)) === 'focused';

const findWindowsProcessWindow = async (targets) => {
  const handle = await runWindowScript('find', targets);
  return /^\d{1,20}$/.test(handle) ? handle : null;
};

// Remembers the processes of the latest scan so the renderer can only name a runtime id,
// never an arbitrary process.
function createTakeControlService({
  platform = process.platform,
  focusWindow = focusWindowsProcessWindow,
  findWindow = findWindowsProcessWindow,
  openExternal,
}) {
  let latest = new Map();
  const embeds = new Map();
  const previewWindows = new Map();

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

  async function sendPreviewInput(runtimeId, input) {
    const plan = planFor(runtimeId);
    if (platform !== 'win32' || !plan.windowTargets?.length) return false;
    if (input?.type === 'key') {
      const validKey =
        Number.isInteger(input.keyCode) &&
        input.keyCode >= 0 &&
        input.keyCode <= 255 &&
        Array.isArray(input.charCodes) &&
        input.charCodes.length <= 2 &&
        input.charCodes.every((code) => Number.isInteger(code) && code >= 0 && code <= 65535) &&
        Number.isInteger(input.modifiers) &&
        input.modifiers >= 0 &&
        input.modifiers <= 7;
      if (!validKey) throw new Error('Invalid preview key input.');
      try {
        return (await runWindowScript('key', plan.windowTargets, input)) === 'sent';
      } catch {
        return false;
      }
    }
    const valid =
      input &&
      ['move', 'down', 'up', 'wheel'].includes(input.type) &&
      Number.isFinite(input.x) &&
      input.x >= 0 &&
      input.x <= 1 &&
      Number.isFinite(input.y) &&
      input.y >= 0 &&
      input.y <= 1 &&
      ['left', 'right'].includes(input.button) &&
      Number.isInteger(input.buttons) &&
      input.buttons >= 0 &&
      input.buttons <= 3 &&
      Number.isInteger(input.delta) &&
      Math.abs(input.delta) <= 120;
    if (!valid) throw new Error('Invalid preview input.');
    try {
      const handle = previewWindows.get(runtimeId);
      return (await runWindowScript('mouse', plan.windowTargets, { ...input, handle })) === 'sent';
    } catch {
      return false;
    }
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
      (await runWindowScript('update-embed', embedded.targets, {
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
    if (embeds.has(runtimeId)) return updateEmbeddedWindow(runtimeId, bounds);
    if (!plan.windowTargets?.length) return false;
    const result = await runWindowScript('embed', plan.windowTargets, { hostHandle, ...bounds });
    let state;
    try {
      state = JSON.parse(result);
    } catch {
      return false;
    }
    if (!state?.handle || !state?.style) return false;
    embeds.set(runtimeId, {
      targets: plan.windowTargets,
      handle: state.handle,
      hostHandle,
      state,
      lastBounds: bounds,
    });
    return true;
  }

  async function restoreEmbeddedWindow(runtimeId) {
    const embedded = embeds.get(runtimeId);
    if (!embedded) return true;
    embeds.delete(runtimeId);
    try {
      return (
        (await runWindowScript('restore-embed', embedded.targets, {
          handle: embedded.handle,
          state: embedded.state,
        })) === 'restored'
      );
    } catch {
      return false;
    }
  }

  async function parkEmbeddedWindow(runtimeId) {
    const embedded = embeds.get(runtimeId);
    if (!embedded) return false;
    try {
      return (
        (await runWindowScript('hide-embed', embedded.targets, { handle: embedded.handle })) ===
        'hidden'
      );
    } catch {
      return false;
    }
  }

  async function prepareRuntimeWindows(runtimeIds, hostHandle) {
    if (platform !== 'win32' || !Array.isArray(runtimeIds) || !/^\d{1,20}$/.test(hostHandle)) {
      return;
    }
    const discovered = new Set(runtimeIds);
    await Promise.all(
      [...embeds.keys()]
        .filter((runtimeId) => !discovered.has(runtimeId))
        .map(restoreEmbeddedWindow),
    );

    for (const runtimeId of discovered) {
      const plan = latest.get(runtimeId);
      if (!plan?.windowTargets?.length) continue;
      let existing = embeds.get(runtimeId);
      if (existing && JSON.stringify(existing.targets) !== JSON.stringify(plan.windowTargets)) {
        await restoreEmbeddedWindow(runtimeId);
        existing = null;
      }
      if (existing) {
        await parkEmbeddedWindow(runtimeId);
        continue;
      }
      const result = await runWindowScript('embed-hidden', plan.windowTargets, {
        hostHandle,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });
      let state;
      try {
        state = JSON.parse(result);
      } catch {
        continue;
      }
      if (state?.handle && state?.style) {
        embeds.set(runtimeId, {
          targets: plan.windowTargets,
          handle: state.handle,
          hostHandle,
          state,
        });
      }
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
    if (embedded) {
      previewWindows.set(runtimeId, embedded.handle);
      return { kind: 'window', handle: embedded.handle };
    }
    let windowLookupError;

    if (platform === 'win32' && plan.windowTargets?.length > 0) {
      try {
        const handle = await findWindow(plan.windowTargets);
        if (handle) {
          previewWindows.set(runtimeId, handle);
          return { kind: 'window', handle };
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
    sendPreviewInput,
    embedWindow,
    updateEmbeddedWindow,
    restoreEmbeddedWindow,
    parkEmbeddedWindow,
    prepareRuntimeWindows,
    restoreAllEmbeds,
  };
}

module.exports = { createTakeControlService };
