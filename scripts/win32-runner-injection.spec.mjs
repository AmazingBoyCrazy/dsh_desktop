#!/usr/bin/env node
/**
 * Runner-injection shape spec (Windows CI).
 *
 * Guards the desktop's sandbox-runner console fix against upstream drift:
 * if upstream renames or relocates the windows-acl runner, the structural
 * matcher must still recognize it and the injected argv must keep `--import`
 * BEFORE the entry script (a misplaced flag is handed to the runner as a
 * script argument — "unknown argument: --import" — and every sandboxed
 * command fails closed).
 *
 * Loads the real patch module and exercises its test surface
 * (childProcess._dshInjectionHelpers), then proves the injected argv's
 * semantics with a real spawn. Skips (exit 0) on non-Windows.
 * @module win32-runner-injection.spec
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const patchPath = fileURLToPath(new URL('../src/main/win32-child-process-patch.mjs', import.meta.url))

let failures = 0
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failures++
}

if (process.platform !== 'win32') {
  console.log('SKIP win32-runner-injection.spec (not Windows)')
  process.exit(0)
}

// Load the real patch module: it installs the helpers on win32 and allocates
// its hidden console (harmless here).
await import(`file:///${patchPath.replaceAll('\\', '/')}`)
const helpers = require('node:child_process')._dshInjectionHelpers
if (helpers === undefined) {
  console.error('FAIL helpers not installed (patch module not active)')
  process.exit(1)
}
const { isSandboxRunnerArgv, buildInjectedArgv } = helpers

// — matching —
check('matches package-path runner (current layout)',
  isSandboxRunnerArgv(['node_modules/@deepseek-ai/dsh-sandbox-windows-acl/lib/runner.js', '--workspace', 'W', '--temp', 'T', '--mode', 'read-only', '--', 'pwsh', '-c', 'x']))
check('matches structural runner (renamed/relocated package)',
  isSandboxRunnerArgv(['C:/somewhere/runner.js', '--mode', 'workspace-write', '--', 'pwsh', '-c', 'x']))
check('matches tsx source form',
  isSandboxRunnerArgv(['--import', 'tsx/esm', 'D:/repo/packages/sandbox/sandbox-windows-acl/src/runner.ts', '--workspace', 'W', '--temp', 'T', '--mode', 'read-only']))
check('rejects plain scripts',
  !isSandboxRunnerArgv(['lib/bin.js', 'web', '--port', '32123']))
check('rejects runner.js without runner flags',
  !isSandboxRunnerArgv(['C:/tools/runner.js', '--help']))
check('rejects empty argv',
  !isSandboxRunnerArgv([]))

// — injection shape —
const argv = ['node_modules/@deepseek-ai/dsh-sandbox-windows-acl/lib/runner.js', '--workspace', 'W', '--temp', 'T', '--mode', 'read-only', '--', 'pwsh', '-c', 'x']
const injected = buildInjectedArgv(argv)
check('--import precedes the entry script',
  injected[0] === '--import' && typeof injected[1] === 'string' && injected[1].endsWith('win32-child-process-patch.mjs'))
check('original argv preserved after the specifier',
  JSON.stringify(injected.slice(2)) === JSON.stringify(argv))

// — real spawn semantics: Node must consume --import, entry keeps its args —
// NOTE: with `-e`, a leading `--workspace` would be parsed as a Node CLI
// option ("bad option", exit 9), so the `--` separator separates script args.
await new Promise((resolve) => {
  const script = 'console.log(JSON.stringify(process.argv.slice(1)))'
  const child = spawn(process.execPath, buildInjectedArgv(['-e', script, '--', '--workspace', 'W', '--mode', 'read-only']), {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.setEncoding('utf8').on('data', (d) => { out += d })
  child.stderr.setEncoding('utf8').on('data', (d) => { out += d })
  child.on('exit', (code) => {
    const ok = code === 0 && out.includes('"--workspace"') && out.includes('"W"')
    if (!ok) console.error('injected spawn output:', JSON.stringify(out))
    check(`injected argv spawns with correct semantics (exit ${code})`, ok)
    resolve()
  })
})

if (failures > 0) {
  console.error(`win32-runner-injection.spec: ${failures} failure(s)`)
  process.exit(1)
}
console.log('win32-runner-injection.spec: OK')
