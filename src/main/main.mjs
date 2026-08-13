/**
 * Desktop application entry: single-instance lock, window lifecycle, the
 * supervised harness engine, and the small IPC surface the local pages use
 * (version info, engine restart, quit).
 * @module main
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HARNESS_LOG_FILENAME, HARNESS_PORTS, HarnessServer, pickPort, resolveDshVersion } from './harness.mjs'
import { MAIN_LOG_FILENAME, initLogs, log, readTail } from './log.mjs'
import { installAppMenu } from './menu.mjs'
import { initUpdater } from './updater.mjs'
import { ERROR_PAGE, LOADING_PAGE, createMainWindow } from './window.mjs'

/** Extra candidate ports a power user may prepend; comma-separated. */
const PORT_ENV = 'DSH_DESKTOP_PORT'

let mainWindow = undefined
let harness = undefined
let quitting = false

/** State surfaced to the error page through `desktop.getInfo()`. */
const state = {
  error: '',
  port: undefined,
}

/** Port candidates: env override first, then the built-in defaults. */
function preferredPorts() {
  const env = (process.env[PORT_ENV] ?? '').split(',').map((p) => Number.parseInt(p.trim(), 10)).filter((p) => Number.isInteger(p) && p > 0 && p < 65536)
  return [...env, ...HARNESS_PORTS]
}

/** Create the main window and track its lifetime in `mainWindow`. */
function openWindow() {
  const win = createMainWindow()
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined
  })
  mainWindow = win
  return win
}

/** Bring the window back to the loading page with the current failure. */
function showError(error) {
  state.error = String(error?.message ?? error)
  log('error', state.error)
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    void mainWindow.loadFile(ERROR_PAGE)
  }
}

/** Whether the system folder dialog is already open (one pick at a time). */
let pickOpen = false

/** Serve the engine plugin's directory-pick requests with the real system dialog. */
function handleChildMessage(message, send) {
  if (message === null || typeof message !== 'object') return
  if (message.type !== 'dsh-desktop:pick-directory') return
  if (pickOpen) {
    send({ type: 'dsh-desktop:pick-result', id: message.id, path: null })
    return
  }
  pickOpen = true
  const parent = mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined
  dialog.showOpenDialog(parent, {
    title: '选择文件夹',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: homedir(),
  }).then((result) => {
    const path = result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
    send({ type: 'dsh-desktop:pick-result', id: message.id, path })
  }, () => {
    send({ type: 'dsh-desktop:pick-result', id: message.id, path: null })
  }).finally(() => { pickOpen = false })
}

/** Boot a fresh engine and navigate the window to it. */
async function bootAndNavigate() {
  const port = await pickPort(preferredPorts())
  harness = new HarnessServer({
    port,
    logDir: join(app.getPath('userData'), 'logs'),
    onUnexpectedExit: (code, signal) => {
      if (quitting) return
      showError(new Error(`harness engine exited unexpectedly (code ${String(code)}, signal ${String(signal)})`))
    },
    onChildMessage: handleChildMessage,
  })
  state.port = port
  harness.start()
  await harness.waitReady()
  log('info', `harness ready at ${harness.url}`)
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(harness.url)
  }
}

/** Stop the current engine (if any) and boot a replacement, for the error page's restart button. */
async function restartHarness() {
  try {
    state.error = ''
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      await mainWindow.loadFile(LOADING_PAGE)
    }
    await harness?.stop()
    await bootAndNavigate()
  } catch (error) {
    showError(error)
  }
}

/** Register the IPC surface the local pages use. */
function registerIpc() {
  ipcMain.handle('desktop:get-info', () => ({
    appVersion: app.getVersion(),
    dshVersion: resolveDshVersion(),
    port: state.port,
    url: harness?.url ?? null,
    error: state.error,
    logPath: join(app.getPath('userData'), 'logs', MAIN_LOG_FILENAME),
    harnessLogPath: join(app.getPath('userData'), 'logs', HARNESS_LOG_FILENAME),
    harnessLogTail: readTail(join(app.getPath('userData'), 'logs', HARNESS_LOG_FILENAME), 40),
    dshHome: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
  }))
  ipcMain.handle('desktop:restart-harness', async () => {
    await restartHarness()
    return { ok: true }
  })
  ipcMain.handle('desktop:quit', () => {
    app.quit()
    return { ok: true }
  })
}

// A second launch focuses the existing window instead of starting a second
// engine (which would contend for DSH_HOME and ports).
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on('before-quit', () => { quitting = true })

  app.on('window-all-closed', () => {
    // Single-window app: closing the window quits the app (and its engine) on
    // every platform. An engine must never outlive its supervisor.
    app.quit()
  })

  app.on('activate', () => {
    // macOS dock click: the engine keeps running; bring back the window.
    if (BrowserWindow.getAllWindows().length === 0 && harness !== undefined) {
      void openWindow().loadURL(harness.url)
    }
  })

  app.on('will-quit', (event) => {
    // Give the engine its graceful shutdown budget, then exit for real.
    if (harness !== undefined && harness.running) {
      event.preventDefault()
      harness.stop().finally(() => { app.exit(0) })
    }
  })

  app.whenReady().then(async () => {
    initLogs(join(app.getPath('userData'), 'logs'))
    installAppMenu()
    registerIpc()
    log('info', `deepseek-harness-desktop ${app.getVersion()} starting (embedded @deepseek-ai/dsh ${resolveDshVersion()})`)
    openWindow()
    try {
      await bootAndNavigate()
      initUpdater()
      // CI-only hook (see ci.yml): prove the full Electron path — spawn with
      // ELECTRON_RUN_AS_NODE + --expose-internals, readiness, then a clean
      // quit that exercises will-quit -> engine shutdown.
      if (process.env.DSH_DESKTOP_SMOKE === '1') {
        log('info', 'desktop smoke: ready, quitting')
        app.quit()
      }
    } catch (error) {
      showError(error)
    }
  }).catch((error) => {
    log('error', `startup failed: ${String(error)}`)
  })
}
