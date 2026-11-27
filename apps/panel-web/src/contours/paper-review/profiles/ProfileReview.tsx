import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { readStored, writeStored } from '@/lib/storage'
import { arr, obj, str } from '@/lib/net/parse'
import { useNow } from '@/lib/clock'
import { Flag } from '@/ui/Flag/Flag'
import { Button } from '@/ui/Button/Button'
import { Icon } from '@/ui/Icon/Icon'
import { Segmented } from '@/ui/Segmented/Segmented'
import { Editor } from '@/ui/CodeArea/Editor'
import { Diff } from '@/ui/CodeArea/Diff'
import { changes, type ProfileError } from '@/ui/CodeArea/text'
import { initialHistory, older, original, profileName, validate, type Revision } from './config'
import styles from '@/ui/CodeArea/ProfileReview.module.css'

const storageKey = 'iceslab.paper-review.profile.ru-reality.v1'
const description = 'Вход из России, под Cloudflare'

const readRevision = arr(obj({ label: str, source: str, text: str }))
function readRevisions(): Revision[] {
  return readStored(storageKey, readRevision, 'session') ?? []
}

const steps = [
  ['Протокол', 'VLESS'], ['Ядро', 'xray'], ['Транспорт', 'raw'], ['Защита', 'REALITY'],
  ['Маскировка', 'www.cloudflare.com'], ['Дополнительно', 'По умолчанию'],
] as const
const hosts = [
  ['NL', 'Amsterdam', 'nl-ams-01 · 443'], ['NL', 'Amsterdam mobile', 'nl-ams-01 · 443'],
  ['SE', 'Stockholm', 'se-sto-01 · 443'], ['DE', 'Frankfurt', 'de-fra-01 · 8443'],
] as const
const recipes = ['REALITY + Vision (raw)', 'REALITY + gRPC (RU camouflage)', 'REALITY + xhttp (HTTP/2 chunked)', 'Trojan + REALITY']

function SideInfo() {
  return <>
    <section><h2 className={styles.sideTitle}>Хосты <small>4</small></h2>
      {hosts.map(([flag, name, address]) => <div className={styles.host} key={name}><span className={styles.hostName}><Flag code={flag} />{name}</span><small>{address}</small></div>)}
      <div className={styles.totals}><div>Юзеры <b>1 204</b></div><div>Не получат <em>Surge, старый Clash</em></div></div>
    </section>
    <section><div className={styles.sideTitle}><h2>Рецепты</h2><small>Заполнят настройки, ключи останутся.</small></div>
      {recipes.map(name => <div className={styles.recipe} key={name}>{name}<Icon name="chevronRight" /></div>)}
      <div className={styles.recipeFoot}><span>Все рецепты</span><span>Импорт  Экспорт</span></div>
    </section>
  </>
}

export default function ProfileReview() {
  const now = useNow()
  const [history, setHistory] = useState(readRevisions)
  const saved = history[0]?.text ?? older
  const [text, setText] = useState(() => history[0]?.text ?? original)
  const [tab, setTab] = useState<'form'|'console'>('form')
  const [step, setStep] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [revision, select] = useState<Revision | null>(null)
  const [draftDiff, setDraftDiff] = useState(false)
  const [error, setError] = useState<ProfileError | null>(null)
  const [message, setMessage] = useState('')
  const dirty = text !== saved
  const rows = [...history.slice(1), ...initialHistory]
  const delta = changes(saved,text)
  function edit(value: string) { setText(value); setError(null); setMessage('') }
  function save() {
    const failure = validate(text)
    setError(failure)
    if (failure) { setTab('console'); setMessage(''); return }
    if (!dirty) return
    const date = new Date(now()).toLocaleString('ru-RU',{ day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
    const next = [{ label:date+', admin', source:'из консоли', text }, ...history]
    writeStored(storageKey, next, 'session')
    if (readRevisions()[0]?.text !== text) {
      setMessage('Не удалось сохранить в этой вкладке')
      return
    }
    setHistory(next); setMessage('Ядро приняло, сохранено'); setDraftDiff(false)
  }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
        event.preventDefault()
        if (!revision) save()
      }
    }
    window.addEventListener('keydown',key)
    return () => window.removeEventListener('keydown',key)
  })
  const diffFrom = revision?.text ?? (draftDiff ? saved : null)
  function showConsole() { setTab('console'); select(null); setDraftDiff(false) }
  return <div className={styles.page}>
    <div className={styles.header}>
      <Link className={styles.back} to="/profiles" aria-label="К профилям"><Icon name="chevronLeft" /></Link>
      <h1>{profileName}</h1><small>1 204 юзера</small><span className={styles.space} />
      {dirty && !revision && <em>● не сохранено</em>}
      <Button size="md" disabled={!dirty || !!revision} onClick={()=>{ edit(saved); select(null); setDraftDiff(false) }}>Отмена</Button>
      <Button size="md" variant="primary" icon={<Icon name="check" />} disabled={!dirty || !!error || !!revision} onClick={save}>Сохранить</Button>
    </div>
    <div className={styles.columns}><div className={styles.stack}>
      <section className={styles.basic}><h2>Основное</h2><div className={styles.fields}>
        <label>Имя<input readOnly value={profileName} /></label><label>Описание<input readOnly value={description} /></label>
      </div></section>
      <section className={styles.protocol}><div className={styles.protocolTitle}><div><h2>Настройки протокола</h2>
        <small>{tab==='form' ? 'Откройте шаг, который нужно изменить.' : 'Строки с замком ведёт панель, остальное пишите сами.'}</small></div>
        <Segmented<'form' | 'console'> label="Настройки протокола" value={tab} options={[{ value:'form', label:'Форма' },{ value:'console', label:'Консоль' }]} onChange={setTab} />
      </div>
      {tab==='form' ? <>
        {steps.map(([name,value],i)=><div key={name}><button className={styles.step} aria-expanded={step===name} onClick={()=>setStep(step===name ? '' : name)}>
          <span className={styles.badge}>{i<5 ? i+1 : '·'}</span>{name}<span className={styles.space}/><b>{value}</b><Icon name="chevronDown" /></button>
          {step===name && <div className={styles.stepDetail}>{value} <button onClick={showConsole}>Открыть в консоли</button></div>}</div>)}
        <div className={styles.from}>Задано в консоли <code>sniffing.routeOnly</code><button onClick={showConsole}>Открыть</button></div>
      </> : <>
        <div className={styles.tools}><span>Конфиг для</span><b>VLESS ﹀</b><span>на ядре</span><b>xray 26.3.27 ﹀</b><span className={styles.space}/><code>config.json</code>
          <Icon name="eye"/><button title="История правок" aria-label="История правок" aria-expanded={showHistory} onClick={()=>{setShowHistory(!showHistory);select(null);setDraftDiff(false)}}><Icon name="refresh"/></button>
          <button aria-label="Копировать конфиг" onClick={()=>void navigator.clipboard.writeText(text).catch(()=>setMessage('Копирование недоступно'))}><Icon name="copy"/></button>
          <button aria-label="Во весь экран" onClick={event=>{
            const panel = event.currentTarget.closest('section')
            if (document.fullscreenElement) void document.exitFullscreen()
            else if (panel) void panel.requestFullscreen().catch(()=>setMessage('Полный экран недоступен'))
          }}><Icon name="fullscreen"/></button>
        </div>
        {diffFrom !== null ? <Diff from={diffFrom} to={revision ? saved : text} label="Разница конфигураций" unchanged={count => count + ' строки без изменений'}/> : <Editor text={text} saved={saved} error={error} edit={edit}/>}
        {(error || message==='Ядро приняло, сохранено') && diffFrom===null && <div className={styles.log} role={error ? 'alert' : 'status'}>
          <code>{error ? 'config.json:'+error.line+':'+error.column+' '+error.reason : 'nl-ams-01 $ xray -test -c config.json'}</code>
          <code>{error ? 'Ядро не запускалось: сначала текст должен разобраться.' : 'Configuration OK.'}</code>
        </div>}
        <div className={styles.status} data-diff={revision ? true : undefined}><span className={styles.dot} data-tone={error ? 'error' : dirty || revision ? 'warn' : 'success'}/>
          <span>{revision ? 'Откат перезапустит ядро на 3 нодах' : error ? 'Ошибка в строке '+error.line+', не сохранено' : message || (dirty ? 'Изменены '+Math.max(delta.before.length,delta.after.length)+' строки' : 'Сохранено')}</span>
          <span className={styles.space}/>
          {diffFrom!==null ? <Button onClick={()=>{select(null);setDraftDiff(false)}}>К тексту</Button> : dirty && !error && <Button onClick={()=>setDraftDiff(true)}>Разница</Button>}
          {revision ? <Button variant="warn" disabled title="Откат не входит в локальную проверку">Откатить</Button> : <><kbd>Ctrl+S</kbd><small>{error ? 'проверит снова' : 'проверит и сохранит'}</small></>}
        </div>
      </>}</section>
      <section className={styles.remove}><div>Удалить профиль<small>Вместе с ним удалятся 4 хоста, в которых он выбран.</small></div><Button size="md" variant="danger" disabled icon={<Icon name="trash"/>}>Удалить</Button></section>
    </div><aside className={styles.stack}>
      {showHistory && tab==='console' && <section><div className={styles.sideTitle}><h2>История правок</h2><small>Откат вернёт конфиг и сам станет правкой.</small></div>
        <div className={styles.rev}><div>Сейчас, admin<small>из консоли</small></div><small>текущая</small></div>
        {rows.map((row,i)=><button className={styles.rev} key={i} onClick={()=>{select(row);setDraftDiff(false)}} aria-pressed={revision===row}><span>{row.label}<small>{row.source}</small></span><span>{revision===row ? 'показана' : 'разница'}</span></button>)}
      </section>}<SideInfo/>
    </aside></div>
  </div>
}
