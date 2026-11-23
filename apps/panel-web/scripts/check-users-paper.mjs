import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { clock, fixture } from './fixtures/users-paper.mjs'

const dist = resolve(process.argv[2] ?? 'dist')
const output = mkdtempSync(join(resolve(process.argv[3] ?? tmpdir()), 'users-paper-'))
const routes = new Set(['/users', '/audit', '/cascades', '/geo'])
const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const index = readFileSync(join(dist, 'index.html'), 'utf8')
const template = readFileSync(new URL('../nginx.conf.template', import.meta.url), 'utf8')
const policy = template.match(/set \$csp_spa "([^"]+)"/)?.[1]
assert.ok(policy, 'Panel CSP is missing from nginx.conf.template')
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost')
  if (routes.has(pathname)) {
    const nonce = randomBytes(16).toString('hex')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': policy.replaceAll('$request_id', nonce) })
    res.end(index.replace('__CSP_NONCE__', nonce))
    return
  }
  const file = join(dist, pathname)
  if (/^\/(?:assets\/[\w.-]+|favicon\.svg)$/.test(pathname) && existsSync(file)) {
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream')
    res.end(readFileSync(file))
    return
  }
  res.writeHead(404).end()
})

async function measure(table) {
  return table.evaluate((element) => {
    const rect = (el) => {
      const r = el.getBoundingClientRect()
      return [r.x, r.y, r.width, r.height]
    }
    const scroller = element.parentElement
    const card = scroller.parentElement
    const rows = [...element.tBodies[0].rows]
    return {
      card: rect(card), header: rect(element.tHead), row: rect(rows[0]), last: rect(rows.at(-1)),
      foot: rect(card.lastElementChild), scroll: [scroller.clientWidth, scroller.scrollWidth],
      columns: [...element.tHead.rows[0].cells].map((head, i) => [head.dataset.col, rect(head), rect(rows[0].cells[i])]),
    }
  })
}

async function check(browser, origin, width, height, count) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'ru-RU', timezoneId: 'Europe/Moscow', reducedMotion: 'reduce' })
  const page = await context.newPage()
  const note = { browser: browser.version(), width, height, requests: [], errors: [], otherPages: [] }
  let creating = false
  page.setDefaultTimeout(10000)
  try {
    await page.clock.setFixedTime(clock)
    page.on('pageerror', (error) => note.errors.push(error.message))
    await context.route('**/*', async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      if (url.origin !== origin) return route.abort()
      if (!url.pathname.startsWith('/api/')) return route.continue()
      const body = req.method() === 'GET' ? fixture(url, count, creating) : undefined
      if (!body) note.errors.push('Unexpected request ' + req.method() + ' ' + url.pathname)
      if (url.pathname === '/api/users') note.requests.push(url.pathname + url.search)
      return route.fulfill({ status: body ? 200 : 404, json: body ?? {} })
    })
    const screenshot = async (name) => {
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: join(output, width + '-' + name + '.png'), animations: 'disabled', caret: 'hide' })
    }
    await page.goto(origin + '/users')
    await page.getByText('alex_dev', { exact: true }).waitFor()
    const table = page.locator('table').first()
    const hoverCell = table.locator('tbody tr').nth(2).locator('[data-col="username"]')
    await hoverCell.hover()
    note.grid = await measure(table)
    const grid = note.grid
    assert.deepEqual(grid.card, [264, 136, width - 352, height - 164])
    assert.equal(grid.header[3], 65)
    assert.equal(grid.last[1] + grid.last[3], 242 + count * 46)
    assert.equal(grid.foot[1], height - 73)
    assert.equal(grid.scroll[0], grid.scroll[1])
    for (const [, head, cell] of grid.columns) {
      assert.equal(head[0], cell[0])
      assert.equal(head[2], cell[2])
    }
    const actions = grid.columns.at(-1)
    assert.equal(actions[0], 'actions')
    assert.equal(actions[1][0] + actions[1][2], width - 89)
    const pinned = table.locator('th[data-col="username"]')
    await pinned.evaluate((el) => { el.style.translate = '1px 0' })
    note.onePixelDetected = (await pinned.boundingBox()).x - (await hoverCell.boundingBox()).x === 1
    await pinned.evaluate((el) => el.style.removeProperty('translate'))
    assert.ok(note.onePixelDetected)
    assert.equal((await pinned.boundingBox()).x, (await hoverCell.boundingBox()).x)
    const expired = table.locator('tbody tr').nth(1)
    const tintStart = (cell) => cell.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--cell-x')))
    assert.equal(await tintStart(expired.locator('[data-col="select"]')), 0)
    assert.equal(await tintStart(expired.locator('[data-col="username"]')), -grid.columns[0][1][2])
    await screenshot('list')

    await page.getByRole('button', { name: /настройк.*колон|^колонки$/i }).first().click()
    const columnSheet = page.locator('[class*="columnsPanel"]').locator('..')
    note.columns = await columnSheet.boundingBox()
    assert.deepEqual(note.columns, { x: width - 479, y: 172, width: 380, height: 600 })
    await hoverCell.hover()
    await screenshot('columns')
    const idSwitch = page.getByRole('switch', { name: 'ID', exact: true })
    const label = idSwitch.locator('xpath=ancestor::label')
    await label.click()
    await table.locator('th[data-col="shortId"]').waitFor({ state: 'detached' })
    await label.click()
    await table.locator('th[data-col="shortId"]').waitFor()
    const pin = label.locator('xpath=ancestor::li').getByRole('button').first()
    await pin.click()
    assert.equal(await pin.getAttribute('aria-pressed'), 'true')
    await pin.click()
    await page.keyboard.press('Escape')
    await columnSheet.waitFor({ state: 'hidden' })

    const term = table.locator('th[data-col="expires"] button[aria-expanded]').first()
    await term.click()
    const panel = page.locator('[class*="filterPanel"]').first()
    await panel.locator('[data-type="year"]').first().waitFor()
    note.term = { trigger: await term.boundingBox(), panel: await panel.locator('..').boundingBox() }
    assert.deepEqual(note.term.trigger, { x: width - 595, y: 207, width: 128, height: 26 })
    assert.deepEqual(note.term.panel, { x: note.term.trigger.x, y: 238, width: 248, height: 209 })
    await hoverCell.hover()
    await screenshot('term')
    const presence = page.getByRole('button', { name: 'Есть срок', exact: true })
    for (const [choice, expected] of [['Нет', 0], ['Да', count]]) {
      await presence.click()
      await page.getByRole('menuitemradio', { name: choice, exact: true }).click()
      await page.waitForFunction((n) => document.querySelectorAll('tbody [data-col="username"]').length === n, expected)
    }
    assert.ok(note.requests.some((request) => request.includes('hasExpiry=no')))
    assert.ok(note.requests.some((request) => request.includes('hasExpiry=yes')))
    note.filteredRows = [count, 0, count]
    await page.keyboard.press('Escape')

    creating = true
    await page.goto(origin + '/users')
    await page.getByText('alex_dev', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('input[name="username"]').fill('kate_m')
    await dialog.locator('button[aria-haspopup="listbox"]').click()
    await page.getByRole('option', { name: 'All', exact: true }).click()
    await page.getByRole('option', { name: 'basic', exact: true }).click()
    await page.keyboard.press('Escape')
    await dialog.getByText('свободно', { exact: true }).waitFor()
    await dialog.getByText('3 из 3 онлайн').waitFor()
    await dialog.getByText(/6 конфигов · 3 ноды · 3 протокола/).waitFor()
    await dialog.getByText(/ru-split, из сквада basic/).waitFor()
    await dialog.getByRole('button', { name: 'Открыть календарь' }).click()
    await page.getByRole('grid').last().waitFor()
    await page.keyboard.press('Escape')
    await dialog.getByRole('heading', { name: 'Новый юзер', exact: true }).click()
    note.form = await dialog.boundingBox()
    assert.deepEqual(note.form, { x: (width - 920) / 2, y: 130, width: 920, height: 598 })
    await screenshot('new')
    await dialog.getByRole('button', { name: /Дополнительно/ }).click()
    await dialog.getByText(/^email$/i).waitFor()
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })

    for (const route of ['/audit', '/cascades', '/geo']) {
      await page.goto(origin + route)
      const name = route === '/geo' ? 'Действия с набором geoip' : /^Фильтры/
      const trigger = page.getByRole('button', { name }).first()
      await trigger.click()
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
      await page.keyboard.press('Escape')
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
      note.otherPages.push(route)
    }
    assert.deepEqual(note.errors, [])
  } finally {
    writeFileSync(join(output, width + '.json'), JSON.stringify(note, null, 2))
    await context.close()
  }
}

await new Promise((ready) => server.listen(0, '127.0.0.1', ready))
let browser
try {
  browser = await chromium.launch({ args: ['--disable-gpu', '--force-color-profile=srgb'] })
  const origin = 'http://127.0.0.1:' + server.address().port
  await check(browser, origin, 1440, 900, 10)
  await check(browser, origin, 1920, 945, 13)
  console.log('8/8', output)
} finally {
  await browser?.close()
  server.close()
}
