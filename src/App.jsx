import { useState } from 'react';

const initialThreads = [
  {
    id: 'feature-1',
    title: 'Feature 1 · Worktree window labels',
    branch: 't3/per-agent-app-sandbox',
    worktree: 'C:\\Users\\chetj\\.t3\\worktrees\\GoSurvey\\t3-4e5a98fc',
    threadState: 'Working',
    kind: 'desktop',
    kindLabel: 'Windows app',
    target: 'GoSurvey.exe',
    launch: 'build\\GoSurvey.exe',
    runtimeState: 'running',
    process: 'PID 12408',
    evidence: 'Sample process image path is inside this worktree build folder.',
    mark: '1',
  },
  {
    id: 'feature-2',
    title: 'Feature 2 · Browser dashboard',
    branch: 't3/feature-2-dashboard',
    worktree: 'C:\\Users\\chetj\\.t3\\worktrees\\GoSurvey\\t3-18eb0216',
    threadState: 'Working',
    kind: 'browser',
    kindLabel: 'Browser app',
    target: 'localhost:5174',
    launch: 'pnpm dev · port 5174',
    runtimeState: 'running',
    process: 'Port 5174',
    evidence: 'Sample dev server port is associated with this worktree.',
    mark: '2',
  },
  {
    id: 'feature-3',
    title: 'Feature 3 · Import tooling',
    branch: 't3/feature-3-import',
    worktree: 'C:\\Users\\chetj\\.t3\\worktrees\\GoSurvey\\t3-27147595',
    threadState: 'Waiting',
    kind: 'other',
    kindLabel: 'Other process',
    target: 'Python worker',
    launch: 'python tools\\preview.py',
    runtimeState: 'stopped',
    process: 'Not running',
    evidence: 'Sample launch command is known; no preview adapter is configured.',
    mark: '3',
  },
];

function RuntimeChip({ thread }) {
  const glyph = thread.kind === 'desktop' ? '▣' : thread.kind === 'browser' ? '◉' : '⌘';
  return <span className={'chip runtime-' + thread.kind}><span className="chip-glyph">{glyph}</span>{thread.kindLabel}</span>;
}

function RunState({ state }) {
  const label = state === 'running' ? 'Running' : state === 'building' ? 'Building' : 'Stopped';
  return <span className={'chip state-' + state}><i className="state-dot" />{label}</span>;
}

function AppSurface({ thread }) {
  if (thread.runtimeState === 'stopped') {
    return (
      <div className="surface-empty">
        <div className="empty-icon">⌁</div>
        <strong>No running app for this worktree</strong>
        <p>Thread and runtime details are separate. Choose an explicit action to start an app.</p>
      </div>
    );
  }

  if (thread.runtimeState === 'building') {
    return (
      <div className="surface-empty">
        <div className="spinner large-spinner" />
        <strong>Building in this worktree</strong>
        <p>Other threads and their running apps remain untouched.</p>
      </div>
    );
  }

  if (thread.kind === 'browser') {
    return (
      <div className="mock-window browser-window">
        <div className="mock-title"><b>{thread.target}</b><span className="micro-pill">Browser surface · sample</span></div>
        <div className="mock-content">
          <div className="mock-brand">Feature preview</div>
          <div className="skeleton wide" /><div className="skeleton medium" /><div className="skeleton short" />
          <div className="mock-message"><span className="ready-indicator" /> Dev server reachable · Preview integration is not connected</div>
        </div>
      </div>
    );
  }

  if (thread.kind === 'other') {
    return (
      <div className="mock-window terminal-window">
        <div className="mock-title"><b>{thread.target}</b><span className="micro-pill">Process adapter · sample</span></div>
        <div className="terminal-lines"><div><span>$</span> python tools\preview.py</div><div className="terminal-muted">Waiting for process to start…</div></div>
      </div>
    );
  }

  return (
    <div className="mock-window desktop-window">
      <div className="mock-title"><b>GoSurvey</b><span className="micro-pill">GoSurvey.exe</span></div>
      <div className="mock-content">
        <div className="mock-brand">Development build</div>
        <div className="skeleton wide" /><div className="skeleton medium" /><div className="skeleton short" />
        <div className="mock-message">Native window host · sample surface, not attached to a real process</div>
      </div>
    </div>
  );
}

function ThreadCard({ thread, selected, onSelect }) {
  return (
    <button className={'thread-card' + (selected ? ' selected' : '')} onClick={onSelect}>
      <span className="thread-mark">{thread.mark}</span>
      <span className="thread-card-copy">
        <span className="thread-name">{thread.title}</span>
        <span className="thread-branch">{thread.branch}</span>
        <span className="thread-tags"><RuntimeChip thread={thread} /><RunState state={thread.runtimeState} /></span>
      </span>
    </button>
  );
}

function Modal({ title, children, onClose, onConfirm, confirmText = 'Confirm' }) {
  return (
    <div className="modal-shade" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="eyebrow">CONFIRM ACTION</div>
        <h2 id="modal-title">{title}</h2>
        <div className="modal-copy">{children}</div>
        <div className="modal-actions"><button onClick={onClose}>Cancel</button><button className="button-primary" onClick={onConfirm}>{confirmText}</button></div>
      </section>
    </div>
  );
}

export default function App() {
  const [threads, setThreads] = useState(initialThreads);
  const [selectedId, setSelectedId] = useState('feature-1');
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const selected = threads.find((thread) => thread.id === selectedId);

  function notify(message) {
    setToast(message);
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(''), 2700);
  }

  function changeRuntime(id, runtimeState) {
    setThreads((current) => current.map((thread) => thread.id === id ? { ...thread, runtimeState } : thread));
  }

  function startExisting() {
    changeRuntime(selected.id, 'running');
    notify('Started the existing build in this worktree.');
  }

  function runBuild(relaunch) {
    const threadId = selected.id;
    setModal(null);
    changeRuntime(threadId, 'building');
    notify('Building in the selected worktree…');
    window.setTimeout(() => {
      changeRuntime(threadId, relaunch ? 'running' : 'stopped');
      notify(relaunch ? 'Build succeeded · relaunched this worktree’s app.' : 'Build succeeded · app remains stopped.');
    }, 900);
  }

  function buildPrompt(relaunch) {
    setModal({
      title: relaunch ? 'Rebuild and relaunch this app?' : 'Build this worktree?',
      relaunch,
    });
  }

  return (
    <div className="window-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">TM</span><span>Thread App Manager</span></div>
        <span className="crumb">/</span>
        <button className="workspace-button" onClick={() => notify('Checkout settings are not connected in this prototype.')}>GoSurvey workspace <span className="chevron">⌄</span></button>
        <div className="topbar-spacer" />
        <span className="prototype-badge"><i /> PROTOTYPE · SAMPLE DATA</span>
        <button className="icon-button" aria-label="Settings" onClick={() => notify('T3 and repository settings are not connected yet.')}>⚙</button>
      </header>

      <main className="cockpit">
        <section className="workspace-heading">
          <div><div className="eyebrow">WORKSPACE</div><h1>GoSurvey <span className="count-pill">3 linked threads</span></h1><p>Choose a thread to bring its app into the work area. Other instances stay running.</p></div>
          <button className="button-secondary" onClick={() => notify('T3 sync is not connected. These thread records are sample data.')}>↻ <span>Sync from T3</span></button>
        </section>

        <section className="thread-shelf" aria-label="Threads">
          {threads.map((thread) => <ThreadCard key={thread.id} thread={thread} selected={thread.id === selectedId} onSelect={() => setSelectedId(thread.id)} />)}
        </section>

        <section className="work-area">
          <aside className="details-panel">
            <div className="eyebrow">THREAD DETAILS</div>
            <h2 className="details-title">{selected.title}</h2>
            <div className="detail-block"><div className="eyebrow">THREAD</div><div className="detail-value">{selected.branch}</div><span className="thread-state">T3 state · {selected.threadState}</span></div>
            <div className="detail-block"><div className="eyebrow">DETECTED RUNTIME</div><div className="runtime-value"><RuntimeChip thread={selected} /><b>{selected.target}</b></div><div className="detail-sub">{selected.launch}</div></div>
            <div className="detail-block"><div className="eyebrow">WORKTREE</div><div className="path-value" title={selected.worktree}>{selected.worktree}</div><div className="detail-sub">Matched by workspace path · sample mapping</div></div>
            <div className="detail-block"><div className="eyebrow">APP INSTANCE</div><div className="detail-value">{selected.process}</div><RunState state={selected.runtimeState} /></div>
            <div className="panel-divider" />
            <div className="eyebrow">ACTIONS</div>
            {selected.runtimeState === 'running' ? (
              <div className="action-stack">
                <button className="button-secondary" onClick={() => notify('Activate/focus requires a runtime adapter.')}>⌖ <span>Bring to front / focus</span></button>
                <button className="button-danger" onClick={() => { changeRuntime(selected.id, 'stopped'); notify('Stopped only this sample instance.'); }}>■ <span>Stop this instance</span></button>
                <button className="button-secondary" onClick={() => buildPrompt(false)}>Build only</button>
              </div>
            ) : selected.runtimeState === 'building' ? (
              <div className="building-callout"><span className="spinner" /> Build in progress…</div>
            ) : (
              <div className="action-stack">
                <button className="button-primary" onClick={() => buildPrompt(true)}>Build &amp; Run</button>
                <button className="button-secondary" onClick={startExisting}>Run existing build</button>
                <button className="button-secondary" onClick={() => buildPrompt(false)}>Build only</button>
              </div>
            )}
            <div className="policy-note">A rebuild stops only this worktree’s instance. After a successful build, the app relaunches here.</div>
          </aside>

          <section className="app-stage">
            <div className="stage-toolbar">
              <div className="stage-dots"><i /><i /><i /></div>
              <span>Associated application</span>
              <div className="stage-toolbar-spacer" />
              <RuntimeChip thread={selected} />
              <span className="surface-state">{selected.runtimeState === 'running' ? 'Attached · sample' : selected.runtimeState === 'building' ? 'Building' : 'Not running'}</span>
            </div>
            <div className="stage-content"><AppSurface thread={selected} /></div>
            <div className="stage-footer">
              <div className="instance-summary"><RunState state={selected.runtimeState} /><span>{selected.runtimeState === 'running' ? 'Selecting another thread leaves this app running.' : selected.runtimeState === 'building' ? 'Only this worktree is being rebuilt.' : 'No process is attached to this worktree.'}</span></div>
              <button className="button-secondary" onClick={() => setDetailsOpen((open) => !open)}>{detailsOpen ? 'Hide runtime details' : 'Runtime details'}</button>
            </div>
            {detailsOpen && <div className="evidence-panel"><span className="eyebrow">DETECTION EVIDENCE · SAMPLE</span><span>{selected.evidence}</span><button onClick={() => notify('Runtime overrides need the process adapter.')}>Review mapping</button></div>}
          </section>
        </section>
      </main>

      <footer className="bottom-note"><span className="status-light" /> T3 connection not configured <span className="footer-separator">·</span> runtime discovery is sample data</footer>

      {modal && (
        <Modal title={modal.title} onClose={() => setModal(null)} onConfirm={() => runBuild(modal.relaunch)} confirmText={modal.relaunch ? 'Confirm rebuild' : 'Build'}>
          <p>{selected.runtimeState === 'running' ? <>This will stop the running <b>{selected.target}</b> instance for this worktree before compiling. Other threads and their apps keep running.</> : <>The build runs in the selected worktree. Other threads and their apps keep running.</>}</p>
          {modal.relaunch && <p>The app will relaunch here only after the build succeeds.</p>}
          <div className="modal-path"><b>Worktree</b><span>{selected.worktree}</span><small>Build output stays local to this checkout.</small></div>
        </Modal>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
