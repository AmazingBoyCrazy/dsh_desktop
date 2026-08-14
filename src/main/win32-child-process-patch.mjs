/**
 * Windows child-process console patch, preloaded into the engine with
 * `--import` (see harness.mjs).
 *
 * Problem: the desktop shell starts the engine hidden (CREATE_NO_WINDOW), so
 * the engine process has no console. On Windows, every console-subsystem
 * child a console-less parent spawns (bash, pwsh, cmd, ripgrep, ...) gets a
 * brand-new console window — a terminal flashes up and closes with each tool
 * call. Upstream's subprocess-local spawn omits `windowsHide`, and the
 * engine is upstream code, so this module fixes it at the seam: every
 * `node:child_process` entry point gets a default `windowsHide: true` on
 * win32. Callers that pass an explicit option are untouched; POSIX is
 * unaffected (no console concept).
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

  /** Default-inject windowsHide for one options object. */
  const hide = (options) => {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) options = {}
    if (options.windowsHide === undefined) options = { ...options, windowsHide: true }
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
