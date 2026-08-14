# DeepSeek Harness Desktop

[![CI](https://github.com/AmazingBoyCrazy/dsh_desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/AmazingBoyCrazy/dsh_desktop/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/AmazingBoyCrazy/dsh_desktop?include_prereleases&label=release)](https://github.com/AmazingBoyCrazy/dsh_desktop/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**DeepSeek Harness Desktop** is the desktop client of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): no terminal, no Node.js installation, no `dsh web` command. Double-click the icon and the full DeepSeek Harness web GUI opens in its own window.

## Origin and maintenance

- **Engine**: the official npm package `@deepseek-ai/dsh` (published by DeepSeek), pinned exactly; upgrades follow the official releases and share the same `~/.dsh` data directory as the CLI.
- **Shell**: started from [deepseek-harness-desktop](https://github.com/hongfeiyucode/deepseek-harness-desktop) (MIT); the original copyright and attribution are preserved (see [LICENSE](LICENSE)). This repository is maintained independently from here on; the update source is the official DeepSeek engine.

## Changes relative to the original shell

1. **Fixed in-app auto-update** (Windows/Linux): the original `latest*.yml` pointed at non-existent files (404), so auto-update could never download. This repository sets an explicit `artifactName`, making the update metadata match the published artifacts (verified 200 OK).
2. **Fixed Windows console popups**: the engine and the sandbox runner are console-less processes, so Windows opened a visible terminal window for every spawned child. This repository implements a two-layer "hidden console" scheme (the engine allocates `AllocConsole + SW_HIDE`; the runner preloads the same patch via `--import` and `AttachConsole`s the engine's console), so command execution never creates a window. Plain subprocesses additionally get an adaptive `windowsHide` fallback.
3. **Fixed Windows sandboxed commands failing 100%**: the desktop workspace is the user's home directory, while the ACL sandbox requires its temp root outside the workspace; the engine's TMP/TEMP is redirected to `C:\Users\Public\dsh-desktop-tmp`, restoring sandboxed commands.
4. **Added Windows CI**: engine smoke, real Electron desktop smoke, console-patch probe, and runner-injection shape tests all run on Windows runners (the original shell had Linux CI only).
5. **Explicit dependency**: the patch's `@deepseek-ai/dsh-host-directory-picker` dependency is declared directly instead of relying on npm hoisting.
6. **Whale icon**: the window/taskbar/dock icon is now the official DeepSeek Harness whale logo.

## How it works

The desktop shell (Electron main process) spawns the embedded engine (`dsh web` profile of `@deepseek-ai/dsh`) as a child via `ELECTRON_RUN_AS_NODE=1`, waits for it on loopback, then loads the official web GUI the engine serves. The engine listens on `127.0.0.1` only; sessions, settings, and plugins live in `~/.dsh`, fully shared with the CLI.

```
Desktop shell (Electron) ──supervise──▶ engine child (Electron Node 24)
     │                                      │ serves the GUI at 127.0.0.1:32123
     └── window (sandboxed renderer) ◀──────┘ sessions/settings/plugins ⇄ ~/.dsh
```

## Install

Download the installer for your platform from [Releases](https://github.com/AmazingBoyCrazy/dsh_desktop/releases):

| Platform | Package |
| --- | --- |
| Windows 10/11 (x64) | `deepseek-harness-desktop-<version>-x64.exe` (NSIS) |
| macOS (Apple Silicon / Intel) | `*-arm64.dmg` / `*-x64.dmg` |
| Linux (x64) | `*-x86_64.AppImage` or `*.deb` |

- Unsigned builds: click *More info → Run anyway* on SmartScreen; on macOS right-click → *Open* on first launch.
- **Shared data**: uses `~/.dsh` by default (sessions, settings, credentials shared with the CLI/web GUI). Run only one engine at a time (desktop app or `dsh web`), never both concurrently.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DSH_HOME` | `~/.dsh` | harness data directory, passed through to the engine |
| `DSH_DESKTOP_PORT` | `32123,32124,32125` | loopback port candidates (comma-separated) |
| `DSH_DESKTOP_PATCH_DEBUG` | unset | `1` logs console-patch diagnostics to the engine log |

## Development

Node.js ≥ 22.12 required:

```sh
git clone https://github.com/AmazingBoyCrazy/dsh_desktop.git
cd dsh_desktop
npm ci
npm start
```

Scripts: `npm start` (dev mode), `npm run smoke` (engine smoke), `npm run dist` (package), `npm run check:upstream` (check engine version).

## Auto-release

`release.yml` checks the npm registry daily: when the official `@deepseek-ai/dsh` publishes a new version, it pins it, builds installers for all three platforms, and publishes a GitHub Release automatically. Manual trigger: Actions → Release → Run workflow.

## Known limitations

- **Unsigned installers** (macOS Gatekeeper / Windows SmartScreen prompts; code signing is on the roadmap).
- **Windows shutdown is a hard kill**: Windows has no SIGTERM graceful shutdown, so quitting may lose a small amount of unsaved session data (POSIX is unaffected).
- **In-app updates depend on the network**: update checks use GitHub; when a proxy/network blocks it (SSL handshake failures in the logs), download installers manually.
- The engine inherits upstream runtime requirements (shell tools need PowerShell etc. on the host).

## License

MIT — see [LICENSE](LICENSE). Engine upstream: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (MIT).
