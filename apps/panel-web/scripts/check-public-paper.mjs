import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium, devices } from 'playwright'
import { createReviewServer } from './serve-paper-review.mjs'

const [dist, publicPages, output] = process.argv.slice(2)
if (!dist || !publicPages || !output) throw Error('Usage: node scripts/check-public-paper.mjs DIST PUBLIC_PAGES OUTPUT')
mkdirSync(output, { recursive: true })
const frames = [
  ['active', '1PVH-0', 390, 1186], ['active', '1PZF-0', 1440, 595],
  ['expired', '1Q3Z-0', 390, 844], ['expired', '1Q40-0', 1440, 900],
  ['limited', '1Q60-0', 390, 844], ['limited', '1QA0-0', 1440, 900],
  ['disabled', '1Q70-0', 390, 844], ['disabled', '1QB0-0', 1440, 900],
  ['revoked', '1Q80-0', 390, 844], ['revoked', '1QC0-0', 1440, 900],
]
const server = createReviewServer(resolve(dist), resolve(publicPages))
await new Promise((ready) => server.listen(0, '127.0.0.1', ready))
const origin = 'http://127.0.0.1:' + server.address().port
const report = []
let browser
try {
  browser = await chromium.launch({ args: ['--disable-gpu', '--force-color-profile=srgb'] })
  for (const [state, id, width, height] of frames) {
    const page = await browser.newPage({
      ...(width === 390 ? devices['iPhone 13'] : {}), viewport: { width, height }, deviceScaleFactor: 1,
      locale: 'ru-RU', timezoneId: 'Europe/Moscow', reducedMotion: 'reduce',
    })
    const entry = { id, width, height, state, errors: [] }
    report.push(entry)
    try {
      page.on('pageerror', (error) => entry.errors.push(error.message))
      await page.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
      await page.clock.setFixedTime(new Date('2026-11-05T12:00:00Z'))
      const response = await page.goto(origin + '/sub/review-' + state, { waitUntil: 'networkidle' })
      entry.status = response.status()
      assert.equal(entry.status, state === 'active' ? 200 : 403)
      await page.getByText('alex-hm', { exact: true }).first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      entry.documentHeight = await page.evaluate(() => document.documentElement.scrollHeight)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width)
      await page.screenshot({ path: join(output, id + '.png'), animations: 'disabled', caret: 'hide' })
      if (state === 'active') {
        await page.screenshot({ path: join(output, id + '-full.png'), fullPage: true, animations: 'disabled' })
        const toggle = page.locator('[data-platform-name]').first()
        await toggle.click()
        await page.locator('[data-platform-picker] [data-pick="android"]:visible').first().click()
        entry.platform = await toggle.innerText()
        assert.match(entry.platform, /android/i)
      } else {
        entry.card = await page.locator('.stopped-sub-card').boundingBox()
        assert.equal(entry.card.width, width === 390 ? 358 : 560)
        assert.equal(entry.card.y, width === 390 ? 56 : 88)
        assert.equal(await page.locator('input#url').count(), state === 'revoked' ? 0 : 1)
        if (state !== 'revoked') {
          await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
          await page.getByRole('button', { name: 'Копировать ссылку' }).click()
          assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await page.locator('#url').inputValue())
          entry.copy = true
        }
        await page.locator('summary').focus()
        await page.keyboard.press('Enter')
        await page.getByRole('link', { name: 'English' }).click()
        assert.equal(await page.locator('html').getAttribute('lang'), 'en')
        assert.ok(await page.locator('.support').isVisible())
        entry.language = 'en'
      }
      assert.deepEqual(entry.errors, [])
    } finally {
      await page.close()
    }
  }
  console.log(report.length + ' public frames passed')
} finally {
  writeFileSync(join(output, 'public.json'), JSON.stringify(report, null, 2))
  await browser?.close()
  server.close()
}
