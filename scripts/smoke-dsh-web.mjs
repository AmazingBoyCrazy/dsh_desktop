#!/usr/bin/env node
/**
 * Engine smoke test: boots the embedded `@deepseek-ai/dsh` package exactly
 * the way the desktop shell does — the published `lib/bin.js` entry with the
 * `web` profile — and proves it serves HTTP on loopback.
 *
 * This is the CI gate for "the embedded engine works": it runs under plain
 * Node (no Electron, no display) with an isolated temporary DSH_HOME, parses
 * the URL line the harness prints, fetches the served page, then shuts the
 * child down and expects a clean exit.
 * @module smoke-dsh-web
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)

const BOOT_TIMEOUT_MS = 120_000
const URL_LINE_PATTERN = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/

/** Fail with a clear message and a non-zero exit. */
function fail(message) {
  console.error(`smoke: FAIL — ${message}`)
  process.exit(1)
}

/** Resolve the published dsh entry, as harness.mjs does. */
function resolveDshEntry() {
  const manifest = require.resolve('@deepseek-ai/dsh/package.json')
  return join(dirname(manifest), 'lib', 'bin.js')
}

const home = await mkdtemp(join(tmpdir(), 'dsh-smoke-'))
// `--entry <path>` overrides the engine location, so the same smoke can run
// against a packaged tree (dist/…/resources/app/node_modules/…) to catch
// dependencies that packaging pruned. Made absolute up front: the child runs
// with `home` as its cwd, so a relative script path would not resolve.
const entryIndex = process.argv.indexOf('--entry')
const entry = resolve(entryIndex >= 0 ? process.argv[entryIndex + 1] : resolveDshEntry())
const args = ['web', '--host', '127.0.0.1', '--port', '0']

let stdout = ''
const child = spawn(process.execPath, [entry, ...args], {
  cwd: home,
  env: { ...process.env, DSH_HOME: join(home, 'dsh-home'), DSH_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (chunk) => { stdout += chunk })
let stderr = ''
child.stderr.on('data', (chunk) => { stderr += chunk })

let ready = false
const url = await new Promise((resolve) => {
  const timer = setTimeout(() => { fail(`no URL line within ${BOOT_TIMEOUT_MS}ms\n${stderr}\n${stdout}`) }, BOOT_TIMEOUT_MS)
  const onData = (chunk) => {
    const match = chunk.match(URL_LINE_PATTERN)
    if (match !== null) {
      ready = true
      clearTimeout(timer)
      child.stdout.off('data', onData)
      resolve(match[1])
    }
  }
  child.stdout.on('data', onData)
  // Only a pre-readiness exit is a failure: after readiness the smoke itself
  // asks the engine to stop (SIGTERM), and that clean exit (code 0) must not
  // trip this guard.
  child.once('exit', (code, signal) => {
    if (!ready) fail(`engine exited before readiness (code ${String(code)}, signal ${String(signal)})\n${stderr}`)
  })
})

let status = 0
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  status = response.status
  await response.arrayBuffer()
} catch (error) {
  child.kill('SIGKILL')
  fail(`GET ${url} failed: ${String(error)}\n${stderr}`)
}
if (status !== 200) {
  child.kill('SIGKILL')
  fail(`GET ${url} -> HTTP ${String(status)} (expected 200)\n${stderr}`)
}
console.log(`smoke: engine serves ${url} (HTTP 200)`)

// The harness treats SIGTERM as a supervisor's stop request and exits 0.
// That graceful path exists on POSIX only: on Windows, SIGTERM is a hard
// terminate (code null, signal SIGTERM) — Node cannot deliver the handler.
// Both are the platform's clean shutdown, so each asserts its own shape.
child.kill('SIGTERM')
const exit = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    try { child.kill('SIGKILL') } catch { /* already gone */ }
    resolve({ code: null, signal: 'SIGKILL-after-timeout' })
  }, 15_000)
  child.once('exit', (code, signal) => {
    clearTimeout(timer)
    resolve({ code, signal })
  })
})
if (process.platform === 'win32') {
  if (!(exit.code === null && exit.signal === 'SIGTERM')) {
    fail(`engine did not terminate on SIGTERM: code ${String(exit.code)} signal ${String(exit.signal)}`)
  }
} else if (exit.code !== 0) {
  fail(`engine did not shut down cleanly: code ${String(exit.code)} signal ${String(exit.signal)}`)
}

await rm(home, { recursive: true, force: true })
console.log('smoke: OK — embedded engine boots, serves, and shuts down cleanly')
