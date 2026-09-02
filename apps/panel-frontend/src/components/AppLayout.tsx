import { Suspense, useState } from 'react';
import { AppShell, Box, Center, Loader, Stack, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, NavLink as RouterNavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconUsersGroup } from '@tabler/icons-react';
import { DiscordIcon, GithubIcon, HeartIcon, StarIcon, TelegramIcon } from './BrandIcons';
import {
  NavBillingIcon,
  NavBlockIcon,
  NavCascadesIcon,
  NavChevronIcon,
  NavDnsIcon,
  NavEgressIcon,
  NavHomeIcon,
  NavHostsIcon,
  NavHttpStatsIcon,
  NavHwidIcon,
  NavLogoutIcon,
  NavNodesIcon,
  NavPoliciesIcon,
  NavProfilesIcon,
  NavQueuesIcon,
  NavRoutesIcon,
  NavRuleSetsIcon,
  NavSearchIcon,
  NavSessionIcon,
  NavSettingsIcon,
  NavShieldIcon,
  NavSlidersIcon,
  NavSubscribePageIcon,
  NavTemplateIcon,
  NavUsersIcon,
} from './NavIcons';
import { useAuth } from '../stores/auth';
import { useBrandName } from '../hooks/useBrandName';
import { getSystemVersion } from '../lib/api';
import { useOverview } from '../hooks/useOverview';
import { PageMetaProvider, usePageMetaFacts } from '../hooks/usePageMeta';
import { DISCORD_URL, GITHUB_URL, SUPPORT_URL, TELEGRAM_URL } from '../lib/community';

const HAIRLINE = '#1C2A3D';
const GROUND = '#08101A';
const CARD = '#0F1A28';
// The nav is its own panel sitting on the ground, a shade above it so the card
// reads as a surface rather than a column ruled off by a border.
const SIDEBAR_CARD = '#0B1622';
const HOVER = '#0B1420';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
// Sub-rows sit half a step under their parent: light enough to read, quiet
// enough that the top level still leads.
const SUBLABEL = '#8A9BB2';
const FAINT = '#5A6B82';
const CYAN = '#7DD3FC';
const CYAN2 = '#67E8F9';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const VIOLET = '#A78BFA';
// Warm rose, used by nothing else in the panel: the donate chip is the one
// place we ask for something back, so it gets its own accent.
const ROSE = '#E08AA8';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const MONO_LABEL = {
  fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
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
  /** Rendered element, so the sidebar can mix drawn marks with icon-set ones. */
  icon: React.ReactNode;
  count?: NavCount;
  countDot?: boolean;
  /**
   * Drawn at full weight but inert: the screen behind it doesn't exist yet.
   * Kept visible rather than hidden so the nav shows the shape we're building
   * toward; a placeholder that navigates nowhere beats one that 404s.
   */
  placeholder?: boolean;
  placeholderTitle?: string;
  /** Extra element after the count, currently only the disclosure arrow. */
  trailing?: React.ReactNode;
};

/** Row body shared by links, the inert placeholders and the Nodes toggle. */
function navRowStyle(isActive: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 12px',
    borderRadius: 8,
    color: isActive ? SNOW : MIST,
    fontFamily: DISPLAY,
    fontSize: 13,
    fontWeight: isActive ? 500 : 400,
    backgroundColor: isActive ? HOVER : 'transparent',
    borderLeft: `2px solid ${isActive ? CYAN : 'transparent'}`,
    transition: 'background-color 120ms, color 120ms',
    position: 'relative',
  };
}

function hoverOn(e: React.MouseEvent, isActive: boolean) {
  if (isActive) return;
  (e.currentTarget as HTMLElement).style.backgroundColor = HOVER;
  (e.currentTarget as HTMLElement).style.color = SNOW;
}

function hoverOff(e: React.MouseEvent, isActive: boolean) {
  if (isActive) return;
  (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
  (e.currentTarget as HTMLElement).style.color = MIST;
}

function NavCount({ count, countDot }: { count: NavCount; countDot?: boolean }) {
  if (count === undefined || count === null) return null;
  return (
    <Box
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
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
  );
}

function NavItem({
  to,
  href,
  end,
  label,
  icon,
  count,
  countDot,
  placeholder,
  placeholderTitle,
  trailing,
}: NavItemProps) {
  const renderInner = (isActive: boolean, interactive = true) => (
    <Box
      style={navRowStyle(isActive)}
      onMouseEnter={interactive ? (e) => hoverOn(e, isActive) : undefined}
      onMouseLeave={interactive ? (e) => hoverOff(e, isActive) : undefined}
    >
      <Box style={{ color: isActive ? CYAN : MIST, display: 'flex' }}>{icon}</Box>
      <span style={{ flex: 1 }}>{label}</span>
      <NavCount count={count} countDot={countDot} />
      {trailing}
    </Box>
  );

  if (placeholder) {
    return (
      <Box title={placeholderTitle} style={{ cursor: 'default' }}>
        {renderInner(false, false)}
      </Box>
    );
  }

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

/**
 * Group heading: a coloured tick plus the mono label. The tick is what tells
 * the four groups apart at a glance once the nav is long enough that the
 * labels themselves scroll past.
 */
function GroupHeader({ label, tick, first }: { label: string; tick: string; first?: boolean }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: first ? '0 28px 8px 22px' : '16px 28px 8px 22px',
        borderTop: first ? undefined : `1px dashed ${HAIRLINE}`,
      }}
    >
      <Box
        style={{ width: 3, height: 12, borderRadius: 2, flexShrink: 0, backgroundColor: tick }}
      />
      <Text style={MONO_LABEL}>{label}</Text>
    </Box>
  );
}

/** Row inside an open sub-list: indented past the parent's icon lane. */
function SubNavItem({
  to,
  label,
  icon,
  count,
  placeholder,
  placeholderTitle,
}: {
  to?: string;
  label: string;
  icon: React.ReactNode;
  count?: NavCount;
  placeholder?: boolean;
  placeholderTitle?: string;
}) {
  const renderInner = (isActive: boolean, interactive = true) => (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 12px 7px 40px',
        borderRadius: 8,
        color: isActive ? SNOW : SUBLABEL,
        fontFamily: DISPLAY,
        fontSize: 12,
        lineHeight: '16px',
        backgroundColor: isActive ? HOVER : 'transparent',
        transition: 'background-color 120ms, color 120ms',
      }}
      onMouseEnter={
        interactive
          ? (e) => {
              if (isActive) return;
              (e.currentTarget as HTMLElement).style.backgroundColor = HOVER;
              (e.currentTarget as HTMLElement).style.color = SNOW;
            }
          : undefined
      }
      onMouseLeave={
        interactive
          ? (e) => {
              if (isActive) return;
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
              (e.currentTarget as HTMLElement).style.color = SUBLABEL;
            }
          : undefined
      }
    >
      <Box style={{ color: isActive ? CYAN : FAINT, display: 'flex' }}>{icon}</Box>
      <span style={{ flex: 1 }}>{label}</span>
      {count !== undefined && count !== null && (
        <span style={{ fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace", fontSize: 10, color: FAINT }}>
          {count}
        </span>
      )}
    </Box>
  );

  if (placeholder || !to) {
    return (
      <Box title={placeholderTitle} style={{ cursor: 'default' }}>
        {renderInner(false, false)}
      </Box>
    );
  }

  return (
    <RouterNavLink to={to} end style={{ textDecoration: 'none', display: 'block' }}>
      {({ isActive }) => renderInner(isActive)}
    </RouterNavLink>
  );
}

/** Chip shell shared by the version / GitHub / support pills in the topbar. */
function TopChip({
  href,
  title,
  bg = CARD,
  border = HAIRLINE,
  padding = '0 11px',
  children,
}: {
  href?: string;
  title?: string;
  bg?: string;
  border?: string;
  padding?: string;
  children: React.ReactNode;
}) {
  const body = (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        height: 32,
        padding,
        borderRadius: 8,
        backgroundColor: bg,
        border: `1px solid ${border}`,
        textDecoration: 'none',
      }}
    >
      {children}
    </Box>
  );
  if (!href) return body;
  return (
    <UnstyledButton
      component="a"
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      style={{ textDecoration: 'none' }}
    >
      {body}
    </UnstyledButton>
  );
}

/**
 * Borderless 32x32 icon link in the channel's own brand colour. Renders even
 * when this install hasn't been given a URL yet: the topbar keeps its shape,
 * the icon just doesn't navigate until `community.ts` is filled in.
 */
function IconLink({ href, title, children }: {
  href: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <UnstyledButton
      component="a"
      href={href || undefined}
      target={href ? '_blank' : undefined}
      rel="noreferrer"
      title={title}
      aria-label={title}
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </UnstyledButton>
  );
}

function Separator() {
  return <Box style={{ width: 1, height: 18, backgroundColor: HAIRLINE, flexShrink: 0 }} />;
}

// Breadcrumb i18n keys per pathname. Resolved via t() at render-time so the
// strings track the active locale. Anything not in this map falls back to a
// generic uppercase-from-pathname formatter (see breadcrumb derivation).
const BREADCRUMB_KEYS: Record<string, string> = {
  '/': 'breadcrumb.dashboard',
  '/users': 'breadcrumb.users',
  '/profiles': 'breadcrumb.profiles',
  '/squads': 'breadcrumb.squads',
  '/hosts': 'breadcrumb.hosts',
  '/nodes': 'breadcrumb.nodes',
  '/subscription/metadata': 'breadcrumb.subscriptionMetadata',
  '/subscription/routes': 'breadcrumb.subscriptionRoutes',
  '/subscription/delivery': 'breadcrumb.subscriptionDelivery',
  '/insights': 'breadcrumb.insights',
  '/settings': 'breadcrumb.settings',
};

export function AppLayout() {
  // The topbar renders facts published by the page below it, so the provider
  // has to sit above both.
  return (
    <PageMetaProvider>
      <AppLayoutInner />
    </PageMetaProvider>
  );
}

function AppLayoutInner() {
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
  const facts = usePageMetaFacts();

  // Wave-14 #18: single dashQuery feeds every sidebar count. Pre-wave we
  // fired 4 separate count queries (users/profiles/squads/nodes) each
  // pulling full row payloads only to call .length on the client, on every
  // page transition for every signed-in admin. The dashboard response now
  // carries `inventory.{profileCount,squadCount}` alongside the existing
  // users.total and system.{total,online}NodeCount, all from the same
  // Redis-cached blob.
  const dashQuery = useOverview();

  // ROADMAP D1: update-available check. Cheap: the backend caches the GitHub
  // call for 6h, so a long staleTime + a couple of refetches a day is plenty.
  // The same response carries the repo's star count for the GitHub chip.
  const versionQuery = useQuery({
    queryKey: ['system', 'version'],
    queryFn: getSystemVersion,
    staleTime: 60 * 60 * 1000,
    refetchInterval: 6 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const update = versionQuery.data?.updateAvailable ? versionQuery.data : null;
  const stars = versionQuery.data?.stars ?? null;

  const userCount = dashQuery.data?.users.total;
  const profileCount = dashQuery.data?.inventory.profileCount;
  const squadCount = dashQuery.data?.inventory.squadCount;
  const hostCount = dashQuery.data?.inventory.hostCount;
  const nodesTotal = dashQuery.data?.system.totalNodeCount;
  const nodesOnline = dashQuery.data?.system.onlineNodeCount ?? nodesTotal;

  // Open by default: the sub-list is the only way to reach the node views now,
  // so hiding it behind a click would bury three destinations.
  const [nodesOpen, setNodesOpen] = useState(true);
  const nodesSectionActive = pathname === '/nodes' || pathname.startsWith('/nodes/');
  const notWired = t('sidebar.notWired');

  function handleLogout() {
    clearSession();
    // Drop cached queries, otherwise next admin on this browser sees the
    // previous session's data flash before refetch.
    qc.clear();
    navigate('/login', { replace: true });
  }

  // Detail routes fall back to their section's crumb, otherwise the raw path
  // lands in the topbar and a uuid becomes the page title. Walk from the
  // longest prefix down, so /subscription/delivery/new finds the two-segment
  // key the same way /squads/:id finds its one-segment one.
  const breadcrumbKey = (() => {
    const parts = pathname.split('/').filter(Boolean);
    // The root has no segments, so the loop below never runs for it and the
    // dashboard fell through to the fallback, printing a bare slash.
    if (parts.length === 0) return BREADCRUMB_KEYS['/'];
    for (let n = parts.length; n > 0; n--) {
      const key = BREADCRUMB_KEYS[`/${parts.slice(0, n).join('/')}`];
      if (key) return key;
    }
    return undefined;
  })();
  const breadcrumb = breadcrumbKey
    ? t(breadcrumbKey)
    : `/ ${pathname.replace('/', '').toUpperCase()}`;
  const crumbLine = [breadcrumb, ...facts].join(' · ');

  return (
    <AppShell
      header={{ height: 76 }}
      navbar={{ width: 262, breakpoint: 'sm', collapsed: { mobile: false } }}
      padding={0}
      styles={{
        main: { backgroundColor: GROUND, minHeight: '100vh' },
        header: {
          backgroundColor: GROUND,
          borderBottom: `1px solid ${HAIRLINE}`,
        },
        // No border on the column: the nav card carries its own, and a second
        // line down the full height would fence off the ground the card floats
        // on. The column scrolls because four groups plus the node sub-list
        // run past the fold on a 1080/1200-tall screen, and the rows that fell
        // off the bottom were sign-out and settings.
        navbar: {
          backgroundColor: GROUND,
          border: 'none',
          padding: '14px 0 14px 14px',
          overflowY: 'auto',
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
          {/* Brand + where you are. The brand sits here rather than in the
              sidebar so the nav starts with the account and the panel reads
              as one wide header. */}
          <Box style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
            <Box style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Box
                style={{
                  width: 17,
                  height: 17,
                  background: `linear-gradient(135deg, ${CYAN}, ${CYAN2})`,
                  transform: 'rotate(45deg)',
                  borderRadius: 4,
                  boxShadow: `0 0 14px ${CYAN}66`,
                  flexShrink: 0,
                }}
              />
              <Text
                style={{
                  fontFamily: DISPLAY,
                  fontWeight: 500,
                  fontSize: 16,
                  lineHeight: '20px',
                  color: SNOW,
                }}
              >
                {brandName.toLowerCase()}
              </Text>
            </Box>
            <Separator />
            <Text style={{ ...MONO_LABEL, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {crumbLine}
            </Text>
          </Box>

          <Box style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Version chip. Turns cyan and links to the release notes when a
                newer tag exists, which is the whole point of the D1 check. */}
            {update ? (
              <TopChip
                href={update.releaseUrl ?? undefined}
                title={t('sidebar.updateAvailable', { version: update.latest })}
                border={`${CYAN}55`}
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
                <Text
                  style={{
                    fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: '0.04em',
                    color: CYAN2,
                  }}
                >
                  v{__APP_VERSION__}
                </Text>
              </TopChip>
            ) : (
              <TopChip>
                <Text
                  style={{
                    fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: '0.04em',
                    color: MIST,
                  }}
                >
                  v{__APP_VERSION__}
                </Text>
              </TopChip>
            )}

            <Separator />

            {/* Project links. An AGPL panel in public alpha lives or dies by
                people finding the repo, so the way there is in the product.
                Always rendered, so the topbar looks the same on every install
                whether or not a given channel has a URL yet. */}
            <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconLink href={TELEGRAM_URL} title="Telegram">
                <TelegramIcon />
              </IconLink>
              <IconLink href={DISCORD_URL} title="Discord">
                <DiscordIcon />
              </IconLink>
              <TopChip href={GITHUB_URL} title="GitHub">
                <GithubIcon />
                {stars !== null && (
                  <>
                    <StarIcon />
                    <Text
                      style={{
                        fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: '0.02em',
                        lineHeight: '16px',
                        color: AMBER,
                      }}
                    >
                      {stars}
                    </Text>
                  </>
                )}
              </TopChip>
            </Box>

            <TopChip
              href={SUPPORT_URL}
              title={t('topbar.support')}
              bg={`${ROSE}17`}
              border={`${ROSE}47`}
              padding="0 13px 0 14px"
            >
              <HeartIcon />
              <Text
                style={{
                  fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: '0.12em',
                  lineHeight: '14px',
                  textTransform: 'uppercase',
                  color: ROSE,
                }}
              >
                {t('topbar.support')}
              </Text>
            </TopChip>
          </Box>
        </Box>
      </AppShell.Header>

      <AppShell.Navbar>
        {/* The nav is a card that ends where its content ends, so the ground
            below it belongs to the page rather than to an empty column. */}
        <Box
          style={{
            width: 248,
            alignSelf: 'flex-start',
            height: 'fit-content',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 14,
            overflow: 'clip',
            paddingBottom: 8,
            backgroundColor: SIDEBAR_CARD,
            border: `1px solid ${HAIRLINE}`,
          }}
        >
          <Stack gap={0}>
            {/* Signed in as */}
            <Box style={{ padding: '20px 16px 16px' }}>
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
                      fontFamily: DISPLAY,
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

            {/* Workspace group: core resources operators manage daily. Order
                follows the model: who gets access (users, squads) before what
                they get (profiles) before the metal it runs on (nodes). */}
            <GroupHeader label={t('sidebar.workspace')} tick={CYAN} first />

            <Stack gap={2} px={8}>
              <NavItem to="/" end label={t('sidebar.home')} icon={<NavHomeIcon />} />
              <NavItem
                to="/users"
                label={t('sidebar.users')}
                icon={<NavUsersIcon />}
                count={userCount}
              />
              <NavItem
                to="/squads"
                label={t('sidebar.squads')}
                icon={<IconUsersGroup size={16} stroke={1.6} />}
                count={squadCount}
              />
              <NavItem
                to="/profiles"
                label={t('sidebar.profiles')}
                icon={<NavProfilesIcon />}
                count={profileCount}
              />
              <NavItem
                to="/hosts"
                label={t('sidebar.hosts')}
                icon={<NavHostsIcon />}
                count={hostCount}
              />

              {/* Nodes opens instead of navigating: the inventory now has three
                  views under it, and the row that owns them shouldn't quietly
                  be one of them. The first child is the plain node list. */}
              <UnstyledButton
                onClick={() => setNodesOpen((v) => !v)}
                aria-expanded={nodesOpen}
                style={{ display: 'block', width: '100%' }}
              >
                <Box
                  style={navRowStyle(nodesSectionActive)}
                  onMouseEnter={(e) => hoverOn(e, nodesSectionActive)}
                  onMouseLeave={(e) => hoverOff(e, nodesSectionActive)}
                >
                  <Box style={{ color: nodesSectionActive ? CYAN : MIST, display: 'flex' }}>
                    <NavNodesIcon />
                  </Box>
                  <span style={{ flex: 1, textAlign: 'left' }}>{t('sidebar.nodes')}</span>
                  <NavCount
                    count={
                      nodesTotal !== undefined && nodesOnline !== undefined
                        ? `${nodesOnline}/${nodesTotal}`
                        : nodesTotal
                    }
                    // LOW: green dot reflects ONLINE nodes, not just "nodes
                    // exist". With 0 online the dot was misleadingly green.
                    countDot={nodesOnline !== undefined && nodesOnline > 0}
                  />
                  <Box
                    style={{
                      display: 'flex',
                      color: MIST,
                      transform: nodesOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                      transition: 'transform 140ms',
                    }}
                  >
                    <NavChevronIcon />
                  </Box>
                </Box>
              </UnstyledButton>

              {nodesOpen && (
                <Stack gap={1} pt={2} pb={6}>
                  <SubNavItem
                    to="/nodes"
                    label={t('sidebar.nodes')}
                    icon={<NavNodesIcon size={14} />}
                    count={nodesTotal}
                  />
                  <SubNavItem
                    to="/cascades"
                    label={t('sidebar.cascades')}
                    icon={<NavCascadesIcon size={14} />}
                  />
                  <SubNavItem
                    label={t('sidebar.infraBilling')}
                    icon={<NavBillingIcon size={14} />}
                    placeholder
                    placeholderTitle={notWired}
                  />
                </Stack>
              )}
            </Stack>

            {/* Subscription group: everything that shapes the client-facing
                subscription URL. "Settings" is the umbrella that holds the
                response headers, the per-status notes and the delivery
                behaviour; metadata is one tab inside it, not a sibling. */}
            <GroupHeader label={t('sidebar.subscriptionGroup')} tick={VIOLET} />
            <Stack gap={2} px={8}>
              <NavItem
                to="/subscription/metadata"
                label={t('sidebar.settings')}
                icon={<NavSlidersIcon />}
              />
              <NavItem
                label={t('sidebar.subscriptionTemplate')}
                icon={<NavTemplateIcon />}
                placeholder
                placeholderTitle={notWired}
              />
              <NavItem
                label={t('sidebar.subscriptionRoutes')}
                icon={<NavRoutesIcon />}
                placeholder
                placeholderTitle={notWired}
              />
              <NavItem
                label={t('sidebar.subscribePage')}
                icon={<NavSubscribePageIcon />}
                placeholder
                placeholderTitle={notWired}
              />
            </Stack>

            {/* Traffic group: everything that answers "where does this packet
                go", plus what we cut. Policies is the rule list itself; the
                rest are the catalogues those rules point at. */}
            <GroupHeader label={t('sidebar.trafficGroup')} tick={MOSS} />
            <Stack gap={2} px={8}>
              <NavItem
                to="/subscription/routes"
                label={t('sidebar.policies')}
                icon={<NavPoliciesIcon />}
              />
              <NavItem
                label={t('sidebar.torrentBlocker')}
                icon={<NavBlockIcon />}
                placeholder
                placeholderTitle={notWired}
              />
              <NavItem
                label={t('sidebar.ruleSets')}
                icon={<NavRuleSetsIcon />}
                placeholder
                placeholderTitle={notWired}
              />
              <NavItem
                label={t('sidebar.egress')}
                icon={<NavEgressIcon />}
                placeholder
                placeholderTitle={notWired}
              />
              <NavItem
                label={t('sidebar.dns')}
                icon={<NavDnsIcon />}
                placeholder
                placeholderTitle={notWired}
              />
            </Stack>

            {/* Tools group: read-only instruments an operator reaches for when
                something looks wrong, not things they configure. */}
            <GroupHeader label={t('sidebar.toolsGroup')} tick={AMBER} />
            <Stack gap={2} px={8}>
              <NavItem
                label={t('sidebar.hwidInspector')}
                icon={<NavHwidIcon />}
                placeholder
                placeholderTitle={notWired}
              />
              <NavItem
                label={t('sidebar.srhInspector')}
                icon={<NavSearchIcon />}
                placeholder
                placeholderTitle={notWired}
              />
              <NavItem
                label={t('sidebar.torrentBlockerReports')}
                icon={<NavShieldIcon />}
                placeholder
                placeholderTitle={notWired}
              />
              <NavItem
                label={t('sidebar.sessionExplorer')}
                icon={<NavSessionIcon />}
                placeholder
                placeholderTitle={notWired}
              />
              <NavItem
                label={t('sidebar.httpStats')}
                icon={<NavHttpStatsIcon />}
                placeholder
                placeholderTitle={notWired}
              />
              <NavItem href="/admin/queues" label={t('sidebar.queues')} icon={<NavQueuesIcon />} />
            </Stack>
          </Stack>

          {/* Bottom: settings + sign out */}
          <Stack
            gap={2}
            px={8}
            pb={4}
            pt={12}
            mt={8}
            style={{ borderTop: `1px dashed ${HAIRLINE}` }}
          >
            <NavItem to="/settings" label={t('sidebar.settings')} icon={<NavSettingsIcon />} />
            <UnstyledButton
              onClick={handleLogout}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 12px',
                borderRadius: 8,
                color: MIST,
                fontFamily: DISPLAY,
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
              <NavLogoutIcon />
              <span>{t('sidebar.logout')}</span>
            </UnstyledButton>
          </Stack>
        </Box>
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
