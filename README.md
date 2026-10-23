# Thread App Manager

React + Electron desktop app for viewing T3 Code threads and the applications running in their worktrees.

## Run

Install dependencies with `npm install`, then start the desktop app with `npm run dev`.

## Current scope

Connect with a one-time code from **T3 Settings → Connections**. The cockpit then lists threads with worktrees across projects, refreshes their state every five seconds, and opens a selected thread in T3 Code. Thread access is read-only.

**Refresh runtimes** scans processes and TCP listeners for the local worktrees. Threads are grouped by project. On Windows, the selected runtime's window is shown as a live capture, with mouse and keyboard input forwarded to that same window. Pointer positions are mapped through the fitted image and translated into the target window's client coordinates under per-monitor DPI awareness. **Take Control** brings the selected app window forward. When a runtime has no discoverable window, the preview shows its loopback page when available.

Build, start, stop, and remembered workspace settings are not connected yet.

## Verify runtime discovery

Run `npm test` for fixture-based OS-neutral scan tests. On Windows run `npm run smoke:windows`, on macOS run `npm run smoke:macos`, and on Linux run `npm run smoke:linux`, to verify the real process/listener collector against a short-lived probe process. macOS discovery uses `ps` and `lsof` without elevation; executable paths or listener ownership that macOS withholds are reported as partial information. Linux discovery reads `/proc` directly (process stat, exe, cmdline, `net/tcp`, `net/tcp6` and socket file descriptors) without elevation or external tools; processes, executable links or listener sockets that permissions or namespaces hide are reported as partial information.
