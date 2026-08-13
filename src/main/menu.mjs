/**
 * Application menu. macOS keeps the conventional menu (the Edit roles are
 * what make Cmd+C/Cmd+V work); Windows and Linux get a menu-bar-free window —
 * the harness GUI provides all its own controls.
 * @module menu
 */

import { Menu } from 'electron'

/** Install the platform menu once at startup. */
export function installAppMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]))
}
