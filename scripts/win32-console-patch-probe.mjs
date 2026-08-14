#!/usr/bin/env node
/**
 * Console-patch probe: prove the win32 child-process seam patch loads inside
 * the exact runtime the desktop uses — the Electron binary in
 * ELECTRON_RUN_AS_NODE mode, spawned hidden (no console, like harness.mjs) —
 * that its marker is installed, and that ESM named imports of
 * `node:child_process` observe the patched functions (live bindings).
 *
 * Runs under plain Node; the child it spawns is Electron-in-Node-mode when
 * the electron package is installed (the CI case), falling back to the plain
 * Node binary so the script is also runnable in minimal environments.
 * @module win32-console-patch-probe
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const patchPath = fileURLToPath(new URL('../src/main/win32-child-process-patch.mjs', import.meta.url))
// --import takes a specifier/URL; a raw Windows path would be read as the
// `d:` URL scheme (ERR_UNSUPPORTED_ESM_URL_SCHEME), exactly what harness.mjs
// must avoid — probe the same file:// form the desktop passes.
const patchSpecifier = pathToFileURL(patchPath).href

/** Inline engine-side script: asserts marker + live binding + spawn shapes. */
const inline = `
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
const cp = createRequire(import.meta.url)('node:child_process')
if (cp._dshWin32ConsolePatch !== true) { console.error('FAIL: patch marker missing'); process.exit(1) }
if (spawn !== cp.spawn) { console.error('FAIL: ESM import is not the patched spawn (live binding broken)'); process.exit(1) }
// The process must end up with a console children can inherit: either
// attached to the parent's console (runner chain) or a hidden
// self-allocated one (the engine itself, spawned by the GUI main).
if (cp._dshEngineHasConsole !== true) { console.error('FAIL: no inheritable console'); process.exit(1) }
const shapes = [
  () => new Promise((res) => { const c = spawn(process.execPath, ['-e', '1'], { stdio: 'ignore' }); c.on('exit', (code) => res(code === 0)) }),
  () => new Promise((res) => { const c = spawn(process.execPath, { stdio: 'ignore' }); c.on('exit', (code) => res(code === 0)) }),
  () => new Promise((res) => { const c = spawn(process.execPath, ['-e', '1'], { stdio: 'ignore' }); c.on('exit', (code) => res(code === 0)) }),
  () => { const r = spawnSync(process.execPath, ['-e', '1'], { stdio: 'ignore' }); return Promise.resolve(r.status === 0) },
]
for (const t of shapes) { if (!(await t())) { console.error('FAIL: spawn shape did not exit 0'); process.exit(1) } }
console.log('PROBE OK')
`

/** Resolve the Electron binary when installed; else fall back to plain node. */
function engineBinary() {
  try {
    return require('electron')
  } catch {
    return process.execPath
  }
}

const binary = engineBinary()
const env = { ...process.env }
if (binary !== process.execPath) {
  // Replicate the desktop's engine spawn exactly (see harness.mjs).
  env.ELECTRON_RUN_AS_NODE = '1'
  env.ELECTRON_NO_ATTACH_CONSOLE = '1'
}

let stdout = ''
let stderr = ''
const child = spawn(binary, ['--import', patchSpecifier, '--input-type=module', '-e', inline], {
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })

const exit = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    try { child.kill('SIGKILL') } catch { /* already gone */ }
    resolve({ code: null, signal: 'timeout' })
  }, 60_000)
  child.once('exit', (code, signal) => {
    clearTimeout(timer)
    resolve({ code, signal })
  })
})

const label = binary === process.execPath ? 'plain-node' : 'electron-run-as-node'
if (exit.code !== 0 || !stdout.includes('PROBE OK')) {
  console.error(`probe FAIL (${label}): code=${String(exit.code)} signal=${String(exit.signal)}`)
  console.error(stderr)
  console.error(stdout)
  process.exit(1)
}
console.log(`probe OK (${label}): console patch live under ${binary}`)
