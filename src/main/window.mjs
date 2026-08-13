/**
 * The desktop window: a sandboxed renderer that shows a local loading page
 * first and the loopback harness GUI once the engine is ready. External links
 * are handed to the system browser; the window itself only ever navigates to
 * our local pages or the loopback origin.
 * @module window
 */

import { BrowserWindow, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Preload script; the sandboxed renderer gets only the `desktop` bridge. */
export const PRELOAD_PATH = join(__dirname, '../preload/preload.mjs')

/** Shown while the engine boots. */
export const LOADING_PAGE = join(__dirname, '../renderer/loading.html')

/** Shown when the engine fails to boot or dies unexpectedly. */
export const ERROR_PAGE = join(__dirname, '../renderer/error.html')

/** Only our loopback origin (any port) may be navigated to from the page. */
const LOOPBACK_ORIGIN = /^http:\/\/127\.0\.0\.1:\d+/

/**
 * Create the main window showing the loading page; the caller navigates it to
 * the engine URL once ready.
 * @returns the created window.
 */
export function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#10141a',
    title: 'DeepSeek Harness Desktop',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  // Popups: never open in-app; external http(s) links go to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Navigation: allow our file: pages and the loopback origin only.
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:') || LOOPBACK_ORIGIN.test(url)) return
    event.preventDefault()
    if (/^https?:/.test(url)) void shell.openExternal(url)
  })

  win.once('ready-to-show', () => { win.show() })
  void win.loadFile(LOADING_PAGE)
  return win
}
