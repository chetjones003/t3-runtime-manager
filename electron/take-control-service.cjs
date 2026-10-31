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
    !['focus', 'find', 'mouse', 'key', 'present', 'update-present', 'restore-present'].includes(
      mode,
    ) ||
    !TARGETS_PATTERN.test(encoded)
  )
    return 'none';
  const script = await readFile(windowScript, 'utf8');
  const mouseVariables =
    mode === 'mouse'
      ? `$MouseType = '${input.type}'\n$MouseX = ${input.x}\n$MouseY = ${input.y}\n$MouseButton = '${input.button}'\n$MouseFlags = ${input.buttons}\n$MouseDelta = ${input.delta}\n$PreviewHandle = '${input.handle ?? ''}'\n`
      : mode === 'key'
        ? `$KeyCode = ${input.keyCode}\n$CharCodes = @(${input.charCodes.join(',')})\n$Modifiers = ${input.modifiers}\n`
        : mode === 'present'
          ? `$HostHandle = '${input.hostHandle}'\n$PresentX = ${input.x}\n$PresentY = ${input.y}\n$PresentWidth = ${input.width}\n$PresentHeight = ${input.height}\n$PresentActivate = ${input.activate ? 1 : 0}\n$PresentPark = ${input.park ? 1 : 0}\n`
          : mode === 'update-present'
            ? `$PresentedHandle = '${input.handle}'\n$HostHandle = '${input.hostHandle}'\n$PresentX = ${input.x}\n$PresentY = ${input.y}\n$PresentWidth = ${input.width}\n$PresentHeight = ${input.height}\n$PresentActivate = ${input.activate ? 1 : 0}\n$PresentPark = ${input.park ? 1 : 0}\n`
            : mode === 'restore-present'
              ? `$PresentedHandle = '${input.handle}'\n$OriginalState = '${JSON.stringify(input.state)}'\n`
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
  // Windows shown full size over the manager, by runtime id, with the state to restore them to.
  const presented = new Map();
  let presentQueue = Promise.resolve();
  // Presenting, hiding, and restoring change the same window, so they run one at a time.
  function serial(task) {
    const result = presentQueue.then(task);
    presentQueue = result.catch(() => {});
    return result;
  }
  const previewWindows = new Map();

  function remember(runtimes) {
    latest = new Map(runtimes.map((runtime) => [runtime.id, planTakeControl(runtime)]));
    for (const runtimeId of previewWindows.keys()) {
      if (!latest.has(runtimeId)) previewWindows.delete(runtimeId);
    }
  }

  function planFor(runtimeId) {
    const plan = latest.get(runtimeId);
    if (!plan) throw new Error('That runtime is no longer in the latest scan.');
    return plan;
  }

  async function takeControl(runtimeId) {
    const plan = planFor(runtimeId);

    if (presented.has(runtimeId)) return { action: 'presented' };

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

  function validScreenBounds(bounds) {
    return (
      bounds &&
      ['x', 'y', 'width', 'height'].every((key) => Number.isInteger(bounds[key])) &&
      Math.abs(bounds.x) <= 100000 &&
      Math.abs(bounds.y) <= 100000 &&
      bounds.width >= 100 &&
      bounds.height >= 100 &&
      bounds.width <= 100000 &&
      bounds.height <= 100000
    );
  }

  // Presenting keeps the app's window top-level, so GPU-rendered apps keep drawing, and makes the
  // manager its owner so it stays above the manager and leaves the taskbar. Shown, it covers the
  // given screen rectangle and takes focus. Parked, it keeps its own size off-screen, where it still
  // renders for the live preview, and never takes focus; the given bounds are then ignored.
  async function presentWindow(runtimeId, hostHandle, bounds, { show = false } = {}) {
    if (platform !== 'win32' || !/^\d{1,20}$/.test(hostHandle)) {
      throw new Error('Invalid window presentation request.');
    }
    if (show && !validScreenBounds(bounds)) throw new Error('Invalid window bounds.');
    const plan = planFor(runtimeId);
    const current = presented.get(runtimeId);
    if (current) {
      // A parked window returns to the size it had before the manager held it.
      const rect = show
        ? bounds
        : { x: 0, y: 0, width: current.state.width, height: current.state.height };
      return (
        (await runWindowScript('update-present', current.targets, {
          handle: current.handle,
          hostHandle,
          activate: show,
          park: !show,
          ...rect,
        })) === 'updated'
      );
    }
    if (!plan.windowTargets?.length) return false;
    const result = await runWindowScript('present', plan.windowTargets, {
      hostHandle,
      activate: show,
      park: !show,
      ...(show ? bounds : { x: 0, y: 0, width: 100, height: 100 }),
    });
    let state;
    try {
      state = JSON.parse(result);
    } catch {
      return false;
    }
    const validState =
      /^\d{1,20}$/.test(state?.handle ?? '') &&
      Number.isInteger(state.style) &&
      ['x', 'y', 'width', 'height'].every((key) => Number.isInteger(state[key]));
    if (!validState) return false;
    presented.set(runtimeId, { targets: plan.windowTargets, handle: state.handle, state });
    return true;
  }

  async function restorePresentedWindow(runtimeId) {
    const current = presented.get(runtimeId);
    if (!current) return true;
    presented.delete(runtimeId);
    try {
      return (
        (await runWindowScript('restore-present', current.targets, {
          handle: current.handle,
          state: current.state,
        })) === 'restored'
      );
    } catch {
      return false;
    }
  }

  async function restoreAllPresented() {
    await Promise.all([...presented.keys()].map(restorePresentedWindow));
  }

  // What the preview area can show for a runtime: its window if it owns one, else its loopback
  // page, else nothing.
  async function getPreview(runtimeId) {
    const plan = planFor(runtimeId);
    const current = presented.get(runtimeId);
    if (current) {
      previewWindows.set(runtimeId, current.handle);
      return { kind: 'window', handle: current.handle };
    }
    const cachedHandle = previewWindows.get(runtimeId);
    if (cachedHandle) return { kind: 'window', handle: cachedHandle };
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

  function forgetPreviewWindow(runtimeId) {
    previewWindows.delete(runtimeId);
  }

  async function preparePreviews(hasWindowSource = () => false) {
    const targets = [...latest.entries()].filter(([, plan]) => plan.windowTargets?.length > 0);
    return Promise.all(
      targets.map(async ([runtimeId, plan]) => {
        // A held window is owned by the manager, so a fresh lookup would skip it and could pick,
        // and show, one of the app's hidden helper windows instead.
        const held = presented.get(runtimeId);
        if (held) {
          previewWindows.set(runtimeId, held.handle);
          return held.handle;
        }
        const cachedHandle = previewWindows.get(runtimeId);
        if (cachedHandle && hasWindowSource(cachedHandle)) return cachedHandle;
        previewWindows.delete(runtimeId);
        try {
          const handle = await findWindow(plan.windowTargets);
          if (handle) previewWindows.set(runtimeId, handle);
          return handle;
        } catch {
          return null;
        }
      }),
    );
  }

  return {
    remember,
    takeControl,
    getPreview,
    forgetPreviewWindow,
    preparePreviews,
    sendPreviewInput,
    presentWindow: (...args) => serial(() => presentWindow(...args)),
    restorePresentedWindow: (runtimeId) => serial(() => restorePresentedWindow(runtimeId)),
    restoreAllPresented: () => serial(restoreAllPresented),
  };
}

module.exports = { createTakeControlService };
