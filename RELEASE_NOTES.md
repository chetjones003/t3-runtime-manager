# Release notes

Every merge to `main` publishes the next patch version. Each pull request adds its own section at the top. The app's update window shows the section for the version it installs.

## v0.1.7

- The app checks for updates when it opens and every hour after that. When a new version is out, the update button in the bottom-right corner lights up.
- Clicking the update button shows the new version and its release notes, then downloads it. The app closes, installs the update silently, and reopens.

## v0.1.6

- Fixed runtime previews failing with an "Invalid capture constraints" error. (#17)

## v0.1.5

- Fixed release publishing so every installer is attached to the GitHub release. (#15)

## v0.1.4

- Added the Runtime Manager app icon. (#14)

## v0.1.3

- Fixed the Windows installer configuration. (#13)

## v0.1.2

- Fixed release publishing on the protected `main` branch. (#12)

## v0.1.1

- Added a cross-platform terminal installer and automatic GitHub releases. (#11)
- Connected the app to T3: active threads, runtimes for each worktree, and Take Control. (#10)
- Added runtime discovery for Linux (#9) and macOS (#8).
- Showed uncertain and unmatched Windows runtime candidates. (#7)
- Added Windows runtime discovery and CI. (#6)
