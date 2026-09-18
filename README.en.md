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
7. **Bundled-enhancement mechanism kept, nothing bundled in this version**: plugins mount through the official `dsh.profile.bundles` mechanism (written into the web profile's `package.json`, and only when it does not exist; identical to `dsh plugin add`, never rows in `cordis.patch.yml`, which would cause duplicate-mount crashes). The list is driven by the `BUNDLED_PLUGINS` array in `src/main/harness.mjs` and is currently empty (see "Bundled plugins"): the third-party plugin ecosystem still targets the `0.1.5-rc` engine line as its peer, and mixing engine lines makes the engine fail to boot.
8. **Fixed the blank window behind the engine token gate**: the `0.1.6-alpha` web GUI requires a process-level browser-session token, and a bare loopback URL answers 401. The shell now parses the `dsh web: http://127.0.0.1:<port>/?token=…` readiness line the engine prints and loads that URL in the window (the token is exchanged for a cookie); previously the window stayed blank.
9. **Restored engine packages that packaging had pruned**: electron-builder collects `node_modules` by walking the dependency graph and drops engine packages that exist only as peer edges (13 in total, including `dsh-jobs`, `dsh-settings`, `dsh-attachment`, `dsh-session-persistence`), so the packaged app failed at startup with `ERR_MODULE_NOT_FOUND`. These packages are now declared explicitly in `package.json` `dependencies`.

## How it works

The desktop shell (Electron main process) spawns the embedded engine (`dsh web` profile of `@deepseek-ai/dsh`) as a child via `ELECTRON_RUN_AS_NODE=1`, waits until the engine prints its token-bearing readiness line, then loads that URL in the window (the engine's web GUI requires a process-level token on the `0.1.6-alpha` line, and a bare loopback URL answers 401). The engine listens on `127.0.0.1` only; sessions, settings, and plugins live in `~/.dsh`, fully shared with the CLI.

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
- After installing, double-click the icon to start; the first launch takes a few seconds to initialize.
- **Shared data**: uses `~/.dsh` by default (sessions, settings, credentials shared with the CLI/web GUI). Run only one engine at a time (desktop app or `dsh web`), never both concurrently.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DSH_HOME` | `~/.dsh` | harness data directory, passed through to the engine |
| `DSH_DESKTOP_PORT` | `32123,32124,32125` | loopback port candidates (comma-separated) |
| `DSH_DESKTOP_PATCH_DEBUG` | unset | `1` logs console-patch diagnostics to the engine log |

## Bundled plugins

**This version (the `0.1.6-alpha.2` engine line) ships no third-party plugins**: the plugin ecosystem still targets the `0.1.5-rc` engine as its peer, and a version mismatch makes the engine fail to boot outright (fail-loud), so "installs and just opens" comes first. A fresh profile mounts only the engine's own `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` bundles (the engine initializes the profile itself; the desktop shell no longer writes a seed).

- **Wanting enhancement plugins**: once the plugin in question supports this engine line, install it from the marketplace UI or with `dsh plugin --profile web add <package>` — both go through the official `dsh.profile.bundles` mechanism.
- **Bundling again**: put the package names into `BUNDLED_PLUGINS` in `src/main/harness.mjs` (an empty array means "bundle nothing"); both the profile manifest and the dependency list are derived from it. Also add the package back to `package.json` `dependencies`, otherwise it cannot be resolved after packaging.
- **Disabling/removing plugins**: use the marketplace UI or `dsh plugin --profile web remove <package>`. **Do not hand-edit plugin rows in `cordis.patch.yml`** — official bundle mounts coexisting with hand-written rows trigger a `duplicate loader entry id` crash (earlier versions of this repository hit exactly that).

## Development

Node.js ≥ 22.12 required:

```sh
git clone https://github.com/AmazingBoyCrazy/dsh_desktop.git
cd dsh_desktop
npm ci
npm start
```

Scripts: `npm start` (dev mode), `npm run smoke` (engine smoke), `npm run dist` (package), `npm run check:upstream` (check engine version).

Dev-mode caveats:

- `npm start` **shares the same `userData` directory and single-instance lock** as an installed copy of the desktop app, so the dev run exits immediately while the installed app is running (it looks like "I clicked and nothing happened"). Fully quit the installed app first, or use a separate data directory: `npx electron . --user-data-dir=<some empty dir>`.
- **The Electron version must be exactly `44.0.0`**: the engine reads Node internal modules via `node-addon-require-builtin` (the profile resolution needs them), and that native module only supports exact fingerprints (`43.0.0`, `44.0.0`, `45.0.0-alpha.6`); anything like `43.4.0` or `^44` makes the engine fail at startup (`Unsupported/no-context`). Upstream's own desktop app likewise pins Electron 44.
- A terminal opened inside the DSH engine inherits `ELECTRON_RUN_AS_NODE=1`, which makes `npm start` run Electron as plain Node and fail with `does not provide an export named 'Menu'`; run it from a normal terminal, or clear the variable first with `Remove-Item Env:\ELECTRON_RUN_AS_NODE`.

## Auto-release

`release.yml` checks the npm registry daily: when the official `@deepseek-ai/dsh` publishes a new version, it pins it, builds installers for all three platforms, and publishes a GitHub Release automatically. Manual trigger: Actions → Release → Run workflow.

## Known limitations

- **Unsigned installers** (macOS Gatekeeper / Windows SmartScreen prompts; code signing is on the roadmap).
- **The Electron version is pinned by the engine**: exactly `44.0.0` (native-module fingerprint requirement), so do not bump Electron casually before a release; before upgrading, confirm the target version appears in the supported list of `node-addon-native-custom-loader`.
- **This version bundles no third-party plugins** (the ecosystem has not caught up with the `0.1.6-alpha` engine line yet); install them yourself from the marketplace.
- **Windows shutdown is a hard kill**: Windows has no SIGTERM graceful shutdown, so quitting may lose a small amount of unsaved session data (POSIX is unaffected).
- **In-app updates depend on the network**: update checks use GitHub; when a proxy/network blocks it (SSL handshake failures in the logs), download installers manually.
- The engine inherits upstream runtime requirements (shell tools need PowerShell etc. on the host).

## License

MIT — see [LICENSE](LICENSE). Engine upstream: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (MIT).
