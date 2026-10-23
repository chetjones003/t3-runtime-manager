# Thread App Manager

React + Electron shell for a multipurpose developer app manager. The Workspace cockpit shows sample T3 threads, their worktrees, and desktop, browser, and other runtime targets.

## Run

Install dependencies with `npm install`, then start the desktop app with `npm run dev`.

## Current scope

The cockpit still uses sample T3 thread and worktree records. On Windows, macOS and Linux, **Refresh runtimes** performs a read-only process and TCP listener scan and shows runtime groups with direct executable-path or command-line evidence for those worktrees. Raw command lines stay in Electron's main process and are omitted from the response. The latest scan remains in memory for the current app session.

A Linux collector, T3 synchronization, remembered workspace settings, process control, builds, launches, and window embedding are not connected yet.

## Verify runtime discovery

Run `npm test` for fixture-based OS-neutral scan tests. On Windows run `npm run smoke:windows`, on macOS run `npm run smoke:macos`, and on Linux run `npm run smoke:linux`, to verify the real process/listener collector against a short-lived probe process. macOS discovery uses `ps` and `lsof` without elevation; executable paths or listener ownership that macOS withholds are reported as partial information. Linux discovery reads `/proc` directly (process stat, exe, cmdline, `net/tcp`, `net/tcp6` and socket file descriptors) without elevation or external tools; processes, executable links or listener sockets that permissions or namespaces hide are reported as partial information.
