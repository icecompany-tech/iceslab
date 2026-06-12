import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';

// F4 - the authenticated pages are code-split so the login bundle no longer
// pulls the entire app graph (Mantine tables, charts, every modal). Each page
// becomes its own chunk loaded on first navigation; AppLayout's Suspense
// boundary shows a loader in the content area while a chunk streams in.
// Named exports → map to `default` for React.lazy.
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const InsightsPage = lazy(() =>
  import('./pages/InsightsPage').then((m) => ({ default: m.InsightsPage })),
);
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const NodesPage = lazy(() => import('./pages/NodesPage').then((m) => ({ default: m.NodesPage })));
const SrrPage = lazy(() => import('./pages/SrrPage').then((m) => ({ default: m.SrrPage })));
const ProfilesPage = lazy(() =>
  import('./pages/ProfilesPage').then((m) => ({ default: m.ProfilesPage })),
);
const SquadsPage = lazy(() => import('./pages/SquadsPage').then((m) => ({ default: m.SquadsPage })));
const CascadesPage = lazy(() =>
  import('./pages/CascadesPage').then((m) => ({ default: m.CascadesPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const SubscriptionMetadataPage = lazy(() =>
  import('./pages/SubscriptionMetadataPage').then((m) => ({ default: m.SubscriptionMetadataPage })),
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
          <Route path="/cascades" element={<CascadesPage />} />
          <Route path="/profiles" element={<ProfilesPage />} />
          {/* Slice 27, /inbounds replaced by /profiles. Keep redirect so
              existing bookmarks don't 404. */}
          <Route path="/inbounds" element={<Navigate to="/profiles" replace />} />
          <Route path="/squads" element={<SquadsPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/subscription/metadata" element={<SubscriptionMetadataPage />} />
          <Route path="/subscription/routing" element={<SrrPage />} />
          {/* Pre-v0.1.1 the routing-rules page lived at /srr (jargon). Keep
              the redirect so any bookmark from the alpha still works. */}
          <Route path="/srr" element={<Navigate to="/subscription/routing" replace />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
