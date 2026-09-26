import { Fragment, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Box, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage } from '@/lib/net/client';
import {
  cascadeShapeError,
  createCascadeV4,
  listCascades,
  type CascadeProtocol,
} from '@/lib/domain/cascades';
import { listNodes } from '@/lib/domain/nodes';
import { listFieldKnown } from '@/lib/domain/nodeFields';
import { listRoutePolicies } from '@/lib/domain/routePolicies';
import { linkCellEngines, nodeCarriesCell } from '@/lib/domain/linkCells';
import { watchCascadeProvisioning } from '@/contours/cascades/lib/cascadeProvision';
import { useEntryBystanders } from '@/contours/cascades/lib/useEntryBystanders';
import { MIN_CASCADE_CORE, isOlderThan } from '@/lib/domain/protocols';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import {
  BarButton,
  CardCaption,
  ChainIcon,
  Counter,
  DashedAdd,
  DirectionNotes,
  DirectionRow,
  EntryBystandersNote,
  EntryChainNote,
  EntryPolicyRow,
  EyeIcon,
  FieldLabel,
  Hint,
  InfoIcon,
  LegRow,
  ModeTile,
  Note,
  PositionRow,
  PreviewDirection,
  PreviewLink,
  PreviewNode,
  PreviewPending,
  RoleBadge,
  SectionCard,
  ShieldIcon,
  StateField,
  TickCircleIcon,
  ToggleRow,
  WarnIcon,
} from '@/contours/cascades/components/CascadeEditor';
import {
  AMBER,
  CARD,
  CYAN,
  DISPLAY,
  EDGE,
  FAINT,
  HAIRLINE,
  MIST,
  MONO,
  MOSS,
  RED,
  SNOW,
  VIOLET,
  WELL,
} from '@/contours/cascades/lib/colors';
import {
  entryProtocolDefault,
  MAX_LINKS,
  MAX_POSITIONS,
  ROLE_TONE,
  LEG_PORT_BASE,
  chainEntryList,
  entryChainFacts,
  legCellNotes,
  legFacts,
  legPortNotes,
  legUnderlay,
  withUnderlay,
  entryPolicyPlace,
  entryChainGaps,
  entryChainNotes,
  entryPolicyRefusal,
  poolRoleAt,
  refusedCells,
  refusedEntryChain,
  refusedLinkPorts,
  refusedUnderlay,
  toDirectionInputs,
  toPositionInputs,
  directionLines,
  directionVia,
  outboundChainGaps,
  refusedDirection,
  type DirectionRefusal,
  type CellRefusal,
  type EntryChainConflict,
  type LinkPortConflict,
  type DirectionDraft,
  type PositionDraft,
} from '@/contours/cascades/lib/cascadeForm';
import { directionOutbounds, listNamedOutbounds, outboundAddress } from '@/lib/domain/namedOutbounds';

/**
 * Build a cascade, as a page.
 *
 * A cascade is a claim about where a client's traffic physically goes, so the
 * path gets the width of the screen and a live drawing of it beside them.
 *
 * The shape is not a stored mode. It follows from what is in the form: one
 * entry pool, however many transit pools, and a list of directions on the way
 * out. Picking "one way out" or "several ways out" only seeds the form, which
 * is why the label says START FROM rather than MODE.
 *
 * Nothing here touches a node until Create is pressed. Until then the bar says
 * so, in as many words.
 */

type StartShape = 'one' | 'many';

export function CascadeCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [hideHops, setHideHops] = useState(true);
  const [startShape, setStartShape] = useState<StartShape>('one');
  /** Ноги, которые сервер отказался записать (409 `CELL_NOT_CARRIED`). */
  const [cellRefusals, setCellRefusals] = useState<CellRefusal[]>([]);
  /** Порты ног, занятые чужими профилями (409 `LINK_PORT_IN_USE`). */
  const [portConflicts, setPortConflicts] = useState<LinkPortConflict[]>([]);
  /** Ноды без AmneziaWG под ногой `awg` (409 `LINK_UNDERLAY_NOT_ON_NODE`). */
  const [underlayRefused, setUnderlayRefused] = useState<string[]>([]);
  /** Входные ноды, которые не могут поднять цепь (409 `ENTRY_CANNOT_CHAIN`). */
  const [entryChainRefusals, setEntryChainRefusals] = useState<EntryChainConflict[]>([]);
  /** Фаза 10: отказ про направление и его выход; строка у своего направления. */
  const [dirRefusal, setDirRefusal] = useState<DirectionRefusal | null>(null);
  /** 409 NAMED_OUTBOUND_NEEDS_CHAIN: ноды последней позиции без sing-box. */
  const [outboundChainRefusals, setOutboundChainRefusals] = useState<EntryChainConflict[]>([]);

  const nextKey = useRef(2);
  // Pools are the entry and any transits after it. The exit is not a pool: it
  // is the directions list below, which is why the counter adds one.
  const [pools, setPools] = useState<PositionDraft[]>([
    { key: 0, nodeIds: [''], entryProtocol: 'xray', linkProtocol: 'xray' },
  ]);
  // Nothing on this page exists server-side yet, so every direction carries a
  // null id and gets its tag from the panel on create.
  const [directions, setDirections] = useState<DirectionDraft[]>([
    { key: 1, id: null, countryCode: '', nodeIds: [''], tag: null },
  ]);

  usePageMeta([t('cascadeCreate.crumbSection'), t('cascadeCreate.crumbNew')]);

  const nodesQuery = useQuery({ queryKey: ['nodes', 'all'], queryFn: () => listNodes({ limit: 100 }) });
  const cascadesQuery = useQuery({ queryKey: ['cascades'], queryFn: listCascades });
  // Политика входа (Ф9.3). Знает ли сервер поле, говорит `fields` конверта
  // каскадов (и на пустом списке); по стоящим каскадам только у сервера старше.
  const entryPolicyKnown = listFieldKnown(cascadesQuery.data?.fields, cascadesQuery.data?.cascades, 'entryPolicy');
  // Фаза 10 (d28cc14): направление на именованном выходе. Знает ли сервер
  // поле, говорит `fields` конверта каскадов.
  const outboundKnown = listFieldKnown(
    cascadesQuery.data?.fields,
    cascadesQuery.data?.cascades.flatMap((c) => c.directions),
    'outboundId',
    'directions[].outboundId',
  );
  const outboundsQuery = useQuery({ queryKey: ['named-outbounds'], queryFn: listNamedOutbounds });
  const outboundOptions = directionOutbounds(outboundsQuery.data?.outbounds);
  const outboundById = new Map((outboundsQuery.data?.outbounds ?? []).map((o) => [o.id, o] as const));
  const policiesQuery = useQuery({ queryKey: ['route-policies'], queryFn: listRoutePolicies });
  /** Выбранная политика входа; `null` = нет (у create это то же, что отсутствие). */
  const [entryPolicyId, setEntryPolicyId] = useState<string | null>(null);
  const [entryPolicyGone, setEntryPolicyGone] = useState(false);
  const nodes = useMemo(() => nodesQuery.data?.nodes ?? [], [nodesQuery.data]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n] as const)), [nodes]);
  // Входная нода, взятая в новый каскад, может уже держать профили другого
  // протокола: они в каскад не войдут, и сказать это надо при выборе входа.
  const bystanders = useEntryBystanders(pools[0]?.entryProtocol, pools[0]?.nodeIds ?? [], nodeById);

  // Which cascade already claims a node. The config generator picks the first
  // enabled cascade a node belongs to, so a second one would be written and then
  // silently ignored: worth saying out loud at pick time.
  const claimedBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cascadesQuery.data?.cascades ?? []) {
      for (const h of c.hops) m.set(h.nodeId, c.name);
    }
    return m;
  }, [cascadesQuery.data]);

  const positionCount = pools.length + 1;

  /** Every node id this draft already spends, so no slot offers it twice. */
  const allIds = useMemo(
    () => [...pools.flatMap((p) => p.nodeIds), ...directions.flatMap((d) => d.nodeIds)].filter(Boolean),
    [pools, directions],
  );
  function othersThan(mine: string[]): string[] {
    const spent = [...allIds];
    for (const id of mine) {
      const at = spent.indexOf(id);
      if (at >= 0) spent.splice(at, 1);
    }
    return spent;
  }

  function setPool(idx: number, patch: Partial<PositionDraft>) {
    setPools((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  /**
   * Picking the first node of the entry pool also sets the entry protocol,
   * because the entry has to be dialled on a core that node actually runs
   * (entryProtocolDefault, by the node's cores, not its label). It stays
   * editable.
   */
  function setPoolNodes(idx: number, ids: string[]) {
    const first = ids.find(Boolean);
    const node = first ? nodeById.get(first) : null;
    const def = idx === 0 && node ? entryProtocolDefault(node) : null;
    setPool(idx, { nodeIds: ids, ...(def?.kind === 'protocol' ? { entryProtocol: def.protocol } : {}) });
  }

  function addPosition() {
    if (positionCount >= MAX_POSITIONS) return;
    // Appended after the last pool, so it lands between the entry and the
    // directions: a transit, which is the only position you can add.
    setPools((prev) => [
      ...prev,
      { key: nextKey.current++, nodeIds: [''], entryProtocol: 'xray', linkProtocol: 'xray' },
    ]);
  }

  function movePool(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= pools.length) return;
    setPools((prev) => {
      const next = [...prev];
      [next[idx], next[j]] = [next[j]!, next[idx]!];
      return next;
    });
  }

  function setDirection(idx: number, patch: Partial<DirectionDraft>) {
    // Отказ был про прошлую форму: правка направления делает его неверным.
    setDirRefusal(null);
    setOutboundChainRefusals([]);
    setDirections((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  function moveDirection(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= directions.length) return;
    setDirections((prev) => {
      const next = [...prev];
      [next[idx], next[j]] = [next[j]!, next[idx]!];
      return next;
    });
  }

  /**
   * The start tiles seed the directions list and nothing else. Switching adds
   * or drops trailing rows, and never touches one the operator has filled in:
   * the choice is a starting point, not a mode that owns the form.
   */
  function pickShape(shape: StartShape) {
    setStartShape(shape);
    const want = shape === 'one' ? 1 : 2;
    setDirections((prev) => {
      if (prev.length >= want) return prev;
      const next = [...prev];
      while (next.length < want) {
        next.push({ key: nextKey.current++, id: null, countryCode: '', nodeIds: [''], tag: null });
      }
      return next;
    });
  }

  const trimmedName = name.trim();
  // Через `useMemo`: и `filter`, и `?? []` дают новый массив на каждый рендер,
  // а проверка версии ядра ниже держит его в зависимостях.
  const entryIds = useMemo(() => pools[0]?.nodeIds.filter(Boolean) ?? [], [pools]);
  const poolsFilled = pools.every((p) => p.nodeIds.some(Boolean));
  // Country is enough. A direction with an empty pool is legitimate in v4: the
  // tag exists and waits for a node, and clients are simply not offered it.
  const directionsFilled = directions.every((d) => Boolean(d.countryCode));
  const duplicate = new Set(allIds).size !== allIds.length;
  const links = Math.max(entryIds.length, 1) * directions.filter((d) => d.nodeIds.some(Boolean)).length;
  const overLinks = links > MAX_LINKS;

  // Та же первая стена, что на правке: цепь несёт только трафик xray, и
  // создавать каскад, который не повезёт ни одного клиента, незачем.
  const entryChain = entryChainFacts(pools[0]?.entryProtocol);
  // Первая нода входа без ядра для входа: говорится у селектора входа.
  const entryHead = nodeById.get(pools[0]?.nodeIds.find(Boolean) ?? '');
  const entryNoCore = entryHead ? entryProtocolDefault(entryHead).kind === 'none' : false;

  const valid =
    trimmedName.length > 0 &&
    poolsFilled &&
    directionsFilled &&
    !duplicate &&
    !overLinks &&
    (entryChain?.carried ?? true);

  // T7: below this the entry rejects the per-direction UUID at auth, so a
  // direction the client picks would fail silently. Any entry node can be the
  // one a client lands on, so the whole pool is checked, not just the first.
  const staleEntries = useMemo(
    () =>
      entryIds
        .map((id) => nodeById.get(id))
        .filter((n): n is NonNullable<typeof n> => Boolean(n))
        .filter((n) => directions.length > 1 && isOlderThan(n.coreVersion, MIN_CASCADE_CORE)),
    [entryIds, nodeById, directions.length],
  );

  const createMutation = useMutation({
    mutationFn: () =>
      createCascadeV4({
        name: trimmedName,
        enabled,
        hideHopsFromSub: hideHops,
        positions: toPositionInputs(pools),
        directions: toDirectionInputs(directions),
        // Только выбранная и только туда, где она действует: при xray-входе
        // селектора нет, и политика не уходит. Отсутствие у create = нет.
        ...(entryPolicyKnown && entryPolicyId && entryPolicyPlace(pools[0]?.entryProtocol, true) === 'select'
          ? { entryPolicyId }
          : {}),
      }),
    onSuccess: (cascade) => {
      qc.invalidateQueries({ queryKey: ['cascades'] });
      qc.invalidateQueries({ queryKey: ['nodes'] });
      navigate('/nodes');
      if (cascade?.id) watchCascadeProvisioning(cascade.id, t);
      else notifications.show({ color: 'green', message: t('cascades.saved') });
    },
    onError: (err) => {
      // Отказ по ноге называет ноды, и место у него своё: строка под той ногой,
      // о которой сервер говорит. Тост тут увёл бы список имён с экрана.
      // Вход не поднимется: sing-box на входных нодах нет. У нового каскада
      // вопроса о согласии не бывает (снимать некого), этот отказ бывает.
      const unchainable = refusedEntryChain(err);
      if (unchainable) {
        setEntryChainRefusals(unchainable);
        return;
      }
      // Фаза 10: отказ про направление и его выход.
      const dirRef = refusedDirection(err);
      if (dirRef) {
        if (dirRef.kind === 'needsChain') setOutboundChainRefusals(dirRef.conflicts);
        else setDirRefusal(dirRef);
        if (dirRef.kind === 'notFound') qc.invalidateQueries({ queryKey: ['named-outbounds'] });
        return;
      }
      const cells = refusedCells(err);
      if (cells) {
        setCellRefusals(cells);
        return;
      }
      const ports = refusedLinkPorts(err);
      if (ports) {
        setPortConflicts(ports);
        return;
      }
      // Туннель под ногой просят у ноды без AmneziaWG: имена встают у ног.
      const noAwg = refusedUnderlay(err);
      if (noAwg && noAwg.length > 0) {
        setUnderlayRefused(noAwg);
        return;
      }
      // Выбранной политики входа уже нет: строка у селектора, список перечитан.
      if (entryPolicyRefusal(err)) {
        setEntryPolicyGone(true);
        qc.invalidateQueries({ queryKey: ['route-policies'] });
        return;
      }
      // The form blocks both unstorable shapes, so a 400 here means the API saw
      // something this page did not. Its sentence is the useful one, not ours.
      const shape = cascadeShapeError(err);
      notifications.show({
        color: 'red',
        title: t('common.createError'),
        message: shape ?? apiErrorMessage(err),
      });
    },
  });

  // What still stands between this draft and a cascade. One sentence, the first
  // thing missing, so the note reads as an instruction rather than a report.
  const blocker = !trimmedName
    ? t('cascadeCreate.needName')
    : duplicate
      ? t('cascadeCreate.needDistinct')
      : !poolsFilled
        ? t('cascadeCreate.needEntry')
        : !directionsFilled
          ? t('cascadeCreate.needDirection')
          : overLinks
            ? t('cascadeCreate.tooManyLinks', { n: links, max: MAX_LINKS })
            : entryChain && !entryChain.carried
              ? t('cascadeCreate.entryNotCarried', { protocol: entryChain.protocol, supported: chainEntryList() })
              : null;

  return (
    <Stack gap={20}>
      {/* Page bar */}
      <Box className="page-bar">
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 16, flexShrink: 0 }}>
          <Box
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: `${VIOLET}1A`,
              border: `1px solid ${VIOLET}33`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ChainIcon size={18} color={CYAN} />
          </Box>
          <Text style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, lineHeight: '22px', color: SNOW }}>
            {trimmedName || t('cascadeCreate.title')}
          </Text>
        </Box>

        <Box style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0 }} />

        <Box className="page-bar-facts">
          {/* Nothing has been written anywhere yet, and the bar keeps saying so
              until the button is pressed. */}
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 22,
              paddingInline: 9,
              borderRadius: 6,
              backgroundColor: WELL,
              border: `1px solid ${EDGE}`,
              flexShrink: 0,
            }}
          >
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: '0.12em',
                lineHeight: '12px',
                textTransform: 'uppercase',
                color: MIST,
              }}
            >
              {t('cascadeCreate.draft')}
            </Text>
          </Box>
          <Text
            className="page-bar-fact-soft"
            style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST }}
          >
            {t('cascadeCreate.subtitle')}
          </Text>
          <Box style={{ flex: 1, minWidth: 0 }} />
        </Box>

        <Box className="page-bar-actions">
          <BarButton onClick={() => navigate('/nodes')}>{t('common.cancel')}</BarButton>
          <BarButton
            primary
            icon="plus"
            disabled={!valid || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? t('cascadeCreate.creating') : t('cascadeCreate.create')}
          </BarButton>
        </Box>
      </Box>

      <Box className="page-columns">
        <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minWidth: 0, width: '100%' }}>
          <SectionCard title={t('cascadeCreate.basics')} icon={<ShieldIcon size={15} color={CYAN} />}>
            <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
              <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                <FieldLabel required>{t('cascadeCreate.name')}</FieldLabel>
                <TextInput
                  placeholder="ru-eu-1"
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                />
                <Hint>{t('cascadeCreate.nameHint')}</Hint>
              </Stack>
              <Stack gap={6} style={{ width: 200, flexShrink: 0 }}>
                <FieldLabel>{t('cascadeCreate.state')}</FieldLabel>
                <StateField
                  enabled={enabled}
                  onChange={setEnabled}
                  onLabel={t('cascadeCreate.stateOn')}
                  offLabel={t('cascadeCreate.stateOff')}
                />
                <Hint>{t('cascadeCreate.stateHint')}</Hint>
              </Stack>
            </Box>

            <Stack gap={8} style={{ width: '100%' }}>
              <Box style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                <FieldLabel>{t('cascadeCreate.startFrom')}</FieldLabel>
                <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
                  {t('cascadeCreate.startFromHint')}
                </Text>
              </Box>
              <Box style={{ display: 'flex', gap: 12, width: '100%' }}>
                <ModeTile
                  selected={startShape === 'one'}
                  tone={CYAN}
                  onClick={() => pickShape('one')}
                  title={t('cascadeCreate.shapeOne')}
                  hint={t('cascadeCreate.shapeOneHint')}
                />
                <ModeTile
                  selected={startShape === 'many'}
                  tone={CYAN}
                  onClick={() => pickShape('many')}
                  title={t('cascadeCreate.shapeMany')}
                  hint={t('cascadeCreate.shapeManyHint')}
                />
              </Box>
            </Stack>

            <ToggleRow
              checked={hideHops}
              onChange={setHideHops}
              title={t('cascadeCreate.hideHops')}
              hint={t('cascadeCreate.hideHopsHint')}
            />
          </SectionCard>

          <Stack
            gap={14}
            style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
              <ChainIcon size={14} color={MIST} />
              <CardCaption>
                {pools.length > 1 ? t('cascadeCreate.positionsTransit') : t('cascadeCreate.positions')}
              </CardCaption>
              <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
                {t('cascadeCreate.positionsHint')}
              </Text>
              <Box style={{ flex: 1, minWidth: 0 }} />
              <Counter full={positionCount >= MAX_POSITIONS}>
                {positionCount}/{MAX_POSITIONS}
              </Counter>
            </Box>

            {pools.map((pool, i) => (
              <Fragment key={pool.key}>
              <PositionRow
                role={poolRoleAt(i)}
                poolLabel={i === 0 ? t('cascadeCreate.poolEntry') : t('cascadeCreate.poolTransit')}
                nodeIds={pool.nodeIds}
                nodes={nodes}
                claimedBy={claimedBy}
                usedElsewhere={othersThan(pool.nodeIds)}
                addNodeLabel={t('cascadeCreate.addNode')}
                onNodes={(ids) => setPoolNodes(i, ids)}
                entryProtocol={i === 0 ? pool.entryProtocol : null}
                onEntryProtocol={(v) => setPool(i, { entryProtocol: v })}
                entryNote={i === 0 ? <EntryChainNote facts={entryChain} noEntryCore={entryNoCore} /> : undefined}
                canUp={i > 1}
                canDown={i > 0 && i < pools.length - 1}
                canDelete={i > 0}
                onUp={() => movePool(i, -1)}
                onDown={() => movePool(i, 1)}
                onDelete={() => setPools((prev) => prev.filter((_, j) => j !== i))}
              >
                {i === 0 && (
                  <EntryPolicyRow
                    place={entryPolicyPlace(pool.entryProtocol, entryPolicyKnown)}
                    value={entryPolicyId}
                    policies={policiesQuery.data?.policies ?? []}
                    gone={entryPolicyGone}
                    onChange={(v) => {
                      setEntryPolicyGone(false);
                      setEntryPolicyId(v);
                    }}
                  />
                )}
                {i === 0 && <EntryBystandersNote items={bystanders} />}
                {i === 0 &&
                  entryChainNotes(
                    entryChainGaps(entryIds.map((id) => nodeById.get(id))),
                    entryChainRefusals,
                  ).map((c) => (
                    <Note key={`chain-${c.nodeName}`} tone={RED} icon={<WarnIcon size={13} color={RED} />}>
                      {t('cascadeCreate.entryCannotChain', {
                        name: c.nodeName,
                        engines: c.engines.length ? c.engines.join(', ') : t('cascadeCreate.legNodeNoEngines'),
                      })}
                    </Note>
                  ))}
                {i === 0 &&
                  staleEntries.map((n) => (
                    <Note key={n.id} tone={AMBER} icon={<WarnIcon size={13} color={AMBER} />}>
                      {t('cascadeCreate.entryCoreOld', {
                        name: n.name,
                        version: n.coreVersion,
                        min: MIN_CASCADE_CORE,
                      })}
                    </Note>
                  ))}
              </PositionRow>
              {/* Та же нога, что и на правке: связь между шагами живёт между
                  карточками, и подпись у последней говорит, где она задаётся. */}
              <LegRow
                // Та же таблица движков, что у ноги направления: иначе hy2 и
                // tuic покраснели бы как чужие ячейки.
                facts={legFacts(pool.linkProtocol, i, linkCellEngines)}
                params={pool.linkParams ?? null}
                onCell={(v) => setPool(i, { linkProtocol: v as CascadeProtocol })}
                onParams={(p) =>
                  setPool(i, { linkParams: { ...(pool.linkParams ?? {}), ...p }, linkTouched: true })
                }
                caption={i === pools.length - 1 ? t('cascadeCreate.legToDirections') : undefined}
                gaps={legCellNotes(
                  // Ногу принимает СЛЕДУЮЩАЯ позиция: ячейку поднимает
                  // принимающая сторона, о ней и говорит отказ.
                  pools[i + 1]?.nodeIds ?? [],
                  pool.linkProtocol,
                  nodeById,
                  nodeCarriesCell,
                  cellRefusals,
                )}
                portTaken={legPortNotes(
                  pools[i + 1]?.nodeIds ?? [],
                  LEG_PORT_BASE + i,
                  nodeById,
                  portConflicts,
                )}
                // Туннель поднимают обе стороны ноги: эта позиция и та, что её
                // принимает (у последней это ноды всех направлений).
                underlay={legUnderlay(
                  [...pool.nodeIds, ...(pools[i + 1]?.nodeIds ?? directions.flatMap((d) => d.nodeIds))],
                  nodeById,
                  pool.linkParams?.underlay,
                  undefined,
                  underlayRefused,
                  // У позиции два положения, `inherit` сюда не приходит.
                  (u) => setPool(i, { linkParams: withUnderlay(pool.linkParams, u), linkTouched: true }),
                )}
              />
              </Fragment>
            ))}

            {/* The exit position. It holds directions rather than a pool, so it
                gets the badge and the table under one border. */}
            <Stack
              gap={12}
              style={{
                padding: 14,
                borderRadius: 10,
                backgroundColor: WELL,
                border: `1px solid ${HAIRLINE}`,
                borderLeft: `3px solid ${ROLE_TONE.exit}`,
              }}
            >
              <Box style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                <RoleBadge role="exit" tone={ROLE_TONE.exit} />
                <Text
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    lineHeight: '12px',
                    textTransform: 'uppercase',
                    color: MIST,
                  }}
                >
                  {t('cascadeCreate.directionsCaption')}
                </Text>
              </Box>

              <Box className="cascade-direction">
                <Box className="cascade-direction-tag">
                  <FieldLabel>{t('cascadeCreate.tag')}</FieldLabel>
                </Box>
                <Box className="cascade-direction-country">
                  <FieldLabel>{t('cascadeCreate.direction')}</FieldLabel>
                </Box>
                <Box className="cascade-direction-nodes">
                  <FieldLabel>{t('cascadeCreate.directionNodes')}</FieldLabel>
                </Box>
                <Box style={{ width: 104, flexShrink: 0 }} />
              </Box>

              {directions.map((dir, i) => (
                <DirectionRow
                  key={dir.key}
                  tag={dir.tag}
                  prospectiveTag={i + 1}
                  countryCode={dir.countryCode}
                  onCountry={(code) => setDirection(i, { countryCode: code })}
                  nodeIds={dir.nodeIds}
                  nodes={nodes}
                  claimedBy={claimedBy}
                  usedElsewhere={othersThan(dir.nodeIds)}
                  addNodeLabel={t('cascadeCreate.addNode')}
                  onNodes={(ids) => setDirection(i, { nodeIds: ids })}
                  canUp={i > 0}
                  canDown={i < directions.length - 1}
                  canDelete={directions.length > 1}
                  onUp={() => moveDirection(i, -1)}
                  onDown={() => moveDirection(i, 1)}
                  onDelete={() => setDirections((prev) => prev.filter((_, j) => j !== i))}
                  outbound={
                    outboundKnown
                      ? {
                          via: directionVia(dir),
                          onVia: (via) =>
                            setDirection(i, {
                              via,
                              outboundTouched: true,
                              ...(via === 'outbound' ? { nodeIds: [''] } : { outboundId: null }),
                            }),
                          outboundId: dir.outboundId ?? null,
                          options: outboundOptions,
                          onOutbound: (o) =>
                            setDirection(i, {
                              outboundId: o?.id ?? null,
                              outboundTouched: true,
                              ...(o?.countryCode && !dir.countryCode ? { countryCode: o.countryCode } : {}),
                            }),
                        }
                      : undefined
                  }
                />
              ))}
              {directions.map((_, i) => (
                <DirectionNotes key={`notes-${i}`} lines={directionLines(directions, i, dirRefusal, t)} />
              ))}

              {/* Выход набирает цепь последней позиции: без sing-box там он
                  не поднимется (NAMED_OUTBOUND_NEEDS_CHAIN). */}
              {entryChainNotes(
                outboundChainGaps(directions, (pools[pools.length - 1]?.nodeIds ?? []).map((nid) => nodeById.get(nid))),
                outboundChainRefusals,
              ).map((c) => (
                <Note key={`out-chain-${c.nodeName}`} tone={RED} icon={<WarnIcon size={13} color={RED} />}>
                  {t('cascadeCreate.outboundNeedsChain', {
                    name: c.nodeName,
                    engines: c.engines.length ? c.engines.join(', ') : t('cascadeCreate.legNodeNoEngines'),
                  })}
                </Note>
              ))}

              <DashedAdd
                label={t('cascadeCreate.addDirection')}
                note={t('cascadeCreate.tagOnce')}
                onClick={() =>
                  setDirections((prev) => [
                    ...prev,
                    { key: nextKey.current++, id: null, countryCode: '', nodeIds: [''], tag: null },
                  ])
                }
              />

              <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
                {t('cascadeCreate.directionsFoot')}
              </Text>
            </Stack>

            <DashedAdd
              label={t('cascadeCreate.addPosition')}
              note={t('cascadeCreate.positionsLeft', { n: MAX_POSITIONS - positionCount })}
              disabled={positionCount >= MAX_POSITIONS}
              onClick={addPosition}
            />
          </Stack>
        </Box>

        <Box className="page-rail">
          <Stack
            gap={14}
            style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <EyeIcon size={15} color={CYAN} />
              <CardCaption>{t('cascadeCreate.chainTitle')}</CardCaption>
            </Box>

            <Stack gap={8} style={{ width: '100%' }}>
              {pools.map((pool, i) => {
                const role = poolRoleAt(i);
                const picked = pool.nodeIds.filter(Boolean);
                return (
                  <Box key={pool.key} style={{ display: 'contents' }}>
                    {picked.length === 0 ? (
                      <PreviewPending
                        label={
                          role === 'entry'
                            ? t('cascadeCreate.chainPendingEntry')
                            : t('cascadeCreate.chainPendingTransit')
                        }
                      />
                    ) : (
                      picked.map((id, j) => {
                        const node = nodeById.get(id);
                        if (!node) return null;
                        return (
                          <PreviewNode
                            key={id}
                            role={role}
                            node={node}
                            // Only the first tile of a pool carries the chip;
                            // repeating it once per node would read as a queue
                            // rather than a set of equals.
                            chip={
                              j > 0
                                ? ''
                                : role === 'entry'
                                  ? `${t('cascades.role.entry')} · ${pool.entryProtocol}`
                                  : t('cascades.role.transit')
                            }
                            claimedBy={claimedBy.get(node.id) ?? null}
                            note={
                              j === 0 && picked.length > 1
                                ? t('cascadeCreate.poolNote', { n: picked.length })
                                : null
                            }
                          />
                        );
                      })
                    )}
                    <PreviewLink
                      label={t('cascadeCreate.chainForwarded', { protocol: pool.linkProtocol })}
                      fan={i === pools.length - 1 && directions.length > 1}
                    />
                  </Box>
                );
              })}

              {directions.map((dir, i) =>
                dir.countryCode ? (
                  <PreviewDirection
                    key={dir.key}
                    countryCode={dir.countryCode}
                    prospectiveTag={i + 1}
                    note={
                      // Фаза 10: выход последней ступенью, его имя и адрес.
                      directionVia(dir) === 'outbound'
                        ? (() => {
                            const o = dir.outboundId ? outboundById.get(dir.outboundId) : undefined;
                            return o
                              ? [o.name, outboundAddress(o)].filter(Boolean).join(' · ')
                              : t('cascadeCreate.outboundPick');
                          })()
                        : dir.nodeIds.filter(Boolean).length
                          ? dir.nodeIds
                              .filter(Boolean)
                              .map((id) => nodeById.get(id)?.name ?? id)
                              .join(' · ')
                          : t('cascadeCreate.directionNoNodes')
                    }
                  />
                ) : (
                  <PreviewPending
                    key={dir.key}
                    label={
                      directions.length > 1
                        ? t('cascadeCreate.chainPendingDirectionN', { n: i + 1 })
                        : t('cascadeCreate.chainPendingDirection')
                    }
                  />
                ),
              )}
            </Stack>

            {/* One note, and it says the next thing to do rather than listing
                everything that is not done. */}
            {blocker ? (
              <Note tone={AMBER} icon={<WarnIcon size={13} color={AMBER} />}>
                {blocker}
              </Note>
            ) : (
              <Note tone={MOSS} icon={<TickCircleIcon size={13} color={MOSS} />}>
                {enabled ? t('cascadeCreate.ready') : t('cascadeCreate.readyDisabled')}
              </Note>
            )}

          </Stack>

          <Stack
            gap={12}
            style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <InfoIcon size={15} color={MIST} />
              <CardCaption>{t('cascadeCreate.rules')}</CardCaption>
            </Box>
            <Rule>{t('cascadeCreate.rule1')}</Rule>
            <Rule>{t('cascadeCreate.rule2', { max: MAX_POSITIONS })}</Rule>
            <Rule>{t('cascadeCreate.rule5', { max: MAX_LINKS })}</Rule>
            <Rule tone={AMBER}>{t('cascadeCreate.rule3', { min: MIN_CASCADE_CORE })}</Rule>
            <Rule>{t('cascadeCreate.rule4')}</Rule>
          </Stack>
        </Box>
      </Box>
    </Stack>
  );
}

function Rule({ children, tone = CYAN }: { children: ReactNode; tone?: string }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 9, width: '100%' }}>
      <Box
        style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: tone, marginTop: 6, flexShrink: 0 }}
      />
      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '16px', color: MIST, flex: 1, minWidth: 0 }}>
        {children}
      </Text>
    </Box>
  );
}
