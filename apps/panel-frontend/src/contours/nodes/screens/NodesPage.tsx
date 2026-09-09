import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Code,
  CopyButton,
  Group,
  Menu,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconEdit,
  IconKey,
  IconPlus,
  IconRefresh,
  IconRoute,
  IconSearch,
  IconServer2,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { createBinding } from '@/lib/domain/profiles';
import {
  createNode,
  deleteNode,
  listNodes,
  listRegions,
  refreshNodeBootstrap,
  updateNode,
  type CreateNodeInput,
  type Node,
  type UpdateNodeInput,
} from '@/lib/domain/nodes';
import { listCascades } from '@/lib/domain/cascades';
import { useOverview } from '@/lib/domain/dashboard';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import { NodeFormModal } from '@/contours/nodes/components/NodeFormModal';
import { NodeEditModal } from '@/contours/nodes/components/NodeEditModal';
import { NodePayloadModal } from '@/contours/nodes/components/NodePayloadModal';
import { NodeCard } from '@/contours/nodes/components/NodeCard';
import { CascadesPanel } from '@/contours/nodes/components/CascadesPanel';
import type { CascadeLayout } from '@/contours/nodes/components/CascadesView';
import { countryFlag } from '@/lib/domain/countries';
import { parseNodeAgentPort, pickFreeQuickDeployPort } from '@/lib/domain/ports';

const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const CYAN = '#7DD3FC';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const RED = '#E07A5F';

const GROUND = '#08101A';
const WELL = '#0B1420';
const EDGE = '#2C3A4E';
const FAINT = '#5A6B82';
const DIM = '#3A4A60';

const MONO_FAMILY = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";
const MONO = { fontFamily: MONO_FAMILY };
const DISPLAY_FAMILY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/**
 * One "12 VPS" pair in the page bar: number in snow, unit in mist. `soft` marks
 * how early it gives up its width when the bar runs out (see .page-bar in
 * index.css): "soft" goes first, "mid" second, unmarked facts always stay.
 */
function BarFact({
  value,
  label,
  accent,
  soft,
}: {
  value: number | string;
  label: string;
  accent?: string;
  soft?: 'soft' | 'mid';
}) {
  return (
    <Box
      className={soft ? `page-bar-fact-${soft}` : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
    >
      {accent && (
        <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent, flexShrink: 0 }} />
      )}
      <Text style={{ ...MONO, fontSize: 13, fontWeight: 500, lineHeight: '16px', color: accent ?? SNOW }}>
        {value}
      </Text>
      <Text
        style={{
          ...MONO,
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

function BarDot({ soft }: { soft?: 'soft' | 'mid' }) {
  return (
    <Text
      className={soft ? `page-bar-fact-${soft}` : undefined}
      style={{ ...MONO, fontSize: 10, lineHeight: '12px', color: DIM }}
    >
      {'·'}
    </Text>
  );
}

/**
 * A two-way switch that carries a word: which inventory the page is showing.
 * Built by hand rather than with a Mantine control so the active pill matches
 * every other raised surface in the bar.
 */
function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon: 'server' | 'chain' }[];
}) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        height: 38,
        padding: 3,
        borderRadius: 9,
        backgroundColor: GROUND,
        border: `1px solid ${HAIRLINE}`,
        flexShrink: 0,
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        const stroke = on ? CYAN : MIST;
        return (
          <UnstyledButton
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              height: 30,
              paddingInline: 12,
              borderRadius: 7,
              backgroundColor: on ? CARD : 'transparent',
              border: `1px solid ${on ? HAIRLINE : 'transparent'}`,
            }}
          >
            {o.icon === 'server' ? (
              <svg width="13" height="13" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <rect x="3" y="4" width="18" height="7" rx="2" fill="none" stroke={stroke} strokeWidth="1.8" />
                <rect x="3" y="13" width="18" height="7" rx="2" fill="none" stroke={stroke} strokeWidth="1.8" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <circle cx="5.5" cy="18.5" r="2.5" fill="none" stroke={stroke} strokeWidth="2" />
                <circle cx="18.5" cy="5.5" r="2.5" fill="none" stroke={stroke} strokeWidth="2" />
                <path
                  d="M5.5 16v-0.5a3.5 3.5 0 0 1 3.5 -3.5h6a3.5 3.5 0 0 0 3.5 -3.5v-0.5"
                  fill="none"
                  stroke={stroke}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            <Text
              className="page-bar-switch-label"
              style={{
                fontFamily: DISPLAY_FAMILY,
                fontSize: 12,
                fontWeight: 500,
                lineHeight: '16px',
                color: on ? SNOW : MIST,
              }}
            >
              {o.label}
            </Text>
          </UnstyledButton>
        );
      })}
    </Box>
  );
}

/** The same switch reduced to glyphs, for a choice about shape rather than content. */
function IconSegmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; icon: 'grid' | 'list'; title: string }[];
}) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        height: 38,
        padding: 3,
        borderRadius: 9,
        backgroundColor: GROUND,
        border: `1px solid ${HAIRLINE}`,
        flexShrink: 0,
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        const stroke = on ? CYAN : MIST;
        return (
          <UnstyledButton
            key={o.value}
            type="button"
            title={o.title}
            onClick={() => onChange(o.value)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 30,
              borderRadius: 7,
              flexShrink: 0,
              backgroundColor: on ? CARD : 'transparent',
              border: `1px solid ${on ? HAIRLINE : 'transparent'}`,
            }}
          >
            {o.icon === 'grid' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <rect x="4" y="4" width="6" height="6" rx="1" fill="none" stroke={stroke} strokeWidth="1.9" />
                <rect x="14" y="4" width="6" height="6" rx="1" fill="none" stroke={stroke} strokeWidth="1.9" />
                <rect x="4" y="14" width="6" height="6" rx="1" fill="none" stroke={stroke} strokeWidth="1.9" />
                <rect x="14" y="14" width="6" height="6" rx="1" fill="none" stroke={stroke} strokeWidth="1.9" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" />
              </svg>
            )}
          </UnstyledButton>
        );
      })}
    </Box>
  );
}

/**
 * A filter that reads as a button, with the count it currently yields. The menu
 * is drawn rather than delegated to the browser: a native select opens the
 * operating system's own list, which lands white and square in the middle of a
 * dark panel.
 */
function BarSelect({
  value,
  onChange,
  data,
  count,
}: {
  value: string;
  onChange: (v: string) => void;
  data: { value: string; label: string }[];
  count?: number;
}) {
  const current = data.find((d) => d.value === value) ?? data[0];
  return (
    <Menu position="bottom-end" withinPortal shadow="md" offset={6}>
      <Menu.Target>
        <UnstyledButton
          type="button"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 38,
            paddingInline: 12,
            borderRadius: 8,
            backgroundColor: WELL,
            border: `1px solid ${HAIRLINE}`,
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path
              d="M4 4h16l-6 8v6l-4 2v-8z"
              fill="none"
              stroke={CYAN}
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <Text
            className="page-bar-filter-label"
            style={{
              fontFamily: DISPLAY_FAMILY,
              fontSize: 13,
              fontWeight: 500,
              lineHeight: '16px',
              color: SNOW,
              whiteSpace: 'nowrap',
            }}
          >
            {current?.label}
          </Text>
          {count !== undefined && (
            <Text style={{ ...MONO, fontSize: 10, lineHeight: '12px', color: FAINT }}>{count}</Text>
          )}
          <svg width="12" height="12" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path
              d="M6 9l6 6l6 -6"
              fill="none"
              stroke={MIST}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown
        style={{ backgroundColor: CARD, border: `1px solid ${HAIRLINE}`, borderRadius: 8, padding: 4 }}
      >
        {data.map((d) => {
          const on = d.value === value;
          return (
            <Menu.Item
              key={d.value}
              onClick={() => onChange(d.value)}
              style={{
                borderRadius: 6,
                backgroundColor: on ? WELL : 'transparent',
                fontFamily: DISPLAY_FAMILY,
                fontSize: 13,
                color: on ? SNOW : MIST,
              }}
              rightSection={
                on ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                    <path
                      d="M5 12l5 5L20 7"
                      fill="none"
                      stroke={CYAN}
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null
              }
            >
              {d.label}
            </Menu.Item>
          );
        })}
      </Menu.Dropdown>
    </Menu>
  );
}

const STATUS_ACCENT: Record<string, string> = {
  online: MOSS,
  unknown: MIST,
  offline: RED,
  unreachable: RED,
  disabled: MIST,
  degraded: AMBER,
};

function formatBytes(n: number): string {
  if (!n || n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

type LayoutMode = 'cards' | 'compact';
const LAYOUT_KEY = 'iceslab:nodes-layout';
const CASCADE_LAYOUT_KEY = 'iceslab:cascades-layout';

// Nodes page top-level view: the flat node inventory, or the cascades (chains of
// those same nodes). A node can be standalone AND a cascade hop, so cascades are
// a SECOND view of one inventory, not a second list.
type NodesView = 'nodes' | 'cascades';
const VIEW_KEY = 'iceslab:nodes-view';
// In the "nodes" view, slice the inventory by cascade membership.
type MembershipFilter = 'all' | 'standalone' | 'cascade';

export function NodesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, { close: closeCreate }] = useDisclosure(false);
  const [editing, setEditing] = useState<Node | null>(null);
  const [payload, setPayload] = useState<{
    name: string;
    payload: string;
    bootstrap?: { token: string; expiresAt: string; command: string };
  } | null>(null);
  const [layout, setLayout] = useState<LayoutMode>(
    (typeof window !== 'undefined' &&
      (window.localStorage.getItem(LAYOUT_KEY) as LayoutMode | null)) ||
      'cards',
  );
  function setLayoutPersist(m: LayoutMode) {
    setLayout(m);
    if (typeof window !== 'undefined') window.localStorage.setItem(LAYOUT_KEY, m);
  }

  // The cascade list has its own density, remembered separately: the two views
  // are looked at for different reasons and rarely want the same shape.
  const [cascadeLayout, setCascadeLayout] = useState<CascadeLayout>(
    (typeof window !== 'undefined' &&
      (window.localStorage.getItem(CASCADE_LAYOUT_KEY) as CascadeLayout | null)) ||
      'cards',
  );
  function setCascadeLayoutPersist(m: CascadeLayout) {
    setCascadeLayout(m);
    if (typeof window !== 'undefined') window.localStorage.setItem(CASCADE_LAYOUT_KEY, m);
  }

  const [view, setView] = useState<NodesView>(
    (typeof window !== 'undefined' &&
      (window.localStorage.getItem(VIEW_KEY) as NodesView | null)) ||
      'nodes',
  );
  function setViewPersist(v: NodesView) {
    setView(v);
    if (typeof window !== 'undefined') window.localStorage.setItem(VIEW_KEY, v);
  }
  const [membership, setMembership] = useState<MembershipFilter>('all');
  const [search, setSearch] = useState('');

  // Slice 27.5 - region filter (URL chip below header). 'all' = no filter.
  const [regionFilter, setRegionFilter] = useState<string>('all');

  const nodesQuery = useQuery({
    queryKey: ['nodes', regionFilter],
    queryFn: () =>
      listNodes({
        page: 1,
        limit: 100,
        regionId: regionFilter === 'all' ? undefined : regionFilter,
      }),
    // Core version and the restart tally ride on this response, not on the
    // overview blob, and until 2026-08-04 nothing refetched it: a core could
    // bounce with the page open and the card would keep the numbers it was
    // mounted with. 30s matches the backend status cron that produces them, so
    // a faster tick would only re-read the same row.
    refetchInterval: 30_000,
  });
  const regionsQuery = useQuery({ queryKey: ['regions'], queryFn: listRegions });
  const regionsById = useMemo(() => {
    const m = new Map<string, { code: string; name: string }>();
    for (const r of regionsQuery.data?.regions ?? []) m.set(r.id, r);
    return m;
  }, [regionsQuery.data]);

  // Pull live metrics from dashboard endpoint - already provides cpu/ram/disk
  // per node + today's traffic + inboundCount. Refetch every 15s to keep
  // cards in sync with the agent metrics-poll cron.
  const overviewQuery = useOverview();
  // Cascade membership drives the ⛓ badge + the standalone/in-cascade filter.
  const cascadesQuery = useQuery({ queryKey: ['cascades'], queryFn: listCascades });
  const allCascades = cascadesQuery.data?.cascades ?? [];

  // nodeId -> the cascade it belongs to + its role (entry/transit/exit). A node
  // can be in at most one cascade (v1 model).
  const nodeCascadeMap = useMemo(() => {
    const m = new Map<string, { name: string; role: string }>();
    for (const c of cascadesQuery.data?.cascades ?? []) {
      const last = c.hops.length - 1;
      c.hops.forEach((h, i) => {
        const role =
          i === 0
            ? t('cascades.entry')
            : i === last
              ? t('cascades.exit')
              : t('cascades.transit');
        m.set(h.nodeId, { name: c.name, role });
      });
    }
    return m;
  }, [cascadesQuery.data, t]);

  // What the cascades carried today: the entry node's traffic, because that is
  // where a client's bytes enter and everything downstream is the same bytes
  // counted again.
  const cascadeToday = useMemo(() => {
    const byId = new Map((overviewQuery.data?.nodes ?? []).map((n) => [n.id, n.todayBytes] as const));
    return allCascades.reduce((sum, c) => {
      const first = [...c.hops].sort((a, b) => a.position - b.position)[0];
      return sum + (first ? byId.get(first.nodeId) ?? 0 : 0);
    }, 0);
  }, [allCascades, overviewQuery.data]);

  // Merge raw nodes (canonical source for actions / address) with dashboard
  // metrics (CPU/RAM/disk/today). Indexed by id for O(1) join.
  const enrichedNodes = useMemo(() => {
    const overviewById = new Map(
      (overviewQuery.data?.nodes ?? []).map((n) => [n.id, n]),
    );
    return (nodesQuery.data?.nodes ?? []).map((n) => ({
      ...n,
      overview: overviewById.get(n.id) ?? null,
    }));
  }, [nodesQuery.data, overviewQuery.data]);

  // In the "nodes" view, slice the inventory by cascade membership, then by
  // whatever was typed in the bar. Name and address both match, because an
  // operator looking for a box knows one or the other.
  const visibleNodes = useMemo(() => {
    const byMembership =
      membership === 'all'
        ? enrichedNodes
        : enrichedNodes.filter((n) =>
            membership === 'cascade' ? nodeCascadeMap.has(n.id) : !nodeCascadeMap.has(n.id),
          );
    const q = search.trim().toLowerCase();
    if (!q) return byMembership;
    return byMembership.filter(
      (n) => n.name.toLowerCase().includes(q) || n.address.toLowerCase().includes(q),
    );
  }, [enrichedNodes, membership, nodeCascadeMap, search]);

  // Bar facts come off the whole fleet, not the filtered slice: they say what
  // the operator owns, and a search should not make nodes appear to vanish.
  const fleetFacts = useMemo(() => {
    const hosts = enrichedNodes.reduce((sum, n) => sum + (n.overview?.inboundCount ?? 0), 0);
    const today = enrichedNodes.reduce((sum, n) => sum + (n.overview?.todayBytes ?? 0), 0);
    return {
      vps: enrichedNodes.length,
      online: enrichedNodes.filter((n) => n.status === 'online').length,
      countries: new Set(enrichedNodes.map((n) => n.countryCode).filter(Boolean)).size,
      hosts,
      today,
    };
  }, [enrichedNodes]);

  // The crumb carries the fleet in two numbers. It follows the sub-view: the
  // cascades side counts cascades, not boxes.
  usePageMeta(
    view === 'cascades'
      ? [
          t('pageMeta.cascades', { count: allCascades.length }),
          t('pageMeta.cascadesEnabled', { count: allCascades.filter((c) => c.enabled).length }),
        ]
      : [
          t('pageMeta.vps', { count: fleetFacts.vps }),
          t('pageMeta.nodeCountries', { count: fleetFacts.countries }),
        ],
  );

  const createMutation = useMutation({
    mutationFn: createNode,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['nodes'] });
      notifications.show({ color: 'green', message: 'Node created' });
      // Surface the one-time payload + bootstrap token - neither is shown
      // by the panel on subsequent reads.
      setPayload({
        name: data.name,
        payload: data.payload,
        bootstrap: data.bootstrap,
      });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Create failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateNodeInput }) => updateNode(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] });
      notifications.show({ color: 'green', message: 'Node updated' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Update failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteNode,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] });
      notifications.show({ color: 'green', message: 'Node deleted' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  // Re-issue a bootstrap token for an existing node - used when the original
  // expired / was lost, or when admin changed `node.address` and needs a new
  // cert with the matching SAN. Reuses the same NodePayloadModal as the create
  // flow, but `payload` stays empty (panel never re-emits the cert payload -
  // only the install command + token).
  const refreshBootstrapMutation = useMutation({
    mutationFn: (node: Node) =>
      refreshNodeBootstrap(node.id).then((info) => ({ node, info })),
    onSuccess: ({ node, info }) => {
      notifications.show({ color: 'green', message: 'New bootstrap token issued' });
      setPayload({
        name: node.name,
        payload: '',
        bootstrap: info,
      });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Refresh bootstrap failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function handleRefreshBootstrap(node: Node) {
    modals.openConfirmModal({
      title: t('nodeConfirm.reBootstrapTitle', { name: node.name }),
      children: (
        <Text size="sm">{t('nodeConfirm.reBootstrapBody')}</Text>
      ),
      labels: { confirm: t('nodeConfirm.reBootstrapConfirm'), cancel: t('common.cancel') },
      confirmProps: { color: 'blue' },
      onConfirm: () => refreshBootstrapMutation.mutate(node),
    });
  }

  function handleDelete(node: Node) {
    // Cleanup command shown post-delete so admins remember to wipe the
    // VPS - otherwise the orphaned agent keeps occupying the mTLS port
    // and an old server cert + CA pair sits around as future drift bait.
    const uninstallCmd =
      'bash <(curl -fsSL https://raw.githubusercontent.com/icecompany-tech/iceslab/main/scripts/install-iceslab-node.sh) --uninstall';
    modals.openConfirmModal({
      title: t('nodeConfirm.deleteTitle', { name: node.name }),
      children: (
        <Stack gap="sm">
          <Text size="sm">{t('nodeConfirm.deleteBody')}</Text>
          <Text size="sm" fw={600}>
            {t('nodeConfirm.deleteCleanupHint')}
          </Text>
          <Group gap="xs" align="flex-start" wrap="nowrap">
            <Code block style={{ flex: 1, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {uninstallCmd}
            </Code>
            <CopyButton value={uninstallCmd}>
              {({ copied, copy }) => (
                <Button size="xs" variant="light" color={copied ? 'teal' : 'blue'} onClick={copy}>
                  {copied ? t('common.copied') : t('common.copy')}
                </Button>
              )}
            </CopyButton>
          </Group>
        </Stack>
      ),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(node.id),
    });
  }

  return (
    <Stack>
      {/* One strip: what the fleet is, then how to slice it, then the single
          action. Facts count the whole fleet, the controls narrow the list. */}
      <Box className="page-bar">
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, paddingRight: 16 }}>
          <Box
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: `${MOSS}1A`,
              border: `1px solid ${MOSS}33`,
              color: MOSS,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <IconServer2 size={18} stroke={1.7} />
          </Box>
          <Text
            style={{
              fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              fontSize: 17,
              fontWeight: 600,
              lineHeight: '22px',
              color: SNOW,
            }}
          >
            {view === 'cascades' ? t('cascades.title') : t('nodes.title')}
          </Text>
        </Box>

        <Box style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0 }} />

        {/* The facts follow the view: a fleet is counted in boxes, a set of
            cascades in chains and hops. */}
        <Box className="page-bar-facts">
          {view === 'nodes' ? (
            <>
              <BarFact value={fleetFacts.vps} label={t('nodes.bar.vps')} />
              <BarDot />
              <BarFact value={fleetFacts.online} label={t('nodes.bar.online')} accent={MOSS} />
              <BarDot soft="mid" />
              <BarFact value={fleetFacts.countries} label={t('nodes.bar.countries')} soft="mid" />
              <BarDot soft="soft" />
              <BarFact value={fleetFacts.hosts} label={t('nodes.bar.hosts')} soft="soft" />
              <BarDot soft="soft" />
              <BarFact value={formatBytes(fleetFacts.today)} label={t('nodes.bar.today')} soft="soft" />
            </>
          ) : (
            <>
              <BarFact value={allCascades.length} label={t('cascades.bar.chains')} />
              <BarDot />
              <BarFact
                value={allCascades.filter((c) => c.enabled).length}
                label={t('cascades.bar.enabled')}
                accent={MOSS}
              />
              <BarDot soft="mid" />
              {/* Traffic that entered the cascades today. Counting positions
                  instead would report the shape of the config, which the cards
                  below already draw. */}
              <BarFact value={formatBytes(cascadeToday)} label={t('nodes.bar.today')} soft="mid" />
            </>
          )}

          <Box style={{ flex: 1, minWidth: 0 }} />

          {/* The field needs the brighter edge: at 34px on a card that is
              already dark, the hairline reads as no border at all. */}
          {view === 'nodes' && (
            <Box
              className="page-bar-search"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 34,
                paddingInline: 12,
                marginRight: 4,
                borderRadius: 8,
                backgroundColor: GROUND,
                border: `1px solid ${EDGE}`,
              }}
            >
              <IconSearch size={14} stroke={2} color={FAINT} />
              <input
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                placeholder={t('nodes.searchPlaceholder')}
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: SNOW,
                  fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                  fontSize: 12,
                  lineHeight: '16px',
                }}
              />
              {search ? (
                <UnstyledButton onClick={() => setSearch('')} style={{ display: 'flex', flexShrink: 0 }}>
                  <IconX size={13} stroke={2.4} color={FAINT} />
                </UnstyledButton>
              ) : (
                <Box
                  className="page-bar-search-key"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    height: 18,
                    paddingInline: 5,
                    borderRadius: 4,
                    backgroundColor: CARD,
                    border: `1px solid ${HAIRLINE}`,
                    flexShrink: 0,
                  }}
                >
                  <Text style={{ fontFamily: MONO_FAMILY, fontSize: 9, lineHeight: '11px', color: FAINT }}>/</Text>
                </Box>
              )}
            </Box>
          )}
        </Box>

        {/* A hairline between what the page is about and what it is set to:
            without it the search field and the view switch read as one control. */}
        <Box
          className="page-bar-sep"
          style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0, marginLeft: 12 }}
        />

        <Box className="page-bar-actions">
          <Segmented
            value={view}
            onChange={(v) => setViewPersist(v as NodesView)}
            options={[
              { value: 'nodes', label: t('nodes.viewNodes'), icon: 'server' },
              { value: 'cascades', label: t('nodes.viewCascades'), icon: 'chain' },
            ]}
          />

          {view === 'nodes' && nodeCascadeMap.size > 0 && (
            <BarSelect
              value={membership}
              onChange={(v) => setMembership(v as MembershipFilter)}
              count={visibleNodes.length}
              data={[
                { value: 'all', label: t('nodes.filter.all') },
                { value: 'standalone', label: t('nodes.filter.standalone') },
                { value: 'cascade', label: t('nodes.filter.cascade') },
              ]}
            />
          )}

          {view === 'nodes' && (regionsQuery.data?.regions ?? []).length > 0 && (
            <BarSelect
              value={regionFilter}
              onChange={setRegionFilter}
              data={[
                { value: 'all', label: t('nodes.regionFilterAll') },
                ...(regionsQuery.data?.regions ?? []).map((r) => ({
                  value: r.id,
                  label: `${r.code} · ${r.name}`,
                })),
              ]}
            />
          )}

          {/* Density lives as two glyphs, not two words: it is a shape choice,
              and the words were competing with the view switch beside it. */}
          <IconSegmented
            value={view === 'cascades' ? cascadeLayout : layout}
            onChange={(v) =>
              view === 'cascades'
                ? setCascadeLayoutPersist(v as CascadeLayout)
                : setLayoutPersist(v as LayoutMode)
            }
            options={
              view === 'cascades'
                ? [
                    { value: 'cards', icon: 'grid', title: t('nodes.layoutCards') },
                    { value: 'rows', icon: 'list', title: t('cascades.layoutRows') },
                  ]
                : [
                    { value: 'cards', icon: 'grid', title: t('nodes.layoutCards') },
                    { value: 'compact', icon: 'list', title: t('nodes.layoutCompact') },
                  ]
            }
          />

          <ActionIcon
            variant="subtle"
            size={38}
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['nodes'] });
              qc.invalidateQueries({ queryKey: ['dashboard'] });
              qc.invalidateQueries({ queryKey: ['cascades'] });
            }}
            loading={nodesQuery.isFetching || overviewQuery.isFetching}
            style={{
              color: MIST,
              borderRadius: 8,
              border: `1px solid ${HAIRLINE}`,
              backgroundColor: '#0B1420',
            }}
          >
            <IconRefresh size={16} />
          </ActionIcon>

          {/* One primary action per view, in the same slot. Registration is a
              three-step sequence now, so it lives on its own page. */}
          <UnstyledButton
            onClick={() => navigate(view === 'cascades' ? '/nodes/cascades/new' : '/nodes/new')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              height: 38,
              padding: '0 16px',
              borderRadius: 8,
              backgroundColor: '#0B1420',
              border: `1px solid ${HAIRLINE}`,
              flexShrink: 0,
            }}
          >
            <IconPlus size={14} stroke={2.4} color={CYAN} />
            <Text
              style={{
                fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                fontSize: 13,
                fontWeight: 500,
                color: SNOW,
              }}
            >
              {view === 'cascades' ? t('cascades.add') : t('nodes.create')}
            </Text>
          </UnstyledButton>
        </Box>
      </Box>

      {view === 'cascades' && <CascadesPanel layout={cascadeLayout} />}

      {view === 'nodes' && (
        <>

      {visibleNodes.length === 0 ? (
        <Text ta="center" py="xl" style={{ color: MIST }}>
          {t('nodes.empty')}
        </Text>
      ) : layout === 'cards' ? (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing="md">
          {visibleNodes.map((n) => {
            // Synthesise a DashboardNode shape if metrics haven't arrived yet -
            // card still renders with status from /api/nodes, just shows
            // metrics placeholder.
            const dashNode = n.overview ?? {
              id: n.id,
              name: n.name,
              status: n.status,
              countryCode: n.countryCode,
              lastStatusChange: n.lastStatusChange,
              inboundCount: 0,
              todayBytes: 0,
              metrics: null,
            };
            const regionLabel = n.regionId
              ? (regionsById.get(n.regionId)?.code ?? null)
              : null;
            const cascade = nodeCascadeMap.get(n.id);
            return (
              <NodeCard
                key={n.id}
                node={{
                  ...dashNode,
                  rawId: n.id,
                  address: n.address,
                  regionLabel,
                  cascadeLabel: cascade ? `${cascade.name} · ${cascade.role}` : null,
                  coreVersion: n.coreVersion ?? null,
                  // Restart tally + memory headroom of the core. Lives on
                  // /api/nodes, not on the overview blob, so it refreshes on
                  // the nodes query's own tick.
                  coreRestarts: n.coreRestarts ?? null,
                  protocol: n.protocol,
                  maxUsers: n.maxUsers ?? null,
                  // approxUsers: capacity bar source. Real per-node user
                  // counter lands with slice 28; here we reuse the today's
                  // bytes-driven inbound count as a placeholder so the bar
                  // shows *something* meaningful - admins prefer "looks
                  // approximately right" over "shows nothing".
                  approxUsers: dashNode.inboundCount ?? 0,
                }}
                onEdit={() => navigate(`/nodes/${n.id}`)}
                onDelete={() => handleDelete(n)}
                onRefreshBootstrap={() => handleRefreshBootstrap(n)}
                refreshLoading={
                  refreshBootstrapMutation.isPending &&
                  refreshBootstrapMutation.variables?.id === n.id
                }
              />
            );
          })}
        </SimpleGrid>
      ) : (
        <Table.ScrollContainer
          minWidth={800}
          style={{ backgroundColor: CARD, borderRadius: 10, border: `1px solid ${HAIRLINE}` }}
        >
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                <Table.Th style={{ ...MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: MIST }}>{t('nodes.table.name')}</Table.Th>
                <Table.Th style={{ ...MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: MIST }}>{t('nodes.table.address')}</Table.Th>
                <Table.Th style={{ ...MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: MIST }}>{t('nodes.table.country')}</Table.Th>
                <Table.Th style={{ ...MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: MIST }}>{t('nodes.table.status')}</Table.Th>
                <Table.Th style={{ ...MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: MIST }}>{t('nodes.table.bindings')}</Table.Th>
                <Table.Th style={{ ...MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: MIST }}>{t('nodes.table.today')}</Table.Th>
                <Table.Th style={{ width: 1, ...MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: MIST }}>{t('common.actions')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visibleNodes.map((n) => {
                const accent = STATUS_ACCENT[n.status] ?? MIST;
                const isOffline = n.status === 'offline' || n.status === 'unreachable';
                const cascade = nodeCascadeMap.get(n.id);
                return (
                  <Table.Tr
                    key={n.id}
                    style={{
                      backgroundColor: isOffline ? `${RED}08` : undefined,
                      borderBottom: `1px solid ${HAIRLINE}`,
                    }}
                  >
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: accent,
                            boxShadow: `0 0 8px ${accent}99`,
                            flexShrink: 0,
                          }}
                        />
                        <Text fw={500} style={{ color: SNOW }}>{n.name}</Text>
                        {cascade && (
                          <Tooltip label={`${cascade.name} · ${cascade.role}`} withArrow>
                            <span style={{ display: 'inline-flex', color: '#A78BFA', flexShrink: 0 }}>
                              <IconRoute size={13} />
                            </span>
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" style={{ ...MONO, color: SNOW }}>{n.address}</Text>
                    </Table.Td>
                    <Table.Td>
                      {n.countryCode ? (
                        <Group gap={4} wrap="nowrap">
                          <Text>{countryFlag(n.countryCode)}</Text>
                          <Text size="sm" style={{ ...MONO, color: MIST }}>{n.countryCode}</Text>
                        </Group>
                      ) : (
                        <Text style={{ color: MIST }}>-</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        variant="light"
                        style={{
                          backgroundColor: `${accent}1A`,
                          color: accent,
                          border: `1px solid ${accent}33`,
                          textTransform: 'uppercase',
                          whiteSpace: 'nowrap',
                          ...MONO,
                          letterSpacing: '0.08em',
                        }}
                      >
                        {n.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" style={{ ...MONO, color: SNOW }}>
                        {n.overview?.inboundCount ?? 0}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" style={{ ...MONO, color: SNOW }}>
                        {n.overview ? formatBytes(n.overview.todayBytes) : '-'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <Tooltip label={t('nodes.refreshBootstrap')}>
                          <ActionIcon
                            variant="outline"
                            size="sm"
                            loading={
                              refreshBootstrapMutation.isPending &&
                              refreshBootstrapMutation.variables?.id === n.id
                            }
                            onClick={() => handleRefreshBootstrap(n)}
                            style={{ borderColor: `${CYAN}55`, color: CYAN }}
                          >
                            <IconKey size={14} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={t('common.edit')}>
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            onClick={() => navigate(`/nodes/${n.id}`)}
                            style={{ color: MIST }}
                          >
                            <IconEdit size={14} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={t('common.delete')}>
                          <ActionIcon variant="subtle" size="sm" color="red" onClick={() => handleDelete(n)}>
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
        </>
      )}

      <NodeFormModal
        opened={createOpen}
        onClose={closeCreate}
        node={null}
        loading={createMutation.isPending}
        onSubmit={async (input, profileIds) => {
          // Step 1: register the node and get its ID. Bootstrap modal opens
          // automatically via createMutation.onSuccess.
          const created = await createMutation.mutateAsync(input as CreateNodeInput);
          // Step 2: auto-create bindings for each picked profile. Done in
          // sequence (low volume - admin won't pick 50 profiles at once)
          // and tolerant - one binding failure doesn't block the rest.
          if (profileIds.length > 0) {
            const ok: string[] = [];
            const fail: string[] = [];
            // Assign a distinct port per profile. A fresh node has no bindings
            // yet, so hardcoding 443 made every profile after the first collide
            // (409 PORT_IN_USE). Reserve the node-agent's own mTLS port so an
            // inbound never shadows it, and feed each pick the ports already
            // assigned in this batch.
            const agentPort = parseNodeAgentPort((input as CreateNodeInput).address);
            const reserved = agentPort !== null ? [agentPort] : [];
            const assigned: number[] = [];
            for (const profileId of profileIds) {
              const port = pickFreeQuickDeployPort(assigned, reserved);
              try {
                await createBinding({ profileId, nodeId: created.id, port });
                assigned.push(port);
                ok.push(profileId);
              } catch {
                fail.push(profileId);
              }
            }
            qc.invalidateQueries({ queryKey: ['bindings'] });
            qc.invalidateQueries({ queryKey: ['profiles'] });
            if (fail.length > 0) {
              notifications.show({
                color: 'yellow',
                title: t('nodeConfirm.bindingsPartialTitle'),
                message: t('nodeConfirm.bindingsPartialMessage', { ok: ok.length, fail: fail.length }),
              });
            } else {
              notifications.show({
                color: 'green',
                message: t('nodeConfirm.bindingsAllOk', { count: ok.length }),
              });
            }
          }
        }}
      />

      <NodeEditModal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        node={editing}
        saving={updateMutation.isPending}
        refreshing={
          refreshBootstrapMutation.isPending &&
          refreshBootstrapMutation.variables?.id === editing?.id
        }
        onSubmit={async (input) => {
          if (!editing) return;
          await updateMutation.mutateAsync({ id: editing.id, input });
          setEditing(null);
        }}
        onDelete={() => {
          if (!editing) return;
          handleDelete(editing);
          setEditing(null);
        }}
        onRefreshBootstrap={() => {
          if (!editing) return;
          handleRefreshBootstrap(editing);
        }}
      />

      {payload && (
        <NodePayloadModal
          opened={true}
          onClose={() => setPayload(null)}
          nodeName={payload.name}
          payload={payload.payload}
          bootstrap={payload.bootstrap}
        />
      )}
    </Stack>
  );
}
