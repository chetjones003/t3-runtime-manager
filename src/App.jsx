import { useState } from 'react';

const threads = [
  {
    id: 'feature-1',
    title: 'Feature 1 · Worktree window labels',
    branch: 't3/per-agent-app-sandbox',
    worktree: 'C:\\Users\\chetj\\.t3\\worktrees\\GoSurvey\\t3-4e5a98fc',
    threadState: 'Working',
    mark: '1',
  },
  {
    id: 'feature-2',
    title: 'Feature 2 · Browser dashboard',
    branch: 't3/feature-2-dashboard',
    worktree: 'C:\\Users\\chetj\\.t3\\worktrees\\GoSurvey\\t3-18eb0216',
    threadState: 'Working',
    mark: '2',
  },
  {
    id: 'feature-3',
    title: 'Feature 3 · Import tooling',
    branch: 't3/feature-3-import',
    worktree: 'C:\\Users\\chetj\\.t3\\worktrees\\GoSurvey\\t3-27147595',
    threadState: 'Waiting',
    mark: '3',
  },
];

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

function RuntimeGroup({ runtime }) {
  return (
    <article className="runtime-group">
      <div className="runtime-group-header">
        <div className="runtime-group-title">
          <RuntimeKind runtime={runtime} />
          <strong>{runtime.process.name}</strong>
        </div>
        <div className="runtime-group-state">
          <span className="direct-confidence">Direct match</span>
          <span className="chip state-running">
            <i className="state-dot" />
            {runtime.status === 'listening' ? 'Listening' : 'Running'}
          </span>
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
      {runtime.helpers.length > 0 && (
        <details className="helper-processes">
          <summary>
            {runtime.helpers.length} helper {runtime.helpers.length === 1 ? 'process' : 'processes'}
          </summary>
          {runtime.helpers.map((helper) => (
            <div key={helper.pid}>
              {helper.name} · PID {helper.pid}
            </div>
          ))}
        </details>
      )}
    </article>
  );
}

export default function App() {
  const [selectedId, setSelectedId] = useState(threads[0].id);
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const selected = threads.find((thread) => thread.id === selectedId);
  const worktreeRuntimes =
    scan?.runtimes.filter((runtime) => runtime.worktreeId === selected.id) ?? [];

  async function refreshRuntimes() {
    setScanning(true);
    setScanError('');
    try {
      const result = await window.threadAppManager.discoverRuntimes(
        threads.map(({ id, worktree }) => ({ id, path: worktree })),
      );
      setScan(result);
    } catch {
      setScanError('The runtime scan could not complete. Try refreshing again.');
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="window-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">TM</span>
          <span>Thread App Manager</span>
        </div>
        <span className="crumb">/</span>
        <button className="workspace-button" disabled>
          GoSurvey workspace <span className="chevron">⌄</span>
        </button>
        <div className="topbar-spacer" />
        <span className="prototype-badge">
          <i /> PROTOTYPE · T3 SAMPLE DATA
        </span>
        <button className="icon-button" aria-label="Settings" disabled>
          ⚙
        </button>
      </header>

      <main className="cockpit">
        <section className="workspace-heading">
          <div>
            <div className="eyebrow">WORKSPACE</div>
            <h1>
              GoSurvey <span className="count-pill">3 linked threads</span>
            </h1>
            <p>
              Runtime discovery reads process and TCP listener metadata without changing running
              apps.
            </p>
          </div>
          <button
            className="button-secondary refresh-button"
            onClick={refreshRuntimes}
            disabled={scanning}
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

        <section className="thread-shelf" aria-label="Threads">
          {threads.map((thread) => (
            <button
              className={'thread-card' + (thread.id === selected.id ? ' selected' : '')}
              key={thread.id}
              onClick={() => setSelectedId(thread.id)}
            >
              <span className="thread-mark">{thread.mark}</span>
              <span className="thread-card-copy">
                <span className="thread-name">{thread.title}</span>
                <span className="thread-branch">{thread.branch}</span>
                <span className="thread-tags">
                  <span className="chip runtime-other">T3 thread</span>
                  <span className="thread-state">{thread.threadState}</span>
                </span>
              </span>
            </button>
          ))}
        </section>

        <section className="work-area">
          <aside className="details-panel">
            <div className="eyebrow">THREAD DETAILS</div>
            <h2 className="details-title">{selected.title}</h2>
            <div className="detail-block">
              <div className="eyebrow">THREAD</div>
              <div className="detail-value">{selected.branch}</div>
              <span className="thread-state">T3 state · {selected.threadState}</span>
            </div>
            <div className="detail-block">
              <div className="eyebrow">WORKTREE</div>
              <div className="path-value" title={selected.worktree}>
                {selected.worktree}
              </div>
              <div className="detail-sub">
                Runtime matches require an exact worktree path reference.
              </div>
            </div>
            <div className="detail-block">
              <div className="eyebrow">MATCHED RUNTIMES</div>
              <div className="detail-value">{worktreeRuntimes.length} found in latest scan</div>
            </div>
            <div className="panel-divider" />
            <div className="read-only-note">
              Discovery is read-only. Build, start, stop, and window attach actions are not
              connected.
            </div>
          </aside>

          <section className="app-stage runtime-stage" aria-label="Discovered runtimes">
            <div className="stage-toolbar">
              <div className="stage-dots">
                <i />
                <i />
                <i />
              </div>
              <span>Discovered runtimes</span>
              <div className="stage-toolbar-spacer" />
              <span className="surface-state">
                {scan ? `Scanned ${new Date(scan.scannedAt).toLocaleTimeString()}` : 'No scan yet'}
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
                  <strong>Refresh to discover local runtimes</strong>
                  <p>
                    Only process groups with direct evidence for a configured worktree will appear
                    here.
                  </p>
                </div>
              )}
              {!scanning && scan && worktreeRuntimes.length === 0 && (
                <div className="scan-message">
                  <div className="empty-icon">⌕</div>
                  <strong>No matched runtimes found</strong>
                  <p>
                    No process executable path or command line referenced this worktree in the
                    latest scan.
                  </p>
                </div>
              )}
              {!scanning &&
                worktreeRuntimes.map((runtime) => (
                  <RuntimeGroup runtime={runtime} key={runtime.id} />
                ))}
            </div>
            {scan?.limitations.length > 0 && (
              <div className="scan-limitations">
                <strong>Partial scan</strong>
                {scan.limitations.map((limitation, index) => (
                  <span key={index}>{limitation}</span>
                ))}
              </div>
            )}
            {scan && (
              <div className="stage-footer">
                <div className="instance-summary">
                  <span>Latest scan · {new Date(scan.scannedAt).toLocaleString()}</span>
                </div>
                <span className="read-only-label">READ ONLY</span>
              </div>
            )}
          </section>
        </section>
      </main>

      <footer className="bottom-note">
        <span className="status-light" /> T3 thread records are sample data{' '}
        <span className="footer-separator">·</span> runtime scan results stay in memory for this
        session
      </footer>
    </div>
  );
}
