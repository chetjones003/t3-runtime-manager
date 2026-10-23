# T3 Runtime Manager

T3 Runtime Manager is a desktop companion for T3 Code. It shows threads that have worktrees, the local apps running in those worktrees, and their available runtime previews.

Connect with a one-time code from **T3 Settings → Connections**. The thread view is read-only. Runtime discovery refreshes every five seconds. On Windows, the app can show a live window capture, forward mouse and keyboard input to that window, or bring it to the foreground with **Take Control**. When a runtime has no discoverable window, its loopback page is shown when available.

Building, starting, stopping, and remembered workspace settings are not connected yet.

## Install from the terminal

Each update merged to `main` increments the patch version and publishes installers to [GitHub Releases](https://github.com/chetjones003/t3-runtime-manager/releases). The install commands download the latest release and print progress in the terminal.

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/chetjones003/t3-runtime-manager/main/scripts/install.ps1 | iex
```

**Linux and macOS**

```sh
curl -fsSL https://raw.githubusercontent.com/chetjones003/t3-runtime-manager/main/scripts/install.sh | bash
```

On Debian and Ubuntu x86_64, the script installs the `.deb` package with apt. On macOS, it copies the matching architecture's app bundle to `/Applications`. Other Linux distributions can download the x86_64 AppImage from the latest release, make it executable, and run it:

```sh
chmod +x "T3 Runtime Manager-"*.AppImage
./"T3 Runtime Manager-"*.AppImage
```

The current release workflow packages Windows x64, macOS Intel and Apple Silicon, and Linux x86_64. Package-manager catalog installs (`winget`, Scoop, Homebrew, AUR) need separate registry manifests and are not available yet.

## Developer guide

Use Node.js 22 and npm. Install the locked dependencies and start the Vite and Electron development apps:

```sh
npm ci
npm run dev
```

Useful project commands:

- `npm test` runs the fixture-based tests.
- `npm run build` builds the web app.
- `npm run format:check` checks formatting.
- `npm run smoke:windows`, `npm run smoke:macos`, or `npm run smoke:linux` checks runtime discovery on the matching OS.
- `npm run dist:win`, `npm run dist:mac`, or `npm run dist:linux` builds local installers for a platform. `npm run dist` targets the current platform.

macOS signing and notarization are not configured yet. Linux runtime discovery reads `/proc` without elevation, while macOS discovery uses `ps` and `lsof`; operating-system permissions can limit the details each platform exposes.
