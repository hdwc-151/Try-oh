import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

const revision = process.env.DEPLOY_REVISION
assert(/^[a-f0-9]{40}$/i.test(revision ?? ''), 'DEPLOY_REVISION must be a full commit SHA.')
const hook = new URL(process.env.RENDER_DEPLOY_HOOK_URL ?? '')
const base = new URL(process.env.PRODUCTION_URL ?? '')
assert(hook.protocol === 'https:' && hook.hostname === 'api.render.com', 'Use your Render HTTPS deploy hook.')
assert(base.protocol === 'https:', 'Production URL must use HTTPS.')
hook.searchParams.set('ref', revision)

// Do not print the hook, its response body or an exception containing its key.
let trigger
try { trigger = await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(30_000) }) }
catch { throw new Error('Could not reach Render. The secret hook was not logged.') }
assert(trigger.ok, 'Render rejected the deployment (HTTP ' + trigger.status + ').')
console.info('Render accepted deployment for ' + revision)
const health = new URL('/api/health', base)
let deployed = false
for (let attempt = 0; attempt < 150; attempt += 1) {
  await delay(4000)
  try {
    const response = await fetch(health, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    const state = await response.json()
    if (response.ok && state.ready === true && state.revision === revision) {
      deployed = true
      break
    }
  } catch { /* platform still building or starting */ }
}
assert(deployed, 'Deployment did not become healthy at the expected revision. Inspect Render logs; do not report it as published.')
console.info('Verified healthy production revision ' + revision)
