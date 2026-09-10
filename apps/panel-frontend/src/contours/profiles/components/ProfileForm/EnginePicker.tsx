import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Group, Menu, Stack, Text, UnstyledButton } from '@mantine/core';
import {
  IconAlertTriangle,
  IconBolt,
  IconCheck,
  IconInfoCircle,
  IconPlus,
  IconSelector,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { listNodes } from '@/lib/domain/nodes';
import { isOlderThan } from '@/lib/domain/protocols';
import {
  PREVIEW_KINDS,
  PREVIEW_ON_XRAY,
  PROFILE_KINDS,
  type PreviewKindKey,
  type ProfileKind,
} from '@/contours/profiles/lib/profileKinds';
import {
  engineTabOf,
  PROTOCOL_ACCENT,
  PROTOCOL_TILE_HINT,
  PROTOCOL_TILE_LABEL,
  PROTOCOL_TILE_NOTE,
  PROTOCOL_TILE_NOTE_WARN,
  type EngineTab,
} from '@/contours/profiles/lib/protocolTiles';
import { SectionCard } from '@/contours/profiles/components/ProfileForm/SectionCard';

const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";
const DISPLAY =
  "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/** Telegram's own blue. The tab wears it as a mark whether it is open or not. */
const TELEGRAM = '#3AABEE';

interface TileSpec {
  id: string;
  title: string;
  hint: string;
  note: string;
  accent: string;
  active: boolean;
  warnNote: boolean;
  onClick: () => void;
}

export function EnginePicker({
  engine,
  protocol,
  preview,
  onPick,
  onPickPreview,
}: {
  engine: 'native' | 'singbox';
  protocol: string;
  /** A Telegram view the panel can draw but not yet save, or null. */
  preview: PreviewKindKey | null;
  onPick: (kind: ProfileKind) => void;
  onPickPreview: (key: PreviewKindKey) => void;
}) {
  const { t } = useTranslation();
  const nodesQuery = useQuery({ queryKey: ['nodes'], queryFn: () => listNodes() });
  // Which core version the operator is inspecting. Null means "the newest one
  // the fleet runs", which is what the row opens on.
  const [picked, setPicked] = useState<string | null>(null);

  const tabs: { value: EngineTab; label: string }[] = [
    { value: 'native', label: t('profiles.engine.native') },
    { value: 'xray', label: t('profiles.engine.xray') },
    { value: 'singbox', label: t('profiles.engine.singbox') },
    { value: 'telegram', label: t('profiles.engine.telegram') },
  ];
  // A picked preview holds the tab open on its own: the form's protocol is
  // still whatever was selected before, and reading the tab from it would
  // throw the operator back to another sheet mid-choice.
  const activeTab: EngineTab = preview ? 'telegram' : engineTabOf(protocol, engine);
  const kinds = PROFILE_KINDS.filter((k) => engineTabOf(k.protocol, k.engine) === activeTab);

  // Core version is a property of the node, not of the profile: one xray
  // process serves every xray-core profile on that box. Show what the fleet
  // actually runs, and name the nodes that lag behind.
  const versioned = (nodesQuery.data?.nodes ?? []).filter(
    (n): n is typeof n & { coreVersion: string } => !!n.coreVersion,
  );
  const coreVersions = versioned.map((n) => n.coreVersion);

  // Which nodes sit on each version. A plain `.sort()` used to pick the
  // newest, and that is string order: it puts 25.9.5 above 25.10.1 because
  // "9" > "1". isOlderThan compares the dotted numbers, the way the cascade
  // gate already does.
  const byVersion = new Map<string, string[]>();
  for (const n of versioned) {
    byVersion.set(n.coreVersion, [...(byVersion.get(n.coreVersion) ?? []), n.name]);
  }
  const versions = [...byVersion.keys()].sort((a, b) =>
    isOlderThan(a, b) ? 1 : isOlderThan(b, a) ? -1 : 0,
  );
  const newest = versions[0] ?? null;

  // Which version the operator is looking at. The list comes from live node
  // data, so a pick can vanish under us when the fleet is upgraded; falling
  // back to the newest beats rendering a version nobody runs.
  const selected = picked && byVersion.has(picked) ? picked : newest;
  const onSelected = selected ? (byVersion.get(selected) ?? []) : [];
  const behind = coreVersions.filter((v) => v !== newest);

  // A fleet of thirty nodes would otherwise print thirty names into a chip
  // that sits on one row of a form. Three and a tail says the same thing.
  const nameList = (names: string[]) =>
    names.length <= 3
      ? names.join(', ')
      : `${names.slice(0, 3).join(', ')}, ${t('profiles.engine.andMore', { count: names.length - 3 })}`;
  // The number belongs to whatever rides the xray binary, which on the
  // Telegram tab is SOCKS5 and HTTP. MTProto and WEB run their own daemons
  // and the panel is never told their versions, so they stay quiet.
  const ridesXray = activeTab === 'xray' || (preview !== null && PREVIEW_ON_XRAY.has(preview));

  const tiles: TileSpec[] = [
    ...kinds.map((k) => ({
      id: k.key,
      title: PROTOCOL_TILE_LABEL[k.key] ?? k.label,
      hint: PROTOCOL_TILE_HINT[k.key] ?? PROTOCOL_TILE_HINT[k.protocol] ?? '',
      note: PROTOCOL_TILE_NOTE[k.key] ?? '',
      accent: PROTOCOL_ACCENT[k.protocol] ?? '#7A8BA3',
      active: !preview && k.protocol === protocol && k.engine === engine,
      warnNote: false,
      onClick: () => onPick(k),
    })),
    ...(activeTab === 'telegram'
      ? PREVIEW_KINDS.map((p) => ({
          id: p.key,
          title: PROTOCOL_TILE_LABEL[p.key] ?? p.label,
          hint: PROTOCOL_TILE_HINT[p.key] ?? '',
          note: PROTOCOL_TILE_NOTE[p.key] ?? '',
          accent: PROTOCOL_ACCENT[p.key] ?? '#7A8BA3',
          active: preview === p.key,
          warnNote: PROTOCOL_TILE_NOTE_WARN.has(p.key),
          onClick: () => onPickPreview(p.key),
        }))
      : []),
  ];

  // Tiles come in fours on the artboard, and a short row is padded with dashed
  // placeholders rather than left ragged.
  const emptySlots = (4 - (tiles.length % 4)) % 4;

  return (
    <SectionCard title={t('profiles.form.protocol')} icon={<IconBolt size={15} color="#7DD3FC" />}>
      {/* A tab strip sitting on a hairline, not a row of buttons: the active
          tab masks the line under itself, which is what makes it read as the
          sheet you are currently looking at. */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          width: '100%',
          borderBottom: '1px solid #1C2A3D',
        }}
      >
        {tabs.map((e) => {
          const active = activeTab === e.value;
          const isTelegram = e.value === 'telegram';
          const count =
            PROFILE_KINDS.filter((k) => engineTabOf(k.protocol, k.engine) === e.value).length +
            (isTelegram ? PREVIEW_KINDS.length : 0);
          return (
            <UnstyledButton
              key={e.value}
              type="button"
              onClick={() => {
                const first = PROFILE_KINDS.find(
                  (k) => engineTabOf(k.protocol, k.engine) === e.value,
                );
                if (first) onPick(first);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 36,
                padding: '0 16px',
                backgroundColor: active ? '#0F1A28' : 'transparent',
                borderTop: `1px solid ${active ? '#1C2A3D' : 'transparent'}`,
                borderLeft: `1px solid ${active ? '#1C2A3D' : 'transparent'}`,
                borderRight: `1px solid ${active ? '#1C2A3D' : 'transparent'}`,
                borderBottom: `1px solid ${active ? '#0F1A28' : 'transparent'}`,
                borderTopLeftRadius: 8,
                borderTopRightRadius: 8,
                marginBottom: -1,
                // A fourth tab took the strip past the card's width and the
                // labels started breaking mid-word ("SING-" / "BOX"). Tabs
                // keep their size; the hint after them is what gives way.
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              {isTelegram && (
                <Box
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    backgroundColor: TELEGRAM,
                    flexShrink: 0,
                  }}
                />
              )}
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: active ? '#C8D4E3' : '#7A8BA3',
                }}
              >
                {e.label}
              </Text>
              <Box
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: 18,
                  minWidth: 18,
                  padding: '0 5px',
                  borderRadius: 999,
                  backgroundColor: isTelegram
                    ? active
                      ? `${TELEGRAM}24`
                      : `${TELEGRAM}1A`
                    : active
                      ? '#7DD3FC24'
                      : '#152233',
                }}
              >
                <Text
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    color: isTelegram
                      ? active
                        ? TELEGRAM
                        : '#5F8EA8'
                      : active
                        ? '#7DD3FC'
                        : '#7A8BA3',
                  }}
                >
                  {count}
                </Text>
              </Box>
            </UnstyledButton>
          );
        })}
        <Box style={{ flex: 1, minWidth: 0 }} />
        <Group
          gap={8}
          wrap="nowrap"
          style={{ height: 36, paddingLeft: 16, paddingRight: 4, minWidth: 0 }}
        >
          <IconInfoCircle size={13} color="#5A6B82" stroke={1.8} style={{ flexShrink: 0 }} />
          <Text
            style={{
              fontSize: 11,
              lineHeight: '14px',
              color: '#5A6B82',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {t(`profiles.engine.tabHint.${activeTab}`)}
          </Text>
        </Group>
      </Box>

      {/* The binary's version belongs to the fleet, not to this template. Say
          so, and name how many boxes still run something older. Only the xray
          core reports its version to the panel, so the other tabs stay quiet
          rather than showing a number that belongs to a different binary. */}
      {ridesXray && selected && (
        <Stack
          gap={8}
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            backgroundColor: '#0B1420',
            border: '1px solid #1C2A3D',
          }}
        >
          {/* Version on the left, fleet verdict on the right, explanation on
              its own line under both. It used to be one nowrap row, and the
              explanation was the only elastic part of it: on the profile page
              the recipe rail takes 380px from 1400px up, which leaves the row
              barely 560px and the sentence about a hundred. Wrapping is
              cheaper than a media query and holds at every width. */}
          <Group gap={10} align="center" justify="space-between">
            <Group gap={10} wrap="nowrap" style={{ flexShrink: 0 }}>
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#7A8BA3',
                }}
              >
                {t('profiles.engine.coreVersion')}
              </Text>
              {/* The artboard draws this as a select, and it is one: the list
                  is the versions the fleet actually reports. Picking one does
                  not install anything, the panel has no way to ask a node for
                  a different binary; it changes which version the row is
                  talking about, which is the question an operator opens this
                  row with when the numbers disagree. */}
              <Menu
                position="bottom-start"
                offset={6}
                withinPortal
                disabled={versions.length < 2}
              >
                <Menu.Target>
                  <UnstyledButton
                    type="button"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      height: 32,
                      padding: '0 12px',
                      borderRadius: 8,
                      backgroundColor: '#08101A',
                      border: '1px solid #1C2A3D',
                      cursor: versions.length < 2 ? 'default' : 'pointer',
                    }}
                  >
                    <Text style={{ fontFamily: MONO, fontSize: 12, color: '#C8D4E3' }}>
                      xray {selected}
                    </Text>
                    <VersionBadge latest={selected === newest} />
                    {/* Only a fleet running more than one version has anything
                        to choose between; a single-version fleet keeps the box
                        without pretending it opens. */}
                    {versions.length > 1 && (
                      <IconSelector size={14} color="#7A8BA3" stroke={2} />
                    )}
                  </UnstyledButton>
                </Menu.Target>
                <Menu.Dropdown
                  style={{ backgroundColor: '#0B1420', border: '1px solid #1C2A3D' }}
                >
                  <Menu.Label
                    style={{
                      fontFamily: MONO,
                      fontSize: 9,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: '#5A6B82',
                    }}
                  >
                    {t('profiles.engine.versionMenuTitle')}
                  </Menu.Label>
                  {versions.map((v) => {
                    const names = byVersion.get(v) ?? [];
                    return (
                      <Menu.Item
                        key={v}
                        onClick={() => setPicked(v)}
                        style={{ backgroundColor: v === selected ? '#7DD3FC0F' : 'transparent' }}
                      >
                        <Stack gap={3} style={{ minWidth: 0 }}>
                          <Group gap={8} wrap="nowrap">
                            <Text
                              style={{
                                fontFamily: MONO,
                                fontSize: 12,
                                color: v === selected ? '#7DD3FC' : '#C8D4E3',
                              }}
                            >
                              xray {v}
                            </Text>
                            <VersionBadge latest={v === newest} />
                          </Group>
                          <Text
                            style={{
                              fontSize: 11,
                              lineHeight: '14px',
                              color: '#5A6B82',
                              maxWidth: 280,
                            }}
                          >
                            {t('profiles.engine.nodesWith', { count: names.length })} ·{' '}
                            {nameList(names)}
                          </Text>
                        </Stack>
                      </Menu.Item>
                    );
                  })}
                </Menu.Dropdown>
              </Menu>
            </Group>
            {/* The chip answers "who is on this", so it follows the pick: on
                an older version it names those nodes, on the newest one it
                keeps the fleet verdict it always gave. */}
            {selected !== newest ? (
              <Group
                gap={8}
                wrap="nowrap"
                align="flex-start"
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  backgroundColor: '#F5B14C1A',
                  border: '1px solid #F5B14C40',
                  minWidth: 0,
                }}
              >
                <IconAlertTriangle size={13} color="#F5B14C" stroke={1.9} style={{ flexShrink: 0, marginTop: 1 }} />
                <Text style={{ fontSize: 11, lineHeight: '14px', color: '#F5B14C', minWidth: 0 }}>
                  {t('profiles.engine.runsOn', { names: nameList(onSelected) })}
                </Text>
              </Group>
            ) : behind.length > 0 ? (
              <Group
                gap={8}
                wrap="nowrap"
                align="flex-start"
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  backgroundColor: '#F5B14C1A',
                  border: '1px solid #F5B14C40',
                  // The sentence inside is a full clause and runs long in
                  // Russian. It wraps rather than being clipped, and the whole
                  // chip drops to its own line when even that does not fit.
                  minWidth: 0,
                }}
              >
                <IconAlertTriangle size={13} color="#F5B14C" stroke={1.9} style={{ flexShrink: 0, marginTop: 1 }} />
                <Text style={{ fontSize: 11, lineHeight: '14px', color: '#F5B14C', minWidth: 0 }}>
                  {t('profiles.engine.behind', {
                    count: behind.length,
                    total: coreVersions.length,
                    version: behind[0],
                  })}
                </Text>
              </Group>
            ) : (
              <Group
                gap={8}
                wrap="nowrap"
                align="flex-start"
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  backgroundColor: '#A7D8B91A',
                  border: '1px solid #A7D8B940',
                  minWidth: 0,
                }}
              >
                <IconCheck size={13} color="#A7D8B9" stroke={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
                <Text style={{ fontSize: 11, lineHeight: '14px', color: '#A7D8B9', minWidth: 0 }}>
                  {t('profiles.engine.allCurrent', {
                    count: coreVersions.length,
                    version: newest,
                  })}
                </Text>
              </Group>
            )}
          </Group>
          <Text style={{ fontSize: 11, lineHeight: '16px', color: '#7A8BA3' }}>
            {t('profiles.engine.coreVersionHint')}
          </Text>
        </Stack>
      )}

      {/* Tiles, not a list: each one says what the protocol actually speaks,
          which is the thing an operator is choosing between. Every protocol
          keeps its own accent so the fleet reads the same colour everywhere. */}
      <Box style={{ display: 'flex', flexWrap: 'wrap', gap: 10, width: '100%' }}>
        {tiles.map((tile) => (
          <UnstyledButton
            key={tile.id}
            type="button"
            onClick={tile.onClick}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              flexBasis: '21%',
              flexGrow: 1,
              minWidth: 0,
              padding: '13px 14px',
              borderRadius: 10,
              backgroundColor: tile.active ? `${tile.accent}14` : '#0B1420',
              border: `1px solid ${tile.active ? tile.accent : '#1C2A3D'}`,
            }}
          >
            <Box
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                <Box
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: tile.accent,
                    flexShrink: 0,
                  }}
                />
                <Text
                  style={{
                    fontFamily: DISPLAY,
                    fontSize: 13,
                    fontWeight: 600,
                    lineHeight: '16px',
                    color: '#C8D4E3',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tile.title}
                </Text>
              </Group>
              {tile.active && <IconCheck size={14} stroke={2.4} color={tile.accent} />}
            </Box>
            <Text
              style={{
                fontSize: 11,
                lineHeight: '14px',
                color: '#7A8BA3',
                textAlign: 'left',
              }}
            >
              {tile.hint}
            </Text>
            {/* The caveat line only earns its place where a protocol shows
                up under more than one binary: on the xray tab the tab name
                has already said everything it would say. */}
            {activeTab !== 'xray' && (
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  lineHeight: '12px',
                  color: tile.warnNote ? '#F5B14C' : tile.active ? tile.accent : '#5A6B82',
                  textAlign: 'left',
                }}
              >
                {tile.note}
              </Text>
            )}
          </UnstyledButton>
        ))}
        {Array.from({ length: emptySlots }, (_, i) => (
          <Box
            key={`slot-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexBasis: '21%',
              flexGrow: 1,
              minWidth: 0,
              padding: '13px 14px',
              borderRadius: 10,
              border: '1px dashed #1C2A3D',
            }}
          >
            <IconPlus size={14} stroke={2} color="#2C3A4E" />
          </Box>
        ))}
      </Box>
    </SectionCard>
  );
}

/**
 * Which binary serves a profile. Shadowsocks 2022 rides the xray process, so
 * it belongs on the xray tab even though its engine field says "native": the
 * tab answers "what runs on the node", not "what does the column say".
 */

/** Green for the newest version the fleet reports, amber for anything behind
 *  it. Both are facts about the fleet, not about upstream: the panel has no
 *  idea what XTLS released last week. */
function VersionBadge({ latest }: { latest: boolean }) {
  const { t } = useTranslation();
  const tone = latest ? '#A7D8B9' : '#F5B14C';
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 18,
        padding: '0 7px',
        borderRadius: 6,
        backgroundColor: `${tone}1F`,
        flexShrink: 0,
      }}
    >
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 9,
          letterSpacing: '0.08em',
          color: tone,
        }}
      >
        {latest ? t('profiles.engine.latest') : t('profiles.engine.older')}
      </Text>
    </Box>
  );
}
