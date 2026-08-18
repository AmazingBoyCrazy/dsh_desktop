#!/usr/bin/env node
/**
 * Reproduce the fresh-install plugin failure locally (not committed to the
 * release flow; run manually with plain Node, no Electron needed):
 *
 *   1. creates a fresh temp DSH_HOME (like a brand-new install),
 *   2. seeds the profile patch exactly like the desktop shell does
 *      (ensureDefaultProfileSeed from src/main/harness.mjs),
 *   3. boots the embedded engine the same way the CI smoke does,
 *   4. prints the engine's full stderr so the plugin load error is visible.
 *
 * Usage: node scripts/repro-fresh-boot.mjs
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureDefaultProfileSeed, resolveDshEntry } from '../src/main/harness.mjs'

const home = mkdtempSync(join(tmpdir(), 'dsh-fresh-boot-'))
process.env.DSH_HOME = home
console.log('fresh DSH_HOME:', home)
ensureDefaultProfileSeed()
console.log('seeded cordis.patch.yml:')
console.log('---')
console.log(readFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), 'utf8'))
console.log('---')

const entry = resolveDshEntry()
const child = spawn(process.execPath, [entry, 'web', '--host', '127.0.0.1', '--port', '0'], {
  cwd: home,
  env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let out = ''
let err = ''
child.stdout.setEncoding('utf8').on('data', (d) => { out += d })
child.stderr.setEncoding('utf8').on('data', (d) => { err += d })

const timer = setTimeout(() => {
  console.log('TIMEOUT after 90s — engine did not exit nor print a URL line')
  child.kill('SIGKILL')
  finish()
}, 90_000)

let done = false
function finish() {
  if (done) return
  done = true
  clearTimeout(timer)
  console.log('=== engine stdout (tail) ===')
  console.log(out.split('\n').slice(-30).join('\n'))
  console.log('=== engine stderr (tail) ===')
  console.log(err.split('\n').slice(-60).join('\n'))
  try { rmSync(home, { recursive: true, force: true }) } catch { /* keep for inspection */ }
  process.exit(0)
}

child.on('exit', (code, signal) => {
  console.log(`engine exited: code=${String(code)} signal=${String(signal)}`)
  finish()
})

// Readiness probe like the real smoke: the URL line is the success signal.
const probe = setInterval(() => {
  const match = out.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/)
  if (match) {
    clearInterval(probe)
    console.log('ENGINE READY AT', match[1])
    child.kill('SIGTERM')
  }
}, 500)
