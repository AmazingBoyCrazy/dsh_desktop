// Watch the rc.7.1 release run to completion and list assets.
const tok = process.argv[2]
const sha = '238dd3f'
const h = { headers: { authorization: `Bearer ${tok}`, 'user-agent': 'dsh-rel-watch' } }
const base = 'https://api.github.com/repos/AmazingBoyCrazy/dsh_desktop'
const deadline = Date.now() + 75 * 60 * 1000
while (Date.now() < deadline) {
  const runs = await (await fetch(`${base}/actions/runs?per_page=8`, h)).json()
  const run = (runs.workflow_runs ?? []).find((r) => r.head_sha.startsWith(sha) && r.name === 'Release')
  if (run && run.status === 'completed') {
    console.log('RELEASE:', run.conclusion, '|', run.html_url)
    if (run.conclusion !== 'success') process.exit(1)
    const jobs = await (await fetch(run.jobs_url, h)).json()
    for (const j of jobs.jobs ?? []) console.log('job:', j.name, '->', j.conclusion)
    const releases = await (await fetch(`${base}/releases?per_page=1`, h)).json()
    if (releases[0]) {
      console.log('RELEASE TAG:', releases[0].tag_name)
      for (const a of releases[0].assets ?? []) console.log('asset:', a.name)
    }
    process.exit(0)
  }
  console.log('waiting...', run ? run.status : 'not found')
  await new Promise((r) => setTimeout(r, 45000))
}
console.log('TIMEOUT')
process.exit(2)
