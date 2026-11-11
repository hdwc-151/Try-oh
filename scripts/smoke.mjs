// Exercises a built server using isolated SQLite, fake images and the mock AI.
// It never calls an external AI provider or touches a configured production DB.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'

const socket = createServer()
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
const directory = await mkdtemp(path.join(tmpdir(), 'tryoh-smoke-'))
const base = 'http://127.0.0.1:' + port
const child = spawn(process.execPath, ['dist-server/index.js'], {
  env: { ...process.env, NODE_ENV: 'production', ALLOW_LOCAL_BACKENDS: 'true', HOST: '127.0.0.1', PORT: String(port), APP_BASE_URL: base, DATA_DIR: directory, PERSISTENCE_BACKEND: 'sqlite', AUTH_BACKEND: 'local', IMAGE_STORAGE: 'local', IMAGE_PROVIDER: 'mock', MOCK_DELAY_MS: '0', COOKIE_SECURE: 'false', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', PAYOS_API_KEY: '', MOMO_SECRET_KEY: '', AI_DAILY_REQUEST_LIMIT: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', chunk => { output += chunk })
child.stderr.on('data', chunk => { output += chunk })
let cookie = ''
const request = (url, init = {}) => fetch(base + url, {
  ...init,
  headers: { Cookie: cookie, 'X-Fitting-Room-Request': '1', ...init.headers },
  signal: AbortSignal.timeout(20_000),
})
try {
  let healthy = false
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Server exited: ' + output)
    try { healthy = (await request('/api/health')).ok } catch {}
    if (healthy) break
    await delay(100)
  }
  assert(healthy, 'Built server must become healthy: ' + output)
  const html = await request('/')
  assert.equal(html.status, 200)
  assert.match(await html.text(), /<div id="root"><\/div>/)
  const register = await request('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'smoke@example.com', displayName: 'Smoke test', password: 'smoke-password-123' }),
  })
  const registered = await register.json()
  assert.equal(register.status, 201, JSON.stringify(registered))
  cookie = register.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const png = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#336699' } }).png().toBuffer()
  const photo = () => new Blob([png], { type: 'image/png' })
  const person = new FormData()
  person.set('personImage', photo(), 'person.png')
  const uploadedPerson = await request('/api/person-image', { method: 'POST', body: person })
  assert.equal(uploadedPerson.status, 201, await uploadedPerson.text())
  const garment = new FormData()
  garment.set('name', 'Smoke shirt')
  garment.set('category', 'tops')
  garment.set('frontOriginal', photo(), 'shirt.png')
  garment.set('frontProcessed', photo(), 'shirt-processed.png')
  const uploadedGarment = await request('/api/garments', { method: 'POST', body: garment })
  assert.equal(uploadedGarment.status, 201)
  const garmentData = await uploadedGarment.json()
  const key = randomUUID()
  const generate = () => request('/api/generations/angles/front', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ garmentIds: [garmentData.id], privacyConfirmed: true }),
  })
  const creditsBefore = await (await request('/api/generations/credits')).json()
  const first = await generate()
  assert.equal(first.status, 200)
  const firstBody = await first.json()
  const replay = await generate()
  assert.equal(replay.headers.get('Idempotency-Replayed'), 'true')
  assert.deepEqual(await replay.json(), firstBody)
  const creditsAfter = await (await request('/api/generations/credits')).json()
  assert.equal(creditsAfter.remaining, creditsBefore.remaining - 1)
  const outfits = await (await request('/api/generations/outfits')).json()
  assert.equal(outfits.items.length, 1)
  assert.equal((await request(firstBody.imageUrl)).status, 200)
  if (process.argv.includes('--browser')) {
    const { browserSmoke } = await import('./browser-smoke.mjs')
    await browserSmoke(base, cookie, registered.user.id)
  }
  const removed = await request('/api/auth/account', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'DELETE' }) })
  assert.equal(removed.status, 204, await removed.text())
  assert.equal((await request('/api/generations/outfits')).status, 401)
  console.info('Smoke passed: built UI, auth, uploads, mock try-on, one credit for a replayed request, outfit history and account deletion.')
} catch (error) {
  console.error(output)
  throw error
} finally {
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGTERM')
  await Promise.race([exited, delay(5000, undefined, { ref: false })])
  if (child.exitCode === null) { child.kill('SIGKILL'); await exited }
  await rm(directory, { recursive: true, force: true })
}
