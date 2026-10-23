# Thread App Manager

React + Electron shell for a multipurpose developer app manager. The Workspace cockpit shows sample T3 threads, their worktrees, and desktop, browser, and other runtime targets.

## Run

Install dependencies with `npm install`, then start the desktop app with `npm run dev`.

## Current scope

The cockpit still uses sample T3 thread and worktree records. On Windows, **Refresh runtimes** performs a read-only process and TCP listener scan and shows runtime groups with direct executable-path or command-line evidence for those worktrees. Raw command lines stay in Electron's main process and are omitted from the response. The latest scan remains in memory for the current app session.

macOS and Linux collectors, unmatched-candidate presentation, T3 synchronization, remembered workspace settings, process control, builds, launches, and window embedding are not connected yet.

## Verify runtime discovery

Run `npm test` for fixture-based OS-neutral scan tests. On Windows, run `npm run smoke:windows` to verify the real process/listener collector against a short-lived probe process.
