import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import {
  getCascadeStatus,
  listBindings,
  listRoutePolicies,
  listSquads,
  type Cascade,
  type CascadeHop,
  type Node,
} from '../lib/api';
import { countryFlag } from '../lib/countries';
import { useOverview } from '../hooks/useOverview';

/**
 * The cascade inventory, in two densities. Cards draw the path as a path, which
 * is what a cascade is; rows collapse the same facts to one line each so a long
 * list stays scannable. Same data behind both, the toggle only changes shape.
 */

const HAIRLINE = '#1C2A3D';
const EDGE = '#2C3A4E';
const CARD = '#0F1A28';
const WELL = '#0B1420';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const FAINT = '#5A6B82';
const DIM = '#3A4A60';
const CYAN = '#7DD3FC';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const RED = '#E07A5F';
const VIOLET = '#A78BFA';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

export type CascadeLayout = 'cards' | 'rows';

/** Everything a cascade row or card needs, assembled once per cascade. */
export interface CascadeRow {
  cascade: Cascade;
  entry: HopView | null;
  /** Positions between the entry and the way out. A cascade with one direction
   *  can still have them; a fan of directions cannot. */
  transits: HopView[];
  /** The ways out. The tag identifies the direction, not the node under it. */
  directions: DirectionView[];
  /** Traffic that entered the cascade today, i.e. the entry node's own. */
  todayBytes: number | null;
  squads: { name: string; members: number }[];
  policies: { name: string; ordinal: number }[];
  users: number;
}

interface HopView {
  hop: CascadeHop;
  node: Node | null;
  status: string;
  todayBytes: number | null;
  /** The hop acknowledged the config pushed after the last save. */
  applied: boolean | null;
}

/**
 * One way out of the cascade.
 *
 * Since v4 the tag and the country are the direction's own fields, read from
 * the API rather than derived from the node under it. That matters after a
 * delete: tags are never renumbered, so a row index would start naming the
 * wrong country while the link in a client still points at the old tag.
 *
 * `hop` and `nodeName` are null when the pool is empty, which is a state the
 * new model can hold on purpose: the tag exists, no node stands behind it yet.
 */
interface DirectionView {
  key: string;
  hop: CascadeHop | null;
  nodeName: string | null;
  node: Node | null;
  status: string;
  todayBytes: number | null;
  applied: boolean | null;
  tag: number;
  countryCode: string | null;
}

/**
 * Join cascades with everything that explains them: node status and traffic
 * from the dashboard poll, squads and policies from the ACL. Kept in one hook so
 * both densities render off the same numbers.
 */
export function useCascadeRows(cascades: Cascade[], nodes: Node[]): CascadeRow[] {
  const overviewQuery = useOverview();
  const squadsQuery = useQuery({ queryKey: ['squads'], queryFn: listSquads });
  const policiesQuery = useQuery({ queryKey: ['route-policies'], queryFn: listRoutePolicies });
  const bindingsQuery = useQuery({ queryKey: ['bindings'], queryFn: () => listBindings() });

  return useMemo(() => {
    const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
    const overviewById = new Map((overviewQuery.data?.nodes ?? []).map((n) => [n.id, n] as const));
    const bindings = bindingsQuery.data?.bindings ?? [];
    const squads = squadsQuery.data?.squads ?? [];
    const policies = policiesQuery.data?.policies ?? [];

    return cascades.map((cascade) => {
      const view = (hop: CascadeHop): HopView => {
        const node = nodeById.get(hop.nodeId) ?? null;
        const ov = overviewById.get(hop.nodeId);
        return {
          hop,
          node,
          status: ov?.status ?? node?.status ?? 'unknown',
          todayBytes: ov?.todayBytes ?? null,
          applied: null,
        };
      };
      const hops = [...cascade.hops].sort((a, b) => a.position - b.position);
      const entry = hops[0] ? view(hops[0]) : null;
      const rest = hops.slice(1).map(view);
      // A balancer's parallel exits are all directions; a chain has exactly one,
      // and everything before it is a transit position.
      const exits = cascade.mode === 'balancer' ? rest : rest.slice(-1);
      const transits = cascade.mode === 'balancer' ? [] : rest.slice(0, -1);

      // v4 answers with directions of their own, and those win: they carry the
      // real tag and the country the operator chose. A pre-v4 cascade has none,
      // and its exits are read from the hop list as before, where the tag can
      // only be guessed from the order.
      const directions: DirectionView[] = cascade.directions.length
        ? cascade.directions.map((d) => {
            const nodeId = d.nodeIds[0] ?? null;
            const node = nodeId ? nodeById.get(nodeId) ?? null : null;
            const ov = nodeId ? overviewById.get(nodeId) : undefined;
            const hop = nodeId ? hops.find((h) => h.nodeId === nodeId) ?? null : null;
            return {
              key: d.id,
              hop,
              nodeName: node?.name ?? hop?.nodeName ?? null,
              node,
              status: ov?.status ?? node?.status ?? 'unknown',
              todayBytes: ov?.todayBytes ?? null,
              applied: null,
              tag: d.tag,
              countryCode: d.countryCode || node?.countryCode || null,
            };
          })
        : exits.map((h, i) => ({
            key: h.hop.id,
            hop: h.hop,
            nodeName: h.hop.nodeName,
            node: h.node,
            status: h.status,
            todayBytes: h.todayBytes,
            applied: h.applied,
            tag: i + 1,
            countryCode: h.node?.countryCode ?? null,
          }));

      // Who can actually use this cascade: squads holding a profile that is
      // bound on the entry node, since that is the door clients dial.
      const entryProfiles = new Set(
        bindings.filter((b) => b.nodeId === entry?.hop.nodeId).map((b) => b.profileId),
      );
      const reaching = squads.filter((s) => s.profileIds.some((p) => entryProfiles.has(p)));
      const grantedIds = new Set(reaching.flatMap((s) => s.policyIds));

      return {
        cascade,
        entry,
        transits,
        directions,
        todayBytes: entry?.todayBytes ?? null,
        squads: reaching.map((s) => ({ name: s.name, members: s.memberCount })),
        policies: policies
          .filter((p) => grantedIds.has(p.id))
          .map((p) => ({ name: p.name, ordinal: p.ordinal })),
        users: reaching.reduce((sum, s) => sum + s.memberCount, 0),
      };
    });
  }, [cascades, nodes, overviewQuery.data, squadsQuery.data, policiesQuery.data, bindingsQuery.data]);
}

export function CascadesView({
  rows,
  layout,
  onEdit,
  onDelete,
  onToggleEnabled,
}: {
  rows: CascadeRow[];
  layout: CascadeLayout;
  onEdit: (c: Cascade) => void;
  onDelete: (c: Cascade) => void;
  onToggleEnabled: (c: Cascade) => void;
}) {
  const { t } = useTranslation();

  if (rows.length === 0) {
    return (
      <Box style={{ padding: 40, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, color: MIST, textAlign: 'center' }}>
          {t('cascades.empty')}
        </Text>
      </Box>
    );
  }

  if (layout === 'rows') {
    return (
      <Box style={{ borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}`, overflow: 'hidden' }}>
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '12px 20px',
            borderBottom: `1px solid ${HAIRLINE}`,
          }}
        >
          <ColHead width={190}>{t('cascades.col.cascade')}</ColHead>
          <ColHead width={120}>{t('cascades.col.shape')}</ColHead>
          <ColHead flex>{t('cascades.col.path')}</ColHead>
          <ColHead width={175}>{t('cascades.col.reaches')}</ColHead>
          <ColHead width={90}>{t('cascades.col.today')}</ColHead>
          <ColHead width={190}>{t('cascades.col.lastPush')}</ColHead>
          <Box style={{ width: 72, flexShrink: 0 }} />
        </Box>
        {rows.map((row) => (
          <CascadeLine
            key={row.cascade.id}
            row={row}
            onEdit={() => onEdit(row.cascade)}
            onDelete={() => onDelete(row.cascade)}
          />
        ))}
      </Box>
    );
  }

  return (
    <Stack gap={20}>
      {rows.map((row) => (
        <CascadeCard
          key={row.cascade.id}
          row={row}
          onEdit={() => onEdit(row.cascade)}
          onDelete={() => onDelete(row.cascade)}
          onToggleEnabled={() => onToggleEnabled(row.cascade)}
        />
      ))}
    </Stack>
  );
}

/* ───── Cards ───────────────────────────────────────────────────────────── */

function CascadeCard({
  row,
  onEdit,
  onDelete,
  onToggleEnabled,
}: {
  row: CascadeRow;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
}) {
  const { t } = useTranslation();
  const { cascade, entry, transits, directions } = row;
  const fan = directions.length > 1;
  const accent = !cascade.enabled ? DIM : fan ? CYAN : MOSS;

  // A cascade that is off pushes nothing, so it collapses to one line: the
  // shape of a path nobody is walking is not worth the vertical space.
  if (!cascade.enabled) {
    return (
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '16px 20px',
          borderRadius: 10,
          backgroundColor: CARD,
          border: `1px solid ${HAIRLINE}`,
          borderLeft: `3px solid ${DIM}`,
        }}
      >
        <Text style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 600, lineHeight: '20px', color: MIST }}>
          {cascade.name}
        </Text>
        <Chip tone={DIM} dot>
          {t('cascades.disabled')}
        </Chip>
        <ShapeChip row={row} />
        <Divider />
        <Box style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {[entry, ...transits].filter(Boolean).map((h, i) => (
            <Box key={h!.hop.id} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              {i > 0 && <Arrow tone={EDGE} />}
              <Text style={{ fontFamily: MONO, fontSize: 12, lineHeight: '15px', color: FAINT }}>
                {h!.hop.nodeName}
              </Text>
            </Box>
          ))}
          {directions.map((d) => (
            <Box key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Arrow tone={EDGE} />
              <Text style={{ fontFamily: MONO, fontSize: 12, lineHeight: '15px', color: FAINT }}>
                {d.countryCode ? `${d.countryCode} ${tagLabel(d.tag)}` : tagLabel(d.tag)}
              </Text>
            </Box>
          ))}
        </Box>
        <Divider />
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT }}>
          {t('cascades.offHint')}
        </Text>
        <Box style={{ flex: 1, minWidth: 0 }} />
        <SmallButton icon="power" onClick={onToggleEnabled}>
          {t('cascades.enable')}
        </SmallButton>
        <IconButton onClick={onEdit} kind="edit" />
        <IconButton onClick={onDelete} kind="delete" />
      </Box>
    );
  }

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 10,
        backgroundColor: CARD,
        border: `1px solid ${HAIRLINE}`,
        borderLeft: `3px solid ${accent}`,
        overflow: 'hidden',
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', width: '100%' }}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 600, lineHeight: '20px', color: SNOW }}>
          {cascade.name}
        </Text>
        <Chip tone={MOSS} dot>
          {t('cascades.enabled')}
        </Chip>
        <ShapeChip row={row} />
        <Dot />
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT }}>
          {fan ? t('cascades.fanHint', { n: directions.length }) : t('cascades.oneWayHint')}
        </Text>
        <Box style={{ flex: 1, minWidth: 0 }} />
        <Fact value={row.todayBytes === null ? '-' : formatBytes(row.todayBytes)} label={t('cascades.bar.today')} />
        <Dot />
        {/* Squads, not users: a member can sit in several of them, and the
            panel has no per-squad member list to dedupe against, so a summed
            user count would overstate reach. The footer chips carry the real
            per-squad numbers. */}
        <Fact value={String(row.squads.length)} label={t('cascades.bar.squads')} />
        <IconButton onClick={onEdit} kind="edit" />
        <IconButton onClick={onDelete} kind="delete" />
      </Box>

      {/* One way out is drawn as a path of tiles; several are drawn as a list,
          because they are a choice rather than a sequence. The choice is the
          client's: it picks a direction by picking a server, so there is no
          probe to report under the arrow. */}
      {fan ? (
        <Box style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '0 20px 18px' }}>
          {entry && <HopTile hop={entry} role="entry" />}
          <LinkColumn
            protocol={entry?.hop.linkProtocol ?? null}
            fan
            note={t('cascades.clientPicks')}
          />
          <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
            {directions.map((d) => (
              <DirectionLine key={d.key} direction={d} />
            ))}
          </Stack>
        </Box>
      ) : (
        <Box style={{ display: 'flex', alignItems: 'stretch', width: '100%', padding: '0 20px 18px' }}>
          {entry && <HopTile hop={entry} role="entry" />}
          {transits.map((h, i) => (
            <Box key={h.hop.id} style={{ display: 'flex', alignItems: 'stretch' }}>
              <LinkColumn
                protocol={(i === 0 ? entry?.hop.linkProtocol : transits[i - 1]?.hop.linkProtocol) ?? null}
              />
              <HopTile hop={h} role="transit" />
            </Box>
          ))}
          {directions.map((d) => (
            <Box key={d.key} style={{ display: 'flex', alignItems: 'stretch' }}>
              <LinkColumn
                protocol={
                  (transits.length ? transits[transits.length - 1]?.hop.linkProtocol : entry?.hop.linkProtocol) ??
                  null
                }
              />
              <DirectionTile direction={d} />
            </Box>
          ))}
          <Box style={{ flex: 1, minWidth: 0 }} />
        </Box>
      )}

      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 20px',
          width: '100%',
          backgroundColor: WELL,
          borderTop: `1px solid ${HAIRLINE}`,
        }}
      >
        <Caption>{t('cascades.reaches')}</Caption>
        {row.squads.length === 0 ? (
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT }}>
            {t('cascades.reachesNobody')}
          </Text>
        ) : (
          row.squads.map((s) => (
            <Box
              key={s.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                height: 22,
                paddingInline: 9,
                borderRadius: 6,
                backgroundColor: CARD,
                border: `1px solid ${HAIRLINE}`,
              }}
            >
              <Box style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: CYAN, flexShrink: 0 }} />
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, fontWeight: 500, lineHeight: '16px', color: SNOW }}>
                {s.name}
              </Text>
              <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: FAINT }}>{s.members}</Text>
            </Box>
          ))
        )}
        <Divider />
        <Caption>{t('cascades.policies')}</Caption>
        {row.policies.length === 0 ? (
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 22,
              paddingInline: 9,
              borderRadius: 6,
              backgroundColor: CARD,
              border: `1px solid ${HAIRLINE}`,
            }}
          >
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST }}>
              {t('cascades.plainOnly')}
            </Text>
          </Box>
        ) : (
          row.policies.map((p) => (
            <Box
              key={p.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                height: 22,
                paddingInline: 9,
                borderRadius: 6,
                backgroundColor: CARD,
                border: `1px solid ${HAIRLINE}`,
              }}
            >
              {/* No ordinal here: the number an operator reads on this screen
                  is the direction tag, and a second numbering beside it reads
                  as the same thing when it is not. */}
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: SNOW }}>{p.name}</Text>
            </Box>
          ))
        )}
        <Box style={{ flex: 1, minWidth: 0 }} />
        <PushState cascadeId={cascade.id} />
      </Box>
    </Box>
  );
}

/** One hop, as a tile: who it is, whether it answers, and what it is here for. */
function HopTile({ hop, role }: { hop: HopView; role: 'entry' | 'transit' | 'exit' }) {
  const { t } = useTranslation();
  const tone = statusTone(hop.status);
  const roleTone = role === 'entry' ? CYAN : role === 'exit' ? MOSS : MIST;
  return (
    <Stack
      gap={10}
      style={{
        width: 300,
        flexShrink: 0,
        padding: 14,
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        {hop.node?.countryCode && (
          <Text style={{ fontSize: 14, lineHeight: '14px' }}>{countryFlag(hop.node.countryCode)}</Text>
        )}
        <Text style={{ fontFamily: DISPLAY, fontSize: 14, fontWeight: 600, lineHeight: '18px', color: SNOW }}>
          {hop.hop.nodeName}
        </Text>
        <Box style={{ flex: 1 }} />
        <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone, flexShrink: 0 }} />
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.08em',
              lineHeight: '12px',
              textTransform: 'uppercase',
              color: tone,
            }}
          >
            {hop.status}
          </Text>
        </Box>
      </Box>
      <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: FAINT }}>
        {hop.node?.address ?? '-'}
      </Text>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Chip tone={roleTone} small>
          {t(`cascades.role.${role}`)}
        </Chip>
        {role === 'entry' && hop.node?.coreVersion && (
          <Chip tone={VIOLET} small>
            {hop.node.protocol} {hop.node.coreVersion}
          </Chip>
        )}
        <Box style={{ flex: 1 }} />
        <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: MIST }}>
          {hop.todayBytes === null ? '-' : formatBytes(hop.todayBytes)}
        </Text>
      </Box>
    </Stack>
  );
}

/** The wire between two hops: what carries it, and where it lands. */
function LinkColumn({ protocol, fan, note }: { protocol: string | null; fan?: boolean; note?: string }) {
  return (
    <Stack
      gap={6}
      align="center"
      justify="center"
      style={{ width: 120, flexShrink: 0, alignSelf: fan ? 'stretch' : undefined }}
    >
      <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', lineHeight: '12px', color: MIST }}>
        {protocol ?? 'vless'}
      </Text>
      <Box style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '0 10px' }}>
        <Box style={{ flex: 1, height: 1, backgroundColor: EDGE }} />
        {fan ? (
          <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path
              d="M6 6l6 6l-6 6M13 6l6 6l-6 6"
              fill="none"
              stroke={CYAN}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <Arrow tone={EDGE} />
        )}
      </Box>
      {note && (
        <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: DIM }}>{note}</Text>
      )}
    </Stack>
  );
}

/** Four hex digits, as they ride in the UUID. */
function tagLabel(tag: number): string {
  return tag.toString(16).padStart(4, '0');
}

/** How many doors in, how many ways out. Read from the path, not from a stored
 *  mode: the panel no longer keeps one. */
function ShapeChip({ row }: { row: CascadeRow }) {
  // One node per position until pools ship; then this counts the entry pool.
  const entries = row.entry ? 1 : 0;
  const fan = row.directions.length > 1;
  return (
    <Chip tone={fan ? CYAN : undefined} edge={!fan}>
      {entries} → {row.directions.length}
    </Chip>
  );
}

/**
 * One way out, as a line. The direction is what the client picks, so the
 * country and the tag lead; the node under it is a detail that can change
 * without the tag ever moving.
 */
function DirectionLine({ direction }: { direction: DirectionView }) {
  const { t } = useTranslation();
  const tone = statusTone(direction.status);
  const dead = direction.status !== 'online';
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '10px 14px',
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${dead ? EDGE : HAIRLINE}`,
      }}
    >
      {direction.countryCode && (
        <Text style={{ fontSize: 13, lineHeight: '13px' }}>{countryFlag(direction.countryCode)}</Text>
      )}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: 600,
          lineHeight: '17px',
          color: dead ? MIST : SNOW,
          width: 110,
          flexShrink: 0,
        }}
      >
        {direction.countryCode ?? t('cascades.directionUnnamed')}
      </Text>
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: '0.06em',
          lineHeight: '14px',
          color: dead ? DIM : MOSS,
          width: 44,
          flexShrink: 0,
        }}
      >
        {tagLabel(direction.tag)}
      </Text>
      <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone, flexShrink: 0 }} />
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 12,
          lineHeight: '15px',
          color: dead ? FAINT : SNOW,
          whiteSpace: 'nowrap',
        }}
      >
        {direction.nodeName ?? t('cascades.directionNoNode')}
        {dead && direction.nodeName ? ` · ${direction.status}` : ''}
      </Text>
      <Box style={{ flex: 1, minWidth: 0 }} />
      <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: dead ? DIM : MIST }}>
        {direction.todayBytes === null ? '-' : formatBytes(direction.todayBytes)}
      </Text>
    </Box>
  );
}

/** The same direction as a tile, for a cascade with a single way out. */
function DirectionTile({ direction }: { direction: DirectionView }) {
  const { t } = useTranslation();
  const tone = statusTone(direction.status);
  return (
    <Stack
      gap={10}
      style={{
        width: 300,
        flexShrink: 0,
        padding: 14,
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        {direction.countryCode && (
          <Text style={{ fontSize: 14, lineHeight: '14px' }}>{countryFlag(direction.countryCode)}</Text>
        )}
        <Text style={{ fontFamily: DISPLAY, fontSize: 14, fontWeight: 600, lineHeight: '18px', color: SNOW }}>
          {direction.countryCode ?? t('cascades.directionUnnamed')}
        </Text>
        <Box style={{ flex: 1 }} />
        <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone, flexShrink: 0 }} />
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.08em',
              lineHeight: '12px',
              textTransform: 'uppercase',
              color: tone,
            }}
          >
            {direction.status}
          </Text>
        </Box>
      </Box>
      <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: FAINT }}>
        {direction.nodeName ?? t('cascades.directionNoNode')}
        {direction.node?.address ? ` · ${direction.node.address}` : ''}
      </Text>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Chip tone={MOSS} small>
          {t('cascades.directionTag', { tag: tagLabel(direction.tag) })}
        </Chip>
        <Box style={{ flex: 1 }} />
        <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: MIST }}>
          {direction.todayBytes === null ? '-' : formatBytes(direction.todayBytes)}
        </Text>
      </Box>
    </Stack>
  );
}

/* ───── Rows ────────────────────────────────────────────────────────────── */

function CascadeLine({ row, onEdit, onDelete }: { row: CascadeRow; onEdit: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const { cascade, entry, transits, directions } = row;
  const fan = directions.length > 1;
  const off = !cascade.enabled;
  const accent = off ? DIM : fan ? CYAN : MOSS;

  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        width: '100%',
        padding: '14px 20px',
        borderTop: `1px solid ${HAIRLINE}`,
        borderLeft: `3px solid ${accent}`,
        opacity: off ? 0.6 : 1,
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 9, width: 187, flexShrink: 0 }}>
        <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: off ? DIM : MOSS, flexShrink: 0 }} />
        <Text
          style={{
            fontFamily: DISPLAY,
            fontSize: 14,
            fontWeight: 600,
            lineHeight: '18px',
            color: off ? MIST : SNOW,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {cascade.name}
        </Text>
        {off && <Chip edge small>{t('cascades.off')}</Chip>}
      </Box>

      <Box style={{ width: 120, flexShrink: 0 }}>
        <ShapeChip row={row} />
      </Box>

      <Box style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
        {entry && <NodePill hop={entry} role="entry" />}
        <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: FAINT }}>
          {entry?.hop.linkProtocol ?? 'vless'}
        </Text>
        {fan ? (
          <svg width="13" height="13" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path
              d="M6 6l6 6l-6 6M13 6l6 6l-6 6"
              fill="none"
              stroke={CYAN}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <Arrow tone={EDGE} />
        )}
        {transits.map((h) => (
          <Box key={h.hop.id} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <NodePill hop={h} role="transit" />
            <Arrow tone={EDGE} />
          </Box>
        ))}
        {directions.map((d) => (
          <DirectionPill key={d.key} direction={d} />
        ))}
      </Box>

      <Box style={{ display: 'flex', alignItems: 'center', gap: 7, width: 175, flexShrink: 0, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: DISPLAY,
            fontSize: 12,
            lineHeight: '16px',
            color: row.squads.length === 0 ? FAINT : SNOW,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {row.squads.length === 0 ? t('cascades.reachesNobody') : row.squads.map((s) => s.name).join(', ')}
        </Text>
      </Box>

      <Text
        style={{
          fontFamily: MONO,
          fontSize: 12,
          fontWeight: 500,
          lineHeight: '15px',
          color: off ? FAINT : SNOW,
          width: 90,
          flexShrink: 0,
        }}
      >
        {row.todayBytes === null ? '-' : formatBytes(row.todayBytes)}
      </Text>

      <Box style={{ width: 190, flexShrink: 0 }}>
        {off ? (
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT }}>
            {t('cascades.offShort')}
          </Text>
        ) : (
          <PushState cascadeId={cascade.id} compact />
        )}
      </Box>

      <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: 72, flexShrink: 0 }}>
        <IconButton onClick={onEdit} kind="edit" bare />
        <IconButton onClick={onDelete} kind="delete" bare />
      </Box>
    </Box>
  );
}

/** A direction in a row: flag, country, tag, and the node currently under it. */
function DirectionPill({ direction }: { direction: DirectionView }) {
  const { t } = useTranslation();
  const dead = direction.status !== 'online';
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      {direction.countryCode && (
        <Text style={{ fontSize: 12, lineHeight: '12px' }}>{countryFlag(direction.countryCode)}</Text>
      )}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: '17px',
          color: dead ? MIST : SNOW,
        }}
      >
        {direction.countryCode ?? t('cascades.directionUnnamed')}
      </Text>
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 20,
          paddingInline: 7,
          borderRadius: 5,
          backgroundColor: dead ? 'transparent' : `${MOSS}14`,
          border: `1px solid ${dead ? HAIRLINE : `${MOSS}2E`}`,
        }}
      >
        <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: dead ? FAINT : MOSS }}>
          {tagLabel(direction.tag)}
        </Text>
      </Box>
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 11,
          lineHeight: '14px',
          color: dead ? RED : FAINT,
          whiteSpace: 'nowrap',
        }}
      >
        {direction.nodeName ?? t('cascades.directionNoNode')}
        {dead && direction.nodeName ? ` · ${t('cascades.directionDown')}` : ''}
      </Text>
    </Box>
  );
}

function NodePill({ hop, role }: { hop: HopView; role: 'entry' | 'transit' | 'exit' }) {
  const { t } = useTranslation();
  const out = hop.status !== 'online';
  const roleTone = role === 'entry' ? CYAN : role === 'exit' ? MOSS : MIST;
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        height: 24,
        paddingInline: 9,
        borderRadius: 6,
        backgroundColor: WELL,
        border: `1px solid ${out ? EDGE : HAIRLINE}`,
        flexShrink: 0,
        opacity: out ? 0.6 : 1,
      }}
    >
      {hop.node?.countryCode && (
        <Text style={{ fontSize: 12, lineHeight: '12px' }}>{countryFlag(hop.node.countryCode)}</Text>
      )}
      <Text style={{ fontFamily: MONO, fontSize: 12, lineHeight: '15px', color: SNOW, whiteSpace: 'nowrap' }}>
        {hop.hop.nodeName}
      </Text>
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.08em',
          lineHeight: '12px',
          textTransform: 'uppercase',
          color: out ? RED : roleTone,
          whiteSpace: 'nowrap',
        }}
      >
        {out ? t('cascades.outShort') : t(`cascades.role.${role}`)}
      </Text>
    </Box>
  );
}

/* ───── Shared bits ─────────────────────────────────────────────────────── */

/**
 * Whether every hop acknowledged the config pushed after the last save. Polled
 * only while it is still provisioning, so a settled cascade costs one call.
 */
function PushState({ cascadeId, compact }: { cascadeId: string; compact?: boolean }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['cascade-status', cascadeId],
    queryFn: () => getCascadeStatus(cascadeId),
    refetchInterval: (q) => (q.state.data?.done ? false : 10_000),
  });
  if (!query.data) return null;

  // The status endpoint can answer without a per-node list (nothing pushed
  // yet). A missing list is not a crash, and it is not "all 0 applied" either:
  // there is simply nothing to report.
  const nodes = query.data.hops ?? [];
  if (nodes.length === 0) return null;

  const pending = nodes.filter((h) => !h.applied);
  const ok = pending.length === 0;
  const tone = ok ? MOSS : AMBER;
  const text = ok
    ? compact
      ? t('cascades.push.okShort')
      : t('cascades.push.ok', { count: nodes.length })
    : t('cascades.push.pending', { names: pending.map((h) => h.name).join(', ') });

  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
      {ok ? (
        <svg width="13" height="13" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path
            d="M5 12l5 5L20 7"
            fill="none"
            stroke={tone}
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path d="M12 9v4M12 17h.01" fill="none" stroke={tone} strokeWidth="1.9" strokeLinecap="round" />
          <path
            d="M10.3 4.3L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"
            fill="none"
            stroke={tone}
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 12,
          lineHeight: '16px',
          color: tone,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </Text>
    </Box>
  );
}

function statusTone(status: string): string {
  if (status === 'online') return MOSS;
  if (status === 'offline') return DIM;
  if (status === 'unreachable') return RED;
  return AMBER;
}

function formatBytes(n: number): string {
  if (!n || n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function Chip({
  children,
  tone,
  edge,
  dot,
  small,
}: {
  children: React.ReactNode;
  tone?: string;
  edge?: boolean;
  dot?: boolean;
  small?: boolean;
}) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: small ? 20 : 22,
        paddingInline: 8,
        borderRadius: small ? 5 : 6,
        flexShrink: 0,
        backgroundColor: tone ? `${tone}14` : WELL,
        border: `1px solid ${tone ? `${tone}2E` : edge ? EDGE : HAIRLINE}`,
      }}
    >
      {dot && tone && (
        <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone, flexShrink: 0 }} />
      )}
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.1em',
          lineHeight: '12px',
          textTransform: 'uppercase',
          color: tone ?? (edge ? FAINT : MIST),
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </Text>
    </Box>
  );
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <Text style={{ fontFamily: MONO, fontSize: 13, fontWeight: 500, lineHeight: '16px', color: SNOW }}>
        {value}
      </Text>
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
        {label}
      </Text>
    </Box>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.12em',
        lineHeight: '12px',
        textTransform: 'uppercase',
        color: MIST,
        flexShrink: 0,
      }}
    >
      {children}
    </Text>
  );
}

function ColHead({ children, width, flex }: { children: React.ReactNode; width?: number; flex?: boolean }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.12em',
        lineHeight: '12px',
        textTransform: 'uppercase',
        color: FAINT,
        width,
        flex: flex ? 1 : undefined,
        minWidth: flex ? 0 : undefined,
        flexShrink: flex ? undefined : 0,
      }}
    >
      {children}
    </Text>
  );
}

function Dot() {
  return <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: DIM }}>·</Text>;
}

function Divider() {
  return <Box style={{ width: 1, height: 16, backgroundColor: HAIRLINE, flexShrink: 0 }} />;
}

function Arrow({ tone }: { tone: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M13 6l6 6l-6 6" fill="none" stroke={tone} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SmallButton({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  icon?: 'power';
  onClick?: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 32,
        paddingInline: 12,
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        flexShrink: 0,
      }}
    >
      {icon === 'power' && (
        <svg width="13" height="13" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path d="M12 5v6" fill="none" stroke={MOSS} strokeWidth="2" strokeLinecap="round" />
          <path d="M7.5 7.5a7 7 0 1 0 9 0" fill="none" stroke={MOSS} strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, fontWeight: 500, lineHeight: '16px', color: SNOW }}>
        {children}
      </Text>
    </UnstyledButton>
  );
}

function IconButton({ kind, bare, onClick }: { kind: 'edit' | 'delete'; bare?: boolean; onClick: () => void }) {
  const tone = kind === 'delete' ? RED : MIST;
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: bare ? 15 : 32,
        height: bare ? 15 : 32,
        borderRadius: 8,
        flexShrink: 0,
        backgroundColor: bare ? 'transparent' : WELL,
        border: bare ? 'none' : `1px solid ${HAIRLINE}`,
      }}
    >
      {kind === 'edit' ? (
        <svg width="15" height="15" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path
            d="M4 20h4l10.5 -10.5a2.8 2.8 0 0 0 -4 -4L4 16v4"
            fill="none"
            stroke={MIST}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M13.5 6.5l4 4" fill="none" stroke={MIST} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path d="M4 7h16" fill="none" stroke={bare ? FAINT : tone} strokeWidth="1.9" strokeLinecap="round" />
          <path d="M10 11v6M14 11v6" fill="none" stroke={bare ? FAINT : tone} strokeWidth="1.9" strokeLinecap="round" />
          <path
            d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2 -2l1 -12"
            fill="none"
            stroke={bare ? FAINT : tone}
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M9 7v-2a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v2"
            fill="none"
            stroke={bare ? FAINT : tone}
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </UnstyledButton>
  );
}
