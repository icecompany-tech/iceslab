import type { Node } from '@/lib/domain/nodes';
import type { Cascade } from '@/lib/domain/cascades';
import type { RoutePolicy } from '@/lib/domain/routePolicies';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChainIcon, CircleMinusIcon, LockIcon } from '@/contours/nodes/components/NodeEdit/icons';
import { RoutesHeader } from '@/contours/nodes/components/NodeEdit/RoutesHeader';
import { RuleRow } from '@/contours/nodes/components/NodeEdit/RuleRow';
import { TableHead } from '@/contours/nodes/components/NodeEdit/RoutesTableHead';
import { TagButton } from '@/contours/nodes/components/NodeEdit/TagButton';
import { AMBER, CARD, CYAN, DIM, DISPLAY, EDGE, FAINT, HAIRLINE, MONO, MOSS, RED, SNOW, VIOLET, WELL } from '@/contours/nodes/lib/colors';
import { Box, Stack, Text } from '@mantine/core';
import { WarnIcon } from '@/contours/nodes/components/NodeEdit/icons';
export function ResolvedRoutes({
  node,
  cascade,
  isBalancerEntry,
  policies,
  egressLabel,
}: {
  node: Node;
  cascade: { cascade: Cascade; role: string; directions: string[] } | null;
  isBalancerEntry: boolean;
  policies: { policy: RoutePolicy; squads: string[] }[];
  egressLabel: string;
}) {
  const { t } = useTranslation();
  // Tag 0 is the plain profile every user gets; the rest are granted policies.
  const [tag, setTag] = useState(0);

  // Only a node outside every cascade has nothing: each hop carries a rule set,
  // it is just a short one everywhere except the balancer entry.
  if (!cascade) {
    return (
      <Box style={{ padding: 40, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}>
        <Stack align="center" gap={8}>
          <Text style={{ fontFamily: DISPLAY, fontSize: 14, fontWeight: 500, color: SNOW }}>
            {t('nodeEdit.routes.noneTitle')}
          </Text>
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT, maxWidth: 560, textAlign: 'center' }}>
            {t('nodeEdit.routes.noneBody', { egress: egressLabel })}
          </Text>
        </Stack>
      </Box>
    );
  }

  const exits = cascade.cascade.hops.slice(1);

  // Transit and exit hops answer one question only: what arrives on the
  // inter-hop link goes where. No tags, no policies, so the header and the two
  // rows are the whole truth about them.
  if (!isBalancerEntry && cascade.role !== 'entry') {
    return (
      <Box style={{ borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}`, overflow: 'hidden' }}>
        <RoutesHeader node={node} role={cascade.role} />
        <TableHead />
        <RuleRow
          accent={MOSS}
          background={WELL}
          icon={<ChainIcon size={13} color={FAINT} />}
          match={t('nodeEdit.routes.fromLink')}
          action={
            cascade.role === 'exit'
              ? t('nodeEdit.routes.fromOurIp')
              : t('nodeEdit.routes.toDirection', {
                  where: cascade.directions.length > 0 ? cascade.directions.join(' · ') : '-',
                })
          }
          actionDot={cascade.role === 'exit' ? MOSS : VIOLET}
          why={t(`nodeEdit.routes.why.${cascade.role}`, { cascade: cascade.cascade.name })}
        />
        <RuleRow
          accent={DIM}
          icon={<CircleMinusIcon size={14} color={FAINT} />}
          match={t('nodeEdit.routes.everythingElse')}
          matchStrong
          action={t('nodeEdit.routes.nothingElse')}
          why={t('nodeEdit.routes.nothingElseWhy')}
          muted
        />
      </Box>
    );
  }

  // A chain entry has no route profiles: one path, so no tag to pick.
  if (!isBalancerEntry) {
    return (
      <Box style={{ borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}`, overflow: 'hidden' }}>
        <RoutesHeader node={node} role="entry" />
        <TableHead />
        <RuleRow
          accent={RED}
          background={WELL}
          icon={<LockIcon size={13} color={FAINT} />}
          match={t('nodeEdit.routes.quicMatch')}
          action={t('nodeEdit.routes.quicAction')}
          why={t('nodeEdit.routes.quicWhy')}
          muted
        />
        <RuleRow
          accent={MOSS}
          background={WELL}
          icon={<CircleMinusIcon size={14} color={FAINT} />}
          match={t('nodeEdit.routes.everythingElse')}
          matchStrong
          action={t('nodeEdit.routes.toDirection', {
                  where: cascade.directions.length > 0 ? cascade.directions.join(' · ') : '-',
                })}
          actionDot={VIOLET}
          why={t('nodeEdit.routes.why.chainEntry', { cascade: cascade.cascade.name })}
        />
      </Box>
    );
  }

  const active = policies.find((p) => p.policy.ordinal === tag) ?? null;
  // Block is emitted above direct, so a domain in both never reaches direct.
  const blocked = new Set(active?.policy.blockDomains ?? []);
  const deadDirect = (active?.policy.directDomains ?? []).filter((d) => blocked.has(d));
  const liveDirect = (active?.policy.directDomains ?? []).filter((d) => !blocked.has(d));
  const source = active ? t('nodeEdit.routes.source', { policy: active.policy.name, squads: active.squads.join(', ') }) : '';

  return (
    <Box style={{ borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}`, overflow: 'hidden' }}>
      <RoutesHeader node={node} role="entry" balancer />

      {/* One node carries every set; the tag in the client's UUID picks one. */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 20px',
          borderBottom: `1px solid ${HAIRLINE}`,
        }}
      >
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.12em',
            lineHeight: '12px',
            textTransform: 'uppercase',
            color: FAINT,
            flexShrink: 0,
          }}
        >
          {t('nodeEdit.routes.showFor')}
        </Text>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <TagButton active={tag === 0} onClick={() => setTag(0)} label={t('nodeEdit.routes.plain')} tag={0} />
          {policies.map(({ policy }) => (
            <TagButton
              key={policy.id}
              active={tag === policy.ordinal}
              onClick={() => setTag(policy.ordinal)}
              label={policy.name}
              tag={policy.ordinal}
            />
          ))}
        </Box>
        <Box style={{ flex: 1 }} />
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT }}>
          {t('nodeEdit.routes.switchHint')}
        </Text>
      </Box>

      <TableHead />

      {/* Always first, on every tag: the panel's own guard rule. */}
      <RuleRow
        accent={RED}
        background={WELL}
        icon={<LockIcon size={13} color={FAINT} />}
        match={t('nodeEdit.routes.quicMatch')}
        action={t('nodeEdit.routes.quicAction')}
        why={t('nodeEdit.routes.quicWhy')}
        muted
      />

      {active && active.policy.blockDomains.length > 0 && (
        <RuleRow
          accent={CYAN}
          match={active.policy.blockDomains.join(' · ')}
          action={t('nodeEdit.routes.toNowhere')}
          actionDot={RED}
          why={source}
        />
      )}
      {active && liveDirect.length > 0 && (
        <RuleRow
          accent={CYAN}
          match={liveDirect.join(' · ')}
          action={t('nodeEdit.routes.fromOurIp')}
          actionDot={MOSS}
          why={source}
        />
      )}
      {deadDirect.length > 0 && (
        <RuleRow
          accent={AMBER}
          background={`${AMBER}0D`}
          icon={<WarnIcon size={14} color={AMBER} />}
          match={deadDirect.join(' · ')}
          action={t('nodeEdit.routes.fromOurIp')}
          why={t('nodeEdit.routes.deadWhy')}
          whyTone={AMBER}
          struck
        />
      )}

      {/* The catch-all. Which exit it lands on is the node's own door. */}
      <RuleRow
        accent={MOSS}
        background={WELL}
        icon={<CircleMinusIcon size={14} color={FAINT} />}
        match={t('nodeEdit.routes.everythingElse')}
        matchStrong
        why={t('nodeEdit.routes.defaultWhy')}
        actionBox={
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              height: 34,
              paddingInline: 12,
              borderRadius: 8,
              backgroundColor: CARD,
              border: `1px solid ${EDGE}`,
              width: 250,
              flexShrink: 0,
            }}
          >
            <Box style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: VIOLET, flexShrink: 0 }} />
            <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '16px', color: SNOW }}>
              {exits.length === 1
                ? t('nodeEdit.routes.exitOne', { name: exits[0]!.nodeName })
                : t('nodeEdit.routes.exitMany', { count: exits.length })}
            </Text>
          </Box>
        }
      />
    </Box>
  );
}

/** Name of the node plus the role it plays in its cascade. */
