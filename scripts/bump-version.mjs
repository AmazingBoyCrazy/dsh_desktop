#!/usr/bin/env node
/**
 * Edit package.json for a release:
 *
 * - `--upstream <version>`: pin `@deepseek-ai/dsh` to that exact version and
 *   set the app version to `<version>.0` (upstream-tracked releases restart
 *   the desktop patch counter).
 * - `--patch`: desktop-only rebuild; increments the last numeric segment of
 *   the current app version, leaving the upstream pin untouched.
 *
 * The lockfile is refreshed by the caller (`npm install --package-lock-only`),
 * not here, so this script stays dependency-light and idempotent.
 * @module bump-version
 */

import { readFileSync, writeFileSync } from 'node:fs'
import semver from 'semver'

const PACKAGE_PATH = new URL('../package.json', import.meta.url)
const DSH_PACKAGE = '@deepseek-ai/dsh'

/** Parse the CLI flags this script accepts. @returns the resolved mode. */
function parseArgs(argv) {
  const upstreamIndex = argv.indexOf('--upstream')
  const upstream = upstreamIndex >= 0 ? argv[upstreamIndex + 1] : ''
  return {
    mode: argv.includes('--patch') ? 'patch' : 'upstream',
    upstream,
  }
}

/**
 * Increment the last numeric segment of a version string, e.g.
 * `0.1.0-rc.6.2` -> `0.1.0-rc.6.3`.
 * @param version - current version.
 * @returns the bumped version.
 */
function bumpPatch(version) {
  const parts = version.split('.')
  const last = parts.length - 1
  const next = Number.parseInt(parts[last] ?? '0', 10) + 1
  parts[last] = String(next)
  return parts.join('.')
}

const args = parseArgs(process.argv.slice(2))
const pkg = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'))
const oldVersion = pkg.version

if (args.mode === 'patch') {
  pkg.version = bumpPatch(oldVersion)
} else {
  if (!semver.valid(args.upstream)) {
    console.error(`bump-version: --upstream requires a valid semver, got ${JSON.stringify(args.upstream)}`)
    process.exit(1)
  }
  pkg.version = `${args.upstream}.0`
  pkg.dependencies[DSH_PACKAGE] = args.upstream
}

writeFileSync(PACKAGE_PATH, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`version: ${oldVersion} -> ${pkg.version}`)
console.log(`@deepseek-ai/dsh pin: ${pkg.dependencies[DSH_PACKAGE]}`)
