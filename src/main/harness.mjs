/**
 * The embedded DeepSeek Harness engine.
 *
 * The desktop shell does not reimplement anything: it spawns the published
 * `@deepseek-ai/dsh` CLI (shipped inside this app's node_modules) with
 * Electron's own Node.js runtime (`ELECTRON_RUN_AS_NODE=1`), boots the exact
 * same `web` profile the CLI exposes, and supervises the child process for the
 * lifetime of the window. The GUI the window loads is the upstream harness GUI
 * served by that child on loopback — this is the "self-hosting" core of the
 * project.
 * @module harness
 */

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

/**
 * Shipped picker plugin (see the file): a `directoryPicker` backend with the
 * native capability whose `pick()` shows the real system folder dialog
 * through the Electron main process, replacing the upstream koffi-driven
 * chooser whose error path crashes under Electron's Node runtime.
 */
export const DESKTOP_PICKER_PLUGIN_PATH = fileURLToPath(new URL('../assets/plugins/dsh-desktop-native-picker.mjs', import.meta.url))

/**
 * Seam patch preloaded into the engine on Windows (--import): defaults
 * `windowsHide: true` on every child_process entry point so tool calls do
 * not flash console windows. See the module for the full rationale.
 */
export const WIN32_CHILD_PROCESS_PATCH_PATH = fileURLToPath(new URL('./win32-child-process-patch.mjs', import.meta.url))

/**
 * Default user patch layer seeded into a FRESH web profile on first boot.
 * Ships the bundled third-party plugins (all MIT) so new installs get them
 * out of the box; an existing `cordis.patch.yml` is never touched, so
 * upgrades and users who manage their own layers are unaffected (the loader
 * throws on duplicate entry ids, which is exactly why the app must not
 * inject these rows through the runtime overlay).
 */
export const DEFAULT_PROFILE_SEED = `# DeepSeek Harness Desktop default plugin layer (created on first boot).
# The desktop app writes this file only when it is missing; edit freely.
- insert:
    - id: better-sidebar
      name: 'dsh-better-sidebar'
    - id: skills-viewer
      name: 'dsh-skill-viewer'
    - id: dsh-market
      name: 'dshmarket'
`

/** Bundled third-party plugins (must match the seed rows and package.json). */
const BUNDLED_PLUGINS = ['dsh-better-sidebar', 'dsh-skill-viewer', 'dshmarket']

/** Absolute path of the web profile's user patch file under one DSH_HOME. */
export function profilePatchPath(dshHome) {
  return join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
}

/**
 * Link the bundled plugins into the profile's own `node_modules` so the
 * loader can resolve them on fresh installs. The engine's installation
 * fallback farm (`$DSH_HOME/profiles/node_modules`) only covers the
 * `@deepseek-ai/dsh` dependency closure — NOT the desktop app's own extra
 * dependencies — so without these links a fresh profile cannot resolve the
 * bundled plugin names (ERR_MODULE_NOT_FOUND at boot). Node's parent-directory
 * walk finds the profile's own node_modules first, which is exactly the
 * upstream contract for out-of-tree plugins.
 * Idempotent: an existing real directory (e.g. pnpm-managed) or a valid
 * symlink is left alone; a wrong/dangling link is replaced.
 */
function ensureProfilePluginLinks(profileDir) {
  const modulesDir = join(profileDir, 'node_modules')
  mkdirSync(modulesDir, { recursive: true })
  for (const name of BUNDLED_PLUGINS) {
    let target
    try {
      target = dirname(require.resolve(`${name}/package.json`))
    } catch {
      continue // not installed in this tree (development edge) — skip
    }
    const link = join(modulesDir, name)
    try {
      if (existsSync(link)) {
        const stat = lstatSync(link)
        if (stat.isSymbolicLink() || stat.isDirectory()) continue
        unlinkSync(link)
      }
      symlinkSync(target, link, 'junction')
    } catch {
      // Best effort: a failed link leaves the plugin unmounted, never breaks
      // the boot.
    }
  }
}

/**
 * Seed the default plugin layer on first boot (fresh installs only).
 * Idempotent and best-effort: a missing profile directory is created; an
 * existing patch file is left alone; plugin links are healed every boot.
 */
export function ensureDefaultProfileSeed() {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const patchPath = profilePatchPath(dshHome)
  try {
    if (!existsSync(patchPath)) {
      mkdirSync(dirname(patchPath), { recursive: true })
      writeFileSync(patchPath, DEFAULT_PROFILE_SEED)
    }
    ensureProfilePluginLinks(dirname(patchPath))
  } catch {
    // Best effort: a fresh install without the seed still boots (plugins
    // simply do not mount); never break startup over a seed write.
  }
}

/**
 * Write the runtime composition overlay the engine boots with: it disables
 * the upstream directory-picker-auto row and inserts the desktop backend
 * (referenced as a file:// URL, so it works wherever the app is installed)
 * plus the upstream native client surface. Written fresh on every boot into
 * the app's userData directory.
 * @param patchPath - absolute path of the overlay file to write.
 * @returns the same path.
 */
export function writeCompositionPatch(patchPath) {
  const pluginUrl = pathToFileURL(DESKTOP_PICKER_PLUGIN_PATH).href
  const content = [
    '# deepseek-harness-desktop runtime composition (regenerated on every boot).',
    '# The desktop backend shows the real system folder dialog through the',
    '# Electron main process; the upstream native client surface drives it.',
    '- id: directory-picker',
    '  disabled: true',
    '- insert:',
    '    - id: directory-picker-desktop-backend',
    `      name: ${JSON.stringify(pluginUrl)}`,
    '    - id: directory-picker-desktop-surface',
    "      name: '@deepseek-ai/dsh-client-ui-directory-picker-native'",
    '',
  ].join('\n')
  writeFileSync(patchPath, content)
  return patchPath
}

/** Loopback only: the desktop window is the only intended client. */
export const HARNESS_HOST = '127.0.0.1'

/** Preferred ports, tried in order; the first free one wins. */
export const HARNESS_PORTS = [32123, 32124, 32125]

/** How long the engine may take to answer the readiness probe. */
export const READY_TIMEOUT_MS = 90_000

/** Poll interval between readiness probes. */
const POLL_INTERVAL_MS = 250

/** Grace period between SIGTERM and SIGKILL on quit. */
export const STOP_GRACE_MS = 4_000

/** Environment variable that makes Electron's binary behave as plain Node. */
const NODE_MODE_ENV = 'ELECTRON_RUN_AS_NODE'

/** Engine log filename under the logs directory. */
export const HARNESS_LOG_FILENAME = 'dsh-web.log'

/** Engine logs are rotated by truncation once they pass this size. */
const HARNESS_LOG_MAX_BYTES = 2 * 1024 * 1024

/**
 * Absolute path of the published dsh entry (`lib/bin.js`). The package ships
 * no `exports` map, so the subpath resolves directly.
 * @returns the entry file path.
 */
export function resolveDshEntry() {
  const manifest = require.resolve('@deepseek-ai/dsh/package.json')
  return join(dirname(manifest), 'lib', 'bin.js')
}

/**
 * Version of the embedded `@deepseek-ai/dsh` package, read from its manifest.
 * @returns the version string, or `unknown` when unreadable.
 */
export function resolveDshVersion() {
  try {
    const manifest = require.resolve('@deepseek-ai/dsh/package.json')
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Whether a TCP port is currently free on loopback.
 * @param port - port number to probe.
 * @returns true when nothing is listening.
 */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => { resolve(false) })
    probe.once('listening', () => { probe.close(() => { resolve(true) }) })
    probe.listen(port, HARNESS_HOST)
  })
}

/**
 * First free port from `preferred` (a single number or a list).
 * @param preferred - candidate port(s), in priority order.
 * @returns the chosen port.
 * @throws when every candidate is taken.
 */
export async function pickPort(preferred = HARNESS_PORTS) {
  const list = Array.isArray(preferred) ? preferred : [preferred]
  for (const port of list) {
    if (await isPortFree(port)) return port
  }
  throw new Error(`no free port among ${list.join(', ')}`)
}

/** Wait for a duration without busy-looping. @param ms - milliseconds. */
export function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * One supervised `dsh web` child process: spawn, readiness polling, log
 * capture, and bounded shutdown.
 */
export class HarnessServer {
  /**
   * @param options.port - fixed port handed to `dsh web --port`.
   * @param options.logDir - directory receiving the engine log file.
   * @param options.onUnexpectedExit - callback `(code, signal)` for exits the
   *   desktop shell did not request.
   * @param options.onChildMessage - optional `(message, send)` handler for
   *   messages the engine (or a plugin inside it) posts over the stdio IPC
   *   channel; `send(reply)` answers that message.
   */
  constructor({ port, logDir, onUnexpectedExit, onChildMessage }) {
    this.port = port
    this.logDir = logDir
    this.onUnexpectedExit = onUnexpectedExit
    this.onChildMessage = onChildMessage
    this.child = undefined
    this.logStream = undefined
    this.stopping = false
  }

  /** The URL the engine serves, once started. */
  get url() {
    return `http://${HARNESS_HOST}:${String(this.port)}`
  }

  /** Absolute path of the engine log file. */
  get logPath() {
    return join(this.logDir, HARNESS_LOG_FILENAME)
  }

  /** Whether a child is currently running. */
  get running() {
    return this.child !== undefined && this.child.exitCode === null
  }

  /**
   * Spawn the engine. Idempotency is the caller's business: a second start
   * while running throws.
   */
  start() {
    if (this.running) throw new Error('harness engine already running')
    // Fresh installs get the bundled plugins through the profile seed; the
    // engine's own init never overwrites an existing cordis.patch.yml, so
    // this is safe to run before the first boot.
    ensureDefaultProfileSeed()
    const entry = resolveDshEntry()
    // The overlay lives in userData (one level above the logs dir) because it
    // embeds the absolute plugin path, which differs per installation.
    const compositionPatch = writeCompositionPatch(join(dirname(this.logDir), 'desktop-composition.patch.yml'))
    const args = [
      'web',
      // --patch is a launcher flag, so it comes before the web app's own flags.
      '--patch', compositionPatch,
      '--host', HARNESS_HOST,
      '--port', String(this.port),
    ]
    // The web profile mounts a watch-only HMR row that needs Node's internal
    // ESM loader. Under plain Node the `node-addon-require-builtin` fallback
    // provides it; Electron's Node build does not load that native addon, so
    // expose the internals the same way Node's own flag does.
    const nodeArgs = ['--expose-internals']
    // On Windows the engine has no console (spawned hidden), so every
    // console-subsystem child it spawns (bash, pwsh, ripgrep, ...) would get
    // a flashing terminal window. Preload the seam patch that defaults
    // `windowsHide: true` on all child_process entry points; harmless no-op
    // on POSIX, so it is only passed on win32.
    if (process.platform === 'win32') {
      // --import takes a specifier/URL, not a raw Windows path: a bare
      // `D:\...` is parsed as the URL scheme `d:` and the engine dies with
      // ERR_UNSUPPORTED_ESM_URL_SCHEME. Always pass the file:// form.
      nodeArgs.push('--import', pathToFileURL(WIN32_CHILD_PROCESS_PATCH_PATH).href)
    }
    nodeArgs.push(entry, ...args)
    const env = { ...process.env, [NODE_MODE_ENV]: '1' }
    // Keep the child windowless on Windows; ELECTRON_RUN_AS_NODE ignores it elsewhere.
    env.ELECTRON_NO_ATTACH_CONSOLE = '1'
    // Windows ACL-sandbox fix: its pre-execution check requires the temp root
    // to be OUTSIDE the session workspace (the user's home), but os.tmpdir()
    // defaults under %LOCALAPPDATA% — inside the home — so every sandboxed
    // command would fail before running. Redirect TMP/TEMP to a writable,
    // workspace-external directory (C:\Users\Public by convention) and
    // pre-create it.
    if (process.platform === 'win32') {
      const publicDir = process.env.PUBLIC ?? join('C:\\', 'Users', 'Public')
      const sandboxTemp = join(publicDir, 'dsh-desktop-tmp')
      try {
        mkdirSync(sandboxTemp, { recursive: true })
        env.TMP = sandboxTemp
        env.TEMP = sandboxTemp
      } catch {
        // Unwritable Public (unusual): keep the default temp — sandboxed
        // commands stay unavailable, everything else is unaffected.
      }
    }
    mkdirSync(this.logDir, { recursive: true })
    const logFile = this.logPath
    if (existsSync(logFile)) {
      try {
        if (statSync(logFile).size > HARNESS_LOG_MAX_BYTES) {
          createWriteStream(logFile, { flags: 'w' }).end()
        }
      } catch {
        // Rotation is best-effort; a held handle falls back to append.
      }
    }
    this.logStream = createWriteStream(logFile, { flags: 'a' })
    // The home directory is the working directory: `{{cwd}}` in the harness
    // persona should be the user's home, not the app's install location.
    // fd 3 is the IPC channel the desktop picker plugin talks over.
    this.child = spawn(process.execPath, nodeArgs, {
      cwd: homedir(),
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    })
    this.stopping = false
    this.child.stdout.pipe(this.logStream, { end: false })
    this.child.stderr.pipe(this.logStream, { end: false })
    if (this.onChildMessage !== undefined) {
      this.child.on('message', (message) => {
        this.onChildMessage(message, (reply) => { this.child?.send(reply) })
      })
    }
    this.child.on('error', (error) => {
      this.logStream?.write(`spawn error: ${String(error)}\n`)
      this.onUnexpectedExit?.(undefined, String(error))
    })
    this.child.once('exit', (code, signal) => {
      this.logStream?.end()
      this.logStream = undefined
      if (!this.stopping) this.onUnexpectedExit?.(code, signal)
    })
  }

  /**
   * Poll the engine until it answers HTTP on loopback.
   * @param options.timeoutMs - maximum wait before rejecting.
   * @throws when the child exits or the timeout expires first.
   */
  async waitReady({ timeoutMs = READY_TIMEOUT_MS } = {}) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (!this.running) {
        throw new Error(`harness engine exited before becoming ready (log: ${this.logPath})`)
      }
      try {
        const response = await fetch(this.url, { signal: AbortSignal.timeout(2_000) })
        // Any HTTP answer means the webserver bound and serves; the dist
        // fallback answers even before the Loader settles, which is exactly
        // the readiness the window needs.
        if (response.status > 0) return
      } catch {
        // Not listening yet (or fetch raced the bind); keep polling.
      }
      if (Date.now() >= deadline) {
        throw new Error(`harness engine did not answer ${this.url} within ${String(timeoutMs)}ms (log: ${this.logPath})`)
      }
      await sleep(POLL_INTERVAL_MS)
    }
  }

  /**
   * Bounded shutdown: SIGTERM (a hard kill on Windows), a grace window, then
   * SIGKILL. The harness handles SIGTERM with its own 5s disposal budget, so
   * the grace is slightly larger.
   * @param options.graceMs - grace before escalation.
   */
  async stop({ graceMs = STOP_GRACE_MS } = {}) {
    if (this.child === undefined) return
    this.stopping = true
    const child = this.child
    this.child = undefined
    if (child.exitCode !== null) return
    const exited = new Promise((resolve) => { child.once('exit', resolve) })
    try {
      child.kill('SIGTERM')
    } catch {
      // Already gone between the exitCode read and the kill.
    }
    const graceful = await Promise.race([exited.then(() => true), sleep(graceMs).then(() => false)])
    if (!graceful && child.exitCode === null) {
      try {
        child.kill('SIGKILL')
      } catch {
        // Best effort; the exit event below still settles.
      }
      await exited
    }
  }

  /** Stop the current child (if any) and start a fresh one. */
  async restart() {
    await this.stop()
    this.start()
  }
}
