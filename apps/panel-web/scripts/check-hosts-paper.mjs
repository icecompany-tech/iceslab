import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { createReviewServer } from './serve-paper-review.mjs'

const [distArg, outputArg] = process.argv.slice(2)
if (!distArg || !outputArg) throw Error('Usage: node scripts/check-hosts-paper.mjs DIST CHECK_DIRECTORY')
const dist = resolve(distArg), output = resolve(outputArg)
const states = [
  ['10A2-0','Карточки',1440,900,'cards'], ['3GOI-0','Карточки',1920,945,'cards'],
  ['10JQ-0','Список',1440,900,'list'], ['3H0A-0','Список',1920,945,'list'],
  ['14K8-0','Перетаскивание',1440,900,'drag'], ['1110-0','Настройки хоста',1440,908,'form'],
  ['147M-0','Нода не отвечает',1440,1018,'offline'],
]
const frames = states.map(([id,title,width,height,kind]) => ({id,title,width,height,kind,paper:'paper/'+id+'.jpg',checks:[]}))
await mkdir(join(output,'browser'), {recursive:true})
const html = await readFile(join(dist,'index.html'),'utf8')
const entry = html.match(/<script[^>]+src="([^"]+)"/)[1]
const server = createReviewServer(dist, undefined, true)
await new Promise(done => server.listen(0,'127.0.0.1',done))
const origin = 'http://127.0.0.1:'+server.address().port
const errors = []
let browser
try {
  browser = await chromium.launch()
  for (const frame of frames) {
    const sizes = [[frame.width,frame.height]]
    if (['drag','form','offline'].includes(frame.kind)) sizes.push([1920,945])
    for (const [width,height] of sizes) {
      const page = await browser.newPage({viewport:{width,height},deviceScaleFactor:1,locale:'ru-RU',timezoneId:'Europe/Moscow'})
      page.setDefaultTimeout(5500)
      const pageErrors = []
      page.on('pageerror', error => pageErrors.push(error.message))
      try {
        await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
        await page.goto(origin+'/hosts'+(frame.kind==='offline'?'?demo=offline':''))
        const main = page.getByRole('main')
        await main.getByRole('link',{name:'Amsterdam',exact:true}).waitFor()
        const filter = main.getByRole('button',{name:'Фильтры',exact:true})
        const search = main.getByPlaceholder('Имя, адрес, порт, профиль',{exact:true})
        assert.ok(Math.abs((await filter.boundingBox()).x - (width === 1440 ? 1066 : 1546)) < 1)
        assert.ok(Math.abs((await search.boundingBox()).x - (width === 1440 ? 871 : 1351)) < 1)
        let metrics
        let after = async () => {}
        if (frame.kind==='list') {
          const rows = main.locator('tbody tr')
          assert.equal(await rows.count(),10)
          assert.equal(await rows.first().getByText('nl-ams-01.example.net:443').count(),1)
          assert.equal(await rows.first().getByText('VLESS',{exact:true}).count(),1)
          metrics = await rows.first().evaluate(e => ({rowHeight:e.getBoundingClientRect().height,cols:[...e.cells].slice(0,8).map(c=>c.getBoundingClientRect().x)}))
          assert.equal(metrics.rowHeight,46)
          const headings = main.getByRole('columnheader')
          const addressX = await headings.nth(1).evaluate(el=>el.getBoundingClientRect().x)
          assert.equal(addressX, width === 1440 ? 579 : 1059)
          after = async () => {
            await main.getByRole('button',{name:'Следующая страница'}).click()
            assert.equal(await rows.count(),4)
            await main.getByRole('textbox',{name:'Искать хост'}).fill('51820')
            assert.equal(await rows.count(),3)
            await main.getByRole('textbox',{name:'Искать хост'}).fill('naive-de')
            assert.equal(await rows.count(),1)
            await main.getByRole('button',{name:'Фильтры',exact:true}).click()
            await main.getByLabel('Страна').selectOption('NL')
            await main.getByText('В этом фильтре хостов нет.').waitFor()
          }
        } else if (frame.kind==='cards'||frame.kind==='drag') {
          await main.getByRole('radio',{name:'Карточки'}).click()
          const cards=main.locator('button[draggable]')
          const expected=width===1440?9:12
          await page.waitForFunction(n=>document.querySelectorAll('main button[draggable]').length===n,expected)
          const first=cards.first()
          metrics=await first.evaluate(el=>{const box=el.getBoundingClientRect(), style=getComputedStyle(el);return {x:box.x,y:box.y,width:box.width,height:box.height,gap:style.gap,padding:style.paddingTop}})
          assert.equal(metrics.width,width===1440?352:380)
          assert.equal(metrics.height,168)
          if(frame.kind==='drag') {
            const source = await cards.nth(1).boundingBox(), target=await first.boundingBox()
            await page.mouse.move(source.x+70,source.y+18)
            await page.mouse.down()
            await page.mouse.move(target.x+70,target.y+35,{steps:14})
            await main.getByRole('button',{name:'На первое место'}).waitFor()
            after=async()=>{
              const response=page.waitForResponse(r=>r.url().endsWith('/api/hosts/reorder')&&r.request().method()==='PUT')
              await page.mouse.move(target.x+72,target.y+36)
              await page.mouse.up()
              assert.equal((await response).status(),200)
              await page.waitForFunction(()=>document.querySelector('main button[draggable] b')?.textContent === 'Amsterdam mobile')
              await main.getByRole('radio',{name:'Список'}).click()
              assert.equal(await main.locator('tbody tr').first().getByRole('link').innerText(),'Amsterdam mobile')
              await main.getByRole('radio',{name:'Карточки'}).click()
              assert.equal(await cards.first().locator('b').first().innerText(),'Amsterdam mobile')
              await page.reload()
              await main.getByRole('link',{name:'Amsterdam mobile',exact:true}).waitFor()
              assert.equal(await main.locator('tbody tr').first().getByRole('link').innerText(),'Amsterdam mobile')
            }
          } else {
            after=async()=>{
              await main.getByRole('button',{name:'Следующая страница'}).click()
              assert.equal(await cards.count(),14-expected)
            }
          }
        } else {
          await main.getByRole('link',{name:'Amsterdam',exact:true}).click()
          const title=main.getByRole('heading',{name:'Amsterdam',exact:true})
          await title.waitFor()
          await main.getByRole('button',{name:/Форматы.*12 из 17/}).waitFor()
          assert.equal(await main.getByRole('button',{expanded:true}).count(),0)
          assert.equal(await main.getByLabel('Имя',{exact:true}).inputValue(),'Amsterdam')
          assert.equal(await main.getByRole('button',{name:'Сохранить'}).isDisabled(),true)
          if(frame.kind==='offline') await main.getByText(/nl-ams-01 · не отвечает, 4 мин/).waitFor()
          metrics=await title.evaluate(el=>({height:el.getBoundingClientRect().height,font:getComputedStyle(el).fontSize}))
          after=async()=>{
            const step=main.getByRole('button',{name:/Нода и порт/})
            await step.click()
            assert.equal(await step.getAttribute('aria-expanded'),'true')
            await step.click()
            assert.equal(await step.getAttribute('aria-expanded'),'false')
          }
        }
        await page.evaluate(()=>document.fonts.ready)
        const file='browser/'+(width!==frame.width?'1920-':'')+frame.id+'.png'
        await page.screenshot({path:join(output,file),animations:'disabled',caret:'hide'})
        await after()
        assert.deepEqual(pageErrors,[])
        frame.checks.push({width,height,file,metrics})
        console.log(frame.id,width,height,'OK')
      } catch (error) {
        errors.push({id:frame.id,width,message:error.message})
        console.error(frame.id,width,error.message)
      } finally {await page.close()}
    }
  }
} finally {
  const build={mode:'paper-review',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),entry}
  await writeFile(join(output,'frames.json'),JSON.stringify({build,chromium:browser?.version(),frames,errors},null,2)+'\n')
  await browser?.close()
  server.close()
}
if(errors.length) process.exitCode=1
