import { Suspense } from 'react';
import { AppShell, Box, Center, Loader, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
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
  IconChartHistogram,
  IconHourglass,
  IconSettings,
  IconSearch,
  IconRss,
  IconRoute,
  type Icon,
} from '@tabler/icons-react';
import { useAuth } from '../stores/auth';
import { useBrandName } from '../hooks/useBrandName';
import { LanguageSwitcher } from './LanguageSwitcher';
import { getSystemVersion } from '../lib/api';
import { useOverview } from '../hooks/useOverview';

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
  '/insights': 'breadcrumb.insights',
  '/settings': 'breadcrumb.settings',
};

export function AppLayout() {
  const [opened, { toggle: _toggle }] = useDisclosure();
  void _toggle;
  void opened;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // F13 - select individual slices instead of the whole store object, so an
  // unrelated store update doesn't re-render the entire layout.
  const admin = useAuth((s) => s.admin);
  const clearSession = useAuth((s) => s.clearSession);
  const qc = useQueryClient();
  const brandName = useBrandName();
  const { t } = useTranslation();

  // Wave-14 #18: single dashQuery feeds every sidebar count. Pre-wave we
  // fired 4 separate count queries (users/profiles/squads/nodes) each
  // pulling full row payloads only to call .length on the client — on every
  // page transition for every signed-in admin. The dashboard response now
  // carries `inventory.{profileCount,squadCount}` alongside the existing
  // users.total and system.{total,online}NodeCount, all from the same
  // Redis-cached blob.
  const dashQuery = useOverview();

  // ROADMAP D1 — update-available check. Cheap: the backend caches the GitHub
  // call for 6h, so a long staleTime + a couple of refetches a day is plenty.
  const versionQuery = useQuery({
    queryKey: ['system', 'version'],
    queryFn: getSystemVersion,
    staleTime: 60 * 60 * 1000,
    refetchInterval: 6 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const update = versionQuery.data?.updateAvailable ? versionQuery.data : null;

  const userCount = dashQuery.data?.users.total;
  const profileCount = dashQuery.data?.inventory.profileCount;
  const squadCount = dashQuery.data?.inventory.squadCount;
  const nodesTotal = dashQuery.data?.system.totalNodeCount;
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
            placeholder={t('sidebar.searchPlaceholder')}
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
              {update ? (
                <Text
                  component="a"
                  href={update.releaseUrl ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t('sidebar.updateAvailable', { version: update.latest })}
                  style={{
                    ...MONO_LABEL,
                    fontSize: 9,
                    letterSpacing: '0.1em',
                    color: CYAN2,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Box
                    component="span"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: CYAN2,
                      boxShadow: `0 0 6px ${CYAN2}`,
                    }}
                  />
                  v{__APP_VERSION__}
                </Text>
              ) : (
                <Text
                  style={{
                    ...MONO_LABEL,
                    fontSize: 9,
                    letterSpacing: '0.1em',
                  }}
                >
                  v{__APP_VERSION__}
                </Text>
              )}
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
                // LOW: green dot reflects ONLINE nodes, not just "nodes exist".
                // With 0 online the dot was misleadingly green (looks healthy).
                countDot={nodesOnline !== undefined && nodesOnline > 0}
              />
              <NavItem to="/cascades" label={t('sidebar.cascades')} icon={IconRoute} />
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
                to="/insights"
                label={t('sidebar.insights')}
                icon={IconChartHistogram}
              />
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
          {/* F4 - lazy-loaded pages suspend while their chunk loads. Scope the
              fallback to the content area so the sidebar/topbar stay put. */}
          <Suspense
            fallback={
              <Center style={{ minHeight: '60vh' }}>
                <Loader color="#7DD3FC" />
              </Center>
            }
          >
            <Outlet />
          </Suspense>
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
