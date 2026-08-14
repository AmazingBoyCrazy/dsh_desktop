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
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const childProcess = require('node:child_process')

if (process.platform === 'win32') {
  /** Installed marker so probes can assert the patch is live. */
  childProcess._dshWin32ConsolePatch = true

  /** Whether this process has a console children can inherit. */
  childProcess._dshEngineHasConsole = false

  /** Give this console-less process a hidden console (best effort). */
  function allocateHiddenConsole() {
    try {
      const koffi = require('koffi')
      const kernel32 = koffi.load('kernel32.dll')
      const user32 = koffi.load('user32.dll')
      // GetConsoleWindow lives in kernel32 (not user32) on modern Windows.
      const allocConsole = kernel32.func('bool AllocConsole(void)')
      const getConsoleWindow = kernel32.func('void* GetConsoleWindow(void)')
      const showWindow = user32.func('bool ShowWindow(void*, int)')
      // FALSE when a console already exists (then children inherit it — fine).
      const allocResult = allocConsole()
      if (allocResult) {
        const hwnd = getConsoleWindow()
        if (hwnd) showWindow(hwnd, 0) // SW_HIDE
        childProcess._dshWin32HiddenConsole = true
      }
      childProcess._dshEngineHasConsole = Boolean(getConsoleWindow())
      // Diagnostic: lands in the engine log (dsh-web.log) via stderr.
      console.error(`[dsh-desktop-patch] allocConsole=${allocResult} hasConsole=${childProcess._dshEngineHasConsole} hidden=${childProcess._dshWin32HiddenConsole === true}`)
    } catch (error) {
      // koffi unavailable or API failure: degrade to the child_process patch
      // alone (windowsHide still covers the plain subprocess paths).
      console.error(`[dsh-desktop-patch] hidden console failed: ${String(error)}`)
    }
  }
  allocateHiddenConsole()

  /** Self-referential file:// specifier, used to preload this patch into the
   * sandbox runner child (see maybeInjectSelf). import.meta.url is already a
   * file:// URL string — pass it through verbatim (pathToFileURL would need
   * a plain path, and new URL(...) yields an object, which crashes). */
  const selfSpecifier = import.meta.url

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
    if (!Array.isArray(argv)) return argv
    if (argv.some((a) => typeof a === 'string' && a.includes('dsh-sandbox-windows-acl'))) {
      console.error('[dsh-desktop-patch] injecting self into sandbox runner')
      return [argv[0], '--import', selfSpecifier, ...argv.slice(1)]
    }
    return argv
  }

  /** Default-inject windowsHide when there is no console to inherit. */
  const hide = (options) => {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) options = {}
    if (options.windowsHide === undefined && childProcess._dshEngineHasConsole !== true) {
      options = { ...options, windowsHide: true }
    }
    return options
  }

  /** Diagnostic: log every spawn the engine performs (lands in dsh-web.log). */
  const logSpawn = (name, file) => {
    try {
      console.error(`[dsh-desktop-patch] spawn ${name}: ${typeof file === 'string' ? file : String(file)}`)
    } catch {
      // Logging must never break a spawn.
    }
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
      logSpawn(name, file)
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
      logSpawn(name, command)
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
