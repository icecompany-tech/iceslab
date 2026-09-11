import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Select, Stack, Switch, Text, UnstyledButton } from '@mantine/core';
import type { CascadeProtocol } from '@/lib/domain/cascades';
import type { Node } from '@/lib/domain/nodes';
import { COUNTRIES, countryFlag } from '@/lib/domain/countries';
import {
  AMBER,
  CARD,
  CYAN,
  DIM,
  DISPLAY,
  EDGE,
  FAINT,
  GROUND,
  HAIRLINE,
  MIST,
  MONO,
  MOSS,
  RED,
  SNOW,
  WELL,
} from '@/contours/cascades/lib/colors';
import {
  ROLE_TONE,
  isKnownProtocol,
  protocolOptions,
  statusTone,
  type HopRole,
} from '@/contours/cascades/lib/cascadeForm';

/**
 * The pieces both cascade pages are built from. Creating and editing a cascade
 * is the same form with a different verb, so the hop row, the node picker and
 * the drawing of the chain live here rather than twice.
 *
 * Anything genuinely different between the two (what the bar says, what the
 * button does, which cards sit in the rail) stays in the page.
 *
 * Components only. The palette is in `lib/colors`, the draft shape and the
 * functions that read it are in `lib/cascadeForm`: a module that exports both
 * components and plain values loses hot reload for everything in it.
 */

/* ───── Hop editor ──────────────────────────────────────────────────────── */

export function HopRow({
  role,
  node,
  nodes,
  claimedBy,
  usedElsewhere,
  onPickNode,
  entryProtocol,
  onEntryProtocol,
  linkProtocol,
  linkLabel,
  onLinkProtocol,
  subscriptionLabel,
  canUp,
  canDown,
  canDelete,
  onUp,
  onDown,
  onDelete,
}: {
  role: HopRole;
  node: Node | null;
  nodes: Node[];
  claimedBy: Map<string, string>;
  usedElsewhere: string[];
  onPickNode: (id: string) => void;
  entryProtocol: CascadeProtocol | null;
  onEntryProtocol: (v: CascadeProtocol) => void;
  linkProtocol: CascadeProtocol | null;
  linkLabel: string;
  onLinkProtocol: (v: CascadeProtocol) => void;
  /** Edit mode only: what a subscriber will see this exit called. Replaces the
   *  inert "egress direct" slot, which says nothing a live cascade needs. */
  subscriptionLabel?: string | null;
  canUp: boolean;
  canDown: boolean;
  canDelete: boolean;
  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const tone = ROLE_TONE[role];

  return (
    <Box
      className="cascade-hop"
      style={{
        padding: 14,
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        borderLeft: `3px solid ${tone}`,
      }}
    >
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 36,
          paddingInline: 10,
          borderRadius: 8,
          flexShrink: 0,
          backgroundColor: `${tone}14`,
          border: `1px solid ${tone}2E`,
        }}
      >
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: '0.1em',
            lineHeight: '12px',
            textTransform: 'uppercase',
            color: tone,
          }}
        >
          {t(`cascades.role.${role}`)}
        </Text>
      </Box>

      <Stack gap={6} className="cascade-hop-node">
        <FieldLabel>{t('cascadeCreate.node')}</FieldLabel>
        <NodeSelect
          value={node?.id ?? null}
          nodes={nodes}
          claimedBy={claimedBy}
          usedElsewhere={usedElsewhere}
          // The entry is the hop whose core version decides whether per-exit
          // auth works at all, so that is what its field reports.
          meta={role === 'entry' ? 'core' : 'status'}
          onChange={onPickNode}
        />
      </Stack>

      <Stack gap={6} className="cascade-hop-field">
        <FieldLabel muted={entryProtocol === null}>{t('cascadeCreate.entryProtocol')}</FieldLabel>
        {entryProtocol === null ? (
          <InertField>{t('cascadeCreate.notApplicable')}</InertField>
        ) : (
          <Select
            data={protocolOptions(entryProtocol)}
            value={entryProtocol}
            allowDeselect={false}
            error={!isKnownProtocol(entryProtocol)}
            onChange={(v) => v && onEntryProtocol(v as CascadeProtocol)}
          />
        )}
      </Stack>

      <Stack gap={6} className="cascade-hop-field">
        <FieldLabel muted={linkProtocol === null && !subscriptionLabel}>
          {linkProtocol === null && subscriptionLabel ? t('cascadeEdit.subLabel') : linkLabel}
        </FieldLabel>
        {linkProtocol !== null ? (
          <Select
            data={protocolOptions(linkProtocol)}
            value={linkProtocol}
            allowDeselect={false}
            error={!isKnownProtocol(linkProtocol)}
            onChange={(v) => v && onLinkProtocol(v as CascadeProtocol)}
          />
        ) : subscriptionLabel ? (
          <ReadonlyField>{subscriptionLabel}</ReadonlyField>
        ) : (
          <InertField>{t('cascadeCreate.egressDirect')}</InertField>
        )}
      </Stack>

      <Box style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <IconButton disabled={!canUp} onClick={onUp} title={t('cascadeCreate.moveUp')}>
          <MoveIcon size={15} color={canUp ? MIST : DIM} up />
        </IconButton>
        <IconButton disabled={!canDown} onClick={onDown} title={t('cascadeCreate.moveDown')}>
          <MoveIcon size={15} color={canDown ? MIST : DIM} />
        </IconButton>
        <IconButton disabled={!canDelete} onClick={onDelete} title={t('common.delete')}>
          <TrashIcon size={15} color={canDelete ? RED : DIM} />
        </IconButton>
      </Box>
    </Box>
  );
}

/**
 * The node picker. Beyond the name it carries the two facts that decide whether
 * a node belongs in this chain: is it answering, and does another cascade
 * already own it.
 */
export function NodeSelect({
  value,
  nodes,
  claimedBy,
  usedElsewhere,
  meta = 'status',
  onChange,
}: {
  value: string | null;
  nodes: Node[];
  claimedBy: Map<string, string>;
  usedElsewhere: string[];
  meta?: 'status' | 'core';
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n] as const)), [nodes]);
  const taken = useMemo(() => new Set(usedElsewhere.filter(Boolean)), [usedElsewhere]);
  const selected = value ? byId.get(value) ?? null : null;

  // A node already used by another hop of THIS cascade is disabled: the backend
  // rejects the save outright (no loops), so offering it would only produce a
  // 400. A node owned by ANOTHER cascade stays pickable and is labelled instead.
  const data = useMemo(
    () => nodes.map((n) => ({ value: n.id, label: n.name, disabled: taken.has(n.id) })),
    [nodes, taken],
  );

  // A node that has not reported a core version yet falls back to its status,
  // rather than leaving the slot blank on the one hop where the version matters.
  const trailing =
    selected && meta === 'core' && selected.coreVersion
      ? { text: `${selected.protocol} ${selected.coreVersion}`, tone: FAINT }
      : selected
        ? { text: selected.status, tone: statusTone(selected.status) }
        : null;

  return (
    <Select
      data={data}
      value={value}
      searchable
      allowDeselect={false}
      placeholder={t('cascadeCreate.nodePlaceholder')}
      nothingFoundMessage={t('common.nothingFound')}
      onChange={(v) => v && onChange(v)}
      leftSection={
        selected?.countryCode ? (
          <Text style={{ fontSize: 14, lineHeight: '14px' }}>{countryFlag(selected.countryCode)}</Text>
        ) : undefined
      }
      leftSectionWidth={30}
      rightSectionWidth={trailing ? Math.min(150, trailing.text.length * 6 + 34) : 34}
      rightSectionPointerEvents="none"
      rightSection={
        <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {trailing && (
            <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: trailing.tone }}>
              {trailing.text}
            </Text>
          )}
          <ChevronIcon size={14} color={MIST} />
        </Box>
      }
      renderOption={({ option }) => {
        const node = byId.get(option.value);
        const owner = claimedBy.get(option.value);
        return (
          <Box style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', minWidth: 0 }}>
            {node?.countryCode && (
              <Text style={{ fontSize: 13, lineHeight: '13px' }}>{countryFlag(node.countryCode)}</Text>
            )}
            <Text
              style={{
                fontFamily: DISPLAY,
                fontSize: 13,
                lineHeight: '17px',
                color: option.disabled ? FAINT : SNOW,
                flexShrink: 0,
              }}
            >
              {option.label}
            </Text>
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 10,
                lineHeight: '12px',
                color: FAINT,
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {node?.address}
            </Text>
            {option.disabled ? (
              <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: FAINT }}>
                {t('cascadeCreate.alreadyInThis')}
              </Text>
            ) : owner ? (
              <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: AMBER }}>
                {t('cascadeCreate.inCascade', { name: owner })}
              </Text>
            ) : null}
            {node && (
              <Box
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: statusTone(node.status),
                  flexShrink: 0,
                }}
              />
            )}
          </Box>
        );
      }}
    />
  );
}

/* ───── Positions and directions (v4) ───────────────────────────────────── */

/**
 * A pool of nodes, as a column of pickers. One row per node plus a dashed row
 * to grow it: the operator should see the pool as a list, because that is what
 * the core will round-robin over.
 */
export function PoolField({
  nodeIds,
  nodes,
  claimedBy,
  usedElsewhere,
  meta = 'status',
  addLabel,
  onChange,
}: {
  nodeIds: string[];
  nodes: Node[];
  claimedBy: Map<string, string>;
  usedElsewhere: string[];
  meta?: 'status' | 'core';
  addLabel: string;
  onChange: (ids: string[]) => void;
}) {
  const rows = nodeIds.length ? nodeIds : [''];
  return (
    <Stack gap={8} style={{ width: '100%' }}>
      {rows.map((id, i) => (
        <Box key={`${i}-${id}`} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <NodeSelect
              value={id || null}
              nodes={nodes}
              claimedBy={claimedBy}
              // Every other slot of this cascade, plus the pool's own other rows.
              usedElsewhere={[...usedElsewhere, ...rows.filter((_, j) => j !== i)]}
              meta={meta}
              onChange={(v) => onChange(rows.map((r, j) => (j === i ? v : r)))}
            />
          </Box>
          {rows.length > 1 && (
            <IconButton onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <TrashIcon size={14} color={RED} />
            </IconButton>
          )}
        </Box>
      ))}
      <DashedAdd label={addLabel} onClick={() => onChange([...rows, ''])} />
    </Stack>
  );
}

/** One position: the badge, its pool, and the two protocol decisions. */
export function PositionRow({
  role,
  poolLabel,
  nodeIds,
  nodes,
  claimedBy,
  usedElsewhere,
  addNodeLabel,
  onNodes,
  entryProtocol,
  onEntryProtocol,
  linkProtocol,
  linkLabel,
  onLinkProtocol,
  canUp,
  canDown,
  canDelete,
  onUp,
  onDown,
  onDelete,
  children,
}: {
  role: HopRole;
  poolLabel: string;
  nodeIds: string[];
  nodes: Node[];
  claimedBy: Map<string, string>;
  usedElsewhere: string[];
  addNodeLabel: string;
  onNodes: (ids: string[]) => void;
  entryProtocol: CascadeProtocol | null;
  onEntryProtocol: (v: CascadeProtocol) => void;
  linkProtocol: CascadeProtocol;
  linkLabel: string;
  onLinkProtocol: (v: CascadeProtocol) => void;
  canUp: boolean;
  canDown: boolean;
  canDelete: boolean;
  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
  /** Anything the page wants under the pool, e.g. a core-version warning. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const tone = ROLE_TONE[role];

  return (
    <Box
      className="cascade-position"
      style={{
        padding: 14,
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        borderLeft: `3px solid ${tone}`,
      }}
    >
      <RoleBadge role={role} tone={tone} />

      <Stack gap={6} className="cascade-position-pool">
        <FieldLabel>{poolLabel}</FieldLabel>
        <PoolField
          nodeIds={nodeIds}
          nodes={nodes}
          claimedBy={claimedBy}
          usedElsewhere={usedElsewhere}
          meta={role === 'entry' ? 'core' : 'status'}
          addLabel={addNodeLabel}
          onChange={onNodes}
        />
        {children}
      </Stack>

      <Stack gap={6} className="cascade-hop-field">
        <FieldLabel muted={entryProtocol === null}>{t('cascadeCreate.entryProtocol')}</FieldLabel>
        {entryProtocol === null ? (
          <InertField>{t('cascadeCreate.notApplicable')}</InertField>
        ) : (
          <Select
            data={protocolOptions(entryProtocol)}
            value={entryProtocol}
            allowDeselect={false}
            error={!isKnownProtocol(entryProtocol)}
            onChange={(v) => v && onEntryProtocol(v as CascadeProtocol)}
          />
        )}
      </Stack>

      <Stack gap={6} className="cascade-hop-field">
        <FieldLabel>{linkLabel}</FieldLabel>
        <Select
          data={protocolOptions(linkProtocol)}
          value={linkProtocol}
          allowDeselect={false}
          error={!isKnownProtocol(linkProtocol)}
          onChange={(v) => v && onLinkProtocol(v as CascadeProtocol)}
        />
      </Stack>

      <RowActions
        canUp={canUp}
        canDown={canDown}
        canDelete={canDelete}
        onUp={onUp}
        onDown={onDown}
        onDelete={onDelete}
      />
    </Box>
  );
}

/**
 * One way out. The tag slot is a fact, not a field: the backend issues it on
 * first save and never reuses it, so before that it shows the number the
 * direction is going to get, in the dashed frame that means "not yet real".
 */
export function DirectionRow({
  tag,
  prospectiveTag,
  countryCode,
  onCountry,
  nodeIds,
  nodes,
  claimedBy,
  usedElsewhere,
  addNodeLabel,
  onNodes,
  canUp,
  canDown,
  canDelete,
  onUp,
  onDown,
  onDelete,
}: {
  tag: number | null;
  prospectiveTag: number;
  countryCode: string;
  onCountry: (code: string) => void;
  nodeIds: string[];
  nodes: Node[];
  claimedBy: Map<string, string>;
  usedElsewhere: string[];
  addNodeLabel: string;
  onNodes: (ids: string[]) => void;
  canUp: boolean;
  canDown: boolean;
  canDelete: boolean;
  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
}) {
  return (
    <Box className="cascade-direction" style={{ alignItems: 'flex-start' }}>
      <Box className="cascade-direction-tag">
        <TagSlot tag={tag} prospective={prospectiveTag} />
      </Box>
      <Box className="cascade-direction-country">
        <CountrySelect value={countryCode} onChange={onCountry} />
      </Box>
      <Box className="cascade-direction-nodes">
        <PoolField
          nodeIds={nodeIds}
          nodes={nodes}
          claimedBy={claimedBy}
          usedElsewhere={usedElsewhere}
          addLabel={addNodeLabel}
          onChange={onNodes}
        />
      </Box>
      <RowActions
        canUp={canUp}
        canDown={canDown}
        canDelete={canDelete}
        onUp={onUp}
        onDown={onDown}
        onDelete={onDelete}
      />
    </Box>
  );
}

/** The four hex digits that ride in the UUID. Dashed until the save that mints it. */
export function TagSlot({ tag, prospective }: { tag: number | null; prospective: number }) {
  const issued = tag !== null;
  const value = (issued ? tag : prospective).toString(16).padStart(4, '0');
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 36,
        borderRadius: 10,
        backgroundColor: issued ? WELL : 'transparent',
        border: `1px ${issued ? 'solid' : 'dashed'} ${issued ? HAIRLINE : EDGE}`,
      }}
    >
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 12,
          letterSpacing: '0.06em',
          lineHeight: '16px',
          color: issued ? CYAN : DIM,
        }}
      >
        {value}
      </Text>
    </Box>
  );
}

/** The country a direction is named after. It labels the way out, not the node
 *  under it, which is why it survives swapping every node beneath. */
export function CountrySelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const { t } = useTranslation();
  const data = useMemo(
    () => COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
    [],
  );
  return (
    <Select
      data={data}
      value={value || null}
      searchable
      allowDeselect={false}
      placeholder={t('cascadeCreate.countryPlaceholder')}
      nothingFoundMessage={t('common.nothingFound')}
      onChange={(v) => v && onChange(v)}
      leftSection={
        value ? <Text style={{ fontSize: 14, lineHeight: '14px' }}>{countryFlag(value)}</Text> : undefined
      }
      leftSectionWidth={value ? 30 : 0}
      renderOption={({ option }) => (
        <Box style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', minWidth: 0 }}>
          <Text style={{ fontSize: 13, lineHeight: '13px' }}>{countryFlag(option.value)}</Text>
          <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '17px', color: SNOW, flex: 1 }}>
            {option.label}
          </Text>
          <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: FAINT }}>
            {option.value}
          </Text>
        </Box>
      )}
    />
  );
}

export function RoleBadge({ role, tone }: { role: HopRole; tone: string }) {
  const { t } = useTranslation();
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 36,
        paddingInline: 10,
        borderRadius: 8,
        flexShrink: 0,
        backgroundColor: `${tone}14`,
        border: `1px solid ${tone}2E`,
      }}
    >
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.1em',
          lineHeight: '12px',
          textTransform: 'uppercase',
          color: tone,
        }}
      >
        {t(`cascades.role.${role}`)}
      </Text>
    </Box>
  );
}

export function RowActions({
  canUp,
  canDown,
  canDelete,
  onUp,
  onDown,
  onDelete,
}: {
  canUp: boolean;
  canDown: boolean;
  canDelete: boolean;
  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, height: 36 }}>
      <IconButton disabled={!canUp} onClick={onUp} title={t('cascadeCreate.moveUp')}>
        <MoveIcon size={15} color={canUp ? MIST : DIM} up />
      </IconButton>
      <IconButton disabled={!canDown} onClick={onDown} title={t('cascadeCreate.moveDown')}>
        <MoveIcon size={15} color={canDown ? MIST : DIM} />
      </IconButton>
      <IconButton disabled={!canDelete} onClick={onDelete} title={t('common.delete')}>
        <TrashIcon size={15} color={canDelete ? RED : DIM} />
      </IconButton>
    </Box>
  );
}

/** A slim dashed row, for growing a pool or a list of directions. */
export function DashedAdd({
  label,
  note,
  disabled,
  onClick,
}: {
  label: string;
  note?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: note ? 'flex-start' : 'center',
        gap: 8,
        height: 36,
        width: '100%',
        paddingInline: 12,
        borderRadius: 10,
        border: `1px dashed ${EDGE}`,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT }}>{label}</Text>
      {note && (
        <>
          <Box style={{ flex: 1, minWidth: 0 }} />
          <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: DIM }}>{note}</Text>
        </>
      )}
    </UnstyledButton>
  );
}

/** A direction in the rail: what the client will see as one way out. */
export function PreviewDirection({
  countryCode,
  prospectiveTag,
  note,
}: {
  countryCode: string;
  prospectiveTag: number;
  note: string;
}) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '11px 13px',
        width: '100%',
        minWidth: 0,
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        borderLeft: `3px solid ${MOSS}`,
      }}
    >
      <Text style={{ fontSize: 14, lineHeight: '14px' }}>{countryFlag(countryCode)}</Text>
      <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 600, lineHeight: '17px', color: SNOW }}>
        {countryCode}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: DIM }}>
        {prospectiveTag.toString(16).padStart(4, '0')}
      </Text>
      <Box style={{ flex: 1, minWidth: 0 }} />
      <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: FAINT }}>{note}</Text>
    </Box>
  );
}

/* ───── Preview ─────────────────────────────────────────────────────────── */

export function PreviewNode({
  role,
  node,
  chip,
  claimedBy,
  note,
}: {
  role: HopRole;
  node: Node;
  chip: string;
  claimedBy?: string | null;
  /** A line under the name: today's traffic, or whatever the page knows. */
  note?: string | null;
}) {
  const { t } = useTranslation();
  const tone = ROLE_TONE[role];
  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        padding: '11px 13px',
        width: '100%',
        minWidth: 0,
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        borderLeft: `3px solid ${tone}`,
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minWidth: 0 }}>
        {node.countryCode && (
          <Text style={{ fontSize: 14, lineHeight: '14px' }}>{countryFlag(node.countryCode)}</Text>
        )}
        <Text
          style={{
            fontFamily: DISPLAY,
            fontSize: 13,
            fontWeight: 600,
            lineHeight: '17px',
            color: SNOW,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {node.name}
        </Text>
        <Box style={{ flex: 1, minWidth: 0 }} />
        {/* A node can physically sit in two cascades; only one config wins, so
            the clash is named here rather than discovered on the VPS. */}
        {claimedBy && (
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 19,
              paddingInline: 7,
              borderRadius: 5,
              backgroundColor: `${AMBER}1A`,
              border: `1px solid ${AMBER}33`,
              flexShrink: 0,
            }}
          >
            <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: AMBER }}>
              {t('cascadeCreate.inCascade', { name: claimedBy })}
            </Text>
          </Box>
        )}
        {chip && (
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 19,
              paddingInline: 7,
              borderRadius: 5,
              backgroundColor: `${tone}1A`,
              border: `1px solid ${tone}33`,
              flexShrink: 0,
            }}
          >
            <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: tone }}>{chip}</Text>
          </Box>
        )}
      </Box>
      {note && (
        <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '13px', color: FAINT }}>{note}</Text>
      )}
    </Box>
  );
}

export function PreviewPending({ label }: { label: string }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '11px 13px',
        width: '100%',
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px dashed ${EDGE}`,
      }}
    >
      <Box
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          backgroundColor: CARD,
          border: `1px solid ${HAIRLINE}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: DIM }}>?</Text>
      </Box>
      <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '17px', color: FAINT }}>{label}</Text>
    </Box>
  );
}

/** The arrow between two hops, carrying the protocol the link speaks. */
export function PreviewLink({ label, fan }: { label: string; fan?: boolean }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 9, paddingLeft: 18, width: '100%' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
        {fan ? (
          // A balancer does not queue its exits, it picks one, so the glyph
          // forks instead of pointing straight down.
          <>
            <path d="M12 4v6" fill="none" stroke={DIM} strokeWidth="2" strokeLinecap="round" />
            <path
              d="M6 20v-4a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4"
              fill="none"
              stroke={DIM}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <>
            <path d="M12 5v14" fill="none" stroke={DIM} strokeWidth="2" strokeLinecap="round" />
            <path
              d="M6 13l6 6l6 -6"
              fill="none"
              stroke={DIM}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}
      </svg>
      <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: FAINT }}>{label}</Text>
    </Box>
  );
}

/* ───── Small pieces ────────────────────────────────────────────────────── */

export function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack gap={16} style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <CardCaption>{title}</CardCaption>
      </Box>
      {children}
    </Stack>
  );
}

export function CardCaption({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.16em',
        lineHeight: '12px',
        textTransform: 'uppercase',
        color: MIST,
      }}
    >
      {children}
    </Text>
  );
}

export function FieldLabel({
  children,
  required,
  muted,
}: {
  children: ReactNode;
  required?: boolean;
  muted?: boolean;
}) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.12em',
          lineHeight: '12px',
          textTransform: 'uppercase',
          color: muted ? DIM : MIST,
        }}
      >
        {children}
      </Text>
      {required && <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: RED }}>*</Text>}
    </Box>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return (
    <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>{children}</Text>
  );
}

/** A field-shaped box that holds a fact rather than a control: the role of this
 *  hop leaves nothing to choose here. */
export function InertField({ children }: { children: ReactNode }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 36,
        paddingInline: 12,
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
      }}
    >
      <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '17px', color: DIM }}>{children}</Text>
    </Box>
  );
}

/** Like InertField, but for a derived value worth reading: sits on the ground
 *  surface like a real field and keeps the value legible. */
export function ReadonlyField({ children }: { children: ReactNode }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 36,
        paddingInline: 12,
        borderRadius: 10,
        backgroundColor: GROUND,
        border: `1px solid ${HAIRLINE}`,
        overflow: 'hidden',
      }}
    >
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 12,
          lineHeight: '16px',
          color: MIST,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </Text>
    </Box>
  );
}

export function Counter({ children, full }: { children: ReactNode; full?: boolean }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 20,
        paddingInline: 8,
        borderRadius: 6,
        backgroundColor: WELL,
        border: `1px solid ${full ? `${AMBER}2E` : EDGE}`,
        flexShrink: 0,
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: full ? AMBER : MIST }}>
        {children}
      </Text>
    </Box>
  );
}

/** Small mono pill in an accent. `dot` prefixes the accent as a dot. */
export function Chip({
  tone,
  dot,
  children,
}: {
  tone: string;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 22,
        paddingInline: 8,
        borderRadius: 6,
        flexShrink: 0,
        backgroundColor: `${tone}14`,
        border: `1px solid ${tone}2E`,
      }}
    >
      {dot && <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone, flexShrink: 0 }} />}
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.1em',
          lineHeight: '12px',
          textTransform: 'uppercase',
          color: tone,
        }}
      >
        {children}
      </Text>
    </Box>
  );
}

export function ModeTile({
  selected,
  tone,
  onClick,
  title,
  hint,
}: {
  selected: boolean;
  tone: string;
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: 14,
        flex: 1,
        minWidth: 0,
        borderRadius: 10,
        textAlign: 'left',
        backgroundColor: selected ? `${tone}0D` : WELL,
        border: `1px solid ${selected ? tone : HAIRLINE}`,
      }}
    >
      <Box
        style={{
          width: 14,
          height: 14,
          borderRadius: 999,
          border: `1px solid ${selected ? tone : DIM}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {selected && <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone }} />}
      </Box>
      <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: DISPLAY,
            fontSize: 13,
            fontWeight: 600,
            lineHeight: '17px',
            color: selected ? SNOW : MIST,
          }}
        >
          {title}
        </Text>
        <Text
          style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: selected ? MIST : FAINT }}
        >
          {hint}
        </Text>
      </Stack>
    </UnstyledButton>
  );
}

export function ToggleRow({
  checked,
  onChange,
  title,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  hint: string;
  /** Greyed out and unclickable, for a switch whose effect the cascade cannot
   *  deliver yet. The hint is expected to say why. */
  disabled?: boolean;
}) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 14px',
        width: '100%',
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
        style={{ flexShrink: 0 }}
      />
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '17px', color: SNOW }}>
          {title}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>{hint}</Text>
      </Stack>
    </Box>
  );
}

/** The state switch, sitting in a box the height of a field so the column next
 *  to it shares one baseline. */
export function StateField({
  enabled,
  onChange,
  onLabel,
  offLabel,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 36,
        paddingInline: 12,
        borderRadius: 10,
        backgroundColor: GROUND,
        border: `1px solid ${HAIRLINE}`,
      }}
    >
      <Switch checked={enabled} onChange={(e) => onChange(e.currentTarget.checked)} style={{ flexShrink: 0 }} />
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: '17px',
          color: enabled ? SNOW : MIST,
        }}
      >
        {enabled ? onLabel : offLabel}
      </Text>
    </Box>
  );
}

export function Note({ tone, icon, children }: { tone: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '11px 13px',
        width: '100%',
        borderRadius: 10,
        backgroundColor: `${tone}0D`,
        border: `1px solid ${tone}29`,
      }}
    >
      <Box style={{ display: 'flex', marginTop: 1, flexShrink: 0 }}>{icon}</Box>
      <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: tone, flex: 1, minWidth: 0 }}>
        {children}
      </Text>
    </Box>
  );
}

export function BarButton({
  children,
  primary,
  icon,
  disabled,
  onClick,
}: {
  children: ReactNode;
  primary?: boolean;
  icon?: 'plus' | 'tick';
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 38,
        paddingInline: 16,
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {icon === 'plus' && <PlusIcon size={14} color={CYAN} />}
      {icon === 'tick' && <TickIcon size={14} color={CYAN} />}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: '16px',
          color: primary ? SNOW : MIST,
        }}
      >
        {children}
      </Text>
    </UnstyledButton>
  );
}

/** Square bar action, for the one destructive button that gets no words. */
export function BarIconButton({
  children,
  title,
  onClick,
}: {
  children: ReactNode;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 38,
        height: 38,
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        flexShrink: 0,
      }}
    >
      {children}
    </UnstyledButton>
  );
}

export function IconButton({
  children,
  disabled,
  title,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 36,
        borderRadius: 8,
        flexShrink: 0,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </UnstyledButton>
  );
}

/** The dashed row that grows the chain. */
export function AddHopButton({
  label,
  left,
  disabled,
  onClick,
}: {
  label: string;
  left: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 44,
        width: '100%',
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px dashed ${EDGE}`,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <PlusIcon size={14} color={CYAN} />
      <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '17px', color: SNOW }}>
        {label}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: FAINT }}>{left}</Text>
    </UnstyledButton>
  );
}

/* ───── Icons ───────────────────────────────────────────────────────────── */

export function ChainIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="5.5" cy="18.5" r="2.5" fill="none" stroke={color} strokeWidth="1.9" />
      <circle cx="18.5" cy="5.5" r="2.5" fill="none" stroke={color} strokeWidth="1.9" />
      <path
        d="M5.5 16v-0.5a3.5 3.5 0 0 1 3.5 -3.5h6a3.5 3.5 0 0 0 3.5 -3.5v-0.5"
        fill="none"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ShieldIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EyeIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" fill="none" stroke={color} strokeWidth="1.8" />
      <path
        d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function InfoIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 9h.01" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M11 12h1v4h1"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

export function WarnIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 9v4" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M12 16h.01" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

/** Tick in a circle: a settled, good state. */
export function TickCircleIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="1.8" />
      <path
        d="M9 12l2 2l4 -4"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Bare tick, for a row that already sits in a list. */
export function TickIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M5 12l5 5L20 7"
        fill="none"
        stroke={color}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ClockIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="1.8" />
      <path
        d="M12 7v5l3 2"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Broadcast arcs: what leaves the panel and reaches a subscriber. */
export function BroadcastIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M5 6a1 1 0 0 1 1 -1c8.3 0 15 6.7 15 15a1 1 0 0 1 -1 1"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M5 12a1 1 0 0 1 1 -1a8 8 0 0 1 8 8a1 1 0 0 1 -1 1"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="6" cy="18" r="1.6" fill="none" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}

export function PlusIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 5l0 14" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M5 12l14 0" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function MoveIcon({ size, color, up }: { size: number; color: string; up?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      {up ? (
        <>
          <path d="M12 20V6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <path
            d="M6 12l6 -6l6 6"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <path d="M12 4v14" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <path
            d="M6 12l6 6l6 -6"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}

export function TrashIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M4 7h16" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2 -2l1 -12"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 7v-2a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v2"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M8 9l4 -4l4 4"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 15l-4 4l-4 -4"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
