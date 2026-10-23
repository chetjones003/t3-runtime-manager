# Thread App Manager

React + Electron shell for a multipurpose developer app manager. The Workspace cockpit shows sample T3 threads, their worktrees, and desktop, browser, and other runtime targets.

## Run

Install dependencies with `npm install`, then start the desktop app with `npm run dev`.

## Prototype boundary

This is a UI prototype. T3 thread synchronization, remembered checkout settings, process discovery, build and launch commands, and real application embedding are not connected. Actions use sample state so the interaction flow can be reviewed.

The app keeps thread activity separate from runtime state. The sample rebuild confirmation stops only the selected runtime, and Build & Run relaunches it after the simulated build succeeds.
