import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Stack, Text, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  apiErrorMessage,
  deleteCascade,
  cascadeShapeError,
  getCascadeStatus,
  listCascades,
  listNodes,
  updateCascadeV4,
  type Cascade,
  type CascadeProtocol,
  type Node,
} from '@/lib/net/api';
import { watchCascadeProvisioning } from '@/contours/cascades/lib/cascadeProvision';
import { MIN_CASCADE_CORE, isOlderThan } from '@/lib/domain/protocols';
import { useOverview } from '@/lib/domain/dashboard';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import {
  AMBER,
  BarButton,
  BarIconButton,
  BroadcastIcon,
  CARD,
  CardCaption,
  ChainIcon,
  Chip,
  Counter,
  CYAN,
  DashedAdd,
  DIM,
  DirectionRow,
  DISPLAY,
  EyeIcon,
  FAINT,
  FieldLabel,
  HAIRLINE,
  Hint,
  isKnownProtocol,
  LINK_PROTOCOL_VALUES,
  MAX_LINKS,
  MAX_POSITIONS,
  MIST,
  MONO,
  MOSS,
  Note,
  PositionRow,
  PreviewDirection,
  PreviewLink,
  PreviewNode,
  PreviewPending,
  RED,
  RoleBadge,
  ROLE_TONE,
  SectionCard,
  ShieldIcon,
  SNOW,
  StateField,
  TickCircleIcon,
  TickIcon,
  ClockIcon,
  ToggleRow,
  TrashIcon,
  VIOLET,
  WarnIcon,
  WELL,
  poolRoleAt,
  statusTone,
  toDirectionInputs,
  toPositionInputs,
  type DirectionDraft,
  type PositionDraft,
} from '@/contours/cascades/components/CascadeEditor';

/**
 * Edit a live cascade. Same form as the create page, but everything here is
 * already running on real machines, so the rail answers the questions only a
 * live cascade raises: what a subscriber currently sees, and whether the last
 * save actually reached every node.
 *
 * The page is in the v4 shape (pools and directions). The API still answers in
 * the older hop shape, so the draft is READ through a translation below and
 * written back in the new shape behind CASCADE_V4_WRITES_LIVE: an existing
 * cascade renders correctly today and needs no migration on this side.
 */
export function CascadeEditPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // There is no single-cascade endpoint; the list is short and already cached
  // by the page the operator came from.
  const cascadesQuery = useQuery({ queryKey: ['cascades'], queryFn: listCascades });
  const nodesQuery = useQuery({ queryKey: ['nodes', 'all'], queryFn: () => listNodes({ limit: 100 }) });
  const overviewQuery = useOverview();
  const cascade = cascadesQuery.data?.cascades.find((c) => c.id === id) ?? null;

  const nodes = useMemo(() => nodesQuery.data?.nodes ?? [], [nodesQuery.data]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n] as const)), [nodes]);
  const todayByNode = useMemo(
    () => new Map((overviewQuery.data?.nodes ?? []).map((n) => [n.id, n.todayBytes] as const)),
    [overviewQuery.data],
  );

  // Every other cascade that already claims a node. This one is excluded: its
  // own nodes are not a clash.
  const claimedBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cascadesQuery.data?.cascades ?? []) {
      if (c.id === id) continue;
      for (const h of c.hops) m.set(h.nodeId, c.name);
    }
    return m;
  }, [cascadesQuery.data, id]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const nextKey = useRef(0);

  // Seed once per cascade, and only once the node list is in: a direction is
  // named after a country, which is a fact about the node under it. Re-seeding
  // on every refetch would throw away an edit the moment the list poll returns.
  if (cascade && nodesQuery.isSuccess && loadedFor !== cascade.id) {
    setLoadedFor(cascade.id);
    setDraft(toDraft(cascade, nodeById, () => nextKey.current++));
  }

  usePageMeta([t('cascadeCreate.crumbSection'), cascade?.name ?? '']);

  const statusQuery = useQuery({
    queryKey: ['cascade-status', id],
    queryFn: () => getCascadeStatus(id),
    enabled: Boolean(cascade),
    // Stop asking once every node has taken the config; a save restarts it.
    refetchInterval: (q) => (q.state.data?.done ? false : 10_000),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('nothing to save');
      return updateCascadeV4(id, {
        name: draft.name.trim(),
        enabled: draft.enabled,
        hideHopsFromSub: draft.hideHops,
        autoProfile: draft.autoProfile,
        positions: toPositionInputs(draft.pools),
        directions: toDirectionInputs(draft.directions),
      });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['cascades'] });
      qc.invalidateQueries({ queryKey: ['nodes'] });
      qc.invalidateQueries({ queryKey: ['cascade-status', id] });
      // Re-seed from what came back, so the bar stops claiming unsaved changes.
      setDraft(toDraft(saved, nodeById, () => nextKey.current++));
      watchCascadeProvisioning(id, t);
    },
    onError: (err) => {
      // A cascade write commits fast and provisions asynchronously, so a slow or
      // timed-out response can fire onError even though the change landed.
      qc.invalidateQueries({ queryKey: ['cascades'] });
      // The form blocks both unstorable shapes, so a 400 means the API saw
      // something this page did not. Its sentence is the useful one.
      const shape = cascadeShapeError(err);
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: shape ?? apiErrorMessage(err),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCascade(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cascades'] });
      qc.invalidateQueries({ queryKey: ['nodes'] });
      notifications.show({ color: 'green', message: t('cascades.deleted') });
      navigate('/nodes');
    },
    onError: (err) =>
      notifications.show({ color: 'red', title: t('common.saveError'), message: apiErrorMessage(err) }),
  });

  if (!cascade || !draft) {
    return (
      <Box style={{ padding: 40, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, color: MIST, textAlign: 'center' }}>
          {cascadesQuery.isLoading ? t('common.loading') : t('cascadeEdit.gone')}
        </Text>
      </Box>
    );
  }

  const { name, enabled, hideHops, autoProfile, pools, directions } = draft;
  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const positionCount = pools.length + 1;

  const allIds = [...pools.flatMap((p) => p.nodeIds), ...directions.flatMap((d) => d.nodeIds)].filter(
    Boolean,
  );
  function othersThan(mine: string[]): string[] {
    const spent = [...allIds];
    for (const nid of mine) {
      const at = spent.indexOf(nid);
      if (at >= 0) spent.splice(at, 1);
    }
    return spent;
  }

  function setPool(idx: number, p: Partial<PositionDraft>) {
    setDraft((d) => (d ? { ...d, pools: d.pools.map((x, i) => (i === idx ? { ...x, ...p } : x)) } : d));
  }

  /** Picking the first entry node also sets the entry protocol: the entry has
   *  to be dialled on a core that node actually runs. It stays editable. */
  function setPoolNodes(idx: number, ids: string[]) {
    const first = ids.find(Boolean);
    const node = first ? nodeById.get(first) : null;
    const proto =
      idx === 0 && node && LINK_PROTOCOL_VALUES.includes(node.protocol)
        ? (node.protocol as CascadeProtocol)
        : null;
    setPool(idx, { nodeIds: ids, ...(proto ? { entryProtocol: proto } : {}) });
  }

  function setDirection(idx: number, p: Partial<DirectionDraft>) {
    setDraft((d) =>
      d ? { ...d, directions: d.directions.map((x, i) => (i === idx ? { ...x, ...p } : x)) } : d,
    );
  }

  function movePool(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= pools.length) return;
    const next = [...pools];
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    patch({ pools: next });
  }

  function moveDirection(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= directions.length) return;
    const next = [...directions];
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    patch({ directions: next });
  }

  const trimmedName = name.trim();
  const entryIds = pools[0]?.nodeIds.filter(Boolean) ?? [];
  const poolsFilled = pools.every((p) => p.nodeIds.some(Boolean));
  // A direction only needs a country to be saveable. An empty pool is a state
  // v4 can hold on purpose: the tag exists, no node stands behind it yet, and
  // the direction is simply not handed to clients. The preview says so per row
  // rather than the save button going dead for the whole form.
  const directionsFilled = directions.every((d) => Boolean(d.countryCode));
  const duplicate = new Set(allIds).size !== allIds.length;
  const links = Math.max(entryIds.length, 1) * directions.filter((d) => d.nodeIds.some(Boolean)).length;

  // A protocol column is a free string in the database and older rows can hold
  // a value the API no longer accepts (the demo seed writes `vless`). Such a
  // cascade keeps running, but it cannot be saved until the field holds a value
  // the schema knows, so say that rather than let the save 400.
  const legacy = pools
    .map((p, i) => {
      const bad: string[] = [];
      if (i === 0 && !isKnownProtocol(p.entryProtocol)) bad.push(p.entryProtocol);
      if (!isKnownProtocol(p.linkProtocol)) bad.push(p.linkProtocol);
      const first = p.nodeIds.find(Boolean);
      return bad.length > 0 ? { node: first ? nodeById.get(first)?.name ?? '?' : '?', bad } : null;
    })
    .filter((x): x is { node: string; bad: string[] } => x !== null);

  const valid =
    trimmedName.length > 0 &&
    poolsFilled &&
    directionsFilled &&
    !duplicate &&
    links <= MAX_LINKS &&
    legacy.length === 0;
  const dirty =
    JSON.stringify(frozen(draft)) !== JSON.stringify(toDraft(cascade, nodeById, () => 0, true));

  // T7: below this a node rejects the per-direction UUID at auth, so a client
  // landing on it loses the choice. Any entry node can be that one, and the
  // check only matters once there is more than one direction to pick from.
  const staleEntries = entryIds
    .map((nid) => nodeById.get(nid))
    .filter((n): n is Node => Boolean(n))
    .filter((n) => directions.length > 1 && isOlderThan(n.coreVersion, MIN_CASCADE_CORE));

  const todayBytes = entryIds.reduce<number | null>((sum, nid) => {
    const v = todayByNode.get(nid);
    if (v === undefined || v === null) return sum;
    return (sum ?? 0) + v;
  }, null);

  const blocker = !trimmedName
    ? t('cascadeCreate.needName')
    : duplicate
      ? t('cascadeCreate.needDistinct')
      : !poolsFilled
        ? t('cascadeCreate.needEntry')
        : !directionsFilled
          ? t('cascadeCreate.needDirection')
          : links > MAX_LINKS
            ? t('cascadeCreate.tooManyLinks', { n: links, max: MAX_LINKS })
            : legacy.length > 0
              ? t('cascadeEdit.legacyProtocol', {
                  node: legacy[0]!.node,
                  value: legacy[0]!.bad.join(', '),
                })
              : null;

  function confirmDelete() {
    modals.openConfirmModal({
      title: t('cascadeEdit.deleteTitle', { name: cascade!.name }),
      children: <Text size="sm">{t('cascadeEdit.deleteBody', { count: cascade!.hops.length })}</Text>,
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(),
    });
  }

  const directionNames = directions
    .flatMap((d) => d.nodeIds.filter(Boolean))
    .map((nid) => nodeById.get(nid)?.name)
    .filter((n): n is string => Boolean(n));
  // Directions that actually carry a node. An empty one is a tag with nothing
  // behind it yet, and it is not something the balancer can pick.
  const filledDirections = directions.filter((d) => d.nodeIds.some(Boolean)).length;

  return (
    <Stack gap={20}>
      {/* Page bar */}
      <Box className="page-bar">
        <Box style={{ display: 'flex', alignItems: 'center', gap: 11, paddingRight: 14, flexShrink: 0 }}>
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
            {cascade.name}
          </Text>
        </Box>

        <Box style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0 }} />

        <Box className="page-bar-facts" style={{ gap: 10 }}>
          {/* The whole strip reads the DRAFT: it describes the thing on screen,
              and the amber marker is what says it has not landed yet. There is
              no mode chip, because there is no mode: the shape below is the
              answer. */}
          <Chip tone={enabled ? MOSS : DIM} dot>
            {enabled ? t('cascades.enabled') : t('cascades.disabled')}
          </Chip>
          <Text
            className="page-bar-fact-mid"
            style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: DIM }}
          >
            ·
          </Text>
          <Text
            className="page-bar-fact-mid"
            style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: MIST, whiteSpace: 'nowrap' }}
          >
            {[
              t('cascadeEdit.factPositions', { n: positionCount }),
              t('cascadeEdit.factEntries', { n: entryIds.length }),
              t('cascadeEdit.factDirections', { n: directions.length }),
              todayBytes !== null ? t('cascadeEdit.factToday', { size: formatBytes(todayBytes) }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <Box style={{ flex: 1, minWidth: 0 }} />
          {dirty && (
            <Box style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: AMBER, flexShrink: 0 }} />
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  lineHeight: '12px',
                  textTransform: 'uppercase',
                  color: AMBER,
                }}
              >
                {t('cascadeEdit.unsaved')}
              </Text>
            </Box>
          )}
        </Box>

        <Box className="page-bar-actions">
          <BarIconButton title={t('common.delete')} onClick={confirmDelete}>
            <TrashIcon size={15} color={RED} />
          </BarIconButton>
          <BarButton onClick={() => navigate('/nodes')}>{t('common.cancel')}</BarButton>
          <BarButton
            primary
            icon="tick"
            disabled={!valid || !dirty || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? t('cascadeEdit.saving') : t('cascadeEdit.save')}
          </BarButton>
        </Box>
      </Box>

      <Box className="page-columns">
        <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minWidth: 0, width: '100%' }}>
          <SectionCard title={t('cascadeCreate.basics')} icon={<ShieldIcon size={15} color={CYAN} />}>
            <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
              <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                <FieldLabel required>{t('cascadeCreate.name')}</FieldLabel>
                <TextInput value={name} onChange={(e) => patch({ name: e.currentTarget.value })} />
                <Hint>{t('cascadeEdit.nameHint')}</Hint>
              </Stack>
              <Stack gap={6} style={{ width: 200, flexShrink: 0 }}>
                <FieldLabel>{t('cascadeCreate.state')}</FieldLabel>
                <StateField
                  enabled={enabled}
                  onChange={(v) => patch({ enabled: v })}
                  onLabel={t('cascadeCreate.stateOn')}
                  offLabel={t('cascadeCreate.stateOff')}
                />
                <Hint>{t('cascadeCreate.stateHint')}</Hint>
              </Stack>
            </Box>

            {/* Named nodes, not "exit nodes": on a live cascade the operator is
                deciding about these machines, and can see which. */}
            <ToggleRow
              checked={hideHops}
              onChange={(v) => patch({ hideHops: v })}
              title={t('cascadeCreate.hideHops')}
              hint={
                directionNames.length > 0
                  ? t('cascadeEdit.hideHopsHintNamed', { names: directionNames.join(', ') })
                  : t('cascadeCreate.hideHopsHint')
              }
            />

            {/* Locked below two directions, because there the balancer would
                choose between one thing and the subscriber would get a second
                row that behaves exactly like the first. */}
            <ToggleRow
              checked={autoProfile}
              disabled={filledDirections < 2}
              onChange={(v) => patch({ autoProfile: v })}
              title={t('cascadeEdit.autoProfile')}
              hint={
                filledDirections < 2
                  ? t('cascadeEdit.autoProfileNeedsTwo')
                  : t('cascadeEdit.autoProfileHint')
              }
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
              <Text
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 11,
                  lineHeight: '15px',
                  color: FAINT,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {t('cascadeCreate.positionsHint')}
              </Text>
              <Counter full={positionCount >= MAX_POSITIONS}>
                {positionCount}/{MAX_POSITIONS}
              </Counter>
            </Box>

            {pools.map((pool, i) => (
              <PositionRow
                key={pool.key}
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
                linkProtocol={pool.linkProtocol}
                linkLabel={t('cascadeCreate.linkProtocol')}
                onLinkProtocol={(v) => setPool(i, { linkProtocol: v })}
                canUp={i > 1}
                canDown={i > 0 && i < pools.length - 1}
                canDelete={i > 0}
                onUp={() => movePool(i, -1)}
                onDown={() => movePool(i, 1)}
                onDelete={() => patch({ pools: pools.filter((_, j) => j !== i) })}
              >
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
            ))}

            {/* The exit position. It holds directions rather than a pool. */}
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
                  prospectiveTag={nextFreeTag(directions, i, draft.nextTag)}
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
                  onDelete={() => patch({ directions: directions.filter((_, j) => j !== i) })}
                />
              ))}

              <DashedAdd
                label={t('cascadeCreate.addDirection')}
                note={t('cascadeCreate.tagOnce')}
                onClick={() =>
                  patch({
                    directions: [
                      ...directions,
                      { key: nextKey.current++, id: null, countryCode: '', nodeIds: [''], tag: null },
                    ],
                  })
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
              onClick={() =>
                patch({
                  pools: [
                    ...pools,
                    { key: nextKey.current++, nodeIds: [''], entryProtocol: 'xray', linkProtocol: 'xray' },
                  ],
                })
              }
            />
          </Stack>
        </Box>

        <Box className="page-rail">
          {/* THE CHAIN */}
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
                      picked.map((nid, j) => {
                        const node = nodeById.get(nid);
                        if (!node) return null;
                        return (
                          <PreviewNode
                            key={nid}
                            role={role}
                            node={node}
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
                    prospectiveTag={dir.tag ?? nextFreeTag(directions, i, draft.nextTag)}
                    note={directionNote(dir, nodeById, todayByNode, t)}
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

            {blocker && (
              <Note tone={AMBER} icon={<WarnIcon size={13} color={AMBER} />}>
                {blocker}
              </Note>
            )}

          </Stack>

          {/* WHAT SUBSCRIBERS SEE */}
          <Stack
            gap={12}
            style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BroadcastIcon size={15} color={CYAN} />
              <CardCaption>{t('cascadeEdit.subTitle')}</CardCaption>
            </Box>

            {!enabled ? (
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST }}>
                {t('cascadeEdit.subDisabled')}
              </Text>
            ) : (
              <Box
                style={{
                  borderRadius: 10,
                  backgroundColor: WELL,
                  border: `1px solid ${HAIRLINE}`,
                  overflow: 'hidden',
                  width: '100%',
                }}
              >
                {subscriptionRows(draft, nodeById, t).map((row, i) => (
                  <Box
                    key={row.label + i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 13px',
                      width: '100%',
                      borderTop: i === 0 ? undefined : `1px solid ${HAIRLINE}`,
                    }}
                  >
                    <Box
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: row.tone,
                        flexShrink: 0,
                      }}
                    />
                    <Text
                      style={{
                        fontFamily: DISPLAY,
                        fontSize: 12,
                        lineHeight: '16px',
                        color: SNOW,
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.label}
                    </Text>
                    <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: FAINT }}>
                      {row.note}
                    </Text>
                  </Box>
                ))}
              </Box>
            )}

            <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
              {directions.length > 1 ? t('cascadeEdit.subHintMany') : t('cascadeEdit.subHintOne')}
            </Text>
          </Stack>

          {/* LAST PUSH */}
          <Stack
            gap={12}
            style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
              <TickCircleIcon size={15} color={statusQuery.data?.done ? MOSS : AMBER} />
              <CardCaption>{t('cascadeEdit.pushTitle')}</CardCaption>
              <Box style={{ flex: 1, minWidth: 0 }} />
              <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: FAINT }}>
                {relativeTime(cascade.updatedAt, t)}
              </Text>
            </Box>

            <Text
              style={{
                fontFamily: DISPLAY,
                fontSize: 12,
                lineHeight: '16px',
                color: statusQuery.data?.done ? MOSS : AMBER,
              }}
            >
              {!statusQuery.data
                ? t('common.loading')
                : statusQuery.data.done
                  ? t('cascades.provisioned')
                  : t('cascadeEdit.pushPending', {
                      // The status endpoint can answer without a per-node list
                      // (nothing pushed yet), and a missing list is not a crash.
                      names: (statusQuery.data.hops ?? [])
                        .filter((h) => !h.applied)
                        .map((h) => h.name)
                        .join(', '),
                    })}
            </Text>

            {(statusQuery.data?.hops ?? []).map((hop) => (
              <Box
                key={hop.nodeId}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}
              >
                {hop.applied ? (
                  <TickIcon size={13} color={MOSS} />
                ) : (
                  <ClockIcon size={13} color={AMBER} />
                )}
                <Text
                  style={{
                    fontFamily: DISPLAY,
                    fontSize: 12,
                    lineHeight: '16px',
                    color: MIST,
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {hop.name}
                </Text>
                <Text
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    lineHeight: '12px',
                    color: hop.online ? FAINT : statusTone('unreachable'),
                  }}
                >
                  {hop.applied
                    ? t('cascadeEdit.hopApplied')
                    : hop.online
                      ? t('cascadeEdit.hopWaiting')
                      : t('cascadeEdit.hopOffline')}
                </Text>
              </Box>
            ))}

            <Note tone={AMBER} icon={<WarnIcon size={13} color={AMBER} />}>
              {t('cascadeEdit.pushNote', { n: allIds.length })}
            </Note>
          </Stack>
        </Box>
      </Box>
    </Stack>
  );
}

/* ───── Draft ───────────────────────────────────────────────────────────── */

interface Draft {
  name: string;
  enabled: boolean;
  hideHops: boolean;
  /** Offer the Auto line in the subscription: the entry picks the fastest
   *  direction instead of the subscriber picking a country. */
  autoProfile: boolean;
  /** The entry and any transits. The exit is `directions`. */
  pools: PositionDraft[];
  directions: DirectionDraft[];
  /** The tag the server will hand the next new direction, straight from the
   *  cascade's counter. Carried in the draft so the preview can name it without
   *  guessing: a guess drifts as soon as a direction is deleted, because spent
   *  tags are never handed out again. */
  nextTag: number;
}

/**
 * The saved cascade as an editable draft, translated from the hop shape the API
 * still answers in:
 *
 *   balancer -> entry pool + one direction per parallel exit
 *   chain    -> entry pool + a transit pool per middle hop + one direction
 *
 * A direction is named after the country of the node under it, which is the
 * best guess available until the backend stores the country itself. The tag is
 * the exit's ordinal, which is what the config generator writes today.
 *
 * `frozenKeys` makes the React keys constant, which is what the dirty
 * comparison needs: a key counter would make every re-seed compare unequal.
 */
function toDraft(
  c: Cascade,
  byId: Map<string, Node>,
  nextKey: () => number,
  frozenKeys = false,
): Draft {
  const sorted = [...c.hops].sort((a, b) => a.position - b.position);
  const key = () => (frozenKeys ? 0 : nextKey());

  // v4 (2026-08-04): the API answers in positions and directions, and that
  // answer wins. It carries two things the hop list cannot express and this
  // form now depends on: the identity of a direction, which is what preserves
  // its tag across a save, and the real tag rather than a row number. Both
  // lists are always present; EMPTY means the cascade predates the move and is
  // read from hops below.
  if (c.positions.length && c.directions.length) {
    return {
      name: c.name,
      enabled: c.enabled,
      hideHops: c.hideHopsFromSub ?? true,
      autoProfile: c.autoProfile ?? false,
      pools: [...c.positions]
        .sort((a, b) => a.position - b.position)
        .map((p) => ({
          key: key(),
          // An empty row keeps the picker drawable; save filters it back out.
          nodeIds: p.nodeIds.length ? [...p.nodeIds] : [''],
          entryProtocol: (p.entryProtocol ?? 'xray') as CascadeProtocol,
          linkProtocol: (p.linkProtocol ?? 'xray') as CascadeProtocol,
        })),
      directions: c.directions.map((d) => ({
        key: key(),
        id: d.id,
        countryCode: d.countryCode ?? '',
        // A direction with no nodes is a legitimate state, not a broken row:
        // the tag exists and waits for a node to stand behind it.
        nodeIds: d.nodeIds.length ? [...d.nodeIds] : [''],
        tag: d.tag,
      })),
      nextTag: c.nextDirectionTag,
    };
  }
  const head = sorted[0];
  const rest = sorted.slice(1);
  const exits = c.mode === 'balancer' ? rest : rest.slice(-1);
  const transits = c.mode === 'balancer' ? [] : rest.slice(0, -1);

  const pool = (h: (typeof sorted)[number]): PositionDraft => ({
    key: key(),
    nodeIds: [h.nodeId],
    // A hop that carried no protocol still needs one in the draft: promoting a
    // position must not produce a payload the API rejects.
    entryProtocol: (h.entryProtocol ?? 'xray') as CascadeProtocol,
    linkProtocol: (h.linkProtocol ?? 'xray') as CascadeProtocol,
  });

  return {
    name: c.name,
    enabled: c.enabled,
    hideHops: c.hideHopsFromSub ?? true,
    autoProfile: c.autoProfile ?? false,
    pools: [
      ...(head ? [pool(head)] : [{ key: key(), nodeIds: [''], entryProtocol: 'xray' as CascadeProtocol, linkProtocol: 'xray' as CascadeProtocol }]),
      ...transits.map(pool),
    ],
    // Pre-v4 cascade: there are no direction ids to keep, and the tag is the
    // position-derived number the old generator produced. Saving such a cascade
    // is what moves it onto the new model.
    directions: exits.length
      ? exits.map((h, i) => ({
          key: key(),
          id: null,
          countryCode: byId.get(h.nodeId)?.countryCode ?? '',
          nodeIds: [h.nodeId],
          tag: i + 1,
        }))
      : [{ key: key(), id: null, countryCode: '', nodeIds: [''], tag: null }],
    // The counter is kept per cascade and answered even for one still stored as
    // hops, so a direction added here gets the number the server will actually
    // issue rather than one derived from the rows on screen.
    nextTag: c.nextDirectionTag,
  };
}

/** The same draft with its React keys zeroed, so comparing it against a freshly
 *  built one measures the edit rather than the key counter. */
function frozen(d: Draft): Draft {
  return {
    ...d,
    pools: d.pools.map((p) => ({ ...p, key: 0 })),
    directions: d.directions.map((x) => ({ ...x, key: 0 })),
  };
}

/* ───── Derived views ───────────────────────────────────────────────────── */

/**
 * The tag a not-yet-saved direction will receive.
 *
 * The starting number comes from the cascade's own counter (`nextDirectionTag`)
 * and is NOT derived from the rows on screen. Tags are never reused, so once a
 * direction has been deleted the highest tag still visible is behind the
 * counter, and `max + 1` would promise a number that is already spent. All this
 * adds is the offset for other new rows queued above this one.
 */
function nextFreeTag(directions: DirectionDraft[], index: number, nextTag: number): number {
  const newBefore = directions.slice(0, index).filter((d) => d.tag === null).length;
  return nextTag + newBefore;
}

/** The line under a direction in the rail: its nodes, and what they carried. */
function directionNote(
  d: DirectionDraft,
  byId: Map<string, Node>,
  todayByNode: Map<string, number | null>,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  const picked = d.nodeIds.filter(Boolean);
  if (picked.length === 0) return t('cascadeCreate.directionNoNodes');
  const names = picked.map((nid) => byId.get(nid)?.name ?? nid).join(' · ');
  const bytes = picked.reduce<number | null>((sum, nid) => {
    const v = todayByNode.get(nid);
    if (v === undefined || v === null) return sum;
    return (sum ?? 0) + v;
  }, null);
  return bytes === null ? names : `${names} · ${formatBytes(bytes)}`;
}

/**
 * What lands in a subscriber's client: one entry per DIRECTION, each carrying
 * that direction's tag, plus the Auto row when the operator asked for it.
 *
 * This list once led with an Auto row unconditionally, and that row was
 * fiction: the entry matches on the tag in the client's UUID and had no rule for
 * an Auto tag, so picking it egressed at the ENTRY country instead of the exit
 * the cascade was sold as. The row was removed on 2026-08-15 and comes back here
 * only paired with the switch that also puts the matching rule on the node.
 */
function subscriptionRows(
  d: Draft,
  byId: Map<string, Node>,
  t: (k: string, o?: Record<string, unknown>) => string,
): { label: string; note: string; tone: string }[] {
  const rows: { label: string; note: string; tone: string }[] = [];
  // Same two conditions the panel enforces when it builds the subscription: the
  // switch is on, and there are at least two directions to choose between.
  if (d.autoProfile && d.directions.filter((x) => x.nodeIds.some(Boolean)).length > 1) {
    rows.push({
      label: t('cascadeEdit.subAuto', { name: d.name }),
      note: t('cascadeEdit.subTag', { tag: 'ffff' }),
      tone: MOSS,
    });
  }
  d.directions.forEach((dir, i) => {
    if (!dir.countryCode || !dir.nodeIds.some(Boolean)) return;
    rows.push({
      label: t('cascadeEdit.subVia', { name: d.name, where: dir.countryCode }),
      note: t('cascadeEdit.subTag', {
        tag: (dir.tag ?? nextFreeTag(d.directions, i, d.nextTag)).toString(16).padStart(4, '0'),
      }),
      tone: MOSS,
    });
  });
  // Off means the direction nodes keep their own direct entries alongside.
  if (!d.hideHops) {
    for (const nid of d.directions.flatMap((x) => x.nodeIds.filter(Boolean))) {
      const name = byId.get(nid)?.name;
      if (name) rows.push({ label: name, note: t('cascadeEdit.subDirect'), tone: DIM });
    }
  }
  return rows;
}

/* ───── Formatting ──────────────────────────────────────────────────────── */

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** How long ago the cascade was last written, which is when its config was last
 *  pushed: the two happen in the same request. */
function relativeTime(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return t('cascadeEdit.justNow');
  if (min < 60) return t('cascadeEdit.minAgo', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('cascadeEdit.hourAgo', { n: h });
  return t('cascadeEdit.dayAgo', { n: Math.floor(h / 24) });
}
