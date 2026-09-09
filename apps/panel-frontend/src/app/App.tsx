import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/app/components/AppLayout';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import { LoginPage } from '@/contours/login/screens/LoginPage';

// F4 - the authenticated pages are code-split so the login bundle no longer
// pulls the entire app graph (Mantine tables, charts, every modal). Each page
// becomes its own chunk loaded on first navigation; AppLayout's Suspense
// boundary shows a loader in the content area while a chunk streams in.
// Named exports → map to `default` for React.lazy.
const DashboardPage = lazy(() =>
  import('@/contours/dashboard/screens/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const InsightsPage = lazy(() =>
  import('@/contours/dashboard/screens/InsightsPage').then((m) => ({ default: m.InsightsPage })),
);
const UsersPage = lazy(() => import('@/contours/users/screens/UsersPage').then((m) => ({ default: m.UsersPage })));
const NodesPage = lazy(() => import('@/contours/nodes/screens/NodesPage').then((m) => ({ default: m.NodesPage })));
const SrrPage = lazy(() => import('@/contours/subscription/screens/SrrPage').then((m) => ({ default: m.SrrPage })));
const ProfilesPage = lazy(() =>
  import('@/contours/profiles/screens/ProfilesPage').then((m) => ({ default: m.ProfilesPage })),
);
const ProfileEditPage = lazy(() =>
  import('@/contours/profiles/screens/ProfileEditPage').then((m) => ({ default: m.ProfileEditPage })),
);
const NodeCreatePage = lazy(() =>
  import('@/contours/nodes/screens/NodeCreatePage').then((m) => ({ default: m.NodeCreatePage })),
);
const NodeEditPage = lazy(() =>
  import('@/contours/nodes/screens/NodeEditPage').then((m) => ({ default: m.NodeEditPage })),
);
const CascadeCreatePage = lazy(() =>
  import('@/contours/cascades/screens/CascadeCreatePage').then((m) => ({ default: m.CascadeCreatePage })),
);
const CascadeEditPage = lazy(() =>
  import('@/contours/cascades/screens/CascadeEditPage').then((m) => ({ default: m.CascadeEditPage })),
);
const SquadsPage = lazy(() => import('@/contours/squads/screens/SquadsPage').then((m) => ({ default: m.SquadsPage })));
const SquadEditPage = lazy(() =>
  import('@/contours/squads/screens/SquadEditPage').then((m) => ({ default: m.SquadEditPage })),
);
const HostsPage = lazy(() => import('@/contours/hosts/screens/HostsPage').then((m) => ({ default: m.HostsPage })));
const HostEditPage = lazy(() =>
  import('@/contours/hosts/screens/HostEditPage').then((m) => ({ default: m.HostEditPage })),
);
const RoutesPage = lazy(() => import('@/contours/traffic/screens/RoutesPage').then((m) => ({ default: m.RoutesPage })));
const SrrRulePage = lazy(() =>
  import('@/contours/subscription/screens/SrrRulePage').then((m) => ({ default: m.SrrRulePage })),
);
const SettingsPage = lazy(() =>
  import('@/contours/settings/screens/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const SubscriptionMetadataPage = lazy(() =>
  import('@/contours/subscription/screens/SubscriptionMetadataPage').then((m) => ({ default: m.SubscriptionMetadataPage })),
);

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/nodes" element={<NodesPage />} />
          {/* Registering a machine is a three-step sequence, so it gets the
              page instead of a dialog that scrolls inside itself. */}
          <Route path="/nodes/new" element={<NodeCreatePage />} />
          {/* Building a chain means picking machines and seeing the path they
              form, so it gets the page. Nested under /nodes because cascades
              are a view of the same inventory, which the crumb then says. */}
          <Route path="/nodes/cascades/new" element={<CascadeCreatePage />} />
          <Route path="/nodes/cascades/:id" element={<CascadeEditPage />} />
          {/* A node carries parameters, egress and its hosts; that is a page
              with tabs, not a dialog. */}
          <Route path="/nodes/:id" element={<NodeEditPage />} />
          {/* Cascades merged into the Nodes page (a sub-view). Keep the path as
              a redirect so existing bookmarks/links don't 404. */}
          <Route path="/cascades" element={<Navigate to="/nodes" replace />} />
          <Route path="/profiles" element={<ProfilesPage />} />
          {/* A profile is a template with a dozen protocol decisions in it, so
              editing one gets the page rather than a dialog. */}
          <Route path="/profiles/:id" element={<ProfileEditPage />} />
          {/* Slice 27, /inbounds replaced by /profiles. Keep redirect so
              existing bookmarks don't 404. */}
          <Route path="/inbounds" element={<Navigate to="/profiles" replace />} />
          <Route path="/squads" element={<SquadsPage />} />
          {/* A squad decides what a whole group reaches, so editing one is a
              page with room for consequences, not a modal. */}
          <Route path="/squads/:id" element={<SquadEditPage />} />
          {/* Hosts are the line a user reads in their client, so they get a
              page of their own instead of living under a profile's binding. */}
          <Route path="/hosts" element={<HostsPage />} />
          <Route path="/hosts/:id" element={<HostEditPage />} />
          <Route path="/subscription/routes" element={<RoutesPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/subscription/metadata" element={<SubscriptionMetadataPage />} />
          {/* "Delivery": the page decides which config FORMAT a client gets by
              its User-Agent, it never decides where traffic goes. It held the
              name "Routing" while nothing else claimed it, which made every
              conversation about routes land on the wrong page. */}
          <Route path="/subscription/delivery" element={<SrrPage />} />
          {/* A delivery rule is a regex plus the format it hands back; both
              want testing against a real User-Agent before they are saved, so
              writing one gets the page rather than a dialog. */}
          <Route path="/subscription/delivery/new" element={<SrrRulePage />} />
          <Route path="/subscription/delivery/:id" element={<SrrRulePage />} />
          <Route
            path="/subscription/routing"
            element={<Navigate to="/subscription/delivery" replace />}
          />
          {/* Pre-v0.1.1 the rules page lived at /srr (jargon). Keep the
              redirect so any bookmark from the alpha still works. */}
          <Route path="/srr" element={<Navigate to="/subscription/delivery" replace />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
