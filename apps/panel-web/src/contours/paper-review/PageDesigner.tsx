import { ReviewPageState } from './ReviewPageState'
import { useState } from 'react'
import { Button } from '@/ui/Button/Button'
import { Field, Input } from '@/ui/Field/Field'
import { Choice, Failure } from './shared'
import { useReviewValue, useSample } from './reviewState'
import styles from './review.module.css'

const states: [string, string, string, string, string] = ['активна', 'истекает', 'истекла', 'лимит', 'отключена']
const publicStates = ['active', 'active', 'expired', 'limited', 'disabled']
const languages = ['RU', 'EN']
const apps = ['Happ', 'Hiddify', 'Karing', 'Streisand', 'AmneziaVPN', 'V2Box', 'Настройка вручную']
const copy = {
  RU: ['Срок закончился', 'Лимит исчерпан', 'Доступ отключён'],
  EN: ['Subscription expired', 'Traffic limit reached', 'Access disabled'],
}
const defaults = {
  name: 'Iceslab',
  locale: 'RU',
  apps,
  RU: ['Продлите, и всё снова заработает.', 'Доступ вернётся, когда лимит обновят.', 'Включить её может поддержка.'],
  EN: ['Renew to reconnect.', 'Access returns when the limit resets.', 'Support can turn access back on.'],
}
type Lang = keyof typeof copy

export default function PageDesigner() {
  const { sample, reset } = useSample()
  const [saved, save] = useReviewValue('subscription-page', defaults)
  const [draft, setDraft] = useState(saved)
  const [editorLang, setEditorLang] = useState<Lang>('RU')
  const [lang, setLang] = useState<Lang>(draft.locale === 'EN' ? 'EN' : 'RU')
  const [state, setState] = useState(states[0])
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft)
  const index = states.indexOf(state)
  if (sample === 'offline') return <ReviewPageState title="Не удалось загрузить настройки страницы" body="Сервер панели не ответил. Клиенты при этом получают подписку как раньше: сломана только эта страница." retry={reset} />
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1>Страница подписки</h1>
        <span className={styles.muted}>что видит человек, открывший ссылку</span>
        <span className={styles.push} />
        {dirty && <span role="status">не сохранено</span>}
        <Button onClick={() => setDraft(saved)}>Отмена</Button>
        <Button variant="primary" disabled={!draft.name.trim()} onClick={() => save(draft)}>
          Сохранить
        </Button>
      </div>
      <div className={styles.columns}>
        <div className={styles.stack}>
          <section className={styles.card}>
            <h2>Вид страницы</h2>
            <Field label="Название">
              {(props) => (
                <Input {...props} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              )}
            </Field>
            <Field label="Язык по умолчанию">
              {(props) => (
                <select
                  {...props}
                  className={styles.control}
                  value={draft.locale}
                  onChange={(e) => setDraft({ ...draft, locale: e.target.value })}
                >
                  <option value="RU">Русский</option>
                  <option value="EN">English</option>
                </select>
              )}
            </Field>
          </section>
          <section className={styles.card}>
            <h2>Когда подключиться нельзя</h2>
            <p className={styles.muted}>Что человек читает на странице.</p>
            <Choice
              label="Язык текста"
              options={languages}
              value={editorLang}
              change={(l) => setEditorLang(l as Lang)}
            />
            {copy[editorLang].map((text, i) => (
              <Field key={text} label={text}>
                {(props) => (
                  <textarea
                    {...props}
                    className={styles.control}
                    rows={2}
                    value={draft[editorLang][i]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [editorLang]: draft[editorLang].map((v, j) => (j === i ? e.target.value : v)),
                      })
                    }
                  />
                )}
              </Field>
            ))}
          </section>
          <section className={styles.card}>
            <h2>Приложения на странице</h2>
            {apps.map((app) => (
              <label key={app}>
                <input
                  type="checkbox"
                  checked={draft.apps.includes(app)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      apps: e.target.checked ? [...draft.apps, app] : draft.apps.filter((v) => v !== app),
                    })
                  }
                />{' '}
                {app}
              </label>
            ))}
          </section>
        </div>
        <div className={styles.stack}>
          <section className={styles.card}>
            <h2>Предпросмотр</h2>
            <Choice label="Язык предпросмотра" options={languages} value={lang} change={(l) => setLang(l as Lang)} />
            <div className={styles.line}>
              {states.map((value) => (
                <Button
                  key={value}
                  aria-pressed={state === value}
                  variant={state === value ? 'primary' : 'normal'}
                  onClick={() => setState(value)}
                >
                  {value}
                </Button>
              ))}
            </div>
          </section>
          {sample === 'no-link' ? (
            <Failure title="Предпросмотр не открылся" reset={reset} />
          ) : (
            <section className={styles.card} aria-label="Страница клиента">
              <div className={styles.toolbar}>
                <strong>{draft.name}</strong>
                <span className={styles.push} />
                {lang}
              </div>
              {index < 2 ? (
                <>
                  <h2>alex-hm</h2>
                  <p>
                    {lang === 'RU'
                      ? index === 0
                        ? 'Активна'
                        : 'Скоро истекает'
                      : index === 0
                        ? 'Active'
                        : 'Expiring soon'}
                  </p>
                  <p>{lang === 'RU' ? 'Трафик: 118 из 200 ГБ' : 'Traffic: 118 of 200 GB'}</p>
                  <p>
                    {lang === 'RU' ? 'Действует до' : 'Valid until'} {index === 0 ? '26.01.2027' : '06.11.2026'}
                  </p>
                  <h3>{lang === 'RU' ? 'Как подключиться' : 'How to connect'}</h3>
                  <p>{draft.apps.join(' · ')}</p>
                </>
              ) : (
                <>
                  <h2>{copy[lang][index - 2]}</h2>
                  <p>{draft[lang][index - 2] || defaults[lang][index - 2]}</p>
                  <p>{lang === 'RU' ? 'Поддержка' : 'Support'}</p>
                </>
              )}
            </section>
          )}
          {sample !== 'no-link' && (
            <a
              className={styles.link}
              href={'/sub/review-' + publicStates[index] + '?lang=' + lang.toLowerCase()}
              target="_blank"
              rel="noreferrer"
            >
              Открыть пример в новой вкладке
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
