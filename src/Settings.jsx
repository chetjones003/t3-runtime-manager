import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  FONT_SIZE,
  FONT_STACKS,
  REFRESH_SECONDS,
  SEARCH_SCOPES,
  THEMES,
  fontStack,
} from './settings.mjs';

const iconProps = {
  viewBox: '0 0 20 20',
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

const SECTIONS = [
  {
    id: 'general',
    label: 'General',
    icon: (
      <svg {...iconProps}>
        <path d="M3.5 5.5h6M13.5 5.5h3M3.5 14.5h3M10.5 14.5h6" />
        <circle cx="11.5" cy="5.5" r="2" />
        <circle cx="8.5" cy="14.5" r="2" />
      </svg>
    ),
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: (
      <svg {...iconProps}>
        <path d="M10 2.5a7.5 7.5 0 1 0 0 15c1.2 0 1.7-.8 1.4-1.7-.4-1 .2-2 1.3-2H14a3.5 3.5 0 0 0 3.5-3.5C17.5 5.6 14.2 2.5 10 2.5Z" />
        <circle cx="6.5" cy="9" r=".7" fill="currentColor" />
        <circle cx="9.5" cy="6" r=".7" fill="currentColor" />
        <circle cx="13" cy="7.5" r=".7" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'connection',
    label: 'T3 connection',
    icon: (
      <svg {...iconProps}>
        <path d="M8.5 11.5a3 3 0 0 0 4.2 0l3-3a3 3 0 0 0-4.2-4.2l-.8.8" />
        <path d="M11.5 8.5a3 3 0 0 0-4.2 0l-3 3a3 3 0 0 0 4.2 4.2l.8-.8" />
      </svg>
    ),
  },
  {
    id: 'updates',
    label: 'Updates',
    icon: (
      <svg {...iconProps}>
        <circle cx="10" cy="10" r="7" />
        <path d="M10 13.5v-7M6.9 9.4 10 6.3l3.1 3.1" />
      </svg>
    ),
  },
];

function Group({ title, children }) {
  return (
    <section className="settings-group">
      <h2 className="settings-group-title">{title}</h2>
      <div className="settings-card">{children}</div>
    </section>
  );
}

function Row({ title, description, stacked, children }) {
  return (
    <div className={'settings-item' + (stacked ? ' stacked' : '')}>
      <div className="settings-item-text">
        <div className="settings-item-title">{title}</div>
        {description && <div className="settings-item-desc">{description}</div>}
      </div>
      {children && <div className="settings-item-control">{children}</div>}
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={'toggle' + (checked ? ' on' : '')}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

function Choice({ label, value, options, onChange, disabled, format = (option) => option.name }) {
  return (
    <select
      className="settings-select"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option value={option.id ?? option} key={option.id ?? option}>
          {format(option)}
        </option>
      ))}
    </select>
  );
}

function General({ settings, onChange, projects }) {
  const hidden = new Set(settings.hiddenProjects);
  const setHidden = (project, isHidden) => {
    const next = new Set(hidden);
    if (isHidden) next.add(project);
    else next.delete(project);
    onChange({ hiddenProjects: Array.from(next) });
  };

  return (
    <>
      <Group title="Threads">
        <Row title="Show branch" description="Show each thread's git branch under its title.">
          <Toggle
            label="Show branch"
            checked={settings.showBranch}
            onChange={(value) => onChange({ showBranch: value })}
          />
        </Row>
      </Group>

      <Group title="Search">
        <Row
          title="Search matches"
          description="What the search box above the thread list looks at."
        >
          <Choice
            label="Search matches"
            value={settings.searchScope}
            options={SEARCH_SCOPES}
            onChange={(value) => onChange({ searchScope: value })}
          />
        </Row>
      </Group>

      <Group title="Projects">
        {projects.length === 0 ? (
          <Row
            title="No projects yet"
            description="Projects appear here once T3 reports threads."
          />
        ) : (
          projects.map((project) => (
            <Row
              title={project}
              description={hidden.has(project) ? 'Hidden from the thread list' : 'Shown'}
              key={project}
            >
              <Toggle
                label={'Show ' + project}
                checked={!hidden.has(project)}
                onChange={(visible) => setHidden(project, !visible)}
              />
            </Row>
          ))
        )}
      </Group>

      <Group title="Refresh">
        <Row title="Thread refresh" description="How often threads are re-read from T3.">
          <Choice
            label="Thread refresh"
            value={settings.refreshSeconds}
            options={REFRESH_SECONDS}
            format={(seconds) => 'Every ' + seconds + ' seconds'}
            onChange={(value) => onChange({ refreshSeconds: Number(value) })}
          />
        </Row>
        <Row
          title="Runtime refresh"
          description="Runtimes refresh when the app window gets focus."
        />
      </Group>
    </>
  );
}

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
      <Group title="Theme">
        <div className="settings-item stacked">
          <div className="settings-item-text">
            <div className="settings-item-title">Color theme</div>
            <div className="settings-item-desc">
              Applies immediately and is remembered on this computer.
            </div>
          </div>
          <div className="theme-groups">
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
          </div>
        </div>
      </Group>

      <Group title="Font">
        <Row title="Font family" description="Fonts must be installed on this computer.">
          {settings.fontId === 'custom' && (
            <input
              className="settings-input"
              style={{ flex: '0 1 180px' }}
              aria-label="Custom font family"
              placeholder="Installed font name"
              spellCheck="false"
              value={settings.customFont}
              onChange={(event) => onChange({ customFont: event.target.value })}
            />
          )}
          <select
            className="settings-select"
            aria-label="Font family"
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
        </Row>
        <Row title="Font size" description="Scales text across the whole app.">
          <input
            className="settings-range"
            type="range"
            aria-label="Font size"
            min={FONT_SIZE.min}
            max={FONT_SIZE.max}
            step="1"
            value={settings.fontSize}
            onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
          />
          <span className="settings-value">{settings.fontSize}px</span>
        </Row>
        <Row title="Preview" stacked>
          <div className="font-preview" style={{ fontFamily: fontStack(settings) }}>
            Implement Issue 1038 — t3/ticket-1038 · The quick brown fox jumps over the lazy dog.
          </div>
        </Row>
        <Row title="Reset font" description="Go back to the default font and size.">
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
            Reset
          </button>
        </Row>
      </Group>
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
  const tone =
    connection.state === 'ok' ? 'ok' : connection.state === 'unreachable' ? 'bad' : 'warn';

  return (
    <>
      <Group title="Connection details">
        <Row title="Status" description="This app only has read access to your threads.">
          <span className={'connection-badge connection-' + tone}>
            <i /> {status}
          </span>
        </Row>
        <Row title="Server" description="The T3 server on this computer.">
          {details?.origin ? <code className="value-code">{details.origin}</code> : 'Not running'}
        </Row>
        <Row title="Environment">
          {details?.environmentId ? (
            <code className="value-code">{details.environmentId}</code>
          ) : (
            '—'
          )}
        </Row>
        <Row title="Access token" description="Stored encrypted when your system supports it.">
          {paired ? 'Expires ' + formatExpiry(details.expiresAt) : 'None'}
        </Row>
      </Group>

      <Group title={paired ? 'Update connection' : 'Connect to T3'}>
        <Row
          title="Pairing code"
          description={
            <>
              In T3, open <b>Settings → Connections</b>, click <b>Create link</b>, and paste the
              one-time code.
              {paired && ' Your current connection stays in place if the new code is rejected.'}
            </>
          }
          stacked
        >
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
            <div className="settings-item-desc" role="status" style={{ marginTop: 10 }}>
              {notice}
            </div>
          )}
        </Row>
      </Group>

      {paired && (
        <Group title="Remove connection">
          <Row
            title="Disconnect from T3"
            description="Forgets the stored access token. You can connect again at any time with a new code."
          >
            {!confirming && (
              <button className="button-danger" onClick={() => setConfirming(true)}>
                Remove…
              </button>
            )}
          </Row>
          {confirming && (
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
          )}
        </Group>
      )}
    </>
  );
}

function Updates({ update }) {
  return (
    <Group title="Updates">
      <Row
        title={update ? 'T3 Runtime Manager v' + update.currentVersion : 'Version'}
        description={
          !update
            ? 'Update status is not available yet.'
            : update.latest
              ? `v${update.latest.version} is available.`
              : update.checking
                ? 'Checking for updates…'
                : 'You are up to date.'
        }
      >
        {update && (
          <button
            className="button-secondary"
            onClick={() => window.threadAppManager.checkForUpdates()}
            disabled={update.checking}
          >
            Check for updates
          </button>
        )}
      </Row>
    </Group>
  );
}

export default function Settings({
  settings,
  onChange,
  connection,
  onConnect,
  onDisconnect,
  update,
  projects,
  onClose,
}) {
  const [section, setSection] = useState('general');

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
        {SECTIONS.map((entry) => (
          <button
            className={'settings-nav-item' + (entry.id === section ? ' active' : '')}
            onClick={() => setSection(entry.id)}
            aria-current={entry.id === section ? 'page' : undefined}
            key={entry.id}
          >
            {entry.icon}
            {entry.label}
          </button>
        ))}
        <span className="settings-nav-spacer" />
        <button className="settings-nav-item" onClick={onClose}>
          <svg {...iconProps}>
            <path d="M16 10H4.5M9 5.5 4.5 10 9 14.5" />
          </svg>
          Back
        </button>
      </nav>
      <div className="settings-main">
        <header className="settings-header">
          <span className="settings-crumb">Settings</span>
          <span className="settings-crumb-sep">/</span>
          <span className="settings-crumb-current">{current.label}</span>
        </header>
        <div className="settings-body">
          <div className="settings-page">
            {section === 'general' && (
              <General settings={settings} onChange={onChange} projects={projects} />
            )}
            {section === 'appearance' && <Appearance settings={settings} onChange={onChange} />}
            {section === 'connection' && (
              <Connection
                connection={connection}
                onConnect={onConnect}
                onDisconnect={onDisconnect}
              />
            )}
            {section === 'updates' && <Updates update={update} />}
          </div>
        </div>
      </div>
    </div>
  );
}
