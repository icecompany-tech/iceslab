import type { RoutingPresetId } from '@iceslab/shared'
import { useMemo, useRef, useState } from 'react'
import { NodePolicyEditor } from '@/contours/traffic/components/NodePolicyEditor'
import { OwnRules } from '@/contours/traffic/components/OwnRules'
import { PresetEditor } from '@/contours/traffic/components/PresetEditor'
import { RoutePolicyEditor } from '@/contours/traffic/components/RoutePolicyEditor'
import styles from '@/contours/traffic/components/traffic.module.css'
import { useCascadesList, useNodePolicies, useOldSquads, usePresets, useRoutePolicies, useSettings } from '@/contours/traffic/hooks/useRoutes'
import { blankPreset, noteKeyFor, PRESET_DNS } from '@/contours/traffic/lib/devicePresets'
import { nodeCountOf, nodeCountWords } from '@/contours/traffic/lib/nodePolicyCount'
import { exportJson, parseImport, policyRules } from '@/contours/traffic/lib/routeExchange'
import { blankPolicy, importedPolicy } from '@/contours/traffic/lib/routeRules'
import { defaultPresetOf, presetsFromList } from '@/contours/traffic/lib/routesView'
import { DICT, sayer } from '@/contours/traffic/routesDict'
import { useDict, useLocale } from '@/lib/i18n'
import { failureText } from '@/lib/net/messages'
import { blankNodePolicy, type NodePolicy } from '@/lib/old/nodePolicies'
import type { RoutePolicy, RoutingPreset } from '@/lib/old/routePolicies'
import { isRoutingPresetId, presetChoiceOf } from '@/lib/old/routingPresets'
import { Button } from '@/ui/Button/Button'
import { Chip } from '@/ui/Chip/Chip'
import { Icon } from '@/ui/Icon/Icon'
import { QueryFailed, QueryLoading } from '@/ui/QueryState/QueryState'
import { useToast } from '@/ui/Toast/useToast'

type Tab = 'nodes' | 'squads' | 'devices'

// The list's last item; a stored preset id is a uuid or a built-in name, never this.
const OWN_RULES = 'own-rules'

interface RowProps {
  title: string
  sub: string
  on: boolean
  onClick: () => void
}

function ListRow({ title, sub, on, onClick }: RowProps) {
  return (
    <button type="button" className={on ? styles.listRowOn : styles.listRow} aria-current={on || undefined} onClick={onClick}>
      <span>{title}</span>
      <span className={styles.note}>{sub}</span>
    </button>
  )
}

function NodesPane({ draft, seq, onDraftDone }: { draft: NodePolicy | null; seq: number; onDraftDone: () => void }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const say = sayer(words)
  const policies = useNodePolicies()
  const cascades = useCascadesList()
  const [selected, setSelected] = useState<string | null>(null)
  const list = policies.data?.policies ?? []
  // A rule has to name its way out, and the ways out live on the cascades: read once here, not per open row.
  const directions = useMemo(() => (cascades.data?.cascades ?? []).flatMap((c) => c.directions.map((d) => ({ id: d.id, cascade: c.name, where: d.countryCode ? d.countryCode.toUpperCase() : words.directionTag(d.tag) }))), [cascades.data, words])
  const policy = draft ?? list.find((p) => p.id === selected) ?? list[0] ?? null
  const failed = policies.isError ? policies : cascades.isError ? cascades : null
  if (failed) return <QueryFailed title={words.failed} body={failureText(failed.error, locale)} retryLabel={words.retry} onRetry={() => void failed.refetch()} />
  if (policies.isPending) return <QueryLoading label={words.loading} />
  return (
    <div className={styles.panes}>
      <div className={styles.list}>
        {draft && <ListRow on title={draft.name || words.newPolicy} sub={words.notSaved} onClick={() => undefined} />}
        {list.map((p) => (
          <ListRow
            key={p.id}
            on={!draft && policy?.id === p.id}
            title={p.name}
            sub={`${words.ruleCount(p.rules.length)} · ${nodeCountWords(nodeCountOf(p), say).chip}`}
            onClick={() => {
              onDraftDone()
              setSelected(p.id)
            }}
          />
        ))}
        {list.length === 0 && !draft && <p className={styles.note}>{words.noPoliciesNodes}</p>}
      </div>
      {policy && (
        <NodePolicyEditor
          key={draft ? `draft-${seq}` : `${policy.id}-${policy.updatedAt}`}
          policy={policy}
          directions={directions}
          onDone={(id) => {
            onDraftDone()
            setSelected(id ?? null)
          }}
        />
      )}
    </div>
  )
}

function SquadsPane({ draft, seq, onDraftDone, onOpenNodes }: { draft: RoutePolicy | null; seq: number; onDraftDone: () => void; onOpenNodes: () => void }) {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const policies = useRoutePolicies()
  const squads = useOldSquads()
  const [selected, setSelected] = useState<string | null>(null)
  const list = policies.data?.policies ?? []
  const allSquads = squads.data?.squads ?? []
  const policy = draft ?? list.find((p) => p.id === selected) ?? null
  const failed = policies.isError ? policies : squads.isError ? squads : null
  if (failed) return <QueryFailed title={words.failed} body={failureText(failed.error, locale)} retryLabel={words.retry} onRetry={() => void failed.refetch()} />
  if (policies.isPending || squads.isPending) return <QueryLoading label={words.loading} />
  return (
    <div className={styles.panes}>
      <div className={styles.list}>
        {draft && <ListRow on title={draft.name || words.newPolicy} sub={words.notSaved} onClick={() => undefined} />}
        <ListRow
          on={!draft && selected === null}
          title={words.plainName}
          sub={words.plainSub}
          onClick={() => {
            onDraftDone()
            setSelected(null)
          }}
        />
        {list.map((p) => {
          const granted = allSquads.filter((s) => s.policyIds.includes(p.id)).length
          return (
            <ListRow
              key={p.id}
              on={!draft && selected === p.id}
              title={p.name}
              sub={`${words.ruleCount(p.directDomains.length + p.blockDomains.length)} · ${granted > 0 ? words.squadCount(granted) : words.grantedToNobody}`}
              onClick={() => {
                onDraftDone()
                setSelected(p.id)
              }}
            />
          )
        })}
        {list.length === 0 && <p className={styles.note}>{words.noPoliciesSquads}</p>}
      </div>
      {policy ? (
        <RoutePolicyEditor
          key={draft ? `draft-${seq}` : policy.id}
          policy={policy}
          squads={allSquads}
          onOpenNodePolicies={onOpenNodes}
          onDone={(id) => {
            onDraftDone()
            setSelected(id ?? null)
          }}
        />
      ) : (
        <section className={styles.detail}>
          <div className={styles.detailHead}>
            <h2 className={styles.panelTitle}>{words.plainName}</h2>
            <span className={styles.chip}>{words.builtIn}</span>
            <span className={styles.spacer} />
            <span className={styles.note}>{words.builtInNoDelete}</span>
          </div>
          <p className={styles.noteRow}>{words.plainBody}</p>
        </section>
      )}
    </div>
  )
}

function DevicesPane({ presets, defaultPreset, draft, seq, onDraftDone }: { presets: readonly RoutingPreset[]; defaultPreset: RoutingPresetId; draft: RoutingPreset | null; seq: number; onDraftDone: () => void }) {
  const words = useDict(DICT)
  const squads = useOldSquads()
  const [selected, setSelected] = useState<string>(defaultPreset)
  const ownOpen = !draft && selected === OWN_RULES
  const preset = draft ?? presets.find((p) => p.id === selected) ?? presets[0]
  const usedBy = (id: string) => (squads.data?.squads ?? []).filter((s) => presetChoiceOf(s) === id).length
  return (
    <div className={styles.panes}>
      <div className={styles.list}>
        {draft && <ListRow on title={draft.name || words.newPreset} sub={words.notSaved} onClick={() => undefined} />}
        {presets.map((p) => {
          const n = usedBy(p.id)
          return (
            <ListRow
              key={p.id}
              on={!draft && selected === p.id}
              title={p.name}
              sub={[words.ruleCount(p.rules.length), p.id === defaultPreset ? words.isDefault : '', n > 0 ? words.squadCount(n) : ''].filter(Boolean).join(' · ')}
              onClick={() => {
                onDraftDone()
                setSelected(p.id)
              }}
            />
          )
        })}
        <ListRow
          on={ownOpen}
          title={words.ownTitle}
          sub={words.ownHint}
          onClick={() => {
            onDraftDone()
            setSelected(OWN_RULES)
          }}
        />
      </div>
      {ownOpen && <OwnRules />}
      {!ownOpen && preset && (
        <PresetEditor
          key={draft ? `draft-${seq}` : preset.id}
          preset={preset}
          isDefault={!draft && preset.id === defaultPreset}
          dns={draft ? undefined : PRESET_DNS[preset.id as RoutingPresetId]}
          onDone={(id) => {
            setSelected(id ?? defaultPreset)
            onDraftDone()
          }}
        />
      )}
    </div>
  )
}

export default function RoutesPage() {
  const words = useDict(DICT)
  const { locale } = useLocale()
  const toast = useToast()
  const say = sayer(words)
  const [tab, setTab] = useState<Tab>('nodes')
  const [nodeDraft, setNodeDraft] = useState<NodePolicy | null>(null)
  const [squadDraft, setSquadDraft] = useState<RoutePolicy | null>(null)
  const [deviceDraft, setDeviceDraft] = useState<RoutingPreset | null>(null)
  const [seq, setSeq] = useState(0)
  const file = useRef<HTMLInputElement>(null)
  const nodePolicies = useNodePolicies()
  const routePolicies = useRoutePolicies()
  const presetsQuery = usePresets()
  const settings = useSettings()
  const defaultPreset = defaultPresetOf(settings.data)
  // The three built-ins are panel copy, so their name and notes stay translated whatever the API calls them.
  const presets = useMemo(
    () =>
      (presetsFromList(presetsQuery.data) ?? []).map((p) =>
        p.builtIn && isRoutingPresetId(p.id)
          ? {
              ...p,
              name: words.presetNames[p.id] ?? p.name,
              rules: p.rules.map((r) => {
                const key = noteKeyFor(r.match)
                return key === undefined ? r : { ...r, note: words.notes[key] ?? r.note }
              }),
            }
          : p,
      ),
    [presetsQuery.data, words],
  )
  const stage = (node: NodePolicy | null, squad: RoutePolicy | null, device: RoutingPreset | null) => {
    setNodeDraft(node)
    setSquadDraft(squad)
    setDeviceDraft(device)
    setSeq((s) => s + 1)
  }
  const exportPane = () => {
    if (tab === 'squads') exportJson('iceslab-route-policies.json', { kind: 'iceslab.route-policies', version: 1, policies: (routePolicies.data?.policies ?? []).map((p) => ({ name: p.name, rules: policyRules(p) })) })
    else exportJson('iceslab-routing-presets.json', { kind: 'iceslab.routing-presets', version: 1, presets: presets.map((p) => ({ name: p.name, rules: p.rules.map((r) => ({ match: r.match, action: r.action, note: r.note })) })) })
    toast.show(words.exported)
  }
  const importPane = async (picked: File) => {
    const parsed = parseImport(await picked.text())
    if (typeof parsed === 'string') {
      toast.show(say(parsed), 'failed')
      return
    }
    const first = parsed[0]
    if (!first) return
    if (tab === 'squads') {
      const folded = importedPolicy(first.rules)
      stage(null, { ...blankPolicy(), name: first.name, ...folded.lists }, null)
      if (folded.dropped > 0) toast.show(words.importDropped(folded.dropped), 'partial')
    } else {
      stage(null, null, { ...blankPreset(), name: first.name, rules: first.rules })
    }
    toast.show(parsed.length > 1 ? words.importFirst(first.name, parsed.length - 1) : words.importOne(first.name), parsed.length > 1 ? 'partial' : 'done')
  }
  const createNew = () => {
    if (tab === 'nodes') stage(blankNodePolicy(), null, null)
    else if (tab === 'squads') stage(null, blankPolicy(), null)
    else stage(null, null, blankPreset())
  }
  const devicesFailed = presetsQuery.isError ? presetsQuery : settings.isError ? settings : null
  const count = (n: number | undefined) => n
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.chips} role="group" aria-label={words.tabLabel}>
          <Chip label={words.tabNodes} count={count(nodePolicies.data?.policies.length)} active={tab === 'nodes'} onClick={() => setTab('nodes')} />
          <Chip label={words.tabSquads} count={count(routePolicies.data?.policies.length)} active={tab === 'squads'} onClick={() => setTab('squads')} />
          <Chip label={words.tabDevices} count={presetsQuery.data ? presets.length : undefined} active={tab === 'devices'} onClick={() => setTab('devices')} />
        </div>
        <div className={styles.actions}>
          {/* A node policy has rules the file format cannot carry, so the pair steps aside rather than exporting what would not import back. */}
          {tab !== 'nodes' && (
            <>
              <input
                ref={file}
                className={styles.hiddenInput}
                type="file"
                accept=".json"
                aria-label={words.importField}
                onChange={(e) => {
                  const picked = e.target.files?.[0]
                  e.target.value = ''
                  if (picked) void importPane(picked)
                }}
              />
              <Button size="sm" onClick={() => file.current?.click()}>
                {words.import}
              </Button>
              <Button size="sm" onClick={exportPane}>
                {words.export}
              </Button>
            </>
          )}
          <Button variant="primary" icon={<Icon name="plus" size="md" />} onClick={createNew}>
            {tab === 'devices' ? words.newPreset : words.newPolicy}
          </Button>
        </div>
      </div>
      <div>
        <p className={styles.noteRow}>{tab === 'nodes' ? words.whenNodes : tab === 'squads' ? words.whenSquads : words.whenDevices}</p>
        <p className={styles.note}>{tab === 'nodes' ? words.hintNodes : tab === 'squads' ? words.hintSquads : words.hintDevices}</p>
      </div>
      {tab === 'nodes' && <NodesPane draft={nodeDraft} seq={seq} onDraftDone={() => setNodeDraft(null)} />}
      {tab === 'squads' && <SquadsPane draft={squadDraft} seq={seq} onDraftDone={() => setSquadDraft(null)} onOpenNodes={() => setTab('nodes')} />}
      {tab === 'devices' && devicesFailed && <QueryFailed title={words.failed} body={failureText(devicesFailed.error, locale)} retryLabel={words.retry} onRetry={() => void devicesFailed.refetch()} />}
      {tab === 'devices' && !devicesFailed && (defaultPreset === null || presets.length === 0) && <QueryLoading label={words.loading} />}
      {tab === 'devices' && !devicesFailed && defaultPreset !== null && presets.length > 0 && <DevicesPane presets={presets} defaultPreset={defaultPreset} draft={deviceDraft} seq={seq} onDraftDone={() => setDeviceDraft(null)} />}
    </div>
  )
}
