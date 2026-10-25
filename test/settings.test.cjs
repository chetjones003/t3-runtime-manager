const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/settings.mjs');
const thread = (id, title, project, updatedAt, state = 'idle', branch = 'b-' + id) => ({
  id,
  title,
  projectTitle: project,
  updatedAt,
  state,
  branch,
});
const threads = [
  thread('1', 'Fix login', 'Alpha', '2026-01-01'),
  thread('2', 'Add charts', 'Beta', '2026-03-01', 'working'),
  thread('3', 'Zebra work', 'Alpha', '2026-02-01', 'waiting', 'feature/login'),
];

test('threads keep the order supplied by T3 without grouping by project', async () => {
  const { organizeThreads, DEFAULT_SETTINGS } = await load();
  const groups = organizeThreads(threads, DEFAULT_SETTINGS);
  assert.deepEqual(
    groups.map(([name, list]) => [name, list.map((entry) => entry.id)]),
    [[null, ['1', '2', '3']]],
  );
});

test('legacy project and thread sorting settings do not reorder T3 threads', async () => {
  const { organizeThreads, DEFAULT_SETTINGS } = await load();
  const organized = organizeThreads(threads, {
    ...DEFAULT_SETTINGS,
    projectOrder: 'name',
    threadSort: 'title',
    groupByProject: false,
  });
  assert.deepEqual(
    organized.map(([name, list]) => [name, list.map((entry) => entry.id)]),
    [[null, ['1', '2', '3']]],
  );
});

test('hidden projects and search scope filter the list', async () => {
  const { organizeThreads, DEFAULT_SETTINGS } = await load();
  const hidden = organizeThreads(threads, { ...DEFAULT_SETTINGS, hiddenProjects: ['Beta'] });
  assert.deepEqual(
    hidden.flatMap(([, list]) => list.map((entry) => entry.id)),
    ['1', '3'],
  );

  const wide = organizeThreads(threads, DEFAULT_SETTINGS, 'LOGIN').flatMap(([, list]) => list);
  assert.deepEqual(wide.map((entry) => entry.id).sort(), ['1', '3']);
  const narrow = organizeThreads(threads, { ...DEFAULT_SETTINGS, searchScope: 'title' }, 'login');
  assert.deepEqual(
    narrow.flatMap(([, list]) => list.map((entry) => entry.id)),
    ['1'],
  );
});

test('saved settings are validated and fall back to defaults', async () => {
  const { normalizeSettings, DEFAULT_SETTINGS } = await load();
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  const result = normalizeSettings({
    theme: 'nope',
    refreshSeconds: 3,
    fontSize: 99,
    groupByProject: 'yes',
    hiddenProjects: ['A', 5],
    threadSort: 'title',
  });
  assert.equal(result.theme, 'dark');
  assert.equal(result.refreshSeconds, 5);
  assert.equal(result.fontSize, 18);
  assert.equal(result.groupByProject, true);
  assert.deepEqual(result.hiddenProjects, ['A']);
  assert.equal(result.threadSort, 'title');
});
