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
        return original.call(this, file, args, hide(options))
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
