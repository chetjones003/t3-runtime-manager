// Theme palettes, font choices, and persistence for the settings window.
// Each theme supplies a handful of base colors; app.css derives everything else from them.

export const THEMES = [
  {
    id: 'dark',
    name: 'Dark',
    group: 'General',
    scheme: 'dark',
    bg: '#0b0e13',
    surface: '#10151c',
    raised: '#171d27',
    line: '#252d3a',
    text: '#e5e9f0',
    muted: '#8a95a7',
    accent: '#cbd6ff',
    onAccent: '#141a28',
    green: '#69dba9',
    amber: '#ffc976',
    red: '#ff9b9b',
    blue: '#75a7ff',
  },
  {
    id: 'light',
    name: 'Light',
    group: 'General',
    scheme: 'light',
    bg: '#eef1f6',
    surface: '#ffffff',
    raised: '#f4f6fa',
    line: '#d6dce6',
    text: '#1c2330',
    muted: '#647087',
    accent: '#3b5bdb',
    onAccent: '#ffffff',
    green: '#13804f',
    amber: '#996100',
    red: '#c93c3c',
    blue: '#2f6fe0',
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    group: 'Catppuccin',
    scheme: 'dark',
    bg: '#11111b',
    surface: '#1e1e2e',
    raised: '#262637',
    line: '#45475a',
    text: '#cdd6f4',
    muted: '#a6adc8',
    accent: '#cba6f7',
    onAccent: '#11111b',
    green: '#a6e3a1',
    amber: '#f9e2af',
    red: '#f38ba8',
    blue: '#89b4fa',
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    group: 'Catppuccin',
    scheme: 'light',
    bg: '#dce0e8',
    surface: '#eff1f5',
    raised: '#e6e9ef',
    line: '#bcc0cc',
    text: '#4c4f69',
    muted: '#6c6f85',
    accent: '#8839ef',
    onAccent: '#eff1f5',
    green: '#2f7d1f',
    amber: '#9a5f0a',
    red: '#d20f39',
    blue: '#1e66f5',
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    group: 'Tokyo Night',
    scheme: 'dark',
    bg: '#16161e',
    surface: '#1a1b26',
    raised: '#24283b',
    line: '#3b4261',
    text: '#c0caf5',
    muted: '#7982a9',
    accent: '#7aa2f7',
    onAccent: '#16161e',
    green: '#9ece6a',
    amber: '#e0af68',
    red: '#f7768e',
    blue: '#7dcfff',
  },
  {
    id: 'tokyo-day',
    name: 'Tokyo Night Day',
    group: 'Tokyo Night',
    scheme: 'light',
    bg: '#d5d6db',
    surface: '#e1e2e7',
    raised: '#e9e9ed',
    line: '#c4c8da',
    text: '#3760bf',
    muted: '#6172b0',
    accent: '#2e7de9',
    onAccent: '#ffffff',
    green: '#587539',
    amber: '#8c6c3e',
    red: '#f52a65',
    blue: '#007197',
  },
  {
    id: 'darcula',
    name: 'Darcula',
    group: 'Darcula',
    scheme: 'dark',
    bg: '#232425',
    surface: '#2b2b2b',
    raised: '#3c3f41',
    line: '#4e5254',
    text: '#a9b7c6',
    muted: '#808c96',
    accent: '#cc7832',
    onAccent: '#1e1e1e',
    green: '#8aa77a',
    amber: '#ffc66d',
    red: '#ff6b68',
    blue: '#6897bb',
  },
  {
    id: 'darcula-light',
    name: 'Darcula Light',
    group: 'Darcula',
    scheme: 'light',
    bg: '#e6e8ec',
    surface: '#f7f8fa',
    raised: '#eceef2',
    line: '#d3d5db',
    text: '#1e1f22',
    muted: '#6c707e',
    accent: '#3574f0',
    onAccent: '#ffffff',
    green: '#1f7a3a',
    amber: '#9a6200',
    red: '#cf3b3b',
    blue: '#3574f0',
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    group: 'One',
    scheme: 'dark',
    bg: '#1e2227',
    surface: '#282c34',
    raised: '#2f343e',
    line: '#3e4451',
    text: '#abb2bf',
    muted: '#7f848e',
    accent: '#61afef',
    onAccent: '#1e2227',
    green: '#98c379',
    amber: '#e5c07b',
    red: '#e06c75',
    blue: '#61afef',
  },
  {
    id: 'one-light',
    name: 'One Light',
    group: 'One',
    scheme: 'light',
    bg: '#e5e5e6',
    surface: '#fafafa',
    raised: '#f0f0f1',
    line: '#d3d3d5',
    text: '#383a42',
    muted: '#696c77',
    accent: '#4078f2',
    onAccent: '#ffffff',
    green: '#3f8a3e',
    amber: '#8a5d00',
    red: '#d13f32',
    blue: '#4078f2',
  },
];

export const FONT_STACKS = [
  { id: 'system', name: 'Segoe UI (default)', stack: "'Segoe UI', system-ui, Arial, sans-serif" },
  { id: 'inter', name: 'Inter', stack: "Inter, 'Segoe UI', system-ui, sans-serif" },
  { id: 'arial', name: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { id: 'georgia', name: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'cascadia', name: 'Cascadia Code', stack: "'Cascadia Code', Consolas, monospace" },
  { id: 'consolas', name: 'Consolas', stack: "Consolas, 'Courier New', monospace" },
  { id: 'jetbrains', name: 'JetBrains Mono', stack: "'JetBrains Mono', Consolas, monospace" },
];

export const FONT_SIZE = { min: 11, max: 18, default: 13 };

export const PROJECT_ORDERS = [
  { id: 'recent', name: 'Most recent activity' },
  { id: 'name', name: 'Name (A–Z)' },
];
export const THREAD_SORTS = [
  { id: 'recent', name: 'Most recent activity' },
  { id: 'state', name: 'Status (working first)' },
  { id: 'title', name: 'Title (A–Z)' },
];
export const SEARCH_SCOPES = [
  { id: 'all', name: 'Title, branch and project' },
  { id: 'title', name: 'Title only' },
];
export const REFRESH_SECONDS = [2, 5, 10, 30, 60];

export const DEFAULT_SETTINGS = Object.freeze({
  groupByProject: true,
  projectOrder: 'recent',
  threadSort: 'recent',
  hiddenProjects: [],
  showBranch: true,
  searchScope: 'all',
  refreshSeconds: 5,
  autoScan: true,
  theme: 'dark',
  fontId: 'system',
  customFont: '',
  fontSize: FONT_SIZE.default,
});

const STORAGE_KEY = 'thread-app-manager.settings';

export function normalizeSettings(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const size = Number(value.fontSize);
  const pick = (list, id, fallback) => (list.some((entry) => entry.id === id) ? id : fallback);
  const flag = (key) => (typeof value[key] === 'boolean' ? value[key] : DEFAULT_SETTINGS[key]);
  return {
    groupByProject: flag('groupByProject'),
    projectOrder: pick(PROJECT_ORDERS, value.projectOrder, DEFAULT_SETTINGS.projectOrder),
    threadSort: pick(THREAD_SORTS, value.threadSort, DEFAULT_SETTINGS.threadSort),
    hiddenProjects: Array.isArray(value.hiddenProjects)
      ? value.hiddenProjects.filter((name) => typeof name === 'string').slice(0, 500)
      : [],
    showBranch: flag('showBranch'),
    searchScope: pick(SEARCH_SCOPES, value.searchScope, DEFAULT_SETTINGS.searchScope),
    refreshSeconds: REFRESH_SECONDS.includes(Number(value.refreshSeconds))
      ? Number(value.refreshSeconds)
      : DEFAULT_SETTINGS.refreshSeconds,
    autoScan: flag('autoScan'),
    theme: THEMES.some((theme) => theme.id === value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
    fontId:
      value.fontId === 'custom' || FONT_STACKS.some((font) => font.id === value.fontId)
        ? value.fontId
        : DEFAULT_SETTINGS.fontId,
    customFont: typeof value.customFont === 'string' ? value.customFont.slice(0, 100) : '',
    fontSize: Number.isFinite(size)
      ? Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, Math.round(size)))
      : DEFAULT_SETTINGS.fontSize,
  };
}

export function loadSettings(storage = globalThis.localStorage) {
  try {
    return normalizeSettings(JSON.parse(storage.getItem(STORAGE_KEY)));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Settings still apply for this session when storage is unavailable.
  }
}

export function fontStack(settings) {
  if (settings.fontId === 'custom') {
    // Only a plain family name is accepted so a setting can never inject CSS.
    const name = settings.customFont.trim().replace(/["'\\;{}<>]/g, '');
    if (name) return `'${name}', ${FONT_STACKS[0].stack}`;
  }
  return (FONT_STACKS.find((font) => font.id === settings.fontId) ?? FONT_STACKS[0]).stack;
}

export function applySettings(settings, root = document.documentElement) {
  const theme = THEMES.find((entry) => entry.id === settings.theme) ?? THEMES[0];
  const colors = {
    '--bg': theme.bg,
    '--surface': theme.surface,
    '--raised': theme.raised,
    '--line': theme.line,
    '--text': theme.text,
    '--muted': theme.muted,
    '--accent': theme.accent,
    '--on-accent': theme.onAccent,
    '--green': theme.green,
    '--amber': theme.amber,
    '--red': theme.red,
    '--blue': theme.blue,
  };
  for (const [name, value] of Object.entries(colors)) root.style.setProperty(name, value);
  root.style.setProperty('--font', fontStack(settings));
  root.style.fontSize = `${settings.fontSize}px`;
  root.style.colorScheme = theme.scheme;
  root.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.bg);
}

// Filters threads for the sidebar while preserving T3's order.
// Returns [[heading | null, threads], ...]; a null heading means no grouping.
export function organizeThreads(threads, settings, query = '') {
  const needle = query.trim().toLowerCase();
  const hidden = new Set(settings.hiddenProjects);
  const matches = (thread) => {
    if (!needle) return true;
    const fields =
      settings.searchScope === 'title'
        ? [thread.title]
        : [thread.title, thread.branch, thread.projectTitle];
    return fields.some((field) =>
      String(field ?? '')
        .toLowerCase()
        .includes(needle),
    );
  };
  const visible = threads.filter(
    (thread) => !hidden.has(thread.projectTitle || 'No project') && matches(thread),
  );
  return [[null, visible]];
}
