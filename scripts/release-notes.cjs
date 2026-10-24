#!/usr/bin/env node
// Reads RELEASE_NOTES.md, which every PR updates with a section for the version it will release.
//   node scripts/release-notes.cjs check            Fail unless the newest section is the right version.
//   node scripts/release-notes.cjs extract v0.1.7   Print one version's notes (used for GitHub releases).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  nextPatch,
  notesFor,
  parseReleaseNotes,
  parseVersion,
} = require('../src/release-notes.cjs');

const NOTES_PATH = path.join(__dirname, '..', 'RELEASE_NOTES.md');

// Merging to main always releases the next patch version, so a PR must add notes for exactly that
// version. On main itself the release tag may or may not exist yet, so either version is fine.
function checkReleaseNotes({ text, latestTag, pullRequest }) {
  const [top] = parseReleaseNotes(text);
  const expected = latestTag ? nextPatch(latestTag) : 'v0.0.1';
  if (!top) return { ok: false, message: 'RELEASE_NOTES.md has no "## vX.Y.Z" sections.' };
  if (!top.body)
    return { ok: false, message: `The ${top.version} section in RELEASE_NOTES.md is empty.` };
  const allowed = pullRequest ? [expected] : [expected, latestTag];
  if (!allowed.includes(top.version)) {
    return {
      ok: false,
      message:
        `The newest RELEASE_NOTES.md section is ${top.version}, but merging this will release ${expected}. ` +
        `Add a "## ${expected}" section at the top describing this change.`,
    };
  }
  return { ok: true, message: `RELEASE_NOTES.md has notes for ${top.version}.` };
}

function latestTagFromGit() {
  const tags = execFileSync('git', ['tag', '--list', 'v[0-9]*', '--sort=-version:refname'], {
    encoding: 'utf8',
  });
  return tags.split(/\r?\n/).find((tag) => parseVersion(tag)) ?? null;
}

function main([command, version]) {
  const text = fs.readFileSync(NOTES_PATH, 'utf8');
  if (command === 'check') {
    if (/\[skip release\]/i.test(process.env.PR_TITLE ?? '')) {
      console.log('This PR skips the release, so it needs no release notes.');
      return 0;
    }
    const result = checkReleaseNotes({
      text,
      latestTag: latestTagFromGit(),
      pullRequest: process.env.GITHUB_EVENT_NAME === 'pull_request',
    });
    (result.ok ? console.log : console.error)(result.message);
    return result.ok ? 0 : 1;
  }
  if (command === 'extract' && version) {
    const notes = notesFor(text, version);
    if (notes === null) {
      console.error(`RELEASE_NOTES.md has no section for ${version}.`);
      return 1;
    }
    process.stdout.write(notes + '\n');
    return 0;
  }
  console.error('Usage: release-notes.cjs check | extract <version>');
  return 2;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { checkReleaseNotes };
