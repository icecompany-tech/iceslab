import { useMemo, useRef, useState } from 'react';
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
import { watchCascadeProvisioning } from '@/contours/cascades/lib/cascadeProvision';
import { MIN_CASCADE_CORE, isOlderThan } from '@/lib/domain/protocols';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import {
  BarButton,
  CardCaption,
  ChainIcon,
  Counter,
  DashedAdd,
  DirectionRow,
  DISPLAY,
  EDGE,
  EyeIcon,
  FieldLabel,
  HAIRLINE,
  Hint,
  InfoIcon,
  LINK_PROTOCOL_VALUES,
  MAX_LINKS,
  MAX_POSITIONS,
  MIST,
  MONO,
  ModeTile,
  MOSS,
  Note,
  PositionRow,
  PreviewDirection,
  PreviewLink,
  PreviewNode,
  PreviewPending,
  RoleBadge,
  ROLE_TONE,
  SectionCard,
  ShieldIcon,
  SNOW,
  StateField,
  TickCircleIcon,
  ToggleRow,
  VIOLET,
  WarnIcon,
  WELL,
  AMBER,
  CARD,
  CYAN,
  FAINT,
  poolRoleAt,
  toDirectionInputs,
  toPositionInputs,
  type DirectionDraft,
  type PositionDraft,
} from '@/contours/cascades/components/CascadeEditor';

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
  const nodes = useMemo(() => nodesQuery.data?.nodes ?? [], [nodesQuery.data]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n] as const)), [nodes]);

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
   * because the entry has to be dialled on a core that node actually runs. It
   * stays editable: a node with the sing-box engine serves more than its own
   * protocol.
   */
  function setPoolNodes(idx: number, ids: string[]) {
    const first = ids.find(Boolean);
    const node = first ? nodeById.get(first) : null;
    const proto =
      idx === 0 && node && LINK_PROTOCOL_VALUES.includes(node.protocol)
        ? (node.protocol as CascadeProtocol)
        : null;
    setPool(idx, { nodeIds: ids, ...(proto ? { entryProtocol: proto } : {}) });
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
  const entryIds = pools[0]?.nodeIds.filter(Boolean) ?? [];
  const poolsFilled = pools.every((p) => p.nodeIds.some(Boolean));
  // Country is enough. A direction with an empty pool is legitimate in v4: the
  // tag exists and waits for a node, and clients are simply not offered it.
  const directionsFilled = directions.every((d) => Boolean(d.countryCode));
  const duplicate = new Set(allIds).size !== allIds.length;
  const links = Math.max(entryIds.length, 1) * directions.filter((d) => d.nodeIds.some(Boolean)).length;
  const overLinks = links > MAX_LINKS;

  const valid =
    trimmedName.length > 0 && poolsFilled && directionsFilled && !duplicate && !overLinks;

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
      }),
    onSuccess: (cascade) => {
      qc.invalidateQueries({ queryKey: ['cascades'] });
      qc.invalidateQueries({ queryKey: ['nodes'] });
      navigate('/nodes');
      if (cascade?.id) watchCascadeProvisioning(cascade.id, t);
      else notifications.show({ color: 'green', message: t('cascades.saved') });
    },
    onError: (err) => {
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
                onDelete={() => setPools((prev) => prev.filter((_, j) => j !== i))}
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
                />
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
                      dir.nodeIds.filter(Boolean).length
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
