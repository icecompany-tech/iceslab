import { AppShell, Box, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, NavLink as RouterNavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconUsers,
  IconServer2,
  IconLogout,
  IconFilter,
  IconStack2,
  IconUsersGroup,
  IconLayoutDashboard,
  IconHourglass,
  IconSettings,
  IconSearch,
  IconRss,
  type Icon,
} from '@tabler/icons-react';
import { useAuth } from '../stores/auth';
import { useBrandName } from '../hooks/useBrandName';
import { LanguageSwitcher } from './LanguageSwitcher';
import {
  getDashboardOverview,
  listNodes,
  listProfiles,
  listSquads,
  listUsers,
} from '../lib/api';

const HAIRLINE = '#1C2A3D';
const GROUND = '#08101A';
const CARD = '#0F1A28';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const CYAN = '#7DD3FC';
const CYAN2 = '#67E8F9';
const MOSS = '#A7D8B9';

const MONO_LABEL = {
  fontFamily: "'Geist Mono', monospace",
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase' as const,
  color: MIST,
};

type NavCount = string | number | null | undefined;

type NavItemProps = {
  to?: string;
  href?: string;
  end?: boolean;
  label: string;
  icon: Icon;
  count?: NavCount;
  shortcut?: string;
  countDot?: boolean;
};

function NavItem({ to, href, end, label, icon: Icon, count, shortcut, countDot }: NavItemProps) {
  const renderInner = (isActive: boolean) => (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        borderRadius: 8,
        color: isActive ? SNOW : MIST,
        fontSize: 13,
        fontWeight: isActive ? 500 : 400,
        backgroundColor: isActive ? '#0B1420' : 'transparent',
        borderLeft: `2px solid ${isActive ? CYAN : 'transparent'}`,
        transition: 'background-color 120ms, color 120ms',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.backgroundColor = '#0B1420';
          (e.currentTarget as HTMLElement).style.color = SNOW;
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
          (e.currentTarget as HTMLElement).style.color = MIST;
        }
      }}
    >
      <Box style={{ color: isActive ? CYAN : MIST, display: 'flex' }}>
        <Icon size={16} stroke={1.6} />
      </Box>
      <span style={{ flex: 1 }}>{label}</span>
      {shortcut && (
        <Box
          style={{
            fontFamily: "'Geist Mono', monospace",
            fontSize: 10,
            color: MIST,
            border: `1px solid ${HAIRLINE}`,
            borderRadius: 4,
            padding: '1px 5px',
            letterSpacing: '0.04em',
          }}
        >
          {shortcut}
        </Box>
      )}
      {count !== undefined && count !== null && (
        <Box
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontFamily: "'Geist Mono', monospace",
            fontSize: 11,
            color: countDot ? MOSS : MIST,
          }}
        >
          {countDot && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: MOSS,
                boxShadow: `0 0 6px ${MOSS}99`,
              }}
            />
          )}
          {count}
        </Box>
      )}
    </Box>
  );

  if (href) {
    return (
      <UnstyledButton
        component="a"
        href={href}
        target="_blank"
        rel="noreferrer"
        style={{ display: 'block', textDecoration: 'none' }}
      >
        {renderInner(false)}
      </UnstyledButton>
    );
  }

  return (
    <RouterNavLink to={to!} end={end} style={{ textDecoration: 'none', display: 'block' }}>
      {({ isActive }) => renderInner(isActive)}
    </RouterNavLink>
  );
}

// Breadcrumb i18n keys per pathname. Resolved via t() at render-time so the
// strings track the active locale. Anything not in this map falls back to a
// generic uppercase-from-pathname formatter (see breadcrumb derivation).
const BREADCRUMB_KEYS: Record<string, string> = {
  '/': 'breadcrumb.dashboard',
  '/users': 'breadcrumb.users',
  '/profiles': 'breadcrumb.profiles',
  '/squads': 'breadcrumb.squads',
  '/nodes': 'breadcrumb.nodes',
  '/subscription/metadata': 'breadcrumb.subscriptionMetadata',
  '/subscription/routing': 'breadcrumb.subscriptionRouting',
  '/settings': 'breadcrumb.settings',
};

export function AppLayout() {
  const [opened, { toggle: _toggle }] = useDisclosure();
  void _toggle;
  void opened;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { admin, clearSession } = useAuth();
  const qc = useQueryClient();
  const brandName = useBrandName();
  const { t } = useTranslation();

  const dashQuery = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: getDashboardOverview,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
  const usersQuery = useQuery({
    queryKey: ['users', 'count'],
    queryFn: () => listUsers({ page: 1, limit: 1 }),
    staleTime: 60_000,
  });
  const profilesQuery = useQuery({
    queryKey: ['profiles', 'count'],
    queryFn: () => listProfiles(),
    staleTime: 60_000,
  });
  const squadsQuery = useQuery({
    queryKey: ['squads', 'count'],
    queryFn: () => listSquads(),
    staleTime: 60_000,
  });
  const nodesQuery = useQuery({
    queryKey: ['nodes', 'count'],
    queryFn: () => listNodes({ page: 1, limit: 100 }),
    staleTime: 60_000,
  });

  const userCount = usersQuery.data?.total ?? dashQuery.data?.users.total;
  const profileCount = profilesQuery.data?.profiles.length;
  const squadCount = squadsQuery.data?.squads.length;
  const nodesTotal = nodesQuery.data?.nodes.length ?? dashQuery.data?.system.totalNodeCount;
  const nodesOnline = dashQuery.data?.system.onlineNodeCount ?? nodesTotal;

  function handleLogout() {
    clearSession();
    // Drop cached queries, otherwise next admin on this browser sees the
    // previous session's data flash before refetch.
    qc.clear();
    navigate('/login', { replace: true });
  }

  const breadcrumbKey = BREADCRUMB_KEYS[pathname];
  const breadcrumb = breadcrumbKey
    ? t(breadcrumbKey)
    : `/ ${pathname.replace('/', '').toUpperCase()}`;

  return (
    <AppShell
      header={{ height: 76 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: false } }}
      padding={0}
      styles={{
        main: { backgroundColor: GROUND, minHeight: '100vh' },
        header: {
          backgroundColor: GROUND,
          borderBottom: `1px solid ${HAIRLINE}`,
        },
        navbar: {
          backgroundColor: GROUND,
          borderRight: `1px solid ${HAIRLINE}`,
          padding: 0,
        },
      }}
    >
      <AppShell.Header>
        <Box
          style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            padding: '0 28px',
            gap: 24,
          }}
        >
          <Text style={{ ...MONO_LABEL, flex: 1 }}>{breadcrumb}</Text>
          <TextInput
            placeholder="Search anything"
            leftSection={<IconSearch size={14} color={MIST} />}
            rightSection={
              <Box
                style={{
                  fontFamily: "'Geist Mono', monospace",
                  fontSize: 10,
                  color: MIST,
                  border: `1px solid ${HAIRLINE}`,
                  borderRadius: 4,
                  padding: '1px 5px',
                  marginRight: 8,
                }}
              >
                ⌘K
              </Box>
            }
            styles={{
              root: { width: 260 },
              input: {
                backgroundColor: CARD,
                borderColor: HAIRLINE,
                color: SNOW,
                fontSize: 12,
                height: 34,
                minHeight: 34,
              },
            }}
          />
          <LanguageSwitcher />
        </Box>
      </AppShell.Header>

      <AppShell.Navbar>
        <Stack justify="space-between" h="100%" gap={0}>
          <Stack gap={0}>
            {/* Brand */}
            <Box
              style={{
                padding: '18px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <Box
                style={{
                  width: 22,
                  height: 22,
                  background: `linear-gradient(135deg, ${CYAN}, ${CYAN2})`,
                  transform: 'rotate(45deg)',
                  borderRadius: 4,
                  boxShadow: `0 0 14px ${CYAN}66`,
                }}
              />
              <Text
                style={{
                  fontFamily: "'Space Grotesk', Inter, sans-serif",
                  fontWeight: 500,
                  fontSize: 18,
                  letterSpacing: '-0.01em',
                  color: SNOW,
                  flex: 1,
                }}
              >
                {brandName.toLowerCase()}
              </Text>
              <Text
                style={{
                  ...MONO_LABEL,
                  fontSize: 9,
                  letterSpacing: '0.1em',
                }}
              >
                v{__APP_VERSION__}
              </Text>
            </Box>

            {/* Signed in as */}
            <Box style={{ padding: '0 16px 16px' }}>
              <Box
                style={{
                  padding: '10px 12px',
                  border: `1px solid ${HAIRLINE}`,
                  borderRadius: 8,
                  backgroundColor: CARD,
                }}
              >
                <Text style={{ ...MONO_LABEL, fontSize: 9, marginBottom: 4 }}>
                  {t('sidebar.signedInAs')}
                </Text>
                <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Text
                    style={{
                      color: SNOW,
                      fontWeight: 500,
                      fontSize: 13,
                    }}
                  >
                    {admin?.username ?? 'admin'}
                  </Text>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: MOSS,
                      boxShadow: `0 0 6px ${MOSS}99`,
                    }}
                  />
                </Box>
              </Box>
            </Box>

            {/* Workspace group — core resources operators manage daily */}
            <Text style={{ ...MONO_LABEL, padding: '0 28px 8px' }}>{t('sidebar.workspace')}</Text>

            <Stack gap={2} px={8}>
              <NavItem
                to="/"
                end
                label={t('sidebar.home')}
                icon={IconLayoutDashboard}
                shortcut="⌘1"
              />
              <NavItem to="/users" label={t('sidebar.users')} icon={IconUsers} count={userCount} />
              <NavItem
                to="/profiles"
                label={t('sidebar.profiles')}
                icon={IconStack2}
                count={profileCount}
              />
              <NavItem
                to="/squads"
                label={t('sidebar.squads')}
                icon={IconUsersGroup}
                count={squadCount}
              />
              <NavItem
                to="/nodes"
                label={t('sidebar.nodes')}
                icon={IconServer2}
                count={
                  nodesTotal !== undefined && nodesOnline !== undefined
                    ? `${nodesOnline}/${nodesTotal}`
                    : nodesTotal
                }
                countDot={nodesTotal !== undefined}
              />
            </Stack>

            {/* Subscription group — everything that shapes the client-facing
                subscription URL: per-instance metadata + UA-routing rules. */}
            <Text style={{ ...MONO_LABEL, padding: '20px 28px 8px' }}>
              {t('sidebar.subscriptionGroup')}
            </Text>
            <Stack gap={2} px={8}>
              <NavItem
                to="/subscription/metadata"
                label={t('sidebar.subscriptionMetadata')}
                icon={IconRss}
              />
              <NavItem
                to="/subscription/routing"
                label={t('sidebar.subscriptionRouting')}
                icon={IconFilter}
              />
            </Stack>

            {/* System group — observability + panel-wide config */}
            <Text style={{ ...MONO_LABEL, padding: '20px 28px 8px' }}>
              {t('sidebar.systemGroup')}
            </Text>
            <Stack gap={2} px={8}>
              <NavItem
                href="/admin/queues"
                label={t('sidebar.queues')}
                icon={IconHourglass}
              />
            </Stack>
          </Stack>

          {/* Bottom: settings + sign out */}
          <Stack gap={2} px={8} pb={16} pt={8} style={{ borderTop: `1px solid ${HAIRLINE}` }}>
            <NavItem to="/settings" label={t('sidebar.settings')} icon={IconSettings} />
            <UnstyledButton
              onClick={handleLogout}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 12px',
                borderRadius: 8,
                color: MIST,
                fontSize: 13,
                borderLeft: '2px solid transparent',
                transition: 'background-color 120ms, color 120ms',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = '#0B1420';
                (e.currentTarget as HTMLElement).style.color = SNOW;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                (e.currentTarget as HTMLElement).style.color = MIST;
              }}
            >
              <IconLogout size={16} stroke={1.6} />
              <span>{t('sidebar.logout')}</span>
            </UnstyledButton>
          </Stack>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box style={{ padding: '32px 40px 48px' }}>
          <Outlet />
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
