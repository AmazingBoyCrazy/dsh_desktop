#!/usr/bin/env node
/**
 * Root postinstall guard for the Electron binary.
 *
 * npm 11+ can swallow a failed dependency postinstall (electron downloads its
 * ~100 MB binary there), leaving a tree that "installed" but cannot launch
 * (`npx electron .` fails with "Electron failed to install correctly"). This
 * script checks the real artifact and, when missing, retries the download
 * once with a loud, actionable failure.
 * @module ensure-electron
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

/** Whether the electron package resolves to a real binary on disk. */
function isInstalled() {
  try {
    const binary = require('electron')
    return existsSync(binary)
  } catch {
    return false
  }
}

if (isInstalled()) process.exit(0)

console.log('ensure-electron: binary missing, retrying the download...')
const manifest = require.resolve('electron/package.json')
const installScript = join(dirname(manifest), 'install.js')
const result = spawnSync(process.execPath, [installScript], { stdio: 'inherit' })

if (result.status !== 0 || !isInstalled()) {
  console.error('')
  console.error('ensure-electron: the Electron binary download failed.')
  console.error('')
  console.error('If you are behind a restricted network, retry with a mirror:')
  console.error('  PowerShell: $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"')
  console.error('  bash:       export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/')
  console.error('then run: npm install')
  console.error('')
  console.error('Note: packaging (npm run dist) downloads its own copy and needs the')
  console.error('ELECTRON_BUILDER_BINARIES_MIRROR mirror in the same environments.')
  process.exit(1)
}

console.log('ensure-electron: OK')
