/**
 * Windows console seam patch, preloaded into the engine with `--import`
 * (see harness.mjs).
 *
 * Problem: the desktop shell starts the engine hidden (CREATE_NO_WINDOW), so
 * the engine process has no console. On Windows, every console-subsystem
 * child a console-less parent spawns (bash, pwsh, cmd, ripgrep, ...) gets a
 * brand-new console window — a terminal flashes up and closes with each tool
 * call. Upstream's subprocess-local spawn omits `windowsHide`, and the
 * engine is upstream code, so this module fixes it at the seam.
 *
 * Two complementary mechanisms:
 *
 * 1. A HIDDEN console for the engine itself (AllocConsole + ShowWindow
 *    SW_HIDE). The windows-acl sandbox runner cannot use CREATE_NO_WINDOW
 *    (restricted-token children die with STATUS_DLL_INIT_FAILED, verified
 *    upstream), so its CreateProcessAsUserW children rely on inheriting the
 *    host console — upstream's design note says exactly that ("the child
 *    shares the host console"). With a hidden console on the engine, every
 *    child that does not request console isolation inherits it, and no
 *    window is ever created.
 *
 * 2. `windowsHide: true` on every `node:child_process` entry point — but
 *    ONLY when the engine has no console to inherit (AllocConsole failed or
 *    was skipped). When the engine carries a hidden console, forcing
 *    CREATE_NO_WINDOW would strip the sandbox runner of its inherited
 *    console and the runner's own children would pop windows again; plain
 *    subprocesses are equally fine inheriting the hidden console.
 *
 * 3. The windows-acl sandbox runner is spawned as `[process.execPath, ...]`:
 *    node.exe under the CLI (a console app that inherits the terminal
 *    console) but electron.exe under the desktop — a GUI-subsystem binary
 *    that never inherits a console, so the runner's restricted-token
 *    children (CreateProcessAsUserW, no console flags by upstream design)
 *    would get a brand-new visible console per command. The spawn wrapper
 *    therefore injects THIS module into the runner's argv (--import), so the
 *    runner allocates its own hidden console for the confined children to
 *    inherit.
 *
 * ESM named imports of builtin modules are live bindings over the CJS
 * exports object, so patching `require('node:child_process').spawn` here
 * (loaded before the engine entry) is visible to the engine's own
 * `import { spawn } from 'node:child_process'`.
 * @module win32-child-process-patch
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const childProcess = require('node:child_process')

if (process.platform === 'win32') {
  /** Installed marker so probes can assert the patch is live. */
  childProcess._dshWin32ConsolePatch = true

  /** Whether this process has a console children can inherit. */
  childProcess._dshEngineHasConsole = false

  /** Opt-in diagnostics (DSH_DESKTOP_PATCH_DEBUG=1) for future debugging. */
  const debug = process.env.DSH_DESKTOP_PATCH_DEBUG === '1'
    ? (...args) => { console.error('[dsh-desktop-patch]', ...args) }
    : () => {}

  /**
   * Give this console-less process a console children can inherit, PREFERRING
   * to attach to the parent's existing console instead of allocating a new
   * one. Every sandbox runner is a direct child of the engine, which already
   * owns one hidden console; an attach shares that same console object, so a
   * per-command AllocConsole (whose console window briefly appears before
   * SW_HIDE) never happens. The engine itself has no console-bearing parent
   * (the desktop main is a GUI binary), so it falls back to
   * AllocConsole + SW_HIDE — the single, startup-only flash.
   */
  function allocateHiddenConsole() {
    try {
      const koffi = require('koffi')
      const kernel32 = koffi.load('kernel32.dll')
      const user32 = koffi.load('user32.dll')
      // GetConsoleWindow lives in kernel32 (not user32) on modern Windows.
      const allocConsole = kernel32.func('bool AllocConsole(void)')
      const attachConsole = kernel32.func('bool AttachConsole(uint)')
      const getConsoleWindow = kernel32.func('void* GetConsoleWindow(void)')
      const showWindow = user32.func('bool ShowWindow(void*, int)')
      const ATTACH_PARENT_PROCESS = 0xFFFFFFFF // (DWORD)-1
      if (!getConsoleWindow()) {
        if (!attachConsole(ATTACH_PARENT_PROCESS)) {
          // No console-bearing parent (the engine itself): allocate one and
          // hide it. FALSE when a console already exists (then children
          // inherit it — fine).
          if (allocConsole()) {
            const hwnd = getConsoleWindow()
            if (hwnd) showWindow(hwnd, 0) // SW_HIDE
            childProcess._dshWin32HiddenConsole = true
          }
        }
      }
      childProcess._dshEngineHasConsole = Boolean(getConsoleWindow())
      debug('hasConsole=', childProcess._dshEngineHasConsole, 'hidden=', childProcess._dshWin32HiddenConsole === true, 'parentAttached=', !childProcess._dshWin32HiddenConsole && childProcess._dshEngineHasConsole)
    } catch (error) {
      // koffi unavailable or API failure: degrade to the child_process patch
      // alone (windowsHide still covers the plain subprocess paths).
      debug('hidden console failed:', String(error))
    }
  }
  allocateHiddenConsole()

  /** Self-referential file:// specifier, used to preload this patch into the
   * sandbox runner child (see maybeInjectSelf). import.meta.url is already a
   * file:// URL string — pass it through verbatim (pathToFileURL would need
   * a plain path, and new URL(...) yields an object, which crashes). */
  const selfSpecifier = import.meta.url

  /**
   * Whether an argv (spawn args WITHOUT the program) is the windows-acl
   * sandbox runner invocation. Matches both the package path (current
   * upstream layout) and a structural fallback (a node entry named
   * runner.js/runner.ts carrying the runner's flag vocabulary), so the
   * injection survives upstream renames or relocations.
   * @param argv - spawn args (args[0] is the entry script).
   */
  function isSandboxRunnerArgv(argv) {
    if (!Array.isArray(argv) || argv.length === 0) return false
    const [entry, ...rest] = argv
    if (typeof entry !== 'string' || entry === '') return false
    if (entry.includes('dsh-sandbox-windows-acl')) return true
    if (/[\\/]runner\.(js|ts)$/u.test(entry)) {
      return rest.some((a) => a === '--mode' || a === '--temp' || a === '--workspace')
    }
    return false
  }

  /**
   * Build the injected argv for the sandbox runner. spawn(file, args): args
   * are the arguments ONLY (the entry script is args[0]). Node flags like
   * --import must come BEFORE the entry script, so prepend — never splice
   * after argv[0] (that would hand `--import` to the runner as a script
   * argument: "unknown argument: --import").
   * @param argv - spawn args of the runner invocation.
   * @returns the argv with this module preloaded.
   */
  function buildInjectedArgv(argv) {
    return ['--import', selfSpecifier, ...argv]
  }

  /**
   * The windows-acl sandbox runner is spawned as `[process.execPath, runner]`.
   * Under the CLI, process.execPath is node.exe (a console app) which
   * inherits the terminal console, so the runner's restricted-token children
   * share it (upstream's design). Under the desktop, process.execPath is
   * electron.exe — a GUI-subsystem binary that NEVER inherits a console — so
   * the runner has none and its CreateProcessAsUserW children get a
   * brand-new visible console per command. Inject this same patch into the
   * runner's argv: it allocates a hidden console in the runner, which the
   * confined children then inherit.
   */
  const maybeInjectSelf = (argv) => {
    if (!isSandboxRunnerArgv(argv)) return argv
    debug('injecting self into sandbox runner')
    return buildInjectedArgv(argv)
  }

  /** Test-only surface for the runner-injection shape spec (Windows CI). */
  childProcess._dshInjectionHelpers = { isSandboxRunnerArgv, buildInjectedArgv }

  /** Default-inject windowsHide when there is no console to inherit. */
  const hide = (options) => {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) options = {}
    if (options.windowsHide === undefined && childProcess._dshEngineHasConsole !== true) {
      options = { ...options, windowsHide: true }
    }
    return options
  }

  /**
   * Patch one spawn-shaped API: `(file[, args][, options])` / fork-shaped
   * `(modulePath[, args][, options])`. The `spawn(file, options)` short form
   * puts the options at index 1 instead of 2, so the wrapper detects it.
   */
  const patchSpawnShape = (name) => {
    const original = childProcess[name]
    if (typeof original !== 'function') return
    childProcess[name] = function (file, args, options) {
      if (Array.isArray(args)) {
        return original.call(this, file, maybeInjectSelf(args), hide(options))
      }
      // spawn(file, options) short form (or bare spawn(file)).
      if (args !== undefined && args !== null && typeof args === 'object') {
        return original.call(this, file, hide(args))
      }
      return original.call(this, file)
    }
  }

  /**
   * Patch one exec-shaped API: `(command[, options][, callback])` and
   * `execFile(file[, args][, options][, callback])`. The options slot moves
   * when an argv array is present.
   */
  const patchExecShape = (name, hasArgvArray) => {
    const original = childProcess[name]
    if (typeof original !== 'function') return
    childProcess[name] = function (command, arg2, arg3, arg4) {
      if (hasArgvArray && Array.isArray(arg2)) {
        return original.call(this, command, arg2, hide(arg3), arg4)
      }
      if (arg2 !== undefined && arg2 !== null && typeof arg2 === 'object' && typeof arg3 !== 'function') {
        return original.call(this, command, hide(arg2), arg3)
      }
      return original.call(this, command, arg2, arg3, arg4)
    }
  }

  patchSpawnShape('spawn')
  patchSpawnShape('spawnSync')
  patchSpawnShape('fork')
  patchExecShape('exec', false)
  patchExecShape('execSync', false)
  patchExecShape('execFile', true)
  patchExecShape('execFileSync', true)
}
