// Kịch bản đo tải Fitsy (k6). Mỗi người dùng ảo là một tài khoản riêng, có IP riêng (X-Forwarded-For).
//   k6 run -e BASE_URL=http://127.0.0.1:8850 -e USERS_FILE=/tmp/fitsy-load/users.json scripts/loadtest/k6-fitsy.js
// Biến: PEAK (số người duyệt app lúc đỉnh, mặc định 100), THUMBS=0 để tải ảnh gốc thay vì ảnh thu nhỏ,
// SAMPLE_DIR (ảnh mẫu để thử tải món đồ lên).
import http from 'k6/http'
import { check, group, sleep } from 'k6'
import { SharedArray } from 'k6/data'
import { Counter, Rate, Trend } from 'k6/metrics'

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8850'
const PEAK = Number(__ENV.PEAK || 100)
const THUMBS = __ENV.THUMBS !== '0'
const users = new SharedArray('users', () => JSON.parse(open(__ENV.USERS_FILE || '/tmp/fitsy-load/users.json')))
const sampleDir = __ENV.SAMPLE_DIR || '/tmp/fitsy-load'
const sampleOriginal = open(`${sampleDir}/sample-original.jpg`, 'b')
const sampleProcessed = open(`${sampleDir}/sample-processed.png`, 'b')

const openApp = new Trend('fitsy_open_app_ms', true)
const imageGrid = new Trend('fitsy_image_grid_ms', true)
const generation = new Trend('fitsy_generation_ms', true)
const upload = new Trend('fitsy_upload_ms', true)
const queueBusy = new Counter('fitsy_ai_queue_busy')
const failed = new Rate('fitsy_failed_requests')

const at = (fraction) => Math.max(1, Math.round(PEAK * fraction))
// Đông dần: 50 người trong 3 phút, rồi 100 người trong 3 phút.
// TIME_SCALE=0.1 rút ngắn còn ~1 phút để chạy thử nhanh.
const TIME_SCALE = Number(__ENV.TIME_SCALE || 1)
const seconds = (value) => `${Math.max(5, Math.round(value * TIME_SCALE))}s`
const ramp = (scale) => [
  { duration: seconds(60), target: at(0.5 * scale) },
  { duration: seconds(180), target: at(0.5 * scale) },
  { duration: seconds(60), target: at(1 * scale) },
  { duration: seconds(180), target: at(1 * scale) },
  { duration: seconds(30), target: 0 },
]

export const options = {
  scenarios: {
    browse: { executor: 'ramping-vus', exec: 'browse', stages: ramp(1), gracefulRampDown: '30s' },
    generate: { executor: 'ramping-vus', exec: 'generate', stages: ramp(0.2), gracefulRampDown: '150s' },
    upload: { executor: 'ramping-vus', exec: 'uploadGarment', stages: ramp(0.05), gracefulRampDown: '60s' },
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

// Mỗi kịch bản dùng một dải tài khoản riêng để không trùng người.
const offsets = { browse: 0, generate: Math.round(PEAK * 1.0), upload: Math.round(PEAK * 1.2) }
const identity = (scenario) => {
  const index = (offsets[scenario] + __VU) % users.length
  return {
    id: users[index],
    headers: {
      Authorization: `Bearer ${users[index]}`,
      'X-Forwarded-For': `10.${(index >> 8) & 255}.${index & 255}.${(__VU % 200) + 10}`,
      'Accept-Encoding': 'br, gzip',
    },
  }
}
const record = (response) => failed.add(response.status >= 400 || response.status === 0)
const sized = (url) => (THUMBS ? `${url}?w=320` : url)

export function browse() {
  const { headers } = identity('browse')
  let garments = []
  group('open_app', () => {
    const started = Date.now()
    const responses = http.batch([
      ['GET', `${BASE}/api/plans`, null, { headers, tags: { name: 'plans' } }],
      ['GET', `${BASE}/api/generations/credits`, null, { headers, tags: { name: 'credits' } }],
      ['GET', `${BASE}/api/garments?limit=40&offset=0`, null, { headers, tags: { name: 'garments' } }],
      ['GET', `${BASE}/api/generations/results`, null, { headers, tags: { name: 'results' } }],
      ['GET', `${BASE}/api/person-image`, null, { headers, tags: { name: 'person' } }],
      ['GET', `${BASE}/api/social`, null, { headers, tags: { name: 'social' } }],
      ['GET', `${BASE}/api/live-preview/status`, null, { headers, tags: { name: 'live-preview' } }],
    ])
    responses.forEach(record)
    openApp.add(Date.now() - started)
    check(responses[2], { 'garments 200': (r) => r.status === 200 })
    if (responses[2].status === 200) garments = responses[2].json('items') || []
  })
  sleep(1 + Math.random())
  group('wardrobe_grid', () => {
    const started = Date.now()
    const responses = http.batch(garments.slice(0, 20).map((item) => ['GET', `${BASE}${sized(item.frontProcessedUrl)}`, null, { headers, tags: { name: 'garment-image' }, redirects: 0 }]))
    responses.forEach(record)
    imageGrid.add(Date.now() - started)
  })
  sleep(3 + Math.random() * 4)
  group('outfits', () => {
    const list = http.get(`${BASE}/api/generations/outfits?limit=20&offset=0`, { headers, tags: { name: 'outfits' } })
    record(list)
    const items = list.status === 200 ? list.json('items') || [] : []
    http.batch(items.slice(0, 5).map((item) => ['GET', `${BASE}${sized(item.frontImageUrl)}`, null, { headers, tags: { name: 'outfit-image' } }])).forEach(record)
  })
  sleep(5 + Math.random() * 5)
}

export function generate() {
  const { headers } = identity('generate')
  const list = http.get(`${BASE}/api/garments?limit=40&offset=0`, { headers, tags: { name: 'garments' } })
  const items = list.status === 200 ? list.json('items') || [] : []
  const pick = items.sort(() => Math.random() - 0.5).slice(0, 3).map((item) => item.id)
  const started = Date.now()
  const response = http.post(`${BASE}/api/generations/angles/front`, JSON.stringify({ garmentIds: pick, privacyConfirmed: true, preservePose: true }), {
    headers: { ...headers, 'Content-Type': 'application/json', 'X-Fitting-Room-Request': '1' },
    tags: { name: 'generate' },
    timeout: '150s',
  })
  if (response.status === 503) queueBusy.add(1)
  else record(response)
  if (response.status === 200) generation.add(Date.now() - started)
  check(response, { 'generation 200': (r) => r.status === 200 })
  sleep(15 + Math.random() * 15)
}

export function uploadGarment() {
  const { headers } = identity('upload')
  const started = Date.now()
  const response = http.post(`${BASE}/api/garments`, {
    name: 'Áo thử tải',
    category: 'tops',
    frontOriginal: http.file(sampleOriginal, 'original.jpg', 'image/jpeg'),
    frontProcessed: http.file(sampleProcessed, 'processed.png', 'image/png'),
  }, { headers: { ...headers, 'X-Fitting-Room-Request': '1' }, tags: { name: 'upload' }, timeout: '120s' })
  record(response)
  upload.add(Date.now() - started)
  check(response, { 'upload 201': (r) => r.status === 201 || r.status === 200 })
  if (response.status === 201 || response.status === 200) {
    const id = response.json('id') || response.json('item.id')
    if (id) http.del(`${BASE}/api/garments/${id}`, null, { headers: { ...headers, 'X-Fitting-Room-Request': '1' }, tags: { name: 'delete' } })
  }
  sleep(20 + Math.random() * 20)
}

export function handleSummary(data) {
  const out = __ENV.SUMMARY_FILE || '/tmp/fitsy-load/summary.json'
  return { [out]: JSON.stringify(data, null, 2), stdout: '' }
}
