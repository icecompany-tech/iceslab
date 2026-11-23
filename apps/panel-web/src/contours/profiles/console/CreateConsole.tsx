import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '@/ui/Icon/Icon'
import { Popover } from '@/ui/Popover/Popover'
import { Editor } from '@/ui/CodeArea/Editor'
import type { ProfileError } from '@/ui/CodeArea/text'
import styles from '@/ui/CodeArea/ProfileReview.module.css'

interface Props {
  text: string
  original: string
  error: ProfileError | null
  isEdit: boolean
  protocol: { label: string; preview?: boolean; file?: { file: string; engine: string } }
  choices: readonly { label: string; engine: string; available: boolean }[]
  actions: {
    onProtocol: (value: string) => void
    onSecurity: (value: "reality" | "tls" | "none") => void
    onGenerate: () => Promise<void>
    onEdit: (value: string) => void
  }
}

export function CreateConsole({ text, original, error, isEdit, protocol: { label: protocol, file, preview }, actions, choices }: Props) {
  const { onProtocol, onEdit, onSecurity, onGenerate } = actions
  const area = useRef<HTMLDivElement>(null)
  const [message, setMessage] = useState('')
  const [help, setHelp] = useState<{ key: 'security' | 'privateKey'; line: number } | null>(null)
  const [working, setWorking] = useState(false)
  const suggestion = useRef<HTMLDivElement>(null)
  function suggest(input: EventTarget | null) {
    if (file || !(input instanceof HTMLTextAreaElement) || input.selectionStart !== input.selectionEnd) { setHelp(null); return }
    const row = input.value.slice(0, input.selectionStart).split('\n').length - 1
    const key = /^\s*"(security|privateKey)"\s*:/.exec(input.value.split('\n')[row] ?? '')?.[1]
    setHelp(key === 'security' || (key === 'privateKey' && !isEdit) ? { key, line: row } : null)
  }
  useLayoutEffect(() => {
    const el = suggestion.current
    const input = area.current?.querySelector('textarea')
    if (!help || !el || !input || !area.current) return
    const css = getComputedStyle(input)
    el.style.top = (input.getBoundingClientRect().top - area.current.getBoundingClientRect().top + parseFloat(css.paddingTop) + (help.line + 1) * parseFloat(css.lineHeight)) + 'px'
  }, [help])
  async function generate() {
    setWorking(true)
    try { await onGenerate(); setHelp(null) }
    catch { setMessage('Не удалось сгенерировать ключи') }
    finally { setWorking(false) }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setMessage('Скопировано')
    } catch {
      setMessage('Браузер отказал в копировании')
    }
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await area.current?.requestFullscreen()
    } catch { setMessage('Полноэкранный режим недоступен') }
  }
  return <div ref={area} className={styles.consoleArea}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHelp(null) }}
    onClick={(event) => { if (event.target instanceof HTMLTextAreaElement) suggest(event.target) }}
    onKeyUp={(event) => {
      if (event.key === 'Escape') setHelp(null)
      else if (event.target instanceof HTMLTextAreaElement && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', ':', '"'].includes(event.key)) suggest(event.target)
    }}
    onKeyDown={(event) => { if (event.ctrlKey && event.code === 'Space') { event.preventDefault(); suggest(event.target) } }}>
    <div className={styles.tools}>
      <span>Конфиг для</span>
      <Popover trigger={(props) => <button type="button" aria-label="Выбор протокола" {...props}>{protocol}<Icon name="chevronDown" size="sm" /></button>}>
        {(close) => <div className={styles.consoleChoices}>{choices.map(({ label, engine, available }) =>
          <div key={label}>
            {label === 'MTProto' && <small>Для Telegram</small>}
            <button type="button" disabled={!available} aria-pressed={protocol === label} onClick={() => { close(); onProtocol(label) }}>{label}<small>{engine}</small></button>
          </div>)}</div>}
      </Popover>
      <span>на ядре</span><b>{file?.engine ?? 'xray'}</b><span className={styles.space} /><code>{file?.file ?? 'config.json'}</code>
      <button type="button" aria-label="Копировать конфиг" onClick={() => void copy()}><Icon name="copy" /></button>
      <button type="button" aria-label="Во весь экран" onClick={() => void fullscreen()}><Icon name="fullscreen" /></button>
    </div>
    <Editor fileName={file?.file} text={text} saved={original} error={error} clientsLabel={isEdit ? 'задаёт панель' : 'появятся с юзерами'} edit={(value) => { setMessage(''); onEdit(value) }} />
    {help && <div className={styles.suggestion} ref={suggestion} aria-label="Подстановка">
      <div>{help.key === 'security' ? (['reality','tls','none'] as const).map((value) =>
        <button key={value} type="button" onClick={() => { onSecurity(value); setHelp(null) }}>{value}</button>)
        : <button type="button" disabled={working} onClick={() => void generate()}>Сгенерировать пару</button>}</div>
      <div>{help.key === 'security' ? 'Защита соединения. Выбранное значение подставится в streamSettings.security.' : 'Ключ x25519. Пара и Short ID подставятся в настройки REALITY.'}</div>
    </div>}
    {error && <div className={styles.log} role="alert"><code>{file?.file ?? 'config.json'}:{error.line}:{error.column} {error.reason}</code></div>}
    <div className={styles.status} role="status">
      <span className={styles.dot} data-tone={error ? 'error' : text !== original ? 'warn' : 'success'} />
      <span>{error ? 'Текст не сохранён' : message || (text === original ? (preview ? 'Образец Paper' : 'Собрано из формы') : 'Есть ручные правки')}</span>
      <span className={styles.space} /><kbd>Ctrl+S</kbd><small>{preview ? 'сохранит на тестовом стенде' : isEdit ? 'проверит и сохранит' : 'проверит и создаст'}</small>
    </div>
  </div>
}
