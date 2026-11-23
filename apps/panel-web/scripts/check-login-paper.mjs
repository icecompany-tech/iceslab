import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { chromium } from 'playwright'
import { createReviewServer } from './serve-paper-review.mjs'

const [dist, output] = process.argv.slice(2)
if (!dist || !output) throw Error('Usage: node scripts/check-login-paper.mjs DIST OUTPUT')
const server = createReviewServer(resolve(dist))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + server.address().port
mkdirSync(output, { recursive: true })
const report = []
let browser
try {
  browser = await chromium.launch({ args: ['--disable-gpu', '--force-color-profile=srgb'] })
  for (const [width, height] of [[1440,900],[1920,945]]) {
    const page = await browser.newPage({ viewport: { width, height }, locale: 'ru-RU', timezoneId: 'Europe/Moscow', reducedMotion: 'reduce', deviceScaleFactor: 1 })
    page.setDefaultTimeout(10000)
    try {
      let state = 'normal'
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== origin) return route.abort()
        const reply = (status, json) => route.fulfill({ status, json })
        if (url.pathname === '/api/auth/status' && state === 'down') return reply(503,{})
        if (url.pathname === '/api/auth/status' && state === 'setup') return reply(200,{ registration: { enabled: true } })
        if (state === 'expired' && ['/api/users','/api/auth/me'].includes(url.pathname)) return reply(401,{ error:'UNAUTHORIZED' })
        if (url.pathname === '/api/auth/logout') return reply(503,{})
        if (url.pathname !== '/api/auth/login') return route.continue()
        const body = route.request().postDataJSON()
        if (state === 'locked') return reply(429,{ error: 'ACCOUNT_LOCKED', retryAfterSeconds: 42 })
        if (state === 'two') return reply(401, { error: body.totpCode ? 'INVALID_TOTP' : 'TOTP_REQUIRED', requires2fa: true })
        if (state === 'success') return reply(200,{ admin: { id: 'sample-admin', role: 'admin', username: 'admin' } })
        return reply(401,{ error: 'INVALID_CREDENTIALS' })
      })
      const go = () => page.goto(origin + '/login')
      const fill = async () => {
        await page.getByLabel('Имя', { exact: true }).fill('admin')
        await page.getByLabel('Пароль', { exact: true }).fill('sampleword')
      }
      const submit = () => page.getByRole('button', { name: 'Войти', exact: true }).click()
      const shot = async (id, action) => {
        await page.evaluate(() => document.fonts.ready)
        const card = page.locator('section[aria-labelledby="auth-title"]')
        const bounds = await card.boundingBox()
        assert.equal(bounds.width, 400)
        assert.equal(bounds.x, (width-400)/2)
        assert.ok(Math.abs(bounds.y + bounds.height/2 - height/2) <= 1)
        await page.screenshot({path:join(output, width + '-' + id + '.png'),animations:'disabled',caret:'hide'})
        report.push({ id, width, height, card:bounds, action })
      }
      await go()
      await fill()
      await page.getByRole('heading', { name: 'Вход в Iceslab' }).click()
      await shot('G76-0', 'Ввести тестовое имя и пароль')
      await submit()
      await page.getByText('Неверное имя или пароль', { exact: true }).waitFor()
      await shot('G84-0', 'Отправить пароль, получить отказ')
      state = 'locked'
      await submit()
      await page.getByRole('button', { name: /Вход закрыт/ }).waitFor()
      await shot('G91-0', 'Отправить пароль, получить блокировку на 42 секунды')
      state = 'two'
      await go(); await fill(); await submit()
      const code = page.getByRole('textbox', { name: 'Код из приложения' })
      await code.fill('418')
      await shot('G9Y-0', 'Отправить пароль, получить запрос второго фактора, ввести три цифры')
      await code.fill('418205')
      await page.getByRole('button', { name: 'Подтвердить' }).click()
      await page.getByText('Неверный код, попробуйте ещё раз', { exact: true }).waitFor()
      await shot('GAV-0', 'Отправить шестизначный тестовый код, получить отказ')
      await page.getByRole('button', { name:'Назад ко входу' }).click()
      await page.getByLabel('Пароль',{exact:true}).waitFor()
      state = 'normal'
      await page.goto(origin + '/users')
      await page.getByText('alex_dev',{exact:true}).waitFor()
      await page.getByRole('button',{name:'Выйти',exact:true}).click()
      await page.getByText(/Сервер не подтвердил выход/).waitFor()
      await fill()
      await shot('GFT-0', 'Нажать «Выйти» в панели, получить отказ сервера при выходе')
      await page.goto(origin + '/users?paper=1')
      await page.getByText('alex_dev',{exact:true}).waitFor()
      state = 'expired'
      await page.getByRole('button', {name:/^Действуют/}).click()
      await page.getByText(/Сессия истекла/).waitFor()
      await fill()
      await shot('39X8-0', 'В открытом реестре сменить статус-фильтр, получить 401 и перейти на вход')
      state = 'success'
      await submit()
      await page.waitForURL('**/users?paper=1')
      await page.getByText('alex_dev',{exact:true}).waitFor()
      state = 'setup'
      await go()
      await page.getByRole('heading',{name:'Админа ещё нет'}).waitFor()
      await shot('35YF-0', 'Открыть вход, когда у стенда нет первого админа')
      state = 'normal'
      await page.getByRole('button',{name:'Проверить снова'}).click()
      await page.getByLabel('Пароль',{exact:true}).waitFor()
      state = 'down'
      await go()
      await page.getByRole('heading',{name:'Сервер панели не ответил'}).waitFor()
      await shot('GCP-0', 'Открыть вход при 503 от статуса панели')
      state = 'normal'
      await page.getByRole('button',{name:'Повторить',exact:true}).click()
      await page.getByLabel('Пароль',{exact:true}).waitFor()
      assert.deepEqual(errors,[])
    } finally { await page.close() }
  }
  console.log(report.length + ' login states and sizes passed')
} finally {
  writeFileSync(join(output,'login.json'),JSON.stringify(report,null,2))
  await browser?.close()
  server.close()
}
