import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { createReviewServer } from './serve-paper-review.mjs'

const [distArg, outputArg] = process.argv.slice(2)
if (!outputArg) throw Error('Usage: node scripts/check-profiles-paper.mjs DIST CHECK_DIRECTORY')
const output = resolve(outputArg), dist = resolve(distArg)
const index = await readFile(join(dist,'index.html'),'utf8')
const entry = /<script[^>]+src="(\/assets\/[^"]+)"/.exec(index)?.[1]
assert.ok(entry, 'Missing Vite entry')
const build = {
  mode: 'paper-review', head: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), entry,
  sha256: createHash('sha256').update(await readFile(join(dist,entry.slice(1)))).digest('hex'),
}
const states = [
  ['LZH-0',912,'Форма, шаги закрыты'], ['MUD-0',1221,'Исходный текст консоли'],
  ['SOZ-0',1286,'После Ctrl+S'], ['NAI-0',1286,'Ошибка в строке 24'],
  ['34RN-0',1221,'История правок'], ['353G-0',1197,'Разница с ревизией'],
]
const frames = states.map(([id,height,title])=>({id,title,width:1440,height,paper:'paper/'+id+'.jpg',checks:[]}))
await mkdir(join(output,'browser'),{recursive:true})
const server = createReviewServer(dist)
await new Promise(done=>server.listen(0,'127.0.0.1',done))
const origin = 'http://127.0.0.1:'+server.address().port
const errors = []
let browser
try {
  browser=await chromium.launch()
  for (const wide of [false,true]) {
    for(const frame of frames) {
      const width = wide ? 1920 : 1440, height = wide ? 945 : frame.height
      const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,locale:'ru-RU',timezoneId:'Europe/Moscow'})
      const page=await context.newPage()
      page.setDefaultTimeout(6000)
      try {
        await context.route('**/*', route=>new URL(route.request().url()).origin===origin ? route.continue() : route.abort())
        await page.clock.setFixedTime(new Date('2026-11-04T11:00:00Z'))
        const main = page.getByRole('main')
        const editor=main.getByRole('textbox',{name:'config.json',exact:true})
        const openConsole=()=>main.getByRole('radio',{name:'Консоль',exact:true}).click()
        const openProfile=async()=>{
          await page.goto(origin+'/profiles')
          await main.getByRole('button',{name:/ru-reality/}).click()
          await main.getByRole('heading',{name:'ru-reality'}).waitFor()
        }
        await openProfile()
        const toggles=main.getByRole('button',{expanded:false})
        assert.equal(await toggles.count(),6)
        let result='Шесть шагов свёрнуты. Перейти в консоль можно из переключателя или строки «Задано в консоли».'
        let afterCapture=async()=>{}
        if(frame.id!=='LZH-0') {
          await openConsole()
          const original=await editor.inputValue()
          assert.equal(original.split('\n').length,27)
          assert.match(original,/"routeOnly": true/)
          result='Открыты 27 строк config.json, включая управляемые поля и sniffing.routeOnly.'
          if(frame.id==='SOZ-0' || frame.id==='NAI-0') {
            const changed=original.replace('"routeOnly": true','"routeOnly": false')
            await editor.fill(changed)
            await editor.press('Control+s')
            await main.getByText('Ядро приняло, сохранено',{exact:true}).waitFor()
            await openProfile()
            await openConsole()
            assert.equal(await editor.inputValue(),changed)
            if(frame.id==='SOZ-0') {
              await editor.fill(original)
              await editor.press('Control+s')
              await main.getByText('Configuration OK.',{exact:true}).waitFor()
              afterCapture=async()=>{await openProfile();await openConsole();assert.equal(await editor.inputValue(),original)}
              result='Сохранены false и затем true. После каждого Ctrl+S профиль повторно открыт из списка, прочитано записанное значение.'
            } else {
              const broken=original.replace('["http", "tls", "quic"],','["http", "tls", "quic"]')
              await editor.fill(broken)
              await editor.press('Control+s')
              await main.getByRole('alert').getByText(/config.json:24:44/).waitFor()
              assert.match(await main.getByRole('alert').innerText(),/после значения нужна запятая/)
              await main.getByText('Ошибка в строке 24, не сохранено').waitFor()
              assert.equal(await editor.inputValue(),broken)
              afterCapture=async()=>{await openProfile();await openConsole();assert.equal(await editor.inputValue(),changed)}
              result='Пропущена запятая на строке 24. Показана позиция 24:44. Черновик остался в редакторе, после открытия из списка вернулся предыдущий сохранённый текст.'
            }
          }
          if(frame.id==='34RN-0' || frame.id==='353G-0') {
            if(frame.id==='353G-0') {await editor.press('Control+s');await main.getByText('Configuration OK.',{exact:true}).waitFor()}
            await main.getByRole('button',{name:'История правок',exact:true}).click()
            await main.getByRole('heading',{name:'История правок'}).waitFor()
            result='Кнопка истории в панели редактора открыла четыре записи с автором и источником.'
            assert.equal(await main.getByRole('button',{name:/разница/i}).filter({has:page.locator('small')}).count(),3)
            if(frame.id==='353G-0'){
              await main.getByRole('button',{name:/4 ноя 18:20/}).click()
              const diff=main.locator('[aria-label="Разница конфигураций"]')
              assert.match(await diff.innerText(),/22 строки без изменений/)
              assert.match(await diff.locator('[data-kind="removed"]').innerText(),/"destOverride"/)
              assert.match((await diff.locator('[data-kind="added"]').allTextContents()).join('\n'),/"routeOnly": true/)
              await main.getByText('Откат перезапустит ядро на 3 нодах').waitFor()
              afterCapture=async()=>{await main.getByRole('button',{name:'К тексту'}).click();assert.equal(await editor.inputValue(),original)}
              result='Выбрана ревизия 4 ноя 18:20. Показаны запятая после destOverride и добавление routeOnly. Видно предупреждение о трёх нодах, «К тексту» возвращает исходный редактор.'
            }
          }
        }
        await main.evaluate(el=>el.scrollTo(0,0))
        await page.mouse.move(width-2,1)
        await page.evaluate(()=>document.fonts.ready)
        const heading = main.getByRole('heading', { name: 'ru-reality', exact: true })
        const count = main.getByText('1 204 юзера', { exact: true }).first()
        const readFont = element => {
          const { fontSize, lineHeight, fontWeight } = getComputedStyle(element)
          return [fontSize, lineHeight, fontWeight]
        }
        assert.deepEqual(await heading.evaluate(readFont), ['24px', '30px', '600'], 'Paper profile title')
        assert.deepEqual(await count.evaluate(readFont), ['14px', '20px', '400'], 'Paper profile user count')
        const file='browser/'+(wide?'1920-':'')+frame.id+'.png'
        await page.screenshot({path:join(output,file),animations:'disabled',caret:'hide'})
        await afterCapture()
        frame.checks.push({width,height,file,result})
        console.log(frame.id,width,height,'OK')
      } catch(e){ errors.push([frame.id,width,e.message]); console.error(frame.id,width,e.message) }
      finally{await context.close()}
    }
  }
} finally{
  await writeFile(join(output,'frames.json'),JSON.stringify({build,chromium:browser?.version(),frames,errors},null,2)+'\n')
  await browser?.close()
  server.close()
}
if(errors.length)process.exitCode=1
