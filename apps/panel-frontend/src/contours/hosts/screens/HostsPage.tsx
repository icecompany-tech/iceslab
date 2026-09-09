import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Box, Menu, Select, SimpleGrid, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import {
  IconAlertTriangle,
  IconDotsVertical,
  IconEdit,
  IconLink,
  IconList,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUser,
  IconWorld,
  IconWorldOff,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import {
  deleteHost,
  listBindings,
  listHosts,
  listNodes,
  listProfiles,
} from '@/lib/net/api';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import { COUNTRIES } from '@/lib/domain/countries';

/**
 * Hosts, first-class. A host is the one line a user reads in their client, so
 * the card leads with that line: flag, name, port. Everything under it answers
 * "and what is that, really" - which profile it speaks, which nodes serve it,
 * how many people it reaches.
 *
 * A host with no nodes serves nobody, which is the one broken state here, so it
 * gets the amber edge and says so instead of showing an empty row.
 */

const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const WELL = '#0B1420';
const BORDER_INPUT = '#2C3A4E';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const FAINT = '#5A6B82';
const DIM = '#3A4A60';
const CYAN = '#7DD3FC';
const CYAN_HI = '#67E8F9';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const VIOLET = '#A78BFA';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

export function HostsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState<string | null>(null);

  const hostsQuery = useQuery({ queryKey: ['hosts'], queryFn: () => listHosts() });
  const bindingsQuery = useQuery({ queryKey: ['bindings'], queryFn: () => listBindings() });
  const nodesQuery = useQuery({ queryKey: ['nodes'], queryFn: () => listNodes() });
  const profilesQuery = useQuery({ queryKey: ['profiles'], queryFn: () => listProfiles() });

  const rows = useMemo(() => {
    const bindingById = new Map((bindingsQuery.data?.bindings ?? []).map((b) => [b.id, b]));
    const nodeById = new Map((nodesQuery.data?.nodes ?? []).map((n) => [n.id, n]));
    const profileById = new Map((profilesQuery.data?.profiles ?? []).map((p) => [p.id, p]));

    return (hostsQuery.data?.hosts ?? [])
      .map((h) => {
        const binding = bindingById.get(h.bindingId);
        const node = binding ? nodeById.get(binding.nodeId) : undefined;
        const profile = binding ? profileById.get(binding.profileId) : undefined;
        return {
          host: h,
          profile,
          nodes: node ? [node] : [],
          // Deleting the last host of a binding takes the binding with it, which
          // restarts xray on that node. The confirmation has to say so, and it
          // only applies in this one case.
          lastOfBinding:
            (hostsQuery.data?.hosts ?? []).filter((x) => x.bindingId === h.bindingId).length === 1,
          nodeName: node?.name ?? null,
          port: h.portOverride ?? binding?.publicPort ?? binding?.port ?? null,
          address: h.addressOverride ?? binding?.publicHost ?? null,
          countryCode: node?.countryCode ? node.countryCode.toUpperCase() : null,
          // Reach comes from the API. It used to be worked out here by adding up
          // each squad's member count, which counted one person in two squads
          // twice, and cannot be fixed here: the squad list carries totals, not
          // user ids, so there is nothing to deduplicate against.
          squadCount: h.reach?.squads ?? 0,
          userCount: h.reach?.users ?? 0,
        };
      })
      .filter((r) => {
        if (country && r.countryCode !== country) return false;
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return `${r.host.remark} ${r.port ?? ''} ${r.profile?.name ?? ''} ${r.address ?? ''}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => a.host.priority - b.host.priority);
  }, [
    hostsQuery.data,
    bindingsQuery.data,
    nodesQuery.data,
    profilesQuery.data,
    search,
    country,
  ]);

  /**
   * Deleting a host is the one destructive action on this page, so it confirms
   * first and names the consequence rather than asking "are you sure".
   *
   * The last host of a binding is the case worth spelling out, and the reason is
   * not the host: the binding goes with it, so the inbound comes off the node
   * and xray restarts there. That restart drops live sessions on every OTHER
   * inbound of the same machine, which is a blast radius the operator cannot
   * guess from "remove one line from a client".
   */
  function confirmDelete(row: Row) {
    modals.openConfirmModal({
      title: t('hostsPage.deleteTitle', { name: row.host.remark }),
      children: (
        <Stack gap={8}>
          <Text size="sm">{t('hostsPage.deleteBody')}</Text>
          {row.lastOfBinding && row.nodeName && (
            <Text size="sm" style={{ color: AMBER }}>
              {t('hostsPage.deleteLast', { node: row.nodeName })}
            </Text>
          )}
        </Stack>
      ),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await deleteHost(row.host.id);
          qc.invalidateQueries({ queryKey: ['hosts'] });
          notifications.show({ color: 'green', message: t('hostsPage.deleted') });
        } catch (err) {
          notifications.show({
            color: 'red',
            title: t('common.saveError'),
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
    });
  }

  const total = hostsQuery.data?.hosts.length ?? 0;
  // The bar counts the same three states the cards show, so a degraded host is
  // not filed under LIVE where it would go unnoticed.
  const isDegraded = (r: Row) =>
    r.host.enabled && r.nodes.length > 0 && r.nodes.some((n) => n.status !== 'online');
  const live = rows.filter((r) => r.host.enabled && r.nodes.length > 0 && !isDegraded(r)).length;
  const degraded = rows.filter(isDegraded).length;
  const orphaned = rows.filter((r) => r.nodes.length === 0).length;
  const countries = [...new Set(rows.map((r) => r.countryCode).filter(Boolean))] as string[];

  usePageMeta([
    t('pageMeta.hosts', { count: total }),
    t('pageMeta.hostCountries', { count: countries.length }),
  ]);

  return (
    <Stack gap="lg">
      {/* Page bar */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 56,
          padding: '8px 8px 8px 14px',
          borderRadius: 10,
          backgroundColor: CARD,
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, paddingRight: 16 }}>
          <Box
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              backgroundColor: `${CYAN}1A`,
              border: `1px solid ${CYAN}33`,
              color: CYAN,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconWorld size={16} stroke={1.8} />
          </Box>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Fact value={total} label={t('hostsPage.bar.hosts')} />
            <Dot />
            <Fact value={live} label={t('hostsPage.bar.live')} accent={MOSS} />
            {degraded > 0 && (
              <>
                <Dot />
                <Fact value={degraded} label={t('hostsPage.bar.degraded')} accent={AMBER} />
              </>
            )}
            {orphaned > 0 && (
              <>
                <Dot />
                <Fact value={orphaned} label={t('hostsPage.bar.noNodes')} accent={AMBER} />
              </>
            )}
          </Box>
        </Box>

        <Box style={{ width: 1, height: 24, backgroundColor: HAIRLINE, flexShrink: 0 }} />

        <Box style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px' }}>
          <IconSearch size={15} stroke={1.8} color={MIST} />
          <input
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder={t('hostsPage.searchPlaceholder')}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: SNOW,
              fontFamily: DISPLAY,
              fontSize: 13,
            }}
          />
        </Box>

        <Box style={{ width: 1, height: 24, backgroundColor: HAIRLINE, flexShrink: 0 }} />

        <Box style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 8, flexShrink: 0 }}>
          <Select
            value={country}
            onChange={setCountry}
            placeholder={t('hostsPage.allCountries')}
            clearable
            w={180}
            data={countries.map((c) => ({
              value: c,
              label: COUNTRIES.find((x) => x.code === c)?.name ?? c,
            }))}
            styles={{
              input: {
                height: 38,
                minHeight: 38,
                backgroundColor: WELL,
                borderColor: HAIRLINE,
                color: SNOW,
                fontFamily: DISPLAY,
                fontSize: 13,
              },
            }}
          />
          <BarButton
            title={t('common.refresh')}
            onClick={() => qc.invalidateQueries({ queryKey: ['hosts'] })}
          >
            <IconRefresh size={16} stroke={1.8} color={MIST} />
          </BarButton>
          <BarButton onClick={() => navigate('/hosts/new')} label={t('hostsPage.create')}>
            <IconPlus size={14} stroke={2.4} color={CYAN} />
          </BarButton>
        </Box>
      </Box>

      {rows.length === 0 ? (
        <Box
          style={{
            padding: 40,
            borderRadius: 10,
            backgroundColor: CARD,
            border: `1px solid ${HAIRLINE}`,
          }}
        >
          <Stack align="center" gap="sm">
            <ThemeIcon size={48} radius="md" variant="light" color="gray">
              <IconWorldOff size={24} />
            </ThemeIcon>
            <Text c="dimmed" size="sm">
              {total === 0 ? t('hostsPage.empty') : t('common.nothingFound')}
            </Text>
          </Stack>
        </Box>
      ) : (
        <SimpleGrid cols={{ base: 1, lg: 2, xl: 3 }} spacing={16}>
          {rows.map((r) => (
            <HostCard
              key={r.host.id}
              row={r}
              onEdit={() => navigate(`/hosts/${r.host.id}`)}
              onDelete={() => confirmDelete(r)}
            />
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}

type Row = {
  host: { id: string; remark: string; enabled: boolean; priority: number };
  profile?: { name: string; protocol: string };
  nodes: { id: string; name: string; status: string }[];
  lastOfBinding: boolean;
  nodeName: string | null;
  port: number | null;
  address: string | null;
  countryCode: string | null;
  squadCount: number;
  userCount: number;
};

function HostCard({
  row,
  onEdit,
  onDelete,
}: {
  row: Row;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const orphaned = row.nodes.length === 0;
  // A host with nodes is not automatically serving: the state used to read
  // "a node exists" and never looked at whether the node answers. Between LIVE
  // and NO NODES there is a third state, still handing out URLs but through a
  // node that is not online, and it is the one worth catching early.
  const down = row.nodes.filter((n) => n.status !== 'online');
  const degraded = row.host.enabled && !orphaned && down.length > 0;
  const live = row.host.enabled && !orphaned && !degraded;
  const accent = orphaned ? AMBER : degraded ? AMBER : row.host.enabled ? VIOLET : DIM;

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 16,
        borderRadius: 10,
        backgroundColor: CARD,
        border: `1px solid ${HAIRLINE}`,
        borderTop: `3px solid ${accent}`,
      }}
    >
      {/* The line the user reads, in the order they read it. */}
      <Box style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
        <Text style={{ fontSize: 18, flexShrink: 0 }}>{flagEmoji(row.countryCode)}</Text>
        <Text
          style={{
            fontFamily: DISPLAY,
            fontSize: 19,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            lineHeight: '24px',
            color: SNOW,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {row.host.remark}
        </Text>
        {row.port !== null && (
          <Text style={{ fontFamily: MONO, fontSize: 14, fontWeight: 500, color: CYAN_HI }}>
            {row.port}
          </Text>
        )}
        {row.address && (
          <Box style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <IconLink size={12} stroke={1.8} color={FAINT} />
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: MIST,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {row.address}
            </Text>
          </Box>
        )}
        <Box style={{ flex: 1 }} />
        <Menu shadow="md" position="bottom-end" withinPortal>
          <Menu.Target>
            <UnstyledButton style={{ display: 'flex', color: DIM, flexShrink: 0 }}>
              <IconDotsVertical size={16} />
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown style={{ backgroundColor: CARD, borderColor: HAIRLINE }}>
            <Menu.Item leftSection={<IconEdit size={14} />} onClick={onEdit}>
              {t('common.edit')}
            </Menu.Item>
            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={onDelete}>
              {t('common.delete')}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Box>

      <FieldRow label={t('hostsPage.card.profile')}>
        {row.profile ? (
          <Box
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 10px',
              borderRadius: 6,
              backgroundColor: WELL,
              border: `1px solid ${BORDER_INPUT}`,
            }}
          >
            <Box style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: VIOLET }} />
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, fontWeight: 500, color: SNOW }}>
              {row.profile.name}
            </Text>
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: MIST,
              }}
            >
              {row.profile.protocol}
            </Text>
          </Box>
        ) : (
          <Text style={{ fontFamily: MONO, fontSize: 11, color: MIST }}>
            {t('hostsPage.unbound')}
          </Text>
        )}
      </FieldRow>

      <FieldRow label={t('hostsPage.card.nodes')}>
        {orphaned ? (
          <Box
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '5px 10px',
              borderRadius: 6,
              backgroundColor: `${AMBER}14`,
              border: `1px solid ${AMBER}3D`,
            }}
          >
            <IconAlertTriangle size={12} stroke={2} color={AMBER} />
            <Text style={{ fontFamily: MONO, fontSize: 11, color: AMBER }}>
              {t('hostsPage.card.noNodesAttached')}
            </Text>
          </Box>
        ) : (
          <Box style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            {row.nodes.map((n) => (
              <Box
                key={n.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 9px',
                  borderRadius: 6,
                  backgroundColor: WELL,
                }}
              >
                <Box
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    backgroundColor: n.status === 'online' ? MOSS : AMBER,
                  }}
                />
                <Text style={{ fontFamily: MONO, fontSize: 11, color: SNOW }}>{n.name}</Text>
              </Box>
            ))}
          </Box>
        )}
      </FieldRow>

      {/* Reach, then state: who gets this line and whether it is actually live. */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          paddingTop: 12,
          borderTop: `1px solid ${HAIRLINE}`,
        }}
      >
        <Box style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <IconUser size={13} stroke={1.8} color={FAINT} />
          <Text style={{ fontFamily: MONO, fontSize: 11, color: MIST }}>
            {t('hostsPage.card.squads', { count: row.squadCount })}
          </Text>
        </Box>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <IconList size={13} stroke={1.8} color={FAINT} />
          <Text style={{ fontFamily: MONO, fontSize: 11, color: MIST }}>
            {t('hostsPage.card.reach', { count: row.userCount })}
          </Text>
        </Box>
        <Box style={{ flex: 1 }} />
        <Box style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Box
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              backgroundColor: live ? MOSS : orphaned || degraded ? AMBER : DIM,
            }}
          />
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: '0.08em',
              color: live ? MOSS : orphaned || degraded ? AMBER : MIST,
            }}
            // Which node is down, since the card lists several by name.
            title={degraded ? down.map((n) => n.name).join(', ') : undefined}
          >
            {live
              ? t('hostsPage.card.live')
              : orphaned
                ? t('hostsPage.card.noNodes')
                : degraded
                  ? t('hostsPage.card.degraded', { count: down.length })
                  : t('hostsPage.card.off')}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
      <Text
        style={{
          width: 96,
          flexShrink: 0,
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: FAINT,
        }}
      >
        {label}
      </Text>
      <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

function Fact({ value, label, accent }: { value: number; label: string; accent?: string }) {
  return (
    <>
      <Text style={{ fontFamily: MONO, fontSize: 13, fontWeight: 500, color: accent ?? SNOW }}>
        {value}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', color: MIST }}>
        {label}
      </Text>
    </>
  );
}

function Dot() {
  return <Text style={{ fontFamily: MONO, fontSize: 10, color: DIM }}>·</Text>;
}

function BarButton({
  children,
  label,
  onClick,
  title,
}: {
  children: ReactNode;
  label?: string;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      title={title}
      aria-label={title ?? label}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 38,
        width: label ? undefined : 38,
        padding: label ? '0 16px' : 0,
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
      }}
    >
      {children}
      {label && (
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, color: SNOW }}>
          {label}
        </Text>
      )}
    </UnstyledButton>
  );
}

function flagEmoji(cc: string | null): string {
  if (!cc || cc.length !== 2) return '🏳';
  const up = cc.toUpperCase();
  const c0 = up.charCodeAt(0);
  const c1 = up.charCodeAt(1);
  if (c0 < 65 || c0 > 90 || c1 < 65 || c1 > 90) return '🏳';
  const A = 0x1f1e6;
  const a = 'A'.charCodeAt(0);
  return String.fromCodePoint(A + (c0 - a)) + String.fromCodePoint(A + (c1 - a));
}
