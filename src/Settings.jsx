import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, FONT_SIZE, FONT_STACKS, THEMES, fontStack } from './settings.js';

const SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'connection', label: 'T3 connection' },
  { id: 'updates', label: 'Updates' },
];

function ThemeCard({ theme, selected, onSelect }) {
  return (
    <button
      className={'theme-card' + (selected ? ' selected' : '')}
      onClick={() => onSelect(theme.id)}
      aria-pressed={selected}
    >
      <span className="theme-swatch" style={{ background: theme.bg }} aria-hidden="true">
        <span className="theme-swatch-bar" style={{ background: theme.surface, width: '70%' }} />
        <span className="theme-swatch-bar" style={{ background: theme.raised, width: '48%' }} />
        <span className="theme-swatch-dots">
          {[theme.accent, theme.green, theme.amber, theme.red].map((color) => (
            <i key={color} style={{ background: color }} />
          ))}
        </span>
      </span>
      <span className="theme-name">
        {theme.name}
        <span className="theme-scheme">{theme.scheme}</span>
      </span>
    </button>
  );
}

function Appearance({ settings, onChange }) {
  const groups = THEMES.reduce((byGroup, theme) => {
    if (!byGroup.has(theme.group)) byGroup.set(theme.group, []);
    byGroup.get(theme.group).push(theme);
    return byGroup;
  }, new Map());

  return (
    <>
      <section className="settings-section">
        <h3>Theme</h3>
        <p className="settings-hint">Applies immediately and is remembered on this computer.</p>
        {Array.from(groups).map(([group, themes]) => (
          <div className="theme-group" key={group}>
            <div className="theme-group-name">{group}</div>
            <div className="theme-grid">
              {themes.map((theme) => (
                <ThemeCard
                  theme={theme}
                  selected={settings.theme === theme.id}
                  onSelect={(id) => onChange({ theme: id })}
                  key={theme.id}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="settings-section">
        <h3>Font</h3>
        <p className="settings-hint">
          Pick a font and size for the whole app. Fonts must be installed on this computer.
        </p>
        <div className="settings-row">
          <label className="settings-label" htmlFor="font-family">
            Font family
          </label>
          <select
            id="font-family"
            className="settings-select"
            value={settings.fontId}
            onChange={(event) => onChange({ fontId: event.target.value })}
          >
            {FONT_STACKS.map((font) => (
              <option value={font.id} key={font.id}>
                {font.name}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
          {settings.fontId === 'custom' && (
            <input
              className="settings-input"
              style={{ flex: '0 1 220px' }}
              aria-label="Custom font family"
              placeholder="Installed font name"
              spellCheck="false"
              value={settings.customFont}
              onChange={(event) => onChange({ customFont: event.target.value })}
            />
          )}
        </div>
        <div className="settings-row">
          <label className="settings-label" htmlFor="font-size">
            Font size
          </label>
          <input
            id="font-size"
            className="settings-range"
            type="range"
            min={FONT_SIZE.min}
            max={FONT_SIZE.max}
            step="1"
            value={settings.fontSize}
            onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
          />
          <span className="settings-value">{settings.fontSize}px</span>
        </div>
        <div className="font-preview" style={{ fontFamily: fontStack(settings) }}>
          Implement Issue 1038 — t3/ticket-1038 · The quick brown fox jumps over the lazy dog.
        </div>
        <div className="settings-actions">
          <button
            className="button-secondary"
            onClick={() =>
              onChange({
                fontId: DEFAULT_SETTINGS.fontId,
                customFont: '',
                fontSize: DEFAULT_SETTINGS.fontSize,
              })
            }
          >
            Reset font
          </button>
        </div>
      </section>
    </>
  );
}

function formatExpiry(expiresAt) {
  if (!expiresAt) return '—';
  const date = new Date(expiresAt);
  return (
    (expiresAt <= Date.now() ? 'Expired ' : '') +
    date.toLocaleDateString() +
    ' ' +
    date.toLocaleTimeString()
  );
}

function Connection({ connection, onConnect, onDisconnect }) {
  const [details, setDetails] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(() => {
    window.threadAppManager.getT3Connection().then(setDetails, () => setDetails(null));
  }, []);

  // Reload whenever the live connection state changes (connected, expired, removed).
  useEffect(load, [load, connection.state]);

  async function replace(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await onConnect(code);
      if (result?.error) setError(result.error);
      else if (result?.state === 'ok') {
        setNotice('Connection updated.');
        setCode('');
      } else setError('T3 could not be reached. Make sure T3 is running and try again.');
    } finally {
      setBusy(false);
      load();
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await onDisconnect();
      setConfirming(false);
      setNotice('Connection removed. Threads are hidden until you connect again.');
    } catch {
      setError('The connection could not be removed. Try again.');
    } finally {
      setBusy(false);
      load();
    }
  }

  const paired = details?.paired;
  const status =
    connection.state === 'ok'
      ? 'Connected'
      : connection.state === 'unreachable'
        ? 'T3 unreachable'
        : paired
          ? 'Needs reconnecting'
          : 'Not connected';

  return (
    <>
      <section className="settings-section">
        <h3>Connection details</h3>
        <p className="settings-hint">
          This app reads your threads from the T3 server on this computer. It only has read access.
        </p>
        <dl className="detail-grid">
          <dt>Status</dt>
          <dd>{status}</dd>
          <dt>Server</dt>
          <dd>{details?.origin ? <code>{details.origin}</code> : 'T3 is not running'}</dd>
          <dt>Environment</dt>
          <dd>{details?.environmentId ? <code>{details.environmentId}</code> : '—'}</dd>
          <dt>Access token</dt>
          <dd>{paired ? 'Stored, expires ' + formatExpiry(details.expiresAt) : 'None'}</dd>
        </dl>
      </section>

      <section className="settings-section">
        <h3>{paired ? 'Update connection' : 'Connect to T3'}</h3>
        <p className="settings-hint">
          In T3, open <b>Settings → Connections</b>, click <b>Create link</b>, and paste the
          one-time code below.
          {paired && ' Your current connection stays in place if the new code is rejected.'}
        </p>
        <form className="connect-row" onSubmit={replace}>
          <input
            type="password"
            autoComplete="off"
            spellCheck="false"
            aria-label="T3 pairing code"
            placeholder="One-time pairing code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={busy}
          />
          <button className="button-primary" disabled={busy || !code.trim()}>
            {busy ? 'Working…' : paired ? 'Replace connection' : 'Connect'}
          </button>
        </form>
        {error && (
          <div className="connect-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="settings-hint" role="status" style={{ marginTop: 10, marginBottom: 0 }}>
            {notice}
          </div>
        )}
      </section>

      {paired && (
        <section className="settings-section">
          <h3>Remove connection</h3>
          <p className="settings-hint">
            Forgets the stored access token. You can connect again at any time with a new code.
          </p>
          {confirming ? (
            <div className="settings-confirm" role="alertdialog">
              Remove the T3 connection? Active threads disappear from this app until you reconnect.
              <div className="settings-actions">
                <button className="button-danger" onClick={remove} disabled={busy}>
                  Remove connection
                </button>
                <button className="button-secondary" onClick={() => setConfirming(false)}>
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button className="button-danger" onClick={() => setConfirming(true)}>
              Remove connection…
            </button>
          )}
        </section>
      )}
    </>
  );
}

function Updates({ update }) {
  return (
    <section className="settings-section">
      <h3>Updates</h3>
      {update ? (
        <>
          <p className="settings-hint">
            T3 Runtime Manager v{update.currentVersion}
            {update.latest
              ? ` · v${update.latest.version} is available`
              : update.checking
                ? ' · checking…'
                : ' · you are up to date'}
          </p>
          <div className="settings-actions" style={{ marginTop: 0 }}>
            <button
              className="button-secondary"
              onClick={() => window.threadAppManager.checkForUpdates()}
              disabled={update.checking}
            >
              Check for updates
            </button>
          </div>
        </>
      ) : (
        <p className="settings-hint">Update status is not available yet.</p>
      )}
    </section>
  );
}

export default function Settings({
  settings,
  onChange,
  connection,
  onConnect,
  onDisconnect,
  update,
  onClose,
}) {
  const [section, setSection] = useState('appearance');

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const current = SECTIONS.find((entry) => entry.id === section);
  return (
    <div className="settings-view" role="region" aria-label="Settings">
      <nav className="settings-nav" aria-label="Settings sections">
        <h2>Settings</h2>
        {SECTIONS.map((entry) => (
          <button
            className={'settings-nav-item' + (entry.id === section ? ' active' : '')}
            onClick={() => setSection(entry.id)}
            aria-current={entry.id === section ? 'page' : undefined}
            key={entry.id}
          >
            {entry.label}
          </button>
        ))}
        <span className="settings-nav-spacer" />
        <button className="button-secondary" onClick={onClose}>
          Back to threads
        </button>
      </nav>
      <div className="settings-body">
        <div className="settings-page">
          <div className="eyebrow">SETTINGS</div>
          <h1>{current.label}</h1>
          {section === 'appearance' && <Appearance settings={settings} onChange={onChange} />}
          {section === 'connection' && (
            <Connection connection={connection} onConnect={onConnect} onDisconnect={onDisconnect} />
          )}
          {section === 'updates' && <Updates update={update} />}
        </div>
      </div>
    </div>
  );
}
