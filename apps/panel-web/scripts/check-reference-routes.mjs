import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { createReviewServer } from './serve-paper-review.mjs'
import { clock } from './fixtures/users-paper.mjs'

const [dist, output, catalog] = process.argv.slice(2)
if (!dist || !output || !catalog)
  throw Error('Usage: node scripts/check-reference-routes.mjs DIST OUTPUT PAPER_SIZES_JSON')
const frames = JSON.parse(readFileSync(catalog, 'utf8'))
mkdirSync(output, { recursive: true })
const groups = {
  '/devices': 'Наблюдение',
  '/requests': 'Наблюдение',
  '/audit': 'Система',
  '/settings': 'Система',
  '/subscription/templates': 'Подписка',
  '/subscription/params': 'Подписка',
}
const menu = { '1XOF-0': 'Система', '1X96-0': 'Наблюдение', '1WTN-0': 'Трафик', '1WED-0': 'Подписка' }
const server = createReviewServer(resolve(dist))
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = 'http://127.0.0.1:' + server.address().port
const evidence = []
const errors = []
let browser
try {
  browser = await chromium.launch({ args: ['--disable-gpu', '--force-color-profile=srgb'] })
  for (const frame of frames) {
    const { id, path, width, height } = frame
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow',
      reducedMotion: 'reduce',
    })
    try {
      await context.route('**/*', (route) =>
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
      )
      const page = await context.newPage()
      await page.clock.setFixedTime(clock)
      page.setDefaultTimeout(5000)
      page.on('pageerror', (e) => errors.push({ id, error: e.message }))
      await page.goto(origin + '/users')
      const main = page.getByRole('main')
      const nav = page.getByRole('navigation')
      let action = 'Из левого меню открыть «' + frame.title + '».'
      if (groups[path]) await nav.getByRole('button', { name: groups[path], exact: true }).click()
      const target = path === '/cascades' ? '/nodes' : path
      await nav.locator('a[href="' + target + '"]').click()
      if (path === '/cascades') {
        await main.getByRole('radio', { name: 'Каскады', exact: true }).click()
        action = 'В левом меню открыть «Ноды» и выбрать «Каскады».'
      }
      await page.waitForURL(origin + path)
      await main.locator(':scope > div > *').first().waitFor()
      if (['/profiles', '/hosts', '/nodes', '/cascades'].includes(path)) {
        const mode = frame.state.includes('список') ? 'Список' : 'Карточки'
        const control = main.getByRole('radio', { name: mode, exact: true })
        await control.click()
        assert.equal(await control.getAttribute('aria-checked'), 'true')
        action += ' Выбрать «' + mode + '».'
      }
      if (menu[id]) {
        const control = nav.getByRole('button', { name: menu[id], exact: true })
        await control.click()
        assert.equal(await control.getAttribute('aria-expanded'), 'true')
        action += ' Раскрыть группу «' + menu[id] + '».'
      }
      if (id === 'ZVD-0') {
        await page.getByRole('button', { name: 'Открыть правую панель' }).click()
        await page.getByRole('complementary', { name: 'Правая панель' }).waitFor()
        action += ' Нажать кнопку правой панели.'
      }
      if (path === '/requests') await main.getByText('За этот период запросов подписки не было').waitFor()
      if (path === '/audit') {
        await main.getByRole('radio', { name: 'всё', exact: true }).click()
        await main.getByText('Записей нет', { exact: true }).waitFor()
        action += ' Выбрать период «всё».'
      }
      await page.waitForLoadState('networkidle')
      await page.evaluate(() => document.fonts.ready)
      assert.ok((await main.innerText()).trim().length > 12)
      await page.screenshot({ path: join(output, id + '.png'), animations: 'disabled' })
      evidence.push({
        id,
        width,
        height,
        path,
        action,
        paired: true,
        main: await main.boundingBox(),
        rows: await main.locator('tbody tr').count(),
        visible: await main.innerText(),
        headings: await main.getByRole('heading').allTextContents(),
      })
    } catch (e) {
      errors.push({ id, error: e.message })
    } finally {
      await context.close()
    }
  }
} finally {
  writeFileSync(
    join(output, 'existing.json'),
    JSON.stringify({ chromium: browser?.version(), evidence, errors }, null, 2),
  )
  await browser?.close()
  server.close()
}
console.log(evidence.length + ' pairs, ' + errors.length + ' failures')
for (const error of errors) console.error(error.id, error.error.slice(0, 800))
if (errors.length) process.exitCode = 1
