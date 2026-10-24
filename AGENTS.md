# Agent instructions

## Release notes

Every merge to `main` releases the next patch version: the latest `v*` tag plus one. Before opening a pull request, add a section for that version at the top of `RELEASE_NOTES.md`:

1. Find the latest tag: `git fetch --tags && git tag --list 'v*' --sort=-version:refname | head -n 1`.
2. Add `## vX.Y.Z` (the next patch) above the existing sections, with short bullets describing what changed for people using the app.
3. If the branch already has a section from an earlier commit and another PR merged first, renumber it to the new next version.

The app's update window shows this section as the release notes, so write for users, not reviewers. CI fails a PR whose newest section isn't the next version. Run `node scripts/release-notes.cjs check` to verify. PRs titled with `[skip release]` don't release and need no notes.
