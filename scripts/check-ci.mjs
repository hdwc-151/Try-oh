import assert from 'node:assert/strict'
assert.equal(process.env.REF_NAME, 'refs/heads/main', 'Release the main branch only.')
const repo = process.env.REPOSITORY
const sha = process.env.DEPLOY_REVISION
assert(repo && /^[a-f0-9]{40}$/i.test(sha ?? ''), 'Repository and revision are required.')
const headers = { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + process.env.GH_TOKEN }
const get = async path => {
  const response = await fetch('https://api.github.com/repos/' + repo + path, { headers, signal: AbortSignal.timeout(20_000) })
  assert(response.ok, 'Could not verify repository CI state.')
  return response.json()
}
const branch = await get('/branches/main')
assert.equal(branch.commit.sha, sha, 'This release is superseded. Wait for CI on the current main commit.')
const runs = await get('/actions/workflows/ci.yml/runs?head_sha=' + sha + '&event=push&per_page=20')
assert(runs.workflow_runs.some(run => run.head_sha === sha && run.head_branch === 'main' && run.conclusion === 'success'), 'A successful CI run is required for this exact revision.')
console.info('Verified successful CI for the current main commit.')
