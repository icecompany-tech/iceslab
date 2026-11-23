import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { createReviewServer } from './serve-paper-review.mjs'
import { clock } from './fixtures/users-paper.mjs'

const [dist, output, catalogPath] = process.argv.slice(2)
if (!dist || !output || !catalogPath)
  throw Error('Usage: node scripts/check-preview-pages.mjs DIST OUTPUT PAPER_SIZES_JSON')
const frames = JSON.parse(readFileSync(catalogPath, 'utf8'))
const sizes = new Map(frames.map((frame) => [frame.id, frame]))
mkdirSync(output, { recursive: true })
const server = createReviewServer(resolve(dist))
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = 'http://127.0.0.1:' + server.address().port
const evidence = []
const errors = []

async function designer({ main, page, click, snap }) {
  await snap('25D3-0', 'Открыть Подписка / Страница.', 'Название')
  for (const [name, id, visible] of [
    ['истекает', '25NY-0', 'Скоро истекает'],
    ['истекла', '25V9-0', 'Срок закончился'],
    ['лимит', '2PHD-0', 'Лимит исчерпан'],
    ['отключена', '2PPG-0', 'Доступ отключён'],
  ]) {
    await click(name)
    await main.getByRole('region', { name: 'Страница клиента' }).getByText(visible, { exact: true }).waitFor()
    await snap(id, 'В предпросмотре выбрать «' + name + '».', visible)
  }
  await click('активна')
  await main.getByRole('textbox', { name: 'Название' }).fill('Iceslab Preview')
  await snap('26A9-0', 'Изменить название. В карточке клиента видно новое имя.', 'не сохранено')
  await click('Сохранить')
  await page.reload()
  assert.equal(await main.getByRole('textbox', { name: 'Название' }).inputValue(), 'Iceslab Preview')
  await main.getByRole('radiogroup', { name: 'Язык предпросмотра' }).getByRole('radio', { name: 'EN' }).click()
  await main.getByText('Active', { exact: true }).waitFor()
}

async function ruleSets({ main, page, click, snap, sample }) {
  await snap('2BKD-0', 'Открыть Трафик / Наборы правил.', 'ruleset:banki-rf', '3EWU-0')
  await click('Удалить')
  await snap('2CNE-0', 'Нажать «Удалить» у набора, который используется двумя правилами.', 'удалить нельзя')
  await click('Понятно')
  await main
    .getByRole('textbox', { name: 'Записи, одна на строку' })
    .fill('domain:sberbank.ru\nfull:tbank.ru\ndomian:example.test')
  await click('Сохранить')
  await snap('2BXL-0', 'В третьей строке ввести domian:example.test и нажать «Сохранить».', 'Строка 3')
  await click('Реклама плюс')
  await snap('2BQV-0', 'Выбрать «Реклама плюс».', 'Ссылка на список')
  await main.getByRole('textbox', { name: 'Ссылка на список' }).fill('https://missing.example.test/ads.txt')
  await click('Обновить сейчас')
  await snap('2C3W-0', 'Для тестовой ссылки, которой нет в фикстуре, нажать «Обновить сейчас».', '404')
  await click('Новый набор')
  await page.getByRole('dialog').getByRole('textbox', { name: 'Имя' }).fill('Локальные домены')
  await snap('2CU0-0', 'Нажать «Новый набор» и ввести имя.', 'Локальные домены')
  await click('Создать')
  await page.reload()
  await click('Локальные домены')
  await main.getByRole('heading', { name: 'Локальные домены' }).waitFor()
  await sample('empty')
  await snap('2CAD-0', 'Открыть тестовый реестр без наборов.', 'Наборов пока нет')
}

async function dns({ main, page, click, snap, sample }) {
  await snap('2CZ6-0', 'Открыть Трафик / DNS.', 'Резолверы по порядку', '3F31-0')
  await click('aeza-de-01')
  await snap('2DF2-0', 'Выбрать aeza-de-01 в колонке «Нода».', 'DNS этой ноды', '3F8S-0')
  await click('Добавить сервер')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Адрес', exact: true }).fill('77.88.8.1')
  await dialog.getByRole('textbox', { name: 'Для каких доменов' }).fill('domain:yandex.ru')
  await snap('2E8I-0', 'Из списка резолверов нажать «Добавить сервер».', 'Новый резолвер')
  await dialog.getByRole('textbox', { name: 'Адрес', exact: true }).fill('dns.google')
  await click('Добавить')
  await snap('2EGG-0', 'Ввести dns.google и нажать «Добавить».', 'Укажите новый IP')
  await dialog.getByRole('textbox', { name: 'Адрес', exact: true }).fill('192.0.2.53')
  await click('Добавить')
  await main.getByText('192.0.2.53', { exact: false }).first().waitFor()
  await click('Как на другой ноде')
  await snap('2EOD-0', 'Нажать «Как на другой ноде».', 'Настроить как на другой ноде')
  await dialog.getByRole('combobox').selectOption('aeza-nl-02')
  await click('Подставить')
  await click('Сохранить')
  await page.reload()
  const savedNode = main.getByRole('row').filter({ has: page.getByRole('button', { name: 'aeza-de-01', exact: true }) })
  await savedNode.getByText('https://dns.google/dns-query', { exact: true }).waitFor()
  await click('aeza-se-p-01')
  await snap('2E17-0', 'Из списка открыть ноду, у которой нет своих резолверов.', 'Как настроено у ядра')
  await click('Отмена')
  await click('ruvds-kz-01')
  await snap('2DMP-0', 'Открыть ruvds-kz-01 с настройкой, ещё не дошедшей до ноды.', 'не на связи')
  await sample('refused')
  await click('aeza-de-01')
  await click('Сохранить')
  await click('aeza-de-01')
  await snap('2DTX-0', 'В режиме отказа сохранить и открыть ту же ноду.', 'нода отказала')
}

async function torrents({ main, page, click, snap }) {
  await snap('2EV9-0', 'Открыть Трафик / Торренты.', 'Последняя попытка')
  await click('Действия юзера nikita.k')
  await page.getByRole('menuitem', { name: 'Отключить юзера', exact: true }).click()
  await snap('2F2H-0', 'В строке nikita.k открыть меню и нажать «Отключить юзера».', 'Отключить nikita.k?')
  await page.getByRole('dialog').getByRole('button', { name: 'Отключить', exact: true }).click()
  await main.getByRole('row').filter({ hasText: 'nikita.k' }).getByText('отключён оператором').waitFor()
  await click('Настройка')
  await snap('2FKU-0', 'Из списка открыть настройку записи и порога.', 'Хранить, дней')
  await main.getByRole('spinbutton', { name: 'Попыток', exact: true }).fill('0')
  await click('Сохранить')
  await snap('2R1W-0', 'Ввести ноль попыток и сохранить.', 'целыми числами')
  await main.getByRole('spinbutton', { name: 'Попыток', exact: true }).fill('100')
  await main.getByRole('checkbox').uncheck()
  await click('Сохранить')
  await snap('2FR7-0', 'Выключить запись и сохранить.', 'Запись выключена')
}

async function sessions({ main, page, click, snap }) {
  await snap('2FVQ-0', 'Открыть Наблюдение / Сессии.', 'Трафик')
  assert.equal(await main.locator('tbody tr').count(), 6)
  await main.getByRole('button', { name: /Сняты, но на связи/ }).click()
  assert.equal(await main.locator('tbody tr').count(), 1)
  await snap('2G2X-0', 'Нажать «Сняты, но на связи». В списке остался petr_m.', 'petr_m')
  await click('Действия сессии petr_m')
  await page.getByRole('menuitem', { name: 'Оборвать сессию', exact: true }).click()
  await snap('2G9Z-0', 'В строке petr_m открыть меню и нажать «Оборвать сессию».', 'все соединения ноды')
  await click('Подождать клиента')
  assert.equal(await main.locator('tbody tr').count(), 1)
  await click('Действия сессии petr_m')
  await page.getByRole('menuitem', { name: 'Оборвать сессию', exact: true }).click()
  await click('Перезапустить ядро')
  assert.equal(await main.locator('tbody tr').count(), 0)
  await page.reload()
  await main.getByRole('cell', { name: 'vasya_2291', exact: true }).waitFor()
  assert.equal(await main.locator('tbody tr').count(), 5)
}

async function httpStats({ main, snap }) {
  await snap('2HOL-0', 'Открыть Наблюдение / Статистика HTTP.', '182')
  assert.equal(await main.locator('tbody tr').count(), 5)
  const plot = main.getByRole('img', { name: /Все запросы и ответы 5xx/ })
  assert.equal((await plot.boundingBox()).height, 96)
  assert.equal(await plot.locator('rect').count(), 27)
  await main.getByRole('button', { name: /Только с ошибками/ }).click()
  assert.equal(await main.locator('tbody tr').count(), 2)
  await snap('2IF1-0', 'Нажать «Только с ошибками». Видны две строки тестовой выборки.', 'POST /api/auth/login')
  const before = await main.locator('tbody td').nth(1).innerText()
  await main.getByRole('radio', { name: '1 ч', exact: true }).click()
  assert.notEqual(await main.locator('tbody td').nth(1).innerText(), before)
}

async function queues({ main, page, click, snap }) {
  await snap('2JGW-0', 'Открыть Система / Очереди.', 'Очередь')
  await click('Юзеры на нодах')
  await snap('2JWY-0', 'Выбрать «Юзеры на нодах».', '#84213')
  await click('#84213')
  await snap('2K8H-0', 'Раскрыть задачу #84213.', 'Ошибка последней попытки')
  await click('#84213')
  await click('Пауза')
  await snap('2KKF-0', 'Нажать «Пауза».', 'Продолжить')
  await click('Продолжить')
  await click('Очистить')
  await snap('2KEL-0', 'Нажать «Очистить». Подтверждение называет число задач.', 'Очистить 4 задачи')
  await click('Отмена')
  assert.equal(await main.locator('tbody tr').count(), 4)
  await click('Очистить')
  await page.getByRole('dialog').getByRole('button', { name: 'Очистить 4 задачи' }).click()
  await snap('2KPZ-0', 'Подтвердить удаление четырёх тестовых задач.', 'Упавших задач нет')
}

const routes = [
  ['/subscription/page', 'Подписка', 'Страница', designer, '26QP-0', '', 'Не удалось загрузить настройки страницы'],
  ['/rule-sets', 'Трафик', 'Наборы правил', ruleSets, '2CGV-0', '', 'Не удалось загрузить наборы'],
  ['/dns', 'Трафик', 'DNS', dns, '2DAZ-0', '2D58-0', 'Не удалось загрузить DNS нод', 'Нод пока нет'],
  ['/torrents', 'Трафик', 'Торренты', torrents, '2FGR-0', '2F9E-0', 'Не удалось загрузить попытки', 'Попыток не было'],
  [
    '/sessions',
    'Наблюдение',
    'Сессии',
    sessions,
    '2GKF-0',
    '2GFC-0',
    'Не удалось загрузить сессии',
    'Сейчас никого нет на связи',
  ],
  [
    '/http-stats',
    'Наблюдение',
    'Статистика HTTP',
    httpStats,
    '2IAQ-0',
    '2I41-0',
    'Не удалось загрузить метрики',
    'Метрик пока нет',
  ],
  ['/admin/queues', 'Система', 'Очереди', queues, '2KVO-0', '', 'Redis недоступен'],
]
let browser
try {
  browser = await chromium.launch({ args: ['--disable-gpu', '--force-color-profile=srgb'] })
  for (const width of [1440, 1920]) {
    const height = width === 1440 ? 900 : 945
    for (const [path, group, name, flow, offline, empty, failureText, emptyText] of routes) {
      const context = await browser.newContext({
        viewport: { width, height },
        locale: 'ru-RU',
        timezoneId: 'Europe/Moscow',
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      })
      try {
        await context.route('**/*', (route) =>
          new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
        )
        const page = await context.newPage()
        await page.clock.setFixedTime(clock)
        page.setDefaultTimeout(4500)
        page.on('pageerror', (error) => errors.push({ width, path, error: error.message }))
        await page.goto(origin + '/users')
        const main = page.getByRole('main')
        if (path === '/subscription/page') {
          const header = page.getByRole('banner')
          await header.getByText('v0.4.0', { exact: true }).waitFor()
          for (const label of ['Telegram', 'Discord', 'GitHub', 'Документация', 'Поддержать']) {
            await header.getByRole('link', { name: label, exact: true }).waitFor()
          }
          await header.getByRole('link', { name: 'GitHub' }).getByText('19', { exact: true }).waitFor()
        }
        const nav = page.getByRole('navigation')
        await nav.getByRole('button', { name: group, exact: true }).click()
        await nav.getByRole('link', { name, exact: true }).click()
        await page.waitForURL(origin + path)
        const sample = async (state) => {
          await page.goto(origin + path + '?sample=' + state)
          await main.locator(':scope > div > *').first().waitFor()
        }
        const click = (label) => main.getByRole('button', { name: label, exact: true }).click()
        const snap = async (id, action, contains, wideId) => {
          const current = wideId && width === 1920 ? wideId : id
          const frame = sizes.get(current)
          assert.ok(frame, current)
          // Dialogs, form controls and their current values all contribute visible state.
          await page.waitForFunction((text) => {
            const root = document.querySelector('main')
            const values = [...root.querySelectorAll('input,textarea')].map((el) => el.value)
            return [root.innerText, ...values].join(' ').includes(text)
          }, contains)
          await page.evaluate(() => document.fonts.ready)
          await page.screenshot({ path: join(output, width + '-' + id + '.png'), animations: 'disabled' })
          if (frame.width === width && frame.height !== height)
            await page.setViewportSize({ width, height: frame.height })
          if (frame.width === width)
            await page.screenshot({ path: join(output, current + '.png'), animations: 'disabled' })
          const bounds = await main.boundingBox()
          const rows = await main.locator('tbody tr').count()
          evidence.push({
            id: current,
            path,
            action,
            width,
            height,
            frameHeight: frame.height,
            paired: frame.width === width,
            rows,
            visible: await main.innerText(),
            main: bounds,
          })
          if (frame.width === width && frame.height !== height) await page.setViewportSize({ width, height })
        }
        await flow({ main, page, click, snap, sample })
        if (empty) {
          await sample('empty')
          await snap(empty, 'Открыть данные без записей.', emptyText)
        }
        if (path === '/subscription/page') {
          await sample('no-link')
          await snap('26IG-0', 'Открыть редактор при отказе выдачи ссылки предпросмотра.', 'Предпросмотр не открылся')
        }
        await sample('offline')
        await snap(offline, 'Открыть тестовый отказ загрузки.', failureText)
        await click('Повторить')
        await page.waitForURL(origin + path)
      } catch (error) {
        errors.push({ width, path, error: error.message })
      } finally {
        await context.close()
      }
    }
  }
} finally {
  writeFileSync(
    join(output, 'preview.json'),
    JSON.stringify({ chromium: browser?.version(), evidence, errors }, null, 2),
  )
  await browser?.close()
  server.close()
}
console.log(
  evidence.length +
    ' browser states, ' +
    evidence.filter((item) => item.paired).length +
    ' pairs, ' +
    errors.length +
    ' failures',
)
for (const error of errors) console.error(error.width, error.path, error.error.slice(0, 1400))
if (errors.length) process.exitCode = 1
