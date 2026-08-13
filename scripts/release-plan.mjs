#!/usr/bin/env node
/**
 * Release decision for the GitHub Actions release workflow.
 *
 * Reads the trigger context from environment variables (set by the workflow)
 * and the upstream check outputs, then decides one of:
 *
 * - `tag`      — a `desktop-v*` tag was pushed; build and release that version.
 * - `upstream` — a newer `@deepseek-ai/dsh` exists (or was forced); pin it,
 *                set the app version to `<upstream>.0`, refresh the lockfile.
 * - `patch`    — manual dispatch with nothing newer: desktop-only rebuild with
 *                an incremented patch segment.
 * - `none`     — nothing to do (e.g. a scheduled run with no upstream change).
 *
 * Emits `build`, `version`, `upstream`, and `bump` outputs. `bump=true` tells
 * the workflow to commit package.json/package-lock.json back to the branch.
 * @module release-plan
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import semver from 'semver'

const PACKAGE_PATH = new URL('../package.json', import.meta.url)
const DSH_PACKAGE = '@deepseek-ai/dsh'

const env = {
  event: process.env.EVENT ?? '',
  ref: process.env.REF ?? '',
  inputUpstream: (process.env.INPUT_UPSTREAM ?? '').trim(),
  update: process.env.UPDATE === 'true',
  latest: process.env.LATEST ?? '',
}

const pkg = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'))
const pinned = pkg.dependencies?.[DSH_PACKAGE] ?? ''

/** One decided action plus the values the workflow consumes. */
let mode = 'none'
let upstream = pinned

if (env.ref.startsWith('refs/tags/desktop-v')) {
  mode = 'tag'
} else if (env.event === 'schedule') {
  if (env.update) {
    mode = 'upstream'
    upstream = env.latest
  }
} else if (env.event === 'workflow_dispatch') {
  if (env.inputUpstream !== '') {
    if (!semver.valid(env.inputUpstream)) {
      console.error(`release-plan: invalid --upstream ${JSON.stringify(env.inputUpstream)} (not semver)`)
      process.exit(1)
    }
    mode = 'upstream'
    upstream = env.inputUpstream
  } else if (env.update) {
    mode = 'upstream'
    upstream = env.latest
  } else {
    mode = 'patch'
  }
} else if (env.event === 'repository_dispatch') {
  if (env.update) {
    mode = 'upstream'
    upstream = env.latest
  }
}

// npm's own progress/audit lines must never reach stdout: under GitHub
// Actions the workflow redirects stdout into $GITHUB_OUTPUT, which accepts
// only KEY=VALUE lines. Capture and drop them.
const quietNpmInstall = () => {
  execSync('npm install --package-lock-only --ignore-scripts --no-audit --no-fund', { stdio: ['ignore', 'pipe', 'pipe'] })
}

/**
 * Next patch — a desktop-only rebuild: `0.1.0-rc.6.0` -> `0.1.0-rc.6.1`.
 * @param version - current version.
 * @returns the bumped version.
 */
function bumpPatch(version) {
  const parts = version.split('.')
  parts[parts.length - 1] = String(Number.parseInt(parts[parts.length - 1] ?? '0', 10) + 1)
  return parts.join('.')
}

if (mode === 'upstream') {
  // Desktop versions mirror the embedded engine: upstream 0.1.0-rc.7 ->
  // desktop 0.1.0-rc.7.0.
  pkg.version = `${upstream}.0`
  pkg.dependencies[DSH_PACKAGE] = upstream
  writeFileSync(PACKAGE_PATH, `${JSON.stringify(pkg, null, 2)}\n`)
  quietNpmInstall()
} else if (mode === 'patch') {
  pkg.version = bumpPatch(pkg.version)
  writeFileSync(PACKAGE_PATH, `${JSON.stringify(pkg, null, 2)}\n`)
  quietNpmInstall()
}

const version = mode === 'tag' ? env.ref.replace(/^refs\/tags\/desktop-v/, '') : pkg.version
const build = mode === 'none' ? 'false' : 'true'
const bump = mode === 'upstream' || mode === 'patch' ? 'true' : 'false'

// Under GitHub Actions the workflow redirects stdout into $GITHUB_OUTPUT,
// where every line must be a bare KEY=VALUE pair — the summary goes to
// stderr, stdout carries only the machine lines.
const inActions = process.env.GITHUB_OUTPUT !== undefined && process.env.GITHUB_OUTPUT !== ''
if (inActions) {
  console.error(`mode=${mode} build=${build} version=${version} upstream=${upstream} bump=${bump}`)
  console.log(`build=${build}`)
  console.log(`version=${version}`)
  console.log(`upstream=${upstream}`)
  console.log(`bump=${bump}`)
} else {
  console.log(`mode=${mode} build=${build} version=${version} upstream=${upstream} bump=${bump}`)
}
