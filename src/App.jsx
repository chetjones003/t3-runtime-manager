import { useCallback, useEffect, useRef, useState } from 'react';
import { startRuntimePreview } from './runtime-preview.mjs';
import Settings from './Settings.jsx';
import {
  applySettings,
  loadSettings,
  normalizeSettings,
  organizeThreads,
  saveSettings,
} from './settings.mjs';
import appIcon from '../assets/icon.png';

const threadStates = {
  working: { label: 'Working', glyph: '●' },
  waiting: { label: 'Waiting', glyph: '◐' },
  failed: { label: 'Failed', glyph: '✕' },
  stopped: { label: 'Stopped', glyph: '■' },
  idle: { label: 'Idle', glyph: '○' },
};

function RuntimeKind({ runtime }) {
  const glyph =
    runtime.kind === 'desktop-app' ? '▣' : runtime.kind === 'browser-dev-server' ? '◉' : '⌘';
  const style =
    runtime.kind === 'desktop-app'
      ? 'runtime-desktop'
      : runtime.kind === 'browser-dev-server'
        ? 'runtime-browser'
        : 'runtime-other';
  return (
    <span className={'chip ' + style}>
      <span className="chip-glyph">{glyph}</span>
      {runtime.kindLabel}
    </span>
  );
}

const takeControlMessages = {
  focused: 'Brought its window to the front.',
  'opened-url': 'Opened it in your browser.',
  none: 'This runtime has no window to focus.',
  unsupported: 'Take Control is not supported on this operating system yet.',
};

function RuntimeBar({ runtime, onTakeControl, hasWindow, fullscreen, onToggleFullscreen }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function takeControl() {
    setBusy(true);
    setMessage('');
    try {
      const result = await window.threadAppManager.takeControl(runtime.id);
      setMessage(takeControlMessages[result.action] ?? '');
      if (result.action === 'focused') onTakeControl?.();
    } catch {
      setMessage('That runtime is gone. Refresh runtimes and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="runtime-bar">
      <div className="runtime-bar-title">
        <RuntimeKind runtime={runtime} />
        <strong>{runtime.name}</strong>
        <span className="chip state-running">
          <i className="state-dot" />
          {runtime.status === 'listening' ? 'Listening' : 'Running'}
        </span>
      </div>
      <div className="runtime-bar-actions">
        {message && (
          <span className="take-control-message" role="status">
            {message}
          </span>
        )}
        {!hasWindow && (
          <button className="button-primary take-control" onClick={takeControl} disabled={busy}>
            Take Control
          </button>
        )}
        <button className="button-secondary" onClick={onToggleFullscreen}>
          {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
      </div>
    </div>
  );
}

// Native window calls run one at a time, so a restore cannot interleave with a new presentation.
let nativeQueue = Promise.resolve();
function runNative(task) {
  const result = nativeQueue.then(task);
  nativeQueue = result.catch(() => {});
  return result;
}

const previewMessages = {
  self: "This is the window you're looking at, so there is nothing to mirror.",
  none: 'This runtime has no window or page to preview.',
  unsupported: 'Window previews are not supported on this operating system yet.',
  ended: 'The window closed or can no longer be captured.',
  error: 'The preview could not start. Refresh runtimes and try again.',
};

const previewStreamCache = new Map();
const PREVIEW_STREAM_CACHE_LIMIT = 4;

function rememberPreviewStream(runtimeId, stream) {
  previewStreamCache.delete(runtimeId);
  previewStreamCache.set(runtimeId, stream);
  while (previewStreamCache.size > PREVIEW_STREAM_CACHE_LIMIT) {
    const [oldestRuntimeId, oldestStream] = previewStreamCache.entries().next().value;
    previewStreamCache.delete(oldestRuntimeId);
    oldestStream.getTracks().forEach((track) => track.stop());
  }
}

// The preview body's content box, inside its border and padding, in page pixels.
function contentBounds(body) {
  const rect = body.getBoundingClientRect();
  const style = getComputedStyle(body);
  const paddingLeft = parseFloat(style.paddingLeft);
  const paddingTop = parseFloat(style.paddingTop);
  return {
    x: Math.round(rect.left + body.clientLeft + paddingLeft),
    y: Math.round(rect.top + body.clientTop + paddingTop),
    width: Math.round(body.clientWidth - paddingLeft - parseFloat(style.paddingRight)),
    height: Math.round(body.clientHeight - paddingTop - parseFloat(style.paddingBottom)),
  };
}

// Shows a live capture of the runtime's window. In fullscreen, the app's real window is placed over
// the preview area instead, so it can be used directly; the capture stays underneath as a fallback.
function RuntimePreview({ runtime, covered, fullscreen, onKindChange }) {
  const [preview, setPreview] = useState({ kind: 'loading' });
  const [stream, setStream] = useState(null);
  const [presentFailed, setPresentFailed] = useState(false);
  const videoRef = useRef(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    onKindChange?.(preview.kind);
  }, [preview.kind, onKindChange]);

  useEffect(() => {
    let cancelled = false;
    const cachedStream = previewStreamCache.get(runtime.id);
    if (cachedStream?.getVideoTracks().some((track) => track.readyState === 'live')) {
      previewStreamCache.delete(runtime.id);
      previewStreamCache.set(runtime.id, cachedStream);
      setStream(cachedStream);
      setPreview({ kind: 'window' });
      return () => {
        cancelled = true;
      };
    }
    if (cachedStream) {
      previewStreamCache.delete(runtime.id);
      cachedStream.getTracks().forEach((track) => track.stop());
    }
    setPreview({ kind: 'loading' });
    setStream(null);

    (async () => {
      try {
        const { preview: result, stream: active } = await startRuntimePreview(runtime.id, {
          getRuntimePreview: (runtimeId) => window.threadAppManager.getRuntimePreview(runtimeId),
          getDisplayMedia: (options) => navigator.mediaDevices.getDisplayMedia(options),
        });
        if (cancelled) {
          active?.getTracks().forEach((track) => track.stop());
          return;
        }
        if (!active) {
          setPreview(result);
          return;
        }
        active.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (previewStreamCache.get(runtime.id) === active) previewStreamCache.delete(runtime.id);
          if (!cancelled) setPreview({ kind: 'ended' });
        });
        rememberPreviewStream(runtime.id, active);
        setStream(active);
        setPreview({ kind: 'window' });
      } catch (error) {
        if (!cancelled) {
          setPreview({
            kind: 'error',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runtime.id]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream, preview.kind]);

  useEffect(() => {
    if (fullscreen) setPresentFailed(false);
  }, [fullscreen]);

  // While its preview is open, the manager holds the window: parked off-screen at the preview's size
  // so the live capture stays sharp, and moved over the preview area in fullscreen. An overlay such as
  // an update dialog parks it again, since the window would otherwise sit on top of the overlay.
  const holding = preview.kind === 'window' && !presentFailed;
  const visible = fullscreen && !covered;

  // Closing the preview hands the window back to its own position and frame.
  useEffect(() => {
    if (!holding) return undefined;
    return () => {
      runNative(() => window.threadAppManager.restorePresentedRuntimeWindow(runtime.id)).catch(
        () => {},
      );
    };
  }, [holding, runtime.id]);

  // Parked, the window keeps its own size, so it is held once and the capture is scaled to fit.
  useEffect(() => {
    if (!holding || visible) return undefined;
    let closed = false;
    runNative(() => window.threadAppManager.presentRuntimeWindow(runtime.id, null, false))
      .then((held) => {
        if (!held && !closed) setPresentFailed(true);
      })
      .catch(() => {
        if (!closed) setPresentFailed(true);
      });
    return () => {
      closed = true;
    };
  }, [holding, visible, runtime.id]);

  // Shown in fullscreen, the window fills the bordered area and follows it as the manager settles.
  useEffect(() => {
    const body = bodyRef.current;
    if (!holding || !visible || !body) return undefined;
    let closed = false;
    let frame = 0;
    let running = false;
    let pending = null;
    const flush = async () => {
      if (closed || running || !pending) return;
      const bounds = pending;
      pending = null;
      running = true;
      try {
        const shown = await runNative(() =>
          window.threadAppManager.presentRuntimeWindow(runtime.id, bounds, true),
        );
        if (!shown && !closed) setPresentFailed(true);
      } catch {
        if (!closed) setPresentFailed(true);
      } finally {
        running = false;
        flush();
      }
    };
    const measure = () => {
      frame = 0;
      const bounds = contentBounds(body);
      if (bounds.width < 100 || bounds.height < 100) return;
      pending = bounds;
      flush();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(body);
    window.addEventListener('resize', schedule);
    // The manager finishes maximizing after the page lays out, so measure once more then.
    const settle = setTimeout(schedule, 400);
    schedule();
    return () => {
      closed = true;
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [holding, visible, runtime.id]);

  return (
    <section className="runtime-preview" aria-label={'Preview of ' + runtime.name}>
      <div ref={bodyRef} className="preview-body">
        {preview.kind === 'loading' && <span className="spinner large-spinner" />}
        {preview.kind === 'window' && (
          <video ref={videoRef} autoPlay muted playsInline aria-label={runtime.name + ' window'} />
        )}
        {preview.kind === 'url' && (
          <iframe
            src={preview.url}
            title={runtime.name + ' page'}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            tabIndex={-1}
          />
        )}
        {previewMessages[preview.kind] && (
          <div className="preview-empty">
            <div>{previewMessages[preview.kind]}</div>
            {preview.kind === 'error' && preview.detail && (
              <details className="preview-error-details">
                <summary>Technical details</summary>
                <code>{preview.detail}</code>
              </details>
            )}
          </div>
        )}
        {fullscreen && presentFailed && (
          <div className="preview-note-overlay" role="status">
            The window could not be shown full size, so this is the live preview.
          </div>
        )}
      </div>
    </section>
  );
}

function ConnectPanel({ connection, connectError, connecting, onConnect }) {
  const [code, setCode] = useState('');
  return (
    <form
      className="connect-panel"
      onSubmit={(event) => {
        event.preventDefault();
        onConnect(code);
        setCode('');
      }}
    >
      <strong>{connection.expired ? 'T3 needs you to reconnect' : 'Connect to T3'}</strong>
      <p>
        In T3, open <b>Settings → Connections</b>, click <b>Create link</b>, and paste the one-time
        code here. This app only asks for read access to your threads.
      </p>
      <div className="connect-row">
        <input
          type="password"
          autoComplete="off"
          spellCheck="false"
          aria-label="T3 pairing code"
          placeholder="One-time pairing code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          disabled={connecting}
        />
        <button className="button-primary" disabled={connecting || !code.trim()}>
          {connecting ? 'Connecting…' : 'Connect'}
        </button>
      </div>
      {connectError && (
        <div className="connect-error" role="alert">
          {connectError}
        </div>
      )}
    </form>
  );
}

function relativeTime(iso) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return 'now';
  if (minutes < 60) return minutes + 'm';
  if (minutes < 60 * 24) return Math.round(minutes / 60) + 'h';
  return Math.round(minutes / (60 * 24)) + 'd';
}

function ThreadRow({ thread, selected, onSelect, onOpen, canOpen, showBranch }) {
  const state = threadStates[thread.state] ?? threadStates.idle;
  return (
    <div className={'thread-row' + (selected ? ' selected' : '')}>
      <div className="thread-row-top">
        <button
          className="thread-row-main"
          onClick={() => onSelect(thread.id)}
          aria-pressed={selected}
          title={thread.title}
        >
          <span className="thread-name">{thread.title}</span>
        </button>
        {thread.state === 'idle' ? (
          <span className="row-time">{relativeTime(thread.updatedAt)}</span>
        ) : (
          <span className={'row-state row-state-' + thread.state}>
            {state.glyph} {state.label}
          </span>
        )}
        <button
          className="row-action"
          onClick={() => onOpen(thread.id)}
          disabled={!canOpen}
          title="Open in T3"
          aria-label={'Open ' + thread.title + ' in T3'}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {showBranch && <span className="thread-branch">⎇ {thread.branch || 'No branch'}</span>}
    </div>
  );
}

function UpdateIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 13.5v-7M6.9 9.4 10 6.3l3.1 3.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 2.4v2M10 15.6v2M2.4 10h2M15.6 10h2M4.6 4.6l1.4 1.4M14 14l1.4 1.4M15.4 4.6 14 6M6 14l-1.4 1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="10" cy="10" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

// Strips the small amount of Markdown GitHub's generated release notes use.
function plainMarkdown(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function ReleaseNotes({ notes }) {
  const lines = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return <p className="release-notes-empty">No release notes.</p>;
  return (
    <div className="release-notes">
      {lines.map((line, index) => {
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        if (heading) return <h3 key={index}>{plainMarkdown(heading[1])}</h3>;
        const bullet = /^[-*]\s+(.*)$/.exec(line);
        if (bullet) return <li key={index}>{plainMarkdown(bullet[1])}</li>;
        return <p key={index}>{plainMarkdown(line)}</p>;
      })}
    </div>
  );
}

function UpdateDialog({ update, onClose }) {
  const available = update.status === 'available';
  const busy = update.status === 'downloading' || update.status === 'installing';

  const percent = Math.round((update.progress ?? 0) * 100);
  return (
    <div className="modal-shade" role="presentation">
      <div className="modal update-modal" role="dialog" aria-labelledby="update-title">
        <div className="eyebrow">UPDATE</div>
        {update.latest ? (
          <>
            <h2 id="update-title">Update to v{update.latest.version}</h2>
            <div className="update-versions">
              You have v{update.currentVersion}
              {update.latest.publishedAt &&
                ` · released ${new Date(update.latest.publishedAt).toLocaleDateString()}`}
            </div>
            <ReleaseNotes notes={update.latest.notes} />
          </>
        ) : (
          <>
            <h2 id="update-title">You're up to date</h2>
            <div className="update-versions">
              T3 Runtime Manager v{update.currentVersion}
              {update.checking && ' · checking…'}
            </div>
          </>
        )}

        {update.status === 'downloading' && (
          <div className="update-progress" role="status">
            <div className="update-progress-track">
              <div className="update-progress-bar" style={{ width: percent + '%' }} />
            </div>
            <span>Downloading… {percent}%</span>
          </div>
        )}
        {update.status === 'installing' && (
          <div className="update-progress" role="status">
            <span className="spinner" /> Closing to install. The app reopens when it finishes.
          </div>
        )}
        {available && !update.canInstall && (
          <p className="update-note">
            Automatic install is only available in the installed Windows app. Download this release
            from GitHub instead.
          </p>
        )}
        {update.error && (
          <div className="connect-error" role="alert">
            {update.error}
          </div>
        )}

        <div className="modal-actions">
          {busy ? (
            <button
              className="button-secondary"
              onClick={() => window.threadAppManager.cancelUpdate()}
              disabled={update.status === 'installing'}
            >
              Cancel
            </button>
          ) : (
            <>
              <button className="button-secondary" onClick={onClose}>
                Close
              </button>
              {!update.latest && (
                <button
                  className="button-primary"
                  onClick={() => window.threadAppManager.checkForUpdates()}
                  disabled={update.checking}
                >
                  Check again
                </button>
              )}
              {available && update.canInstall && (
                <button
                  className="button-primary"
                  onClick={() => window.threadAppManager.installUpdate()}
                >
                  {update.error ? 'Try again' : 'Update'}
                </button>
              )}
              {available && !update.canInstall && (
                <button
                  className="button-primary"
                  onClick={() => window.threadAppManager.openReleasePage()}
                >
                  Open release page
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const connectionBadge = {
  ok: { label: 'T3 connected', tone: 'ok' },
  'needs-connect': { label: 'T3 not connected', tone: 'warn' },
  unreachable: { label: 'T3 unreachable', tone: 'bad' },
};

export default function App() {
  const [connection, setConnection] = useState({ state: 'loading' });
  const [t3Data, setT3Data] = useState(null);
  const [connectError, setConnectError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [openError, setOpenError] = useState('');
  const [previewId, setPreviewId] = useState(null);
  const [maximized, setMaximized] = useState(false);
  const [update, setUpdate] = useState(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const [query, setQuery] = useState('');
  const threadsRef = useRef([]);
  const scannedOnce = useRef(false);
  const scanInFlight = useRef(false);

  useEffect(() => {
    if (window.threadAppManager.platform !== 'win32') return undefined;
    window.threadAppManager.controlWindow('state').then(setMaximized);
    return window.threadAppManager.onWindowState(setMaximized);
  }, []);

  useEffect(() => {
    window.threadAppManager.getUpdateState().then(setUpdate);
    return window.threadAppManager.onUpdateState(setUpdate);
  }, []);

  const threads = t3Data?.threads ?? [];
  const threadGroups = organizeThreads(threads, settings, query);
  const visibleThreads = threadGroups.flatMap(([, list]) => list);
  const projectNames = Array.from(
    new Set([
      ...threads.map((thread) => thread.projectTitle || 'No project'),
      ...settings.hiddenProjects,
    ]),
  ).sort((x, y) => x.localeCompare(y));
  threadsRef.current = threads;
  const selected =
    visibleThreads.find((thread) => thread.id === selectedId) ?? visibleThreads[0] ?? null;

  const refreshRuntimes = useCallback(async () => {
    if (scanInFlight.current || threadsRef.current.length === 0) return;
    scanInFlight.current = true;
    setScanning(true);
    setScanError('');
    try {
      const result = await window.threadAppManager.discoverRuntimes(
        threadsRef.current.map(({ id, worktree }) => ({ id, path: worktree })),
      );
      setScan(result);
    } catch {
      setScanError('The runtime scan could not complete. Try refreshing again.');
    } finally {
      scanInFlight.current = false;
      setScanning(false);
    }
  }, []);

  const applyResult = useCallback(
    (result) => {
      setConnection(result);
      if (result.state === 'ok') {
        setT3Data(result);
        if (!scannedOnce.current) {
          scannedOnce.current = true;
          threadsRef.current = result.threads;
          if (result.threads.length > 0) refreshRuntimes();
        }
      }
    },
    [refreshRuntimes],
  );

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await window.threadAppManager.getT3Threads();
        if (!cancelled) applyResult(result);
      } catch {
        if (!cancelled) setConnection({ state: 'unreachable' });
      } finally {
        inFlight = false;
      }
    }
    poll();
    const timer = setInterval(poll, settings.refreshSeconds * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [applyResult, settings.refreshSeconds]);

  useEffect(() => {
    const refresh = () => refreshRuntimes();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refreshRuntimes]);

  async function connect(code) {
    setConnecting(true);
    setConnectError('');
    try {
      const result = await window.threadAppManager.connectT3(code);
      if (result.error) setConnectError(result.error);
      applyResult(result);
      return result;
    } catch {
      setConnectError('Could not connect to T3. Try again.');
      return { state: 'unreachable' };
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    await window.threadAppManager.disconnectT3();
    setT3Data(null);
    setSelectedId(null);
    setScan(null);
    scannedOnce.current = false;
    setConnection({ state: 'needs-connect' });
  }

  function changeSettings(patch) {
    setSettings((previous) => {
      const next = normalizeSettings({ ...previous, ...patch });
      saveSettings(next);
      return next;
    });
  }

  useEffect(() => {
    applySettings(settings);
  }, [settings]);

  async function openInT3(threadId) {
    setOpenError('');
    try {
      await window.threadAppManager.openT3Thread(threadId);
    } catch {
      setOpenError('That thread could not be opened. Refresh and try again.');
    }
  }

  const worktreeRuntimes = selected
    ? (scan?.runtimes.filter((runtime) => runtime.worktreeId === selected.id) ?? [])
    : [];
  const previewed =
    worktreeRuntimes.find((runtime) => runtime.id === previewId) ?? worktreeRuntimes[0];
  const overlayOpen = settingsOpen || (updateOpen && Boolean(update));
  const [previewKind, setPreviewKind] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  // Fullscreen makes the manager window cover the screen, so the runtime fills the screen with it.
  useEffect(() => {
    window.threadAppManager.setWindowFullscreen(fullscreen).catch(() => {});
  }, [fullscreen]);
  const scanState = scanning
    ? 'scanning'
    : scanError
      ? 'error'
      : !scan
        ? 'empty'
        : scan.state === 'partial'
          ? 'partial'
          : 'complete';
  const scanStateLabel = {
    scanning: 'Scanning',
    error: 'Scan failed',
    empty: 'No scan yet',
    partial: 'Partial scan',
    complete: 'Complete scan',
  }[scanState];

  const badge = connectionBadge[connection.state];
  const stale = Boolean(t3Data) && connection.state !== 'ok';

  return (
    <div className={'window-shell' + (fullscreen ? ' runtime-fullscreen' : '')}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <img src={appIcon} alt="" draggable="false" />
          </span>
          <span>T3 Runtime Manager</span>
        </div>
        <div className="topbar-spacer" />
        {badge && (
          <span className={'connection-badge connection-' + badge.tone}>
            <i /> {badge.label}
          </span>
        )}
        {window.threadAppManager.platform === 'win32' && (
          <div className="window-controls" aria-label="Window controls">
            <button
              className="window-control-button"
              aria-label="Minimize window"
              title="Minimize"
              onClick={() => window.threadAppManager.controlWindow('minimize')}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8.5h10" />
              </svg>
            </button>
            <button
              className="window-control-button"
              aria-label={maximized ? 'Restore window' : 'Maximize window'}
              title={maximized ? 'Restore' : 'Maximize'}
              onClick={async () =>
                setMaximized(await window.threadAppManager.controlWindow('toggle-maximize'))
              }
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                {maximized ? (
                  <>
                    <path d="M5 5V3.5A.5.5 0 0 1 5.5 3h7a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5H11" />
                    <path d="M3.5 5h7a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5Z" />
                  </>
                ) : (
                  <rect x="3.5" y="3.5" width="9" height="9" rx="0.7" />
                )}
              </svg>
            </button>
            <button
              className="window-control-button window-close-button"
              aria-label="Close window"
              title="Close"
              onClick={() => window.threadAppManager.controlWindow('close')}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 4 8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        )}
      </header>

      <div className="content">
        <main className="cockpit">
          {connection.state === 'unreachable' && (
            <div className="connection-banner connection-banner-bad" role="status">
              T3 is unreachable. Start T3 on this computer
              {stale ? ' — showing the last threads it reported while retrying.' : '.'}
            </div>
          )}

          <section className="work-area">
            <div className="thread-sidebar">
              {threads.length > 0 ? (
                <>
                  <div
                    className="sidebar-heading"
                    title={`Your active T3 threads that have a worktree on this computer. Refreshed from T3 every ${settings.refreshSeconds} seconds. Runtime discovery reads process and TCP listener metadata without changing running apps; Take Control only brings an app window forward.`}
                  >
                    Active threads{' '}
                    <span className="count-pill">
                      {visibleThreads.length === threads.length
                        ? threads.length + ' in T3'
                        : visibleThreads.length + ' of ' + threads.length}
                    </span>
                  </div>
                  <div className="thread-search">
                    <input
                      type="search"
                      aria-label="Search threads"
                      placeholder={
                        settings.searchScope === 'title'
                          ? 'Search thread titles'
                          : 'Search threads, branches, projects'
                      }
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      spellCheck="false"
                    />
                  </div>
                  <div
                    className={'thread-list' + (stale ? ' stale' : '')}
                    role="list"
                    aria-label="Active threads"
                  >
                    {visibleThreads.length === 0 && (
                      <div className="thread-list-empty">
                        {query
                          ? 'No threads match your search.'
                          : 'All projects are hidden in Settings.'}
                      </div>
                    )}
                    {threadGroups.map(([project, projectThreads]) => (
                      <section className="thread-project-group" key={project ?? 'all'}>
                        {project !== null && (
                          <div className="thread-project-heading">
                            <span className="project-badge" aria-hidden="true">
                              {project.slice(0, 2).toUpperCase()}
                            </span>
                            <span>{project}</span>
                            <span className="thread-project-count">{projectThreads.length}</span>
                          </div>
                        )}
                        {projectThreads.map((thread) => (
                          <ThreadRow
                            thread={thread}
                            selected={selected?.id === thread.id}
                            onSelect={setSelectedId}
                            onOpen={openInT3}
                            canOpen={!stale}
                            showBranch={settings.showBranch}
                            key={thread.id}
                          />
                        ))}
                      </section>
                    ))}
                  </div>
                </>
              ) : (
                <div className="sidebar-fill">
                  <div className="thread-list-empty">
                    {connection.state === 'ok'
                      ? 'No active threads yet.'
                      : 'Connect to T3 to see your active threads here.'}
                  </div>
                </div>
              )}
              {openError && (
                <div className="connect-error" role="alert">
                  {openError}
                </div>
              )}
              <div className="sidebar-footer">
                <button
                  className={'settings-button' + (settingsOpen ? ' active' : '')}
                  onClick={() => setSettingsOpen((open) => !open)}
                  title="Settings"
                  aria-label="Settings"
                  aria-pressed={settingsOpen}
                >
                  <SettingsIcon />
                </button>
                <span className="sidebar-footer-spacer" />
                {update && (
                  <button
                    className={'update-button' + (update.latest ? ' update-available' : '')}
                    onClick={() => setUpdateOpen(true)}
                    title={
                      update.latest
                        ? `Update to v${update.latest.version}`
                        : `Up to date · v${update.currentVersion}`
                    }
                    aria-label={
                      update.latest
                        ? `Update available: v${update.latest.version}`
                        : 'Check for updates'
                    }
                  >
                    <UpdateIcon />
                  </button>
                )}
              </div>
            </div>

            {threads.length > 0 ? (
              <section className="app-stage runtime-stage" aria-label="Runtimes for this thread">
                <div className="stage-toolbar">
                  <div>
                    <div className="eyebrow">RUNTIMES</div>
                    <div className="stage-title" title={selected?.title}>
                      {selected?.title ?? 'No thread selected'}
                    </div>
                  </div>
                  <div className="stage-toolbar-spacer" />
                  <span className={'surface-state scan-state-' + scanState}>
                    {scanStateLabel}
                    {scan && !scanning && ` · ${new Date(scan.scannedAt).toLocaleTimeString()}`}
                  </span>
                  <button
                    className="button-secondary refresh-button"
                    onClick={refreshRuntimes}
                    disabled={scanning || threads.length === 0}
                  >
                    {scanning ? (
                      <>
                        <span className="spinner" /> Scanning…
                      </>
                    ) : (
                      <>
                        ↻ <span>Refresh runtimes</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="runtime-results">
                  {scanError && (
                    <div className="scan-message scan-error" role="alert">
                      {scanError}
                    </div>
                  )}
                  {!scan && !scanError && !scanning && (
                    <div className="scan-message">
                      <div className="empty-icon">⌕</div>
                      <strong>Refresh to discover this thread's runtimes</strong>
                      <p>Only processes with direct evidence for this worktree appear here.</p>
                    </div>
                  )}
                  {scan && selected && worktreeRuntimes.length === 0 && (
                    <div className="scan-message">
                      <div className="empty-icon">⌕</div>
                      <strong>No runtimes found for this thread</strong>
                      <p>
                        No process executable path or command line referenced this worktree in the
                        latest scan.
                      </p>
                    </div>
                  )}
                  {worktreeRuntimes.length > 1 && (
                    <div className="runtime-tabs" role="tablist">
                      {worktreeRuntimes.map((runtime) => (
                        <button
                          key={runtime.id}
                          role="tab"
                          aria-selected={previewed?.id === runtime.id}
                          className={
                            'runtime-tab' + (previewed?.id === runtime.id ? ' active' : '')
                          }
                          onClick={() => setPreviewId(runtime.id)}
                        >
                          {runtime.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {previewed && (
                    <>
                      {fullscreen ? (
                        <button
                          className="fullscreen-exit"
                          onClick={() => setFullscreen(false)}
                          title="Exit fullscreen (Esc)"
                        >
                          Exit fullscreen
                        </button>
                      ) : (
                        <RuntimeBar
                          key={'bar-' + previewed.id}
                          runtime={previewed}
                          onTakeControl={refreshRuntimes}
                          hasWindow={previewKind === 'window'}
                          fullscreen={fullscreen}
                          onToggleFullscreen={() => setFullscreen((value) => !value)}
                        />
                      )}
                      <RuntimePreview
                        key={'preview-' + previewed.id}
                        runtime={previewed}
                        covered={overlayOpen}
                        fullscreen={fullscreen}
                        onKindChange={setPreviewKind}
                      />
                    </>
                  )}
                </div>
                {scanning && (
                  <div className="scan-toast" role="status">
                    <span className="spinner" />
                    <span>Scanning local processes and TCP listeners…</span>
                  </div>
                )}
                {scan?.limitations.length > 0 && (
                  <div className="scan-limitations">
                    <strong>Partial scan · other results are still shown</strong>
                    {scan.limitations.map((limitation, index) => (
                      <span key={index}>{limitation}</span>
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <div className="stage-fallback">
                {connection.state === 'needs-connect' && (
                  <ConnectPanel
                    connection={connection}
                    connectError={connectError}
                    connecting={connecting}
                    onConnect={connect}
                  />
                )}

                {connection.state === 'loading' && (
                  <div className="scan-message">
                    <span className="spinner large-spinner" />
                    <strong>Reading threads from T3…</strong>
                  </div>
                )}

                {t3Data && threads.length === 0 && (
                  <div className="scan-message">
                    <div className="empty-icon">⌕</div>
                    <strong>No active threads with a worktree on this computer</strong>
                    <p>Active threads appear here once T3 creates a worktree for them.</p>
                  </div>
                )}
              </div>
            )}
          </section>
        </main>

        {settingsOpen && (
          <Settings
            settings={settings}
            onChange={changeSettings}
            connection={connection}
            onConnect={connect}
            onDisconnect={disconnect}
            update={update}
            projects={projectNames}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </div>

      {updateOpen && update && (
        <UpdateDialog update={update} onClose={() => setUpdateOpen(false)} />
      )}
    </div>
  );
}
