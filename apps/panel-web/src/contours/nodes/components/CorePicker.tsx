import { componentsOfEngine, type EngineName, type NodeCoreVersions } from '@iceslab/shared'
import { useState, type ReactNode } from 'react'
import styles from '@/contours/nodes/components/nodes.module.css'
import { DICT } from '@/contours/nodes/dict'
import { engineLabel, isEngine } from '@/lib/domain/engines'
import { useDict } from '@/lib/i18n'
import { Check } from '@/ui/Check/Check'

const names: Record<string, string> = { xray: 'Xray', hysteria: 'Hysteria', amneziawg: 'AmneziaWG', naive: 'NaiveProxy', mieru: 'Mieru', mtproto: 'MTProto', 'tproxy-server': 'Telegram WEB' }
const protocols: Record<string, string> = { xray: 'VLESS, VMess, Trojan, Shadowsocks, SOCKS5, HTTP', singbox: 'VLESS, Trojan, Hysteria 2, Shadowsocks, TUIC, AnyTLS, ShadowTLS', hysteria: 'Hysteria 2', amneziawg: 'AWG 1.x, AWG 3.1', naive: 'NaiveProxy', mieru: 'Mieru', mtproto: 'MTProto (mtg)', 'tproxy-server': 'Telegram WEB' }
const native = ['xray', 'hysteria', 'amneziawg', 'naive', 'mieru', 'mtproto'] satisfies EngineName[]

type Props = {
  first?: string
  extra?: readonly string[]
  installed?: readonly EngineName[]
  toggle?: (key: EngineName) => void
  state?: (key: string) => string | undefined
  versions?: NodeCoreVersions
  children: (key: string) => ReactNode
}

export function CorePicker({ first = 'xray', extra = [], installed = [], toggle, state, versions, children }: Props) {
  const words = useDict(DICT)
  const [selected, select] = useState(first)
  const label = (key: string) => names[key] ?? engineLabel(key)
  const row = (key: string) => {
    const pin = versions && componentsOfEngine(key).map(component => versions[component]).find(Boolean)
    return (
    <div key={key} className={styles.pickerRow} data-selected={selected === key}>
      {toggle && isEngine(key) ? <Check label={engineLabel(key)} checked={installed.includes(key)} onChange={() => toggle(key)} />
        : <span className={styles.coreMarker} data-state={state?.(key)} />}
      <button type="button" aria-pressed={selected === key} onClick={() => select(key)}>
        <b>{label(key)} {pin && <code>{pin}</code>}</b><small>{protocols[key] ?? key}</small>
      </button>
    </div>
    )
  }
  return <div className={styles.corePicker}>
    <div className={styles.pickerList}>
      <h4>{words.nativeCores}</h4>
      {[...native, 'tproxy-server'].map(row)}
      <h4>{words.otherCores}</h4>
      {['singbox', ...extra.filter(key => key !== 'tproxy-server')].map(row)}
    </div>
    <section aria-label={label(selected)} className={styles.pickerDetails}>
      <h4>{label(selected)}</h4>
      <div className={styles.protocolTags}>{(protocols[selected] ?? selected).split(', ').map(protocol => <span key={protocol}>{protocol}</span>)}</div>
      {selected === 'xray' && <p className={styles.note}>{words.xrayAbout}</p>}
      {selected === 'singbox' && <p className={styles.note}>{words.singboxAbout}</p>}
      {children(selected)}
    </section>
  </div>
}
