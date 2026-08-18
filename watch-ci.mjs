// Watch the CI run for the latest main commit and report per-job conclusions.
const tok = process.argv[2]
const sha = process.argv[3] ?? ''
const h = { headers: { authorization: `Bearer ${tok}`, 'user-agent': 'dsh-ci-watch' } }
const base = 'https://api.github.com/repos/AmazingBoyCrazy/dsh_desktop'
const deadline = Date.now() + 30 * 60 * 1000
while (Date.now() < deadline) {
  const runs = await (await fetch(`${base}/actions/runs?per_page=5`, h)).json()
  const run = (runs.workflow_runs ?? []).find((r) => r.name === 'CI' && (sha === '' || r.head_sha.startsWith(sha)))
  if (run && run.status === 'completed') {
    console.log('CI:', run.conclusion, '|', run.head_sha.slice(0, 7), '|', run.html_url)
    const jobs = await (await fetch(run.jobs_url, h)).json()
    for (const j of jobs.jobs ?? []) console.log('job:', j.name, '->', j.conclusion)
    process.exit(run.conclusion === 'success' ? 0 : 1)
  }
  console.log('waiting...', run ? run.status : 'not found')
  await new Promise((r) => setTimeout(r, 30000))
}
console.log('TIMEOUT')
process.exit(2)
