import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const profile = process.env.BUILD_PROFILE
const platform = process.env.BUILD_PLATFORM
assert(['preview', 'production', 'simulator'].includes(profile), 'Unknown build profile.')
assert(['ios', 'android', 'all'].includes(platform), 'Unknown build platform.')
assert(profile !== 'simulator' || platform === 'ios', 'Simulator builds require platform=ios.')
const submit = process.env.SUBMIT_BUILD === 'true'
assert(!submit || profile === 'production', 'Only production builds can be submitted.')
if (submit && platform !== 'android') assert(/^\d+$/.test(process.env.ASC_APP_ID ?? ''), 'Configure ASC_APP_ID before iOS submission.')
const eas = JSON.parse(readFileSync('mobile/eas.json', 'utf8'))
const names = ['EXPO_PROJECT_ID', 'EXPO_ACCOUNT_OWNER', 'EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_WEB_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'EXPO_PUBLIC_BILLING_MODE']
// Only these PUBLIC values go into the cloud build. Never forward process.env.
eas.build[profile].env = Object.fromEntries(names.filter(name => process.env[name]).map(name => [name, process.env[name]]))
if (submit && platform !== 'android') eas.submit.production.ios.ascAppId = process.env.ASC_APP_ID
writeFileSync('mobile/eas.json', JSON.stringify(eas, null, 2) + '\n')
console.info('Prepared public build configuration; credentials remain in EAS.')
