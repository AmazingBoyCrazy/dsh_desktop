/**
 * Desktop-provided native directory picker (a loadable harness plugin).
 *
 * The upstream native backend drives the OS chooser with koffi, whose error
 * path crashes under Electron's bundled Node runtime. This plugin registers
 * the same `directoryPicker` service with the same `native` capability, but
 * implements `pick()` by asking the Electron main process — over the engine's
 * own stdio IPC channel — to show the real system folder dialog
 * (`dialog.showOpenDialog` with `openDirectory`): the standard modern folder
 * window with free navigation.
 *
 * Loaded by the Loader as an ordinary service-class plugin (default export),
 * mounted through the runtime-generated `--patch` overlay in harness.mjs.
 * @module dsh-desktop-native-picker
 */

import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'

/** Give up on a pick the operator left open this long. */
const PICK_TIMEOUT_MS = 10 * 60 * 1000

let nextId = 1
/** id -> { resolve, timer } for in-flight picks. */
const pending = new Map()
let bridgeAttached = false

/** One-shot attachment of the parent-message bridge (the plugin loads once). */
function attachBridge() {
  if (bridgeAttached) return
  bridgeAttached = true
  process.on('message', (message) => {
    if (message === null || typeof message !== 'object') return
    if (message.type !== 'dsh-desktop:pick-result') return
    const entry = pending.get(message.id)
    if (entry === undefined) return
    clearTimeout(entry.timer)
    pending.delete(message.id)
    entry.resolve(typeof message.path === 'string' ? message.path : null)
  })
}

export default class DesktopNativeDirectoryPicker extends DirectoryPicker {
  /** Stable per-service capability object, as the seam requires. */
  capability() {
    return { kind: 'native', pick: signal => this.pick(signal) }
  }

  /**
   * One OS folder dialog on the host display, driven by the Electron main
   * process over IPC.
   * @param signal - caller lifetime; abort resolves null without a dialog result.
   * @returns the chosen absolute path, or null on cancel/abort/unavailability.
   */
  pick(signal) {
    if (typeof process.send !== 'function') return Promise.resolve(null)
    attachBridge()
    return new Promise((resolve) => {
      const id = nextId++
      const settle = (path) => {
        const entry = pending.get(id)
        if (entry === undefined) return
        clearTimeout(entry.timer)
        pending.delete(id)
        resolve(path)
      }
      const timer = setTimeout(() => { settle(null) }, PICK_TIMEOUT_MS)
      pending.set(id, { resolve, timer })
      if (signal !== undefined) {
        signal.addEventListener('abort', () => { settle(null) }, { once: true })
      }
      try {
        process.send({ type: 'dsh-desktop:pick-directory', id })
      } catch {
        settle(null)
      }
    })
  }
}
