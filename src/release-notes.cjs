// Parses RELEASE_NOTES.md: one "## vX.Y.Z" section per release, newest first.
function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? '').trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

function nextPatch(tag) {
  const [major, minor, patch] = parseVersion(tag) ?? [0, 0, 0];
  return `v${major}.${minor}.${patch + 1}`;
}

function parseReleaseNotes(text) {
  const sections = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const heading = /^##\s+(v\d+\.\d+\.\d+)\s*$/.exec(line);
    if (heading) {
      current = { version: heading[1], lines: [] };
      sections.push(current);
    } else if (/^#{1,2}\s/.test(line)) {
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections.map(({ version, lines }) => ({ version, body: lines.join('\n').trim() }));
}

function notesFor(text, version) {
  const tag = String(version).startsWith('v') ? version : `v${version}`;
  return parseReleaseNotes(text).find((section) => section.version === tag)?.body || null;
}

module.exports = { nextPatch, notesFor, parseReleaseNotes, parseVersion };
