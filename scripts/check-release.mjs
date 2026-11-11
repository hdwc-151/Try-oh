import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const required = (name, test = value => value.length > 0) => {
  const value = process.env[name]?.trim() ?? ''
  assert(test(value) && !/your[_-]|placeholder|example\.|_xxx/i.test(value), 'Configure ' + name + ' for your own project.')
  return value
}
const https = value => { try { return new URL(value).protocol === 'https:' } catch { return false } }
const app = JSON.parse(readFileSync('mobile/app.json', 'utf8')).expo
assert(!app.owner && !app.extra?.eas?.projectId, 'Static app config must not point to the upstream Expo account.')
assert.equal(app.ios.bundleIdentifier, 'com.hdwc151.tryoh')
assert.equal(app.android.package, 'com.hdwc151.tryoh')
required('EXPO_PROJECT_ID', value => /^[a-f0-9-]{36}$/i.test(value))
required('EXPO_PUBLIC_API_URL', https)
required('EXPO_PUBLIC_SUPABASE_URL', https)
required('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', value => value.startsWith('sb_publishable_') && value.length > 30)
assert.equal(process.env.EXPO_PUBLIC_BILLING_MODE ?? 'store', 'store', 'Store builds must use store billing mode.')
console.info('Release configuration passed; no secret values were printed.')
