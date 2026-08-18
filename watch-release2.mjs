import { writeFileSync } from 'node:fs'
const tok = process.argv[2]
const sha = '0e79f4b'
const h = { headers: { authorization: `Bearer ${tok}`, 'user-agent': 'dsh-rel-watch' } }
const base = 'https://api.github.com/repos/AmazingBoyCrazy/dsh_desktop'
const deadline = Date.now() + 75 * 60 * 1000
while (Date.now() < deadline) {
  const runs = await (await fetch(`${base}/actions/runs?per_page=8`, h)).json()
  const run = (runs.workflow_runs ?? []).find((r) => r.head_sha.startsWith(sha) && r.name === 'Release')
  if (run && run.status === 'completed') {
    console.log('RELEASE:', run.conclusion, '|', run.html_url)
    if (run.conclusion !== 'success') process.exit(1)
    const releases = await (await fetch(`${base}/releases?per_page=1`, h)).json()
    const rel = releases[0]
    console.log('RELEASE TAG:', rel.tag_name)
    for (const a of rel.assets ?? []) console.log('asset:', a.name)
    const body = [
      '**Embedded engine:** [@deepseek-ai/dsh v0.1.0-rc.6](https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.1.0-rc.6)',
      '',
      '## What\u2019s included',
      '',
      '- **Bundled plugins** (MIT, mounted on first boot):',
      '  - `dsh-better-sidebar` — right sidebar + bottom panel workbench (resources / editor / terminal / Git / browser)',
      '  - `dsh-skill-viewer` — skill management (cards / enable-disable / add / remove / group)',
      '  - `dshmarket` — visual plugin marketplace (browse / one-click install / backup / update)',
      '- **Windows console fix** — hidden-console scheme (engine + sandbox runner share one hidden console): no terminal windows flash on command execution, including sandboxed commands',
      '- **Windows sandbox fix** — engine TMP/TEMP redirected outside the workspace so ACL-sandboxed commands run',
      '- **Auto-update fix** — update metadata now matches published artifacts (was 404)',
      '- **Windows CI** — engine smoke, real Electron smoke, console-patch probe, runner-injection shape tests',
      '',
      '## Notes',
      '',
      '- Unsigned builds: SmartScreen → *More info → Run anyway*; macOS first launch → right-click *Open*.',
      '- Data lives in `~/.dsh` (shared with the CLI / web GUI). Run only one engine at a time.',
      '',
      'Upstream project: https://github.com/deepseek-ai/deepseek-harness',
    ].join('\n')
    const p = await fetch(`${base}/releases/${rel.id}`, {
      method: 'PATCH',
      headers: { ...h, 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    console.log('release body patched:', p.status)
    process.exit(0)
  }
  console.log('waiting...', run ? run.status : 'not found')
  await new Promise((r) => setTimeout(r, 45000))
}
console.log('TIMEOUT')
process.exit(2)
