const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkReleaseNotes } = require('../scripts/release-notes.cjs');
const { nextPatch, notesFor, parseReleaseNotes } = require('../src/release-notes.cjs');

const text = [
  '# Release notes',
  '',
  'Intro text that belongs to no version.',
  '',
  '## v0.1.7',
  '',
  '- Added updates',
  '- Second line',
  '',
  '## v0.1.6',
  '',
  '- Fixed previews (#17)',
].join('\n');

test('parses version sections newest first', () => {
  assert.deepEqual(parseReleaseNotes(text), [
    { version: 'v0.1.7', body: '- Added updates\n- Second line' },
    { version: 'v0.1.6', body: '- Fixed previews (#17)' },
  ]);
});

test('extracts one version with or without the v prefix', () => {
  assert.equal(notesFor(text, 'v0.1.6'), '- Fixed previews (#17)');
  assert.equal(notesFor(text, '0.1.7'), '- Added updates\n- Second line');
  assert.equal(notesFor(text, 'v9.9.9'), null);
});

test('computes the next patch version', () => {
  assert.equal(nextPatch('v0.1.9'), 'v0.1.10');
});

test('a PR must add notes for the next version', () => {
  assert.equal(checkReleaseNotes({ text, latestTag: 'v0.1.6', pullRequest: true }).ok, true);
  const missing = checkReleaseNotes({ text, latestTag: 'v0.1.7', pullRequest: true });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /## v0\.1\.8/);
});

test('main accepts notes before or after its release tag exists', () => {
  assert.equal(checkReleaseNotes({ text, latestTag: 'v0.1.6', pullRequest: false }).ok, true);
  assert.equal(checkReleaseNotes({ text, latestTag: 'v0.1.7', pullRequest: false }).ok, true);
  assert.equal(checkReleaseNotes({ text, latestTag: 'v0.1.8', pullRequest: false }).ok, false);
});

test('rejects an empty newest section', () => {
  const empty = '## v0.1.7\n\n## v0.1.6\n\n- Fixed';
  assert.equal(
    checkReleaseNotes({ text: empty, latestTag: 'v0.1.6', pullRequest: true }).ok,
    false,
  );
});

test('the repository notes file parses and every section has notes', () => {
  const sections = parseReleaseNotes(
    fs.readFileSync(path.join(__dirname, '..', 'RELEASE_NOTES.md'), 'utf8'),
  );
  assert.ok(sections.length > 0);
  for (const section of sections) assert.ok(section.body, `${section.version} is empty`);
});
