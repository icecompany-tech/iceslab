import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import type { EngineName } from '@iceslab/shared';
import type { Node } from '@/lib/domain/nodes';
import { componentsOfEngine, coreVersionFleet, type CoreVersionFleet } from '@/lib/domain/coreVersions';
import { AMBER, CYAN, FAINT, HAIRLINE, MIST, MOSS, SNOW, WELL } from '@/contours/profiles/lib/colors';

const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

/**
 * Which version of the selected core the manifest pins, and how the fleet
 * stands against it.
 *
 * The version is the node's, not the profile's: one process serves every
 * profile of its core on a machine, so a profile cannot choose one. Owner's
 * question on the stand (24.09): "how do I set the version when creating a
 * profile" was answered by this strip being on the xray tab only; every tab
 * says it now, and says where the version is changed.
 *
 * Numbers from the manifest and cores[].version through judgeCoreVersion
 * (coreVersionFleet), never node.coreVersion, which is xray's alone.
 */
export function CoreVersionStrip({ engine, nodes }: { engine: EngineName; nodes: readonly Node[] }) {
  const { t } = useTranslation();
  const fleets = componentsOfEngine(engine).map((c) => coreVersionFleet(c, nodes));
  if (fleets.length === 0) return null;

  return (
    <Stack
      gap={8}
      style={{ padding: '10px 14px', borderRadius: 8, backgroundColor: '#0B1420', border: `1px solid ${HAIRLINE}` }}
    >
      <Group gap={10} align="center" wrap="wrap">
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: MIST,
          }}
        >
          {t('profiles.engine.coreVersion')}
        </Text>
        {fleets.map((f) => (
          <Group
            key={f.component}
            gap={8}
            wrap="nowrap"
            style={{ height: 30, padding: '0 12px', borderRadius: 8, backgroundColor: WELL, border: `1px solid ${HAIRLINE}` }}
          >
            <Text style={{ fontFamily: MONO, fontSize: 12, color: SNOW }}>
              {t(`profiles.engine.component.${f.component}`)} {f.pinned ?? ''}
            </Text>
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 9,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: f.pinned ? MOSS : FAINT,
              }}
            >
              {f.pinned ? t('profiles.engine.pin') : t('profiles.engine.noPin')}
            </Text>
          </Group>
        ))}
      </Group>

      {fleets.map((f) => (
        <FleetLine key={`fleet-${f.component}`} fleet={f} named={fleets.length > 1} />
      ))}

      <Text style={{ fontSize: 11, lineHeight: '16px', color: MIST }}>
        {t('profiles.engine.coreVersionHint')}{' '}
        <Link to="/nodes" style={{ color: CYAN }}>
          {t('profiles.engine.toNodes')}
        </Link>
      </Text>
    </Stack>
  );
}

/** «N из M нод на пине, K иначе, L не сообщили», раскрывается именами. */
function FleetLine({ fleet: f, named }: { fleet: CoreVersionFleet; named: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const who = named ? `${t(`profiles.engine.component.${f.component}`)}: ` : '';
  const expandable = f.other.length + f.silent.length > 0;
  const tone = f.other.length > 0 ? AMBER : f.total > 0 && f.silent.length === 0 ? MOSS : MIST;

  const summary =
    f.total === 0
      ? t('profiles.engine.fleetNone')
      : f.pinned
        ? t('profiles.engine.fleet', {
            onPin: f.onPin.length,
            total: f.total,
            other: f.other.length,
            silent: f.silent.length,
          })
        : t('profiles.engine.fleetUnpinned', {
            reported: f.other.length,
            total: f.total,
            silent: f.silent.length,
          });

  return (
    <Stack gap={4}>
      <UnstyledButton
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: expandable ? 'pointer' : 'default' }}
      >
        <Text style={{ fontSize: 11, lineHeight: '15px', color: tone }}>
          {who}
          {summary}
        </Text>
        {expandable && (
          <IconChevronDown
            size={12}
            stroke={2}
            color={tone}
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}
          />
        )}
      </UnstyledButton>
      {!f.pinned && f.unpinnedReason && (
        <Text style={{ fontSize: 11, lineHeight: '15px', color: FAINT }}>
          {t('profiles.engine.noPinWhy', { reason: f.unpinnedReason })}
        </Text>
      )}
      {open && (
        <Box style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 10 }}>
          {f.other.length > 0 && (
            <NodeList
              title={f.pinned ? t('profiles.engine.otherTitle') : t('profiles.engine.reportedTitle')}
              items={f.other.map((n) => ({ id: n.id, text: `${n.name} ${n.version}` }))}
            />
          )}
          {f.silent.length > 0 && (
            <NodeList
              title={t('profiles.engine.silentTitle')}
              items={f.silent.map((n) => ({ id: n.id, text: n.name }))}
            />
          )}
        </Box>
      )}
    </Stack>
  );
}

function NodeList({ title, items }: { title: string; items: { id: string; text: string }[] }) {
  return (
    <Text style={{ fontSize: 11, lineHeight: '16px', color: FAINT }}>
      {title}{' '}
      {items.map((n, i) => (
        <span key={n.id}>
          {i > 0 ? ', ' : ''}
          <Link to={`/nodes/${n.id}`} style={{ color: MIST }}>
            {n.text}
          </Link>
        </span>
      ))}
    </Text>
  );
}
