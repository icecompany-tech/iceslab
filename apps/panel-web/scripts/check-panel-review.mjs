import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { createReviewServer } from './serve-paper-review.mjs'
import { checkUserActions } from './fixtures/check-user-actions.mjs'
import { clock } from './fixtures/users-paper.mjs'

const [dist, output, mode = 'all'] = process.argv.slice(2)
if (!dist || !output) throw Error('Usage: node scripts/check-panel-review.mjs DIST OUTPUT [wide]')
mkdirSync(output, { recursive: true })
const pages = ['/login', '/', '/users', '/squads', '/profiles', '/hosts', '/nodes', '/cascades', '/subscription/params', '/subscription/delivery', '/subscription/templates', '/routes', '/outbounds', '/geo', '/devices', '/requests', '/audit', '/settings', '/account']
const registries = { '/routes': '[class*="panes"]', '/outbounds': 'table', '/geo': 'table', '/subscription/delivery': 'table' }
const server = createReviewServer(resolve(dist))
await new Promise((ready) => server.listen(0, '127.0.0.1', ready))
const origin = 'http://127.0.0.1:' + server.address().port
async function checkSidebarScroll(page) {
  const nav = page.getByRole('navigation')
  const account = nav.locator('a[href="/account"]')
  const before = await account.boundingBox()
  const closed = nav.getByRole('button', { expanded: false })
  while (await closed.count()) await closed.last().click()

  const first = nav.locator('a[href="/"]')
  const last = nav.locator('a[href="/settings"]')
  const inView = (el) => {
    const { x, y, width, height } = el.getBoundingClientRect()
    return el.contains(document.elementFromPoint(x + width / 2, y + height / 2))
  }
  await first.focus()
  await first.hover()
  assert.equal(await last.evaluate(inView), false)
  const main = page.getByRole('main')
  const mainTop = await main.evaluate((el) => el.scrollTop)
  await page.mouse.wheel(0, 2 * page.viewportSize().height)
  await page.waitForFunction(inView, await last.elementHandle())
  assert.deepEqual(await account.boundingBox(), before)
  assert.equal(await account.evaluate(inView), true)
  assert.equal(await main.evaluate((el) => el.scrollTop), mainTop)

  await first.focus()
  const tabStops = await nav.locator('a, button').count()
  for (let n = 0; n < tabStops && !(await last.evaluate((el) => el === document.activeElement)); n++) {
    await page.keyboard.press('Tab')
  }
  assert.equal(await last.evaluate((el) => el === document.activeElement), true)
  assert.equal(await last.evaluate(inView), true)
  await page.keyboard.press('Enter')
  await page.waitForURL('**/settings')
}

const results = []
let browser
try {
  browser = await chromium.launch({ args: ['--disable-gpu', '--force-color-profile=srgb'] })
  for (const [width, height] of [[1440, 900], [1920, 945]]) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'ru-RU', timezoneId: 'Europe/Moscow', reducedMotion: 'reduce', deviceScaleFactor: 1 })
    try {
      await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
      for (const path of mode === 'wide' ? Object.keys(registries) : pages) {
        const page = await context.newPage()
        page.setDefaultTimeout(6500)
        const item = { path, width, height, errors: [], failed: [] }
        results.push(item)
        page.on('pageerror', (err) => item.errors.push(err.message))
        page.on('response', (response) => {
          if (response.status() >= 400) item.failed.push(response.status() + ' ' + new URL(response.url()).pathname)
        })
        try {
          await page.clock.setFixedTime(clock)
          await page.goto(origin + path, { waitUntil: 'networkidle' })
          const area = path === '/login' ? page.locator('body') : page.locator('main')
          await area.waitFor()
          await page.evaluate(() => document.fonts.ready)
          const selector = registries[path]
          if (selector) {
            item.registry = await area.locator(selector).first().boundingBox()
            const border = path === '/routes' ? 0 : 2
            assert.equal(item.registry.width, width - 352 - border, 'Registry width')
          }
          if (path === '/subscription/delivery') {
            item.form = await area.locator('[class*="columns" i]').first().boundingBox()
            assert.equal(item.form.width, 1088)
          }
          item.text = (await area.innerText()).slice(0, 900)
          assert.ok(item.text.trim().length > 12, 'Empty screen')
          item.documentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
          assert.equal(item.documentWidth, width)
          item.file = width + '-' + (path.slice(1).replaceAll('/', '-') || 'overview') + '.png'
          await page.screenshot({ path: join(output, item.file), animations: 'disabled', caret: 'hide' })
          if (path === '/squads') {
            const cards = area.locator('button[class*="card"]')
            const first = await cards.first().boundingBox()
            const second = await cards.nth(1).boundingBox()
            assert.equal(first.width, width === 1440 ? 352 : 380)
            assert.equal(second.x - first.x - first.width, 16)
            item.card = first
            await area.getByRole('radio', { name: 'Список', exact: true }).click()
            await area.getByRole('link', { name: 'basic', exact: true }).waitFor()
            await page.screenshot({ path: join(output, width + '-squads-list.png'), animations: 'disabled' })
            const search = area.getByRole('textbox', { name: 'Искать сквад' })
            await search.fill('Платный тариф')
            assert.equal(await area.locator('tbody tr').count(), 1)
            await area.getByRole('link', { name: 'basic', exact: true }).focus()
            await page.keyboard.press('Enter')
            await page.waitForURL('**/squads/basic')
          }
          if (path === '/routes') await checkSidebarScroll(page)
          if (path === '/users') item.actions = await checkUserActions(page, origin, output, width)
        } catch (err) {
          item.errors.push(err.message.split('\n')[0])
        } finally {
          await page.close()
        }
      }
    } finally {
      await context.close()
    }
  }
} finally {
  writeFileSync(join(output, 'results.json'), JSON.stringify({ chromium: browser?.version(), results }, null, 2))
  await browser?.close()
  server.close()
}
const failed = results.filter((r) => r.errors.length || r.failed.length)
console.log(results.length + ' screens, ' + failed.length + ' with errors')
for (const r of failed) console.log(r.width, r.path, r.errors, r.failed)
if (failed.length) process.exitCode = 1
