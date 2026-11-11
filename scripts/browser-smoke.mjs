import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

export async function browserSmoke(base, cookie, userId) {
  await mkdir('test-results', { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const errors = []
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await context.addInitScript(id => localStorage.setItem('fitsy:onboarding:' + id + ':v1', 'complete'), userId)
    await context.addCookies(cookie.split('; ').map(pair => {
      const index = pair.indexOf('=')
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base, httpOnly: true, sameSite: 'Lax' }
    }))
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base + '/phong-thu', { waitUntil: 'networkidle' })
    await page.locator('#root').waitFor({ state: 'visible' })
    await page.getByRole('main').first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByRole('heading', { name: 'Tạo ảnh thử đồ', exact: true }).waitFor()
    await page.screenshot({ path: 'test-results/prototype-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'test-results/prototype-mobile-web.png', fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false, 'Mobile viewport must not scroll horizontally.')
    assert.deepEqual(errors, [], 'The built prototype must not have browser runtime errors.')
    await context.close()
  } finally { await browser.close() }
}
