import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const [reportPath, exitCode, ...exports] = process.argv.slice(2)
const report = JSON.parse(readFileSync(reportPath, 'utf8'))
assert(['0', '1'].includes(exitCode) && report.vulnerabilities && !report.error, 'npm audit did not return a report.')

const issues = Object.values(report.vulnerabilities)
for (const { name, severity } of issues) console.info(name, severity)
const severe = issues.filter(({ severity }) => severity === 'critical' || severity === 'high')
if (!severe.length) {
  assert.equal(exitCode, '0', 'Unexpected npm audit status.')
  process.exit(0)
}

// Expo and Metro include this advisory in npm's production graph. Keep auditing
// their graph and verify that the flagged package stays out of the native bundles.
const advisory = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf'
const causes = (name, seen = new Set()) => {
  if (seen.has(name)) return []
  seen.add(name)
  const issue = report.vulnerabilities[name]
  assert(issue?.via.length, 'Cannot trace the audit advisory for ' + name)
  return issue.via.flatMap(via => typeof via === 'string' ? causes(via, seen) : [via])
}
const blocked = severe.filter(issue => {
  const securityAdvisories = causes(issue.name).filter(({ severity }) => severity === 'critical' || severity === 'high')
  return issue.severity === 'critical' || !securityAdvisories.length || securityAdvisories.some(
    ({ name, dependency, url, severity }) => (name ?? dependency) !== 'picomatch' || url !== advisory || severity !== 'high',
  )
})
assert.equal(blocked.length, 0, 'Unresolved high or critical npm advisories for ' + blocked.map(issue => issue.name).join(', '))

assert.equal(exports.length, 2, 'Check both native platforms.')
const sources = map => Array.isArray(map.sources) ? map.sources : (map.sections ?? []).flatMap(section => sources(section.map))
for (const dir of exports) {
  const maps = readdirSync(dir, { recursive: true }).filter(path => /\.(?:js|hbc)\.map$/.test(path))
  assert(maps.length, 'Expo did not export bundle source maps for ' + dir)
  for (const path of maps) {
    const files = sources(JSON.parse(readFileSync(join(dir, path), 'utf8')))
    assert(files.length > 0, 'Bundle source map is empty for ' + path)
    assert(!files.some(file => /(?:^|\/)picomatch\//.test(file.replaceAll('\\', '/'))), 'Picomatch is present in ' + path)
  }
}
console.warn('Picomatch advisory is still open for Expo build tooling. Both native bundles passed the dependency check.')
console.warn(advisory)
