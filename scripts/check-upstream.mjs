#!/usr/bin/env node
/**
 * Compare the pinned `@deepseek-ai/dsh` version in package.json against the
 * npm registry, and report the upstream GitHub release tag for release notes.
 *
 * The npm dist-tag is authoritative: the desktop app embeds the npm package,
 * so a new npm publish is exactly what a new desktop build must track. GitHub
 * release info is informational only (the registry can answer while GitHub is
 * rate-limited, and vice versa).
 *
 * Prints a human summary and, when `$GITHUB_OUTPUT` is set (GitHub Actions),
 * appends `KEY=value` outputs: `update`, `pinned`, `latest`, `githubTag`,
 * `githubUrl`. Always exits 0 — "no update" is a normal outcome, not a
 * failure.
 * @module check-upstream
 */

import { readFileSync } from 'node:fs'
import semver from 'semver'

const REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2fdsh'
const GITHUB_RELEASES_URL = 'https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/latest'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const pinned = pkg.dependencies?.['@deepseek-ai/dsh'] ?? ''

/**
 * GET a JSON document with a hard timeout.
 * @param url - endpoint.
 * @param headers - extra request headers.
 * @returns the parsed body.
 */
async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`GET ${url} -> HTTP ${String(response.status)}`)
  return response.json()
}

/** Main entry; wraps the logic so failures still produce a readable report. */
async function main() {
  let latest = ''
  let githubTag = ''
  let githubUrl = ''
  try {
    const registry = await fetchJson(REGISTRY_URL, { accept: 'application/json' })
    if (typeof registry['dist-tags']?.latest === 'string') latest = registry['dist-tags'].latest
  } catch (error) {
    console.warn(`registry check failed: ${String(error)}`)
  }
  try {
    const release = await fetchJson(GITHUB_RELEASES_URL, { 'user-agent': 'deepseek-harness-desktop' })
    if (typeof release.tag_name === 'string') githubTag = release.tag_name
    if (typeof release.html_url === 'string') githubUrl = release.html_url
  } catch (error) {
    // 404 means the upstream repo has no GitHub Releases yet (npm is the
    // authoritative channel); any other failure is worth a note.
    if (!String(error).includes('404')) console.warn(`github releases check failed: ${String(error)}`)
  }

  const comparable = (value) => (semver.valid(value) !== null ? value : '')
  const update = Boolean(comparable(latest) && comparable(pinned) && semver.gt(comparable(latest), comparable(pinned)))

  // Under GitHub Actions the workflow redirects stdout into $GITHUB_OUTPUT,
  // where every line must be a bare KEY=VALUE pair — so the human summary
  // moves to stderr and stdout carries only the machine lines.
  const inActions = process.env.GITHUB_OUTPUT !== undefined && process.env.GITHUB_OUTPUT !== ''
  const say = inActions ? console.error : console.log
  say(`pinned @deepseek-ai/dsh : ${pinned || '(missing)'}`)
  say(`npm dist-tag latest    : ${latest || '(unknown)'}`)
  say(`upstream GitHub tag    : ${githubTag || '(unknown)'} ${githubUrl}`)
  say(`update needed          : ${update ? 'yes' : 'no'}`)

  if (inActions) {
    console.log(`update=${update ? 'true' : 'false'}`)
    console.log(`pinned=${pinned}`)
    console.log(`latest=${latest}`)
    console.log(`githubTag=${githubTag}`)
    console.log(`githubUrl=${githubUrl}`)
  }
}

await main()
