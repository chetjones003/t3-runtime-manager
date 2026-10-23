# Thread App Manager

React + Electron desktop app for viewing T3 Code threads and the applications running in their worktrees.

## Run

Install dependencies with `npm install`, then start the desktop app with `npm run dev`.

## Current scope

Connect with a one-time code from **T3 Settings → Connections**. The cockpit then lists threads with worktrees across projects, refreshes their state every five seconds, and opens a selected thread in T3 Code. Thread access is read-only.

**Refresh runtimes** scans processes and TCP listeners for the local worktrees. On Windows, every discovered desktop window is attached to its associated runtime and parked inside the manager; the selected runtime's actual window is shown in the preview and accepts direct mouse and keyboard input. The preview container resizes to the available app area without resizing the external application. Fullscreen expands that same embedded window inside the manager frame; **Exit fullscreen** returns to the workspace. When a runtime has no window, the preview shows its loopback page when available. Native window embedding is Windows-only.

Build, start, stop, and remembered workspace settings are not connected yet.

## Verify runtime discovery

Run `npm test` for fixture-based OS-neutral scan tests. On Windows run `npm run smoke:windows`, on macOS run `npm run smoke:macos`, and on Linux run `npm run smoke:linux`, to verify the real process/listener collector against a short-lived probe process. macOS discovery uses `ps` and `lsof` without elevation; executable paths or listener ownership that macOS withholds are reported as partial information. Linux discovery reads `/proc` directly (process stat, exe, cmdline, `net/tcp`, `net/tcp6` and socket file descriptors) without elevation or external tools; processes, executable links or listener sockets that permissions or namespaces hide are reported as partial information.
