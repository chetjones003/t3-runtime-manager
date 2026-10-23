import { useCallback, useEffect, useRef, useState } from 'react';

const THREAD_POLL_MS = 5000;

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

function HelperList({ helpers }) {
  if (helpers.length === 0) return null;
  return (
    <details className="helper-processes">
      <summary>
        {helpers.length} supporting {helpers.length === 1 ? 'process' : 'processes'}
      </summary>
      {helpers.map((helper) => (
        <div key={helper.pid}>
          {helper.name} · PID {helper.pid}
          {helper.listeners.map((listener) => (
            <code key={listener.address + listener.port}>
              {listener.address}:{listener.port}
            </code>
          ))}
        </div>
      ))}
    </details>
  );
}

function MissingFields({ process }) {
  if (process.missingFields.length === 0) return null;
  return (
    <div className="partial-detail">
      Unavailable for this process: {process.missingFields.join(', ')}
    </div>
  );
}

const takeControlMessages = {
  focused: 'Brought its window to the front.',
  'opened-url': 'Opened it in your browser.',
  none: 'This runtime has no window to focus.',
  unsupported: 'Take Control is not supported on this operating system yet.',
};

function RuntimeGroup({ runtime, selected, selectable, onSelect }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function takeControl() {
    setBusy(true);
    setMessage('');
    try {
      const result = await window.threadAppManager.takeControl(runtime.id);
      setMessage(takeControlMessages[result.action] ?? '');
    } catch {
      setMessage('That runtime is gone. Refresh runtimes and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className={
        'runtime-group' + (selectable ? ' selectable' : '') + (selected ? ' previewed' : '')
      }
      onClick={selectable ? () => onSelect(runtime.id) : undefined}
    >
      <div className="runtime-group-header">
        <div className="runtime-group-title">
          <RuntimeKind runtime={runtime} />
          <strong>{runtime.name}</strong>
        </div>
        <div className="runtime-group-state">
          <span className="chip state-running">
            <i className="state-dot" />
            {runtime.status === 'listening' ? 'Listening' : 'Running'}
          </span>
          <button
            className="button-primary take-control"
            onClick={(event) => {
              event.stopPropagation();
              takeControl();
            }}
            disabled={busy}
          >
            Take Control
          </button>
        </div>
      </div>
      <div className="runtime-process">
        PID {runtime.process.pid}
        {runtime.process.executablePath && (
          <span title={runtime.process.executablePath}>{runtime.process.executablePath}</span>
        )}
      </div>
      {runtime.listeners.length > 0 && (
        <div className="runtime-endpoints">
          <span className="eyebrow">TCP LISTENERS</span>
          {runtime.listeners.map((listener) => (
            <code key={listener.address + listener.port}>
              {listener.address}:{listener.port}
            </code>
          ))}
        </div>
      )}
      <ul className="runtime-evidence">
        {runtime.evidence.map((evidence) => (
          <li key={evidence}>{evidence}</li>
        ))}
      </ul>
      <MissingFields process={runtime.process} />
      <HelperList helpers={runtime.helpers} />
      {message && (
        <div className="take-control-message" role="status">
          {message}
        </div>
      )}
    </article>
  );
}

const previewMessages = {
  self: "This is the window you're looking at, so there is nothing to mirror.",
  none: 'This runtime has no window or page to preview.',
  unsupported: 'Window previews are not supported on this operating system yet.',
  ended: 'The window closed or can no longer be captured.',
  error: 'The preview could not start. Refresh runtimes and try again.',
};

function RuntimePreview({ runtime, scannedAt }) {
  const [preview, setPreview] = useState({ kind: 'loading' });
  const [stream, setStream] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const videoRef = useRef(null);
  const previewRef = useRef(null);
  const streamRef = useRef(null);
  const lastPointerSend = useRef(0);
  const fitPreviewRef = useRef(() => {});

  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  function sendPointer(event, type, delta = 0) {
    if (preview.kind !== 'window' || !videoRef.current) return;
    const now = performance.now();
    if (type === 'move' && now - lastPointerSend.current < 100) return;
    lastPointerSend.current = now;

    const video = videoRef.current;
    const bounds = video.getBoundingClientRect();
    const imageRatio = video.videoWidth / video.videoHeight;
    if (!imageRatio) return;
    const boxRatio = bounds.width / bounds.height;
    const drawnWidth = imageRatio > boxRatio ? bounds.width : bounds.height * imageRatio;
    const drawnHeight = imageRatio > boxRatio ? bounds.width / imageRatio : bounds.height;
    const left = bounds.left + (bounds.width - drawnWidth) / 2;
    const top = bounds.top + (bounds.height - drawnHeight) / 2;
    const x = (event.clientX - left) / drawnWidth;
    const y = (event.clientY - top) / drawnHeight;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    window.threadAppManager.sendPreviewInput(runtime.id, {
      type,
      x,
      y,
      button: event.button === 2 ? 'right' : 'left',
      buttons: event.buttons ?? 0,
      delta,
    });
  }

  function sendKey(event) {
    if (preview.kind !== 'window' || (fullscreen && event.key === 'Escape')) return;
    const keyCode = event.keyCode || event.which;
    if (!keyCode) return;
    event.preventDefault();
    window.threadAppManager.sendPreviewInput(runtime.id, {
      type: 'key',
      keyCode,
      charCodes:
        event.key.length === 1 && !event.ctrlKey && !event.altKey
          ? Array.from({ length: event.key.length }, (_, index) => event.key.charCodeAt(index))
          : [],
      modifiers: (event.shiftKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.altKey ? 4 : 0),
    });
  }

  useEffect(() => {
    let cancelled = false;
    setPreview({ kind: 'loading' });
    setStream(null);

    (async () => {
      try {
        const result = await window.threadAppManager.getRuntimePreview(runtime.id);
        if (cancelled) return;
        if (result.kind !== 'window') {
          setPreview(result);
          return;
        }
        if (typeof result.sourceId !== 'string') {
          throw new Error('Electron did not provide a capture source for this window.');
        }
        const active = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: result.sourceId,
              maxFrameRate: 15,
            },
          },
        });
        if (cancelled) {
          active.getTracks().forEach((track) => track.stop());
          return;
        }
        active.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (!cancelled) setPreview({ kind: 'ended' });
        });
        streamRef.current = active;
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
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [runtime.id, runtime.name, scannedAt]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream, preview.kind]);

  useEffect(() => {
    const section = previewRef.current;
    const video = videoRef.current;
    if (preview.kind !== 'window' || !section || !video) return undefined;
    const panel = section.parentElement;
    if (!panel) return undefined;

    const fit = () => {
      if (fullscreen) {
        section.style.width = '';
        section.style.height = '';
        section.classList.remove('preview-fitted');
        return;
      }
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      if (!sourceWidth || !sourceHeight) return;

      const panelStyle = getComputedStyle(panel);
      const paddingX = parseFloat(panelStyle.paddingLeft) + parseFloat(panelStyle.paddingRight);
      const paddingY = parseFloat(panelStyle.paddingTop) + parseFloat(panelStyle.paddingBottom);
      const gap = parseFloat(panelStyle.rowGap) || 0;
      const siblingsHeight = Array.from(panel.children)
        .filter((child) => child !== section)
        .reduce((total, child) => total + child.getBoundingClientRect().height, 0);
      const siblingGaps = gap * Math.max(0, panel.children.length - 1);
      const availableWidth = Math.max(1, panel.clientWidth - paddingX);
      const availableHeight = Math.max(
        120,
        panel.clientHeight -
          paddingY -
          siblingsHeight -
          siblingGaps -
          section.querySelector('.preview-bar').getBoundingClientRect().height,
      );
      const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
      const width = Math.max(1, Math.floor(sourceWidth * scale));
      const height = Math.max(1, Math.floor(sourceHeight * scale));
      const barHeight = section.querySelector('.preview-bar').getBoundingClientRect().height;

      section.style.width = `${width}px`;
      section.style.height = `${height + barHeight}px`;
      section.classList.add('preview-fitted');
    };

    fitPreviewRef.current = fit;
    const observer = new ResizeObserver(fit);
    observer.observe(panel);
    observer.observe(section.querySelector('.preview-bar'));
    Array.from(panel.children)
      .filter((child) => child !== section)
      .forEach((child) => observer.observe(child));
    fit();
    return () => {
      observer.disconnect();
      section.style.width = '';
      section.style.height = '';
      section.classList.remove('preview-fitted');
      fitPreviewRef.current = () => {};
    };
  }, [preview.kind, fullscreen, runtime.id]);

  return (
    <section
      ref={previewRef}
      className={'runtime-preview' + (fullscreen ? ' preview-fullscreen' : '')}
      aria-label={'Preview of ' + runtime.name}
    >
      <div className="preview-bar">
        {fullscreen && <span className="preview-manager-mark">TM</span>}
        <span className="eyebrow">PREVIEW</span>
        <span className="preview-source">{runtime.name}</span>
        <span className="stage-toolbar-spacer" />
        {preview.kind === 'window' && (
          <span className="preview-note">Live app · click, scroll, and type to control</span>
        )}
        {preview.kind === 'url' && <span className="preview-note">{preview.url}</span>}
        <button
          className="preview-fullscreen-button"
          onClick={() => setFullscreen((value) => !value)}
          aria-label={fullscreen ? 'Exit fullscreen preview' : 'Fullscreen preview'}
        >
          {fullscreen ? 'Exit fullscreen' : '⛶ Fullscreen'}
        </button>
      </div>
      <div className="preview-body">
        {preview.kind === 'loading' && <span className="spinner large-spinner" />}
        {preview.kind === 'window' && (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            tabIndex={0}
            aria-label={runtime.name + ' window'}
            onLoadedMetadata={() => fitPreviewRef.current()}
            onKeyDown={sendKey}
            onMouseMove={(event) => sendPointer(event, 'move')}
            onMouseDown={(event) => {
              event.preventDefault();
              videoRef.current?.focus({ preventScroll: true });
              sendPointer(event, 'down');
            }}
            onMouseUp={(event) => sendPointer(event, 'up')}
            onWheel={(event) => {
              event.preventDefault();
              sendPointer(event, 'wheel', Math.round(Math.max(-120, Math.min(120, -event.deltaY))));
            }}
            onContextMenu={(event) => event.preventDefault()}
          />
        )}
        {preview.kind === 'url' && (
          <iframe
            src={preview.url}
            title={runtime.name + ' page'}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
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

function ThreadRow({ thread, selected, onSelect, onOpen, canOpen }) {
  const state = threadStates[thread.state] ?? threadStates.idle;
  return (
    <div className={'thread-row' + (selected ? ' selected' : '')}>
      <div className="thread-row-top">
        <span className="project-badge" aria-hidden="true">
          {thread.projectTitle.slice(0, 2).toUpperCase()}
        </span>
        <span className="project-name">{thread.projectTitle}</span>
        <span className="thread-row-spacer" />
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
      <button
        className="thread-row-main"
        onClick={() => onSelect(thread.id)}
        aria-pressed={selected}
      >
        <span className="thread-name" title={thread.title}>
          {thread.title}
        </span>
        <span className="thread-branch">⎇ {thread.branch || 'No branch'}</span>
      </button>
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
  const threadsRef = useRef([]);
  const scannedOnce = useRef(false);

  const threads = t3Data?.threads ?? [];
  threadsRef.current = threads;
  const selected = threads.find((thread) => thread.id === selectedId) ?? threads[0] ?? null;

  const refreshRuntimes = useCallback(async () => {
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
          refreshRuntimes();
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
    const timer = setInterval(poll, THREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [applyResult]);

  async function connect(code) {
    setConnecting(true);
    setConnectError('');
    try {
      const result = await window.threadAppManager.connectT3(code);
      if (result.error) setConnectError(result.error);
      applyResult(result);
    } catch {
      setConnectError('Could not connect to T3. Try again.');
    } finally {
      setConnecting(false);
    }
  }

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
    <div className="window-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">TM</span>
          <span>Thread App Manager</span>
        </div>
        <div className="topbar-spacer" />
        {badge && (
          <span className={'connection-badge connection-' + badge.tone}>
            <i /> {badge.label}
          </span>
        )}
      </header>

      <main className="cockpit">
        <section className="workspace-heading">
          <div>
            <div className="eyebrow">WORKSPACE</div>
            <h1>
              Active threads {t3Data && <span className="count-pill">{threads.length} in T3</span>}
            </h1>
            <p>
              Your active T3 threads that have a worktree on this computer. Runtime discovery reads
              process and TCP listener metadata without changing running apps.
            </p>
          </div>
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
        </section>

        {connection.state === 'unreachable' && (
          <div className="connection-banner connection-banner-bad" role="status">
            T3 is unreachable. Start T3 on this computer
            {stale ? ' — showing the last threads it reported while retrying.' : '.'}
          </div>
        )}

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

        {selected && (
          <section className="work-area">
            <div className="thread-sidebar">
              <div
                className={'thread-list' + (stale ? ' stale' : '')}
                role="list"
                aria-label="Active threads"
              >
                {threads.map((thread) => (
                  <ThreadRow
                    thread={thread}
                    selected={selected.id === thread.id}
                    onSelect={setSelectedId}
                    onOpen={openInT3}
                    canOpen={!stale}
                    key={thread.id}
                  />
                ))}
              </div>
              {openError && (
                <div className="connect-error" role="alert">
                  {openError}
                </div>
              )}
            </div>

            <section className="app-stage runtime-stage" aria-label="Runtimes for this thread">
              <div className="stage-toolbar">
                <div>
                  <div className="eyebrow">RUNTIMES</div>
                  <div className="stage-title" title={selected.title}>
                    {selected.title}
                  </div>
                </div>
                <div className="stage-toolbar-spacer" />
                <span className={'surface-state scan-state-' + scanState}>
                  {scanStateLabel}
                  {scan && !scanning && ` · ${new Date(scan.scannedAt).toLocaleTimeString()}`}
                </span>
              </div>
              <div className="runtime-results">
                {scanning && (
                  <div className="scan-message">
                    <span className="spinner large-spinner" />
                    <strong>Scanning local processes and TCP listeners…</strong>
                  </div>
                )}
                {!scanning && scanError && (
                  <div className="scan-message scan-error" role="alert">
                    {scanError}
                  </div>
                )}
                {!scanning && !scanError && !scan && (
                  <div className="scan-message">
                    <div className="empty-icon">⌕</div>
                    <strong>Refresh to discover this thread's runtimes</strong>
                    <p>Only processes with direct evidence for this worktree appear here.</p>
                  </div>
                )}
                {!scanning && scan && worktreeRuntimes.length === 0 && (
                  <div className="scan-message">
                    <div className="empty-icon">⌕</div>
                    <strong>No runtimes found for this thread</strong>
                    <p>
                      No process executable path or command line referenced this worktree in the
                      latest scan.
                    </p>
                  </div>
                )}
                {!scanning &&
                  worktreeRuntimes.map((runtime) => (
                    <RuntimeGroup
                      runtime={runtime}
                      selected={previewed?.id === runtime.id}
                      selectable={worktreeRuntimes.length > 1}
                      onSelect={setPreviewId}
                      key={runtime.id}
                    />
                  ))}
                {!scanning && previewed && (
                  <RuntimePreview runtime={previewed} scannedAt={scan.scannedAt} />
                )}
              </div>
              {scan?.limitations.length > 0 && (
                <div className="scan-limitations">
                  <strong>Partial scan · other results are still shown</strong>
                  {scan.limitations.map((limitation, index) => (
                    <span key={index}>{limitation}</span>
                  ))}
                </div>
              )}
            </section>
          </section>
        )}
      </main>

      <footer className="bottom-note">
        <span className="status-light" /> Threads refresh from T3 every 5 seconds
        <span className="footer-separator">·</span> Take Control only focuses existing windows;
        build, start and stop are not connected
      </footer>
    </div>
  );
}
