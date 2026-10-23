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

function HelperList({ helpers }) {
  if (helpers.length === 0) return null;
  return (
    <details className="helper-processes">
      <summary>
        {helpers.length} helper {helpers.length === 1 ? 'process' : 'processes'}
      </summary>
      {helpers.map((helper) => (
        <div key={helper.pid}>
          {helper.name} · PID {helper.pid} ·{' '}
          {helper.confidence === 'direct' ? 'Direct path match' : 'Lineage only (weaker)'}
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

function CandidateGroup({ candidate, worktreeNames }) {
  const ambiguous = candidate.confidence === 'ambiguous';
  return (
    <article className={'runtime-group candidate-group' + (ambiguous ? ' ambiguous' : '')}>
      <div className="runtime-group-header">
        <div className="runtime-group-title">
          <RuntimeKind runtime={candidate} />
          <strong>{candidate.process.name}</strong>
        </div>
        <div className="runtime-group-state">
          <span className={ambiguous ? 'ambiguous-confidence' : 'low-confidence'}>
            {ambiguous ? 'Ambiguous · not assigned' : 'Unmatched · low confidence'}
          </span>
          <span className="chip state-running">
            <i className="state-dot" />
            {candidate.status === 'listening' ? 'Listening' : 'Running'}
          </span>
        </div>
      </div>
      <div className="runtime-process">
        PID {candidate.process.pid}
        {candidate.process.executablePath && (
          <span title={candidate.process.executablePath}>{candidate.process.executablePath}</span>
        )}
      </div>
      {ambiguous && (
        <div className="detail-sub">
          Could belong to:{' '}
          {candidate.candidateWorktreeIds.map((id) => worktreeNames[id]).join(', ')}
        </div>
      )}
      {candidate.listeners.length > 0 && (
        <div className="runtime-endpoints">
          <span className="eyebrow">TCP LISTENERS</span>
          {candidate.listeners.map((listener) => (
            <code key={listener.address + listener.port}>
              {listener.address}:{listener.port}
            </code>
          ))}
        </div>
      )}
      <ul className="runtime-evidence">
        {candidate.process.evidence.map((evidence) => (
          <li key={evidence}>{evidence}</li>
        ))}
      </ul>
      <MissingFields process={candidate.process} />
      <HelperList helpers={candidate.helpers} />
    </article>
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
      <MissingFields process={runtime.process} />
      <HelperList helpers={runtime.helpers} />
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
  const worktreeNames = Object.fromEntries(threads.map(({ id, title }) => [id, title]));
  const worktreeAmbiguous =
    scan?.unmatched.filter(
      (candidate) =>
        candidate.confidence === 'ambiguous' &&
        candidate.candidateWorktreeIds.includes(selected.id),
    ) ?? [];
  const workspaceUnmatched =
    scan?.unmatched.filter((candidate) => candidate.confidence !== 'ambiguous') ?? [];
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
              {!scanning && worktreeAmbiguous.length > 0 && (
                <section className="candidate-section" aria-label="Ambiguous candidates">
                  <div className="eyebrow">AMBIGUOUS · NOT ASSIGNED TO A WORKTREE</div>
                  {worktreeAmbiguous.map((candidate) => (
                    <CandidateGroup
                      candidate={candidate}
                      worktreeNames={worktreeNames}
                      key={candidate.process.pid}
                    />
                  ))}
                </section>
              )}
            </div>
            {!scanning && workspaceUnmatched.length > 0 && (
              <section
                className="candidate-section workspace-unmatched"
                aria-label="Unmatched candidates"
              >
                <div className="eyebrow">
                  WORKSPACE · UNMATCHED CANDIDATES ({workspaceUnmatched.length})
                </div>
                {workspaceUnmatched.map((candidate) => (
                  <CandidateGroup
                    candidate={candidate}
                    worktreeNames={worktreeNames}
                    key={candidate.process.pid}
                  />
                ))}
              </section>
            )}
            {scan?.limitations.length > 0 && (
              <div className="scan-limitations">
                <strong>Partial scan · other results are still shown</strong>
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
