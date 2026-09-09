import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Box, Menu, SimpleGrid, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconAlertTriangle,
  IconDotsVertical,
  IconEdit,
  IconLink,
  IconShield,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUsers,
} from '@tabler/icons-react';
import { ALL_SQUAD_ID, listRoutePolicies } from '@/lib/domain/route-policies';
import {
  createSquad,
  deleteSquad,
  listSquads,
  updateSquad,
  type CreateSquadInput,
  type Squad,
  type UpdateSquadInput,
} from '@/lib/domain/squads';
import { listBindings, listProfiles } from '@/lib/domain/profiles';
import { listCascades } from '@/lib/domain/cascades';
import { listNodes } from '@/lib/domain/nodes';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import { SquadFormModal } from '@/contours/squads/components/SquadFormModal';

/**
 * Squads: who gets what. Each card answers three questions at a glance, in the
 * order an operator asks them: where can these people connect (countries), how
 * many of them are there, and how far their access is narrowed (cascade exits
 * and route policies).
 *
 * A squad with nothing granted is the one broken state here, so it is coloured
 * amber and its button says "grant" instead of "edit": the card tells you what
 * to do about it rather than just reporting a zero.
 */

const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const WELL = '#0B1420';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const FAINT = '#5A6B82';
const DIM = '#3A4A60';
const CYAN = '#7DD3FC';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const VIOLET = '#A78BFA';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

/** Country chips cycle these so two neighbours never share a colour. */
const CHIP_COLORS = [VIOLET, CYAN, MOSS, AMBER];

export function SquadsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Creation moved to its own page; the modal now only serves edit-in-place
  // paths that have not been migrated yet.
  const [createOpen, { close: closeCreate }] = useDisclosure(false);
  const [editing, setEditing] = useState<Squad | null>(null);
  const [search, setSearch] = useState('');

  const squadsQuery = useQuery({ queryKey: ['squads'], queryFn: listSquads });
  const profilesQuery = useQuery({ queryKey: ['profiles'], queryFn: () => listProfiles() });
  const bindingsQuery = useQuery({ queryKey: ['bindings'], queryFn: () => listBindings() });
  const nodesQuery = useQuery({ queryKey: ['nodes'], queryFn: () => listNodes() });
  // A4 increment 2 - balancer cascades for the per-squad exit allow-list.
  const cascadesQuery = useQuery({ queryKey: ['cascades'], queryFn: listCascades });
  // A4 ad-split - route-policies the squad can grant.
  const policiesQuery = useQuery({ queryKey: ['route-policies'], queryFn: listRoutePolicies });

  const createMutation = useMutation({
    mutationFn: createSquad,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['squads'] });
      notifications.show({ color: 'green', message: t('squads.notify.created') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.createError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSquadInput }) => updateSquad(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['squads'] });
      notifications.show({ color: 'green', message: t('squads.notify.updated') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSquad,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['squads'] });
      notifications.show({ color: 'green', message: t('squads.notify.deleted') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.deleteError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function handleCreate(input: CreateSquadInput | UpdateSquadInput): Promise<void> {
    return createMutation.mutateAsync(input as CreateSquadInput).then(() => undefined);
  }

  function handleUpdate(input: CreateSquadInput | UpdateSquadInput): Promise<void> {
    if (!editing) return Promise.resolve();
    return updateMutation
      .mutateAsync({ id: editing.id, input: input as UpdateSquadInput })
      .then(() => undefined);
  }

  function handleDelete(squad: Squad) {
    modals.openConfirmModal({
      title: t('squads.deleteTitle', { name: squad.name }),
      children: <Text size="sm">{t('squads.deleteBody')}</Text>,
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(squad.id),
    });
  }

  const squads = squadsQuery.data?.squads ?? [];
  const profiles = profilesQuery.data?.profiles ?? [];
  const cascades = cascadesQuery.data?.cascades ?? [];
  const routePolicies = policiesQuery.data?.policies ?? [];

  const bindingsByProfile = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bindingsQuery.data?.bindings ?? []) {
      m.set(b.profileId, (m.get(b.profileId) ?? 0) + 1);
    }
    return m;
  }, [bindingsQuery.data]);

  /**
   * Countries a squad can actually reach: its profiles, wherever those are
   * deployed. This is the honest answer to "where does this squad connect",
   * and it is a squad's most useful single fact.
   */
  const countriesByProfile = useMemo(() => {
    const nodeCountry = new Map<string, string | null>();
    for (const n of nodesQuery.data?.nodes ?? []) nodeCountry.set(n.id, n.countryCode);
    const m = new Map<string, Set<string>>();
    for (const b of bindingsQuery.data?.bindings ?? []) {
      const cc = nodeCountry.get(b.nodeId);
      if (!cc) continue;
      const set = m.get(b.profileId) ?? new Set<string>();
      set.add(cc.toUpperCase());
      m.set(b.profileId, set);
    }
    return m;
  }, [bindingsQuery.data, nodesQuery.data]);

  function countriesOf(squad: Squad): string[] {
    const out = new Set<string>();
    for (const pid of squad.profileIds) {
      for (const cc of countriesByProfile.get(pid) ?? []) out.add(cc);
    }
    return [...out].sort();
  }

  // Denominator in "1 of 2". Only balancer cascades have selectable exits: in
  // a chain the path is fixed, so every hop after the entry is a link, not a
  // choice.
  const totalExits = useMemo(
    () =>
      cascades.reduce(
        (sum, c) => sum + (c.mode === 'balancer' ? Math.max(0, c.hops.length - 1) : 0),
        0,
      ),
    [cascades],
  );

  const filteredSquads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return squads;
    return squads.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || (s.description?.toLowerCase().includes(q) ?? false),
    );
  }, [squads, search]);

  // Pin "All" first, then alphabetical.
  const sortedSquads = useMemo(() => {
    const all: Squad[] = [];
    const others: Squad[] = [];
    for (const s of filteredSquads) {
      if (s.id === ALL_SQUAD_ID) all.push(s);
      else others.push(s);
    }
    others.sort((a, b) => a.name.localeCompare(b.name));
    return [...all, ...others];
  }, [filteredSquads]);

  const totalMembers = squads.reduce((sum, s) => sum + s.memberCount, 0);
  const withoutHosts = squads.filter((s) => s.profileIds.length === 0).length;

  usePageMeta([
    t('pageMeta.squads', { count: squads.length }),
    t('pageMeta.squadMembers', { count: totalMembers }),
  ]);

  return (
    <Stack gap="lg">
      {/* Page bar: the three facts, then search, then actions. One row, so the
          cards start as high on the page as possible. */}
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
              flexShrink: 0,
            }}
          >
            <IconLink size={16} stroke={1.8} />
          </Box>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Fact value={squads.length} label={t('squads.bar.squads')} />
            <Dot />
            <Fact value={totalMembers} label={t('squads.bar.members')} />
            {withoutHosts > 0 && (
              <>
                <Dot />
                <Fact value={withoutHosts} label={t('squads.bar.withoutHosts')} accent={AMBER} />
              </>
            )}
          </Box>
        </Box>

        <Box style={{ width: 1, height: 24, backgroundColor: HAIRLINE, flexShrink: 0 }} />

        <Box
          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px' }}
        >
          <IconSearch size={15} stroke={1.8} color={MIST} />
          <input
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder={t('squads.searchPlaceholder')}
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
          <BarButton
            title={t('common.refresh')}
            onClick={() => qc.invalidateQueries({ queryKey: ['squads'] })}
          >
            <IconRefresh size={16} stroke={1.8} color={MIST} />
          </BarButton>
          <BarButton onClick={() => navigate('/squads/new')} label={t('squads.create')}>
            <IconPlus size={14} stroke={2.4} color={CYAN} />
          </BarButton>
        </Box>
      </Box>

      {sortedSquads.length === 0 ? (
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
              <IconUsers size={24} />
            </ThemeIcon>
            <Text c="dimmed" size="sm">
              {squads.length === 0 ? t('squads.empty') : t('common.nothingFound')}
            </Text>
          </Stack>
        </Box>
      ) : (
        <SimpleGrid cols={{ base: 1, lg: 2, xl: 3 }} spacing={16}>
          {sortedSquads.map((squad) => (
            <SquadCard
              key={squad.id}
              squad={squad}
              countries={countriesOf(squad)}
              totalExits={totalExits}
              onEdit={() => navigate(`/squads/${squad.id}`)}
              onDelete={() => handleDelete(squad)}
            />
          ))}
        </SimpleGrid>
      )}

      <SquadFormModal
        opened={createOpen}
        onClose={closeCreate}
        squad={null}
        profiles={profiles}
        bindingsByProfile={bindingsByProfile}
        cascades={cascades}
        routePolicies={routePolicies}
        onSubmit={handleCreate}
        loading={createMutation.isPending}
      />

      <SquadFormModal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        squad={editing}
        profiles={profiles}
        bindingsByProfile={bindingsByProfile}
        cascades={cascades}
        routePolicies={routePolicies}
        onSubmit={handleUpdate}
        loading={updateMutation.isPending}
      />
    </Stack>
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

// ───── Squad card ─────

function SquadCard({
  squad,
  countries,
  totalExits,
  onEdit,
  onDelete,
}: {
  squad: Squad;
  countries: string[];
  totalExits: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const isAll = squad.id === ALL_SQUAD_ID;
  const empty = squad.profileIds.length === 0;
  // Accent carries the state: system green, amber when nothing is granted,
  // violet for an ordinary squad.
  const accent = isAll ? MOSS : empty ? AMBER : VIOLET;

  // The "All" squad is seeded in English by a migration, so its name and
  // description come from i18n instead of the row.
  const displayName = isAll ? t('squads.allDefaultName') : squad.name;
  const displayDescription = isAll ? t('squads.allDefaultDescription') : squad.description;

  const allowedExits = squad.exitAcl.reduce((sum, e) => sum + e.exitNodeIds.length, 0);
  const exitsLabel =
    allowedExits === 0 ? t('squads.card.allExits') : `${allowedExits} ${t('squads.card.of')} ${totalExits}`;
  const policiesLabel =
    squad.policyIds.length === 0 ? t('squads.card.noPolicies') : String(squad.policyIds.length);

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 16,
        borderRadius: 10,
        backgroundColor: CARD,
        border: `1px solid ${HAIRLINE}`,
        borderTop: `3px solid ${accent}`,
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%' }}>
        <Box
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            backgroundColor: `${accent}1A`,
            border: `1px solid ${accent}33`,
            color: accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <IconLink size={20} stroke={1.8} />
        </Box>
        <Box style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Text
              style={{
                fontFamily: DISPLAY,
                fontSize: 17,
                fontWeight: 600,
                lineHeight: '22px',
                color: SNOW,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {displayName}
            </Text>
            {/* The system squad is the one card an operator must not treat like
                the others, so it says so on the card, not in a tooltip. */}
            {isAll && (
              <>
                <IconShield size={13} stroke={1.8} color={MOSS} />
                <Box
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    height: 18,
                    padding: '0 7px',
                    borderRadius: 5,
                    backgroundColor: `${MOSS}1A`,
                    border: `1px solid ${MOSS}33`,
                    flexShrink: 0,
                  }}
                >
                  <Text
                    style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', color: MOSS }}
                  >
                    {t('squads.card.system')}
                  </Text>
                </Box>
              </>
            )}
          </Box>
          {displayDescription && (
            <Text
              style={{
                fontFamily: DISPLAY,
                fontSize: 11,
                lineHeight: '14px',
                color: MIST,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {displayDescription}
            </Text>
          )}
        </Box>
        <Menu shadow="md" position="bottom-end" withinPortal>
          <Menu.Target>
            <UnstyledButton style={{ display: 'flex', color: DIM, flexShrink: 0 }}>
              <IconDotsVertical size={16} />
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown style={{ backgroundColor: CARD, borderColor: HAIRLINE }}>
            <Menu.Item leftSection={<IconEdit size={14} />} onClick={onEdit}>
              {isAll ? t('squads.open') : t('common.edit')}
            </Menu.Item>
            <Menu.Item
              color="red"
              leftSection={<IconTrash size={14} />}
              disabled={isAll}
              onClick={onDelete}
            >
              {t('common.delete')}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Box>

      {/* Metrics strip */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          margin: '14px 0',
          padding: '10px 12px',
          borderRadius: 8,
          backgroundColor: WELL,
        }}
      >
        <Box style={{ flex: 1.4, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <Text style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', color: FAINT }}>
            {t('squads.card.hosts')}
          </Text>
          {countries.length === 0 ? (
            <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconAlertTriangle size={12} stroke={2} color={AMBER} />
              <Text style={{ fontFamily: MONO, fontSize: 11, color: AMBER }}>
                {t('squads.card.noneGranted')}
              </Text>
            </Box>
          ) : (
            <Box style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'nowrap' }}>
              {countries.slice(0, 3).map((cc, i) => (
                <CountryChip key={cc} code={cc} color={CHIP_COLORS[i % CHIP_COLORS.length]} />
              ))}
              {countries.length > 3 && (
                <Text style={{ fontFamily: MONO, fontSize: 9, color: MIST }}>
                  +{countries.length - 3}
                </Text>
              )}
            </Box>
          )}
        </Box>

        <Box style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0 }} />

        <Box style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 12 }}>
          <Text style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', color: FAINT }}>
            {t('squads.card.members')}
          </Text>
          <Text style={{ fontFamily: MONO, fontSize: 12, color: SNOW }}>{squad.memberCount}</Text>
        </Box>

        <Box style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0 }} />

        <Box style={{ flex: 1.1, display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 12 }}>
          <Text style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', color: FAINT }}>
            {t('squads.card.exitsPolicies')}
          </Text>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontFamily: MONO, fontSize: 12, color: allowedExits ? CYAN : MIST }}>
              {exitsLabel}
            </Text>
            <Text style={{ fontFamily: MONO, fontSize: 12, color: DIM }}>·</Text>
            <Text
              style={{ fontFamily: MONO, fontSize: 12, color: squad.policyIds.length ? CYAN : MIST }}
            >
              {policiesLabel}
            </Text>
          </Box>
        </Box>
      </Box>

      <UnstyledButton
        onClick={onEdit}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          height: 38,
          borderRadius: 8,
          backgroundColor: `${accent}1A`,
          border: `1px solid ${accent}33`,
        }}
      >
        <Box style={{ display: 'flex', color: accent }}>
          <IconPencil size={14} stroke={1.8} />
        </Box>
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, color: accent }}>
          {isAll ? t('squads.open') : empty ? t('squads.card.grantHosts') : t('common.edit')}
        </Text>
      </UnstyledButton>
    </Box>
  );
}

function CountryChip({ code, color }: { code: string; color: string }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 17,
        padding: '0 6px',
        borderRadius: 5,
        backgroundColor: `${color}24`,
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: 9, lineHeight: '12px', color }}>{code}</Text>
    </Box>
  );
}
