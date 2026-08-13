/**
 * In-app auto-update via electron-updater.
 *
 * Every packaged build embeds its GitHub publish metadata, and the release
 * workflow uploads the generated `latest*.yml` files alongside the
 * installers, so a running app can discover, download, and install the next
 * release without a browser.
 *
 * Disabled while developing (`app.isPackaged` is false) and on macOS: Apple
 * requires code-signed builds for auto-update, and this project is unsigned
 * for now. Windows (NSIS) and Linux (AppImage) update silently in the
 * background and prompt before the restart that installs the new version.
 * @module updater
 */

import { app, dialog } from 'electron'
import electronUpdater from 'electron-updater'
import { log } from './log.mjs'

const { autoUpdater } = electronUpdater

/** How often a running app re-checks for a new release. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Map electron-updater's logger onto the desktop log file. */
function attachLogger() {
  autoUpdater.logger = {
    info: (message) => { log('info', `updater: ${message}`) },
    warn: (message) => { log('warn', `updater: ${message}`) },
    error: (message) => { log('error', `updater: ${message}`) },
  }
}

/** One background check; failures are logged, never fatal. */
function checkSafely() {
  autoUpdater.checkForUpdates().catch((error) => {
    log('warn', `updater: check failed: ${String(error)}`)
  })
}

/**
 * Start the updater: background download on startup, a native restart prompt
 * when the download lands, and a periodic re-check while the app stays open.
 */
export function initUpdater() {
  if (!app.isPackaged) {
    log('info', 'updater: skipped (development mode)')
    return
  }
  if (process.platform === 'darwin') {
    log('info', 'updater: skipped on macOS until builds are code-signed')
    return
  }
  attachLogger()
  // Desktop versions mirror the engine's prerelease line (0.1.0-rc.*), so
  // the updater must consider prerelease releases too.
  autoUpdater.allowPrerelease = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    log('info', `updater: version ${info.version} downloaded`)
    const choice = dialog.showMessageBoxSync({
      type: 'info',
      title: 'Update ready',
      message: `DeepSeek Harness Desktop ${info.version} is ready to install.`,
      detail: 'Restart now to finish the update, or it will install next time you quit.',
      buttons: ['Restart and install', 'Later'],
      defaultId: 0,
      cancelId: 1,
    })
    if (choice === 0) autoUpdater.quitAndInstall()
  })
  autoUpdater.on('error', (error) => { log('error', `updater: ${String(error)}`) })

  checkSafely()
  setInterval(checkSafely, CHECK_INTERVAL_MS)
  log('info', 'updater: enabled')
}
