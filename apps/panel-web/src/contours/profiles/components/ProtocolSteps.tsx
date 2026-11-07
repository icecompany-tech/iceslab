// The steps of a protocol: a registry, one entry per protocol (codex O). A new protocol is a new
// entry here and breaks the build until it has one. Words in the fields are those of the old form.
import type { ProtocolName } from '@iceslab/shared'
import type { ReactNode } from 'react'
import styles from '@/contours/profiles/components/profiles.module.css'
import { CFG_WORDS } from '@/contours/profiles/cfgWords'
import { DICT } from '@/contours/profiles/dict'
import { MOBILE_PRESET, randomAwgHeaders, TSPU_PRESET } from '@/contours/profiles/lib/awgPresets'
import { subnetCapacity } from '@/contours/profiles/lib/awgSubnet'
import { isPlainSubprotocol } from '@/contours/profiles/lib/plainSubprotocol'
import { formProblems } from '@/contours/profiles/lib/profileBody'
import { defaults } from '@/contours/profiles/lib/profileDefaults'
import { renameAwg, type FormValues } from '@/contours/profiles/lib/profileFormValues'
import { ssKeyState } from '@/contours/profiles/lib/ssServerKey'
import { FLOW_COMPATIBLE_TRANSPORTS, PATH_HOST_TRANSPORTS, transportsFor, XRAY_TRANSPORTS } from '@/contours/profiles/lib/xrayTransports'
import { fmtNumber } from '@/lib/format'
import { useDict, useLocale } from '@/lib/i18n'
import { AWG_PROTOCOLS, awgLabel, type AwgProtocol } from '@/lib/old/awg'
import type { Profile } from '@/lib/old/profiles'
import { Banner } from '@/ui/Banner/Banner'
import { Button } from '@/ui/Button/Button'
import { Field, Input } from '@/ui/Field/Field'
import { Keys, Secret } from '@/contours/profiles/components/StepFields'
import { RadioRow } from '@/ui/RadioRow/RadioRow'
import { Select } from '@/ui/Select/Select'

export interface StepDef {
  id: string
  title: string
  value?: ReactNode
  optional?: boolean
  faded?: string
  invalid?: boolean
  body: ReactNode
}

export interface StepProps {
  values: FormValues
  patch: (next: Partial<FormValues>) => void
  isEdit: boolean
  profile: Profile | null
  /** Generate a key pair for the protocol, through the window of cost when needed. */
  onGenerate: () => void
  generating: boolean
  destError: string | null
}

type Words = ReturnType<typeof useStepWords>

function useStepWords() {
  const words = useDict(DICT)
  const cfg = useDict(CFG_WORDS)
  return { words, cfg }
}

function numberInput(value: number | '', onChange: (next: number | '') => void, a11y: object) {
  return <Input {...a11y} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value === '' || Number.isNaN(Number(e.target.value)) ? '' : Number(e.target.value))} />
}

function readFileInto(onText: (text: string) => void) {
  return (event: { target: HTMLInputElement }) => {
    const file = event.target.files?.[0]
    if (file) void file.text().then(onText)
  }
}

function xraySteps(props: StepProps, { words, cfg }: Words): StepDef[] {
  const { values: v, patch } = props
  const onSingbox = v.engine === 'singbox'
  const problems = formProblems(v)
  const realityClosed = onSingbox ? undefined : v.xraySubprotocol === 'vmess' ? words.onlyVlessTrojan : !['raw', 'xhttp', 'grpc'].includes(v.xrayNetwork) ? words.onlyRealityNetworks : undefined
  const transport: StepDef = {
    id: 'transport',
    title: words.stepTransport,
    value: XRAY_TRANSPORTS.find((t) => t.value === v.xrayNetwork)?.label,
    invalid: v.xrayNetwork === 'kcp',
    body: [
      v.xrayNetwork === 'kcp' && (
        <Banner key="kcp-refused" tone="warn">
          {words.kcpRefused}
        </Banner>
      ),
      ...transportsFor(props.profile ? defaults(props.profile).xrayNetwork : undefined, v.xrayNetwork).map((t) => (
      <RadioRow key={t.value} name="network" title={t.label} description={words.transportHint[t.value]} checked={v.xrayNetwork === t.value} closedReason={onSingbox && t.value !== 'raw' ? words.onlyXrayCore : undefined} onSelect={() => patch({ xrayNetwork: t.value })}>
        {PATH_HOST_TRANSPORTS.includes(t.value) && (
          <div className={styles.twoFields}>
            <Field label={words.path}>{(a11y) => <Input {...a11y} value={v.xrayPath} onChange={(e) => patch({ xrayPath: e.target.value })} />}</Field>
            <Field label={words.hostHeader} hint={cfg.hostHeaderDesc}>{(a11y) => <Input {...a11y} value={v.xrayHostHeader} onChange={(e) => patch({ xrayHostHeader: e.target.value })} />}</Field>
          </div>
        )}
        {t.value === 'grpc' && <Field label={words.serviceName} hint={cfg.grpcServiceNameDesc}>{(a11y) => <Input {...a11y} value={v.xrayServiceName} onChange={(e) => patch({ xrayServiceName: e.target.value })} />}</Field>}
        {t.value === 'xhttp' && (
          <div className={styles.twoFields}>
            <Field label={cfg.xhttpModeLabel} hint={cfg.xhttpModeDesc}>{(a11y) => <Select {...a11y} value={v.xrayXhttpMode} onChange={(e) => patch({ xrayXhttpMode: e.target.value as FormValues['xrayXhttpMode'] })} options={['auto', 'packet-up', 'stream-up', 'stream-one'].map((m) => ({ value: m, label: m }))} />}</Field>
            <Field label={cfg.xhttpPaddingBytesLabel} hint={cfg.xhttpPaddingBytesDesc}>{(a11y) => <Input {...a11y} value={v.xrayXhttpPaddingBytes} onChange={(e) => patch({ xrayXhttpPaddingBytes: e.target.value })} />}</Field>
          </div>
        )}
      </RadioRow>
      )),
    ],
  }
  const security: StepDef = {
    id: 'security',
    title: words.stepSecurity,
    value: v.xraySecurity === 'reality' ? words.securityReality : v.xraySecurity === 'tls' ? words.securityTls : words.securityNone,
    invalid: problems.security !== undefined,
    body: (
      <>
        {problems.security && <div role="alert" className={styles.stepError}>{words.securityWrongNetwork}</div>}
        <RadioRow name="security" title={words.securityReality} description={words.securityRealityDesc} checked={v.xraySecurity === 'reality'} closedReason={realityClosed} onSelect={() => patch({ xraySecurity: 'reality' })}>
          <Keys props={props} privateKey={v.xrayPrivateKey} publicKey={v.xrayPublicKey} onPrivate={(xrayPrivateKey) => patch({ xrayPrivateKey })} onPublic={(xrayPublicKey) => patch({ xrayPublicKey })} publicPlaceholder={cfg.realityPublicKeyDesc} />
          <Field label={cfg.shortIdsLabel} hint={cfg.realityShortIdsDesc}>{(a11y) => <Input {...a11y} value={v.xrayShortIds} onChange={(e) => patch({ xrayShortIds: e.target.value })} />}</Field>
        </RadioRow>
        <RadioRow name="security" title={words.securityTls} description={words.securityTlsDesc} checked={v.xraySecurity === 'tls'} closedReason={onSingbox ? words.onlyXrayCore : undefined} onSelect={() => patch({ xraySecurity: 'tls' })}>
          <Field label={words.tlsDomain}>{(a11y) => <Input {...a11y} value={v.xrayTlsServerName} onChange={(e) => patch({ xrayTlsServerName: e.target.value })} />}</Field>
          <Field label={words.tlsCert}>{(a11y) => <textarea {...a11y} className={styles.pem} value={v.xrayTlsCert} onChange={(e) => patch({ xrayTlsCert: e.target.value })} />}</Field>
          <label className={styles.fileRow}>
            {words.fromFile}
            <input type="file" onChange={readFileInto((xrayTlsCert) => patch({ xrayTlsCert }))} />
          </label>
          <Field label={words.tlsKey}>{(a11y) => <textarea {...a11y} className={styles.pem} value={v.xrayTlsKey} onChange={(e) => patch({ xrayTlsKey: e.target.value })} />}</Field>
          <label className={styles.fileRow}>
            {words.fromFile}
            <input type="file" onChange={readFileInto((xrayTlsKey) => patch({ xrayTlsKey }))} />
          </label>
        </RadioRow>
        <RadioRow name="security" title={words.securityNone} description={words.securityNoneDesc} checked={v.xraySecurity === 'none'} closedReason={onSingbox ? words.onlyXrayCore : undefined} onSelect={() => patch({ xraySecurity: 'none' })} />
      </>
    ),
  }
  const masquerade: StepDef = {
    id: 'masquerade',
    title: words.stepMasquerade,
    value: v.xraySecurity === 'reality' ? (v.xrayRealityMode === 'self-steal' ? words.masqSelf : v.xrayDest) : undefined,
    faded: v.xraySecurity === 'reality' ? undefined : words.onlyForReality,
    invalid: props.destError !== null,
    body: (
      <>
        <RadioRow name="mode" title={words.masqOthers} description={words.masqOthersDesc} checked={v.xrayRealityMode === 'steal-others'} onSelect={() => patch({ xrayRealityMode: 'steal-others' })}>
          <Field label={words.target} error={props.destError ?? undefined} hint={cfg.realityDestDesc}>{(a11y) => <Input {...a11y} placeholder={words.targetPlaceholder} value={v.xrayDest} onChange={(e) => patch({ xrayDest: e.target.value })} />}</Field>
          <Field label={cfg.serverNamesLabel} hint={cfg.realityServerNamesDesc}>{(a11y) => <Input {...a11y} value={v.xrayServerNames} onChange={(e) => patch({ xrayServerNames: e.target.value })} />}</Field>
        </RadioRow>
        <RadioRow name="mode" title={words.masqSelf} description={words.masqSelfDesc} checked={v.xrayRealityMode === 'self-steal'} closedReason={onSingbox ? words.onlyXrayCore : undefined} onSelect={() => patch({ xrayRealityMode: 'self-steal' })}>
          <Field label={cfg.realitySelfStealDomainLabel} hint={cfg.realitySelfStealDomainDesc}>{(a11y) => <Input {...a11y} value={v.xrayServerNames} onChange={(e) => patch({ xrayServerNames: e.target.value })} />}</Field>
          <Field label={cfg.realityFallbackUpstreamLabel} hint={cfg.realityFallbackUpstreamDesc}>{(a11y) => <Input {...a11y} value={v.xrayRealityFallbackUpstream} onChange={(e) => patch({ xrayRealityFallbackUpstream: e.target.value })} />}</Field>
        </RadioRow>
      </>
    ),
  }
  const flowOk = FLOW_COMPATIBLE_TRANSPORTS.includes(v.xrayNetwork)
  const advanced: StepDef = {
    id: 'advanced',
    title: words.stepAdvanced,
    optional: true,
    value: words.byDefault,
    body: (
      <>
        <div className={styles.twoFields}>
          <Field label={words.fingerprint} hint={cfg.realityFingerprintDesc}>{(a11y) => <Select {...a11y} value={v.xrayFingerprint} onChange={(e) => patch({ xrayFingerprint: e.target.value })} options={['firefox', 'chrome', 'safari', 'edge', 'ios', 'android', 'random', 'randomized'].map((f) => ({ value: f, label: f }))} />}</Field>
          <Field label={words.flow} hint={flowOk ? cfg.realityFlowDesc : words.flowClosed}>{(a11y) => <Select {...a11y} disabled={!flowOk} value={flowOk ? v.xrayFlow : ''} onChange={(e) => patch({ xrayFlow: e.target.value })} options={[{ value: '', label: words.flowNone }, { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' }]} />}</Field>
        </div>
        {v.xraySecurity === 'reality' && (
          <>
            <div className={styles.twoFields}>
              <Field label={cfg.realityXverLabel} hint={cfg.realityXverDesc}>{(a11y) => <Select {...a11y} value={String(v.xrayRealityXver)} onChange={(e) => patch({ xrayRealityXver: Number(e.target.value) as 0 | 1 | 2 })} options={['0', '1', '2'].map((x) => ({ value: x, label: x }))} />}</Field>
              <Field label={cfg.realityMaxTimeDiffLabel} hint={cfg.realityMaxTimeDiffDesc}>{(a11y) => numberInput(v.xrayRealityMaxTimeDiff, (xrayRealityMaxTimeDiff) => patch({ xrayRealityMaxTimeDiff }), a11y)}</Field>
            </div>
            <div className={styles.twoFields}>
              <Field label={cfg.realityLimitFallbackUploadLabel} hint={cfg.realityLimitFallbackUploadDesc}>{(a11y) => numberInput(v.xrayRealityLimitFallbackUpload, (xrayRealityLimitFallbackUpload) => patch({ xrayRealityLimitFallbackUpload }), a11y)}</Field>
              <Field label={cfg.realityLimitFallbackDownloadLabel} hint={cfg.realityLimitFallbackDownloadDesc}>{(a11y) => numberInput(v.xrayRealityLimitFallbackDownload, (xrayRealityLimitFallbackDownload) => patch({ xrayRealityLimitFallbackDownload }), a11y)}</Field>
            </div>
          </>
        )}
        {v.xrayNetwork === 'grpc' && (
          <label className={styles.checkRow}>
            <input type="checkbox" checked={v.xrayGrpcMultiMode} onChange={(e) => patch({ xrayGrpcMultiMode: e.target.checked })} />
            {cfg.grpcMultiModeLabel}
          </label>
        )}
        {v.xraySecurity === 'tls' && (
          <label className={styles.checkRow}>
            <input type="checkbox" checked={v.xrayTlsRejectUnknownSni} onChange={(e) => patch({ xrayTlsRejectUnknownSni: e.target.checked })} />
            {cfg.tlsRejectUnknownSniLabel}
          </label>
        )}
        {!onSingbox && (
          <fieldset className={styles.fieldset} disabled>
            <legend>{words.tcpTimeouts}</legend>
            <div className={styles.threeFields}>
              <Field label={words.tcpUserTimeout}>{(a11y) => <Input {...a11y} placeholder="-" />}</Field>
              <Field label={words.tcpKeepAliveIdle}>{(a11y) => <Input {...a11y} placeholder="-" />}</Field>
              <Field label={words.tcpKeepAliveInterval}>{(a11y) => <Input {...a11y} placeholder="-" />}</Field>
            </div>
            <p className={styles.note}>{words.tcpEmpty} {words.tcpOldAgent} {words.tcpWaiting}</p>
          </fieldset>
        )}
      </>
    ),
  }
  return [transport, security, masquerade, advanced]
}

function plainSteps(props: StepProps, { cfg }: Words): StepDef[] {
  const socks = props.values.xraySubprotocol === 'socks'
  return [
    {
      id: 'plain',
      title: socks ? 'SOCKS5' : 'HTTP',
      body: (
        <ul className={styles.plainList}>
          <li>{cfg.plain.onXray}</li>
          <li>{cfg.plain.fixed}</li>
          <li>{cfg.plain.auth}</li>
          <li>{socks ? cfg.plain.portSocks : cfg.plain.portHttp}</li>
        </ul>
      ),
    },
  ]
}

function hysteriaSteps({ values: v, patch }: StepProps, { words, cfg }: Words): StepDef[] {
  const problems = formProblems(v)
  return [
    {
      id: 'obfs',
      title: words.stepObfs,
      optional: true,
      value: v.hyObfsPassword ? 'Salamander' : '-',
      body: <Secret label={cfg.salamanderObfsLabel} hint={cfg.salamanderObfsDesc} value={v.hyObfsPassword} onChange={(hyObfsPassword) => patch({ hyObfsPassword })} words={words} />,
    },
    {
      id: 'masq',
      title: words.stepMasquerade,
      optional: true,
      value: v.hyMasqueradeUrl || '-',
      body: <Field label={cfg.masqueradeUrlLabel}>{(a11y) => <Input {...a11y} placeholder="https://en.wikipedia.org" value={v.hyMasqueradeUrl} onChange={(e) => patch({ hyMasqueradeUrl: e.target.value })} />}</Field>,
    },
    {
      id: 'speed',
      title: words.stepSpeed,
      optional: true,
      value: v.hyBrutalUp || v.hyBrutalDown ? `${v.hyBrutalUp || '-'}/${v.hyBrutalDown || '-'}` : '-',
      body: (
        <div className={styles.twoFields}>
          <Field label={cfg.brutalUpLabel}>{(a11y) => numberInput(v.hyBrutalUp, (hyBrutalUp) => patch({ hyBrutalUp }), a11y)}</Field>
          <Field label={cfg.brutalDownLabel}>{(a11y) => numberInput(v.hyBrutalDown, (hyBrutalDown) => patch({ hyBrutalDown }), a11y)}</Field>
        </div>
      ),
    },
    {
      id: 'ports',
      title: words.stepPorts,
      optional: true,
      invalid: problems.portHop !== undefined,
      value: v.hyPortHopStart ? `${v.hyPortHopStart}-${v.hyPortHopEnd || '?'}` : '-',
      body: (
        <div className={styles.twoFields}>
          <Field label={cfg.portRangeStart} hint={cfg.portRangeStartDesc} error={problems.portHop === 'hyPortHopStart' ? cfg.portRangeNoStart : undefined}>{(a11y) => numberInput(v.hyPortHopStart, (hyPortHopStart) => patch({ hyPortHopStart }), a11y)}</Field>
          <Field label={cfg.portRangeEnd} hint={cfg.portRangeEndDesc} error={problems.portHop === 'hyPortHopEnd' ? cfg.portRangeBadEnd : undefined}>{(a11y) => numberInput(v.hyPortHopEnd, (hyPortHopEnd) => patch({ hyPortHopEnd }), a11y)}</Field>
        </div>
      ),
    },
  ]
}

function awgSteps(props: StepProps, { words, cfg }: Words, locale: 'ru' | 'en'): StepDef[] {
  const { values: v, patch, isEdit } = props
  const capacity = subnetCapacity(v.awgSubnet)
  const problems = formProblems(v)
  const num = (label: string, key: 'awgJc' | 'awgJmin' | 'awgJmax' | 'awgS1' | 'awgS2' | 'awgS3' | 'awgS4' | 'awgH1' | 'awgH2' | 'awgH3' | 'awgH4', hint?: string) => (
    <Field key={key} label={label} hint={hint}>
      {(a11y) => numberInput(v[key], (next) => patch({ [key]: next, awgPreset: 'custom' }), a11y)}
    </Field>
  )
  const preset = (next: 'tspu' | 'mobile') => {
    const headers = randomAwgHeaders()
    patch({ awgPreset: next, ...renameAwg(next === 'tspu' ? TSPU_PRESET : MOBILE_PRESET), awgH1: headers.h1, awgH2: headers.h2, awgH3: headers.h3, awgH4: headers.h4 })
  }
  return [
    {
      id: 'generation',
      title: words.stepGeneration,
      value: awgLabel(v.awgGeneration),
      body: (
        <>
          <Field label={cfg.awgGenerationLabel} hint={cfg.awgGenerationHint}>{(a11y) => <Select {...a11y} value={String(v.awgGeneration)} onChange={(e) => patch({ awgGeneration: Number(e.target.value) as AwgProtocol })} options={AWG_PROTOCOLS.map((g) => ({ value: String(g), label: awgLabel(g) }))} />}</Field>
          {v.awgGeneration === 3 && <p className={styles.note}>{cfg.awgGenerationPending}</p>}
          <Banner tone="info" title={cfg.awgImportantTitle}>
            {cfg.awgImportant1} {cfg.awgImportant3}
          </Banner>
        </>
      ),
    },
    {
      id: 'network',
      title: words.stepNetwork,
      value: v.awgSubnet,
      body: (
        <>
          <Field label={cfg.awgSubnetLabel} hint={isEdit ? cfg.awgSubnetLockedHint : cfg.awgSubnetHint}>{(a11y) => <Input {...a11y} disabled={isEdit} placeholder="10.66.66.0/24" value={v.awgSubnet} onChange={(e) => patch({ awgSubnet: e.target.value })} />}</Field>
          {capacity !== null && <p className={styles.note}>{words.subnetCapacity(fmtNumber(capacity, locale))}</p>}
        </>
      ),
    },
    {
      id: 'keys',
      title: words.stepKeys,
      value: v.awgServerPub ? `${v.awgServerPub.slice(0, 12)}...` : '-',
      body: <Keys props={props} privateKey={v.awgServerPriv} publicKey={v.awgServerPub} onPrivate={(awgServerPriv) => patch({ awgServerPriv })} onPublic={(awgServerPub) => patch({ awgServerPub })} publicPlaceholder={cfg.awgServerPubPlaceholder} />,
    },
    {
      id: 'obfuscation',
      title: words.stepAwgObfs,
      value: v.awgPreset === 'tspu' ? words.presetTspu : v.awgPreset === 'mobile' ? words.presetMobile : words.presetCustom,
      invalid: problems.awgHeaders === true,
      body: (
        <>
          <RadioRow name="awgPreset" title={words.presetTspu} description={`Jc ${TSPU_PRESET.jc}, Jmin ${TSPU_PRESET.jmin}, Jmax ${TSPU_PRESET.jmax}, S1 ${TSPU_PRESET.s1}, S2 ${TSPU_PRESET.s2}`} checked={v.awgPreset === 'tspu'} onSelect={() => preset('tspu')} />
          <RadioRow name="awgPreset" title={words.presetMobile} description={`Jc ${MOBILE_PRESET.jc}, Jmin ${MOBILE_PRESET.jmin}, Jmax ${MOBILE_PRESET.jmax}, S1 ${MOBILE_PRESET.s1}, S2 ${MOBILE_PRESET.s2}`} checked={v.awgPreset === 'mobile'} onSelect={() => preset('mobile')} />
          <RadioRow name="awgPreset" title={words.presetCustom} checked={v.awgPreset === 'custom'} onSelect={() => patch({ awgPreset: 'custom' })}>
            <div className={styles.fourFields}>
              {num('Jc', 'awgJc')}
              {num('Jmin', 'awgJmin')}
              {num('Jmax', 'awgJmax')}
              {num('S1', 'awgS1')}
              {num('S2', 'awgS2')}
              {num('S3', 'awgS3', words.keepZero)}
              {num('S4', 'awgS4', words.keepZero)}
            </div>
            <div className={styles.fourFields}>
              {num('H1', 'awgH1')}
              {num('H2', 'awgH2')}
              {num('H3', 'awgH3')}
              {num('H4', 'awgH4')}
            </div>
            {problems.awgHeaders && <div role="alert" className={styles.stepError}>{words.awgHeadersDup}</div>}
            <div>
              <Button
                onClick={() => {
                  const h = randomAwgHeaders()
                  patch({ awgH1: h.h1, awgH2: h.h2, awgH3: h.h3, awgH4: h.h4 })
                }}
              >
                {words.headersRoll}
              </Button>
            </div>
          </RadioRow>
        </>
      ),
    },
    {
      id: 'mimicry',
      title: words.stepMimicry,
      optional: true,
      value: v.awgI1 || v.awgI2 || v.awgI3 || v.awgI4 || v.awgI5 ? words.changedCount([v.awgI1, v.awgI2, v.awgI3, v.awgI4, v.awgI5].filter(Boolean).length) : '-',
      body: (
        <>
          <p className={styles.note}>{cfg.awgMimicryDesc}</p>
          {(['awgI1', 'awgI2', 'awgI3', 'awgI4', 'awgI5'] as const).map((key, i) => (
            <Field key={key} label={`I${i + 1}`}>{(a11y) => <Input {...a11y} value={v[key]} onChange={(e) => patch({ [key]: e.target.value })} />}</Field>
          ))}
        </>
      ),
    },
  ]
}

const CIPHERS = ['2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305', 'chacha20-ietf-poly1305', 'aes-256-gcm', 'aes-128-gcm'] as const

function ssSteps({ values: v, patch, isEdit, profile }: StepProps, { words, cfg }: Words): StepDef[] {
  return [
    {
      id: 'cipher',
      title: words.stepCipher,
      value: v.ssMethod,
      body: (
        <>
          <Field label={cfg.ssCipherLabel}>{(a11y) => <Select {...a11y} value={v.ssMethod} onChange={(e) => patch({ ssMethod: e.target.value as FormValues['ssMethod'] })} options={CIPHERS.map((c) => ({ value: c, label: c }))} />}</Field>
          <p className={styles.note}>{cfg.ssKey[ssKeyState(profile?.config, isEdit, v.ssMethod)]}</p>
          <p className={styles.note}>{cfg.ssNote}</p>
        </>
      ),
    },
  ]
}

function oneField(id: string, title: string, value: ReactNode, body: ReactNode): StepDef[] {
  return [{ id, title, value, body }]
}

const STEPS: Record<ProtocolName, (props: StepProps, words: Words, locale: 'ru' | 'en') => StepDef[]> = {
  xray: (p, w) => (isPlainSubprotocol(p.values.xraySubprotocol) ? plainSteps(p, w) : xraySteps(p, w)),
  hysteria: hysteriaSteps,
  amneziawg: awgSteps,
  shadowsocks: ssSteps,
  naive: ({ values: v, patch }, { words, cfg }) =>
    oneField(
      'site',
      words.stepSite,
      v.naiveHostname || '-',
      <>
        <Field label={cfg.naiveHostnameLabel}>{(a11y) => <Input {...a11y} value={v.naiveHostname} onChange={(e) => patch({ naiveHostname: e.target.value })} />}</Field>
        <Field label={cfg.naiveTlsEmailLabel}>{(a11y) => <Input {...a11y} type="email" value={v.naiveTlsEmail} onChange={(e) => patch({ naiveTlsEmail: e.target.value })} />}</Field>
        <Field label={cfg.naiveMasqueradeLabel}>{(a11y) => <Input {...a11y} value={v.naiveMasquerade} onChange={(e) => patch({ naiveMasquerade: e.target.value })} />}</Field>
      </>,
    ),
  mtproto: ({ values: v, patch }, { words, cfg }) =>
    oneField(
      'domain',
      words.stepMasquerade,
      v.mtgDomain || '-',
      <Field label={cfg.mtprotoDomain} warning={cfg.mtprotoDomainNote}>{(a11y) => <Input {...a11y} value={v.mtgDomain} onChange={(e) => patch({ mtgDomain: e.target.value })} />}</Field>,
    ),
  mieru: ({ values: v, patch }, { words, cfg }) =>
    oneField('mtu', words.stepNetwork, v.mieruMtu || '-', <Field label={cfg.mieruMtu}>{(a11y) => numberInput(v.mieruMtu, (mieruMtu) => patch({ mieruMtu }), a11y)}</Field>),
  tuic: ({ values: v, patch }, { words }) =>
    oneField(
      'tuic',
      words.stepSite,
      v.tuicServerName || '-',
      <>
        <Field label="Server name">{(a11y) => <Input {...a11y} value={v.tuicServerName} onChange={(e) => patch({ tuicServerName: e.target.value })} />}</Field>
        <Field label="Congestion control">{(a11y) => <Select {...a11y} value={v.tuicCongestion} onChange={(e) => patch({ tuicCongestion: e.target.value as FormValues['tuicCongestion'] })} options={['bbr', 'cubic', 'new_reno'].map((c) => ({ value: c, label: c }))} />}</Field>
      </>,
    ),
  anytls: ({ values: v, patch }, { words }) =>
    oneField('anytls', words.stepSite, v.anytlsServerName || '-', <Field label="Server name">{(a11y) => <Input {...a11y} value={v.anytlsServerName} onChange={(e) => patch({ anytlsServerName: e.target.value })} />}</Field>),
  shadowtls: ({ values: v, patch }, { words }) =>
    oneField(
      'shadowtls',
      words.stepSite,
      v.shadowtlsHandshake || '-',
      <>
        <Field label="Handshake">{(a11y) => <Input {...a11y} value={v.shadowtlsHandshake} onChange={(e) => patch({ shadowtlsHandshake: e.target.value })} />}</Field>
        <Field label="Shadowsocks">{(a11y) => <Select {...a11y} value={v.shadowtlsSsMethod} onChange={(e) => patch({ shadowtlsSsMethod: e.target.value as FormValues['shadowtlsSsMethod'] })} options={CIPHERS.map((c) => ({ value: c, label: c }))} />}</Field>
      </>,
    ),
}

export function useProtocolSteps(props: StepProps): StepDef[] {
  const words = useStepWords()
  const { locale } = useLocale()
  return STEPS[props.values.protocol](props, words, locale)
}
