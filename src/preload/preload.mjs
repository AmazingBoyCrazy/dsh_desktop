/**
 * Sandboxed preload: the only bridge between the renderer and the main
 * process. Exposes a frozen `window.desktop` object with three read-only
 * operations. The harness GUI itself never uses it — only the local
 * loading/error pages do.
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktop', Object.freeze({
  /** Current app/harness state plus log tails for diagnostics. */
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  /** Stop the engine and boot a replacement. */
  restartHarness: () => ipcRenderer.invoke('desktop:restart-harness'),
  /** Quit the whole app (and the supervised engine). */
  quit: () => ipcRenderer.invoke('desktop:quit'),
}))
