import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './store/auth';
import { AppShell } from './components/AppShell';
import { LandingPage } from './pages/public/LandingPage';
import { AboutPage } from './pages/public/AboutPage';
import { DataSourcesPage as PublicDataSourcesPage } from './pages/public/DataSourcesPage';
import { PrivacyPage, TermsPage } from './pages/public/PrivacyTerms';
import { PublicReportPage } from './pages/public/PublicReportPage';
import { LoginPage } from './pages/public/LoginPage';
import { RegisterPage } from './pages/public/RegisterPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/public/PasswordPages';
import { Logo } from './components/Logo';

const DashboardPage = lazy(() => import('./pages/app/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const MapPage = lazy(() => import('./pages/app/MapPage').then((m) => ({ default: m.MapPage })));
const PredictionsPage = lazy(() => import('./pages/app/PredictionsPage').then((m) => ({ default: m.PredictionsPage })));
const AiAnalystPage = lazy(() => import('./pages/app/AiAnalystPage').then((m) => ({ default: m.AiAnalystPage })));
const ReportsPage = lazy(() => import('./pages/app/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const ReportDetailPage = lazy(() => import('./pages/app/ReportDetailPage').then((m) => ({ default: m.ReportDetailPage })));
const AlertsPage = lazy(() => import('./pages/app/AlertsPage').then((m) => ({ default: m.AlertsPage })));
const AlertDetailPage = lazy(() => import('./pages/app/AlertsPage').then((m) => ({ default: m.AlertDetailPage })));
const IncidentsPage = lazy(() => import('./pages/app/IncidentsPage').then((m) => ({ default: m.IncidentsPage })));
const IncidentDetailPage = lazy(() => import('./pages/app/IncidentsPage').then((m) => ({ default: m.IncidentDetailPage })));
const CompliancePage = lazy(() => import('./pages/app/CompliancePages').then((m) => ({ default: m.CompliancePage })));
const ComplianceDocumentsPage = lazy(() => import('./pages/app/CompliancePages').then((m) => ({ default: m.ComplianceDocumentsPage })));
const NotificationsPage = lazy(() => import('./pages/app/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const SimulationPage = lazy(() => import('./pages/app/SimulationPages').then((m) => ({ default: m.SimulationPage })));
const SimulationSessionPage = lazy(() => import('./pages/app/SimulationPages').then((m) => ({ default: m.SimulationSessionPage })));
const SourcesPage = lazy(() => import('./pages/app/SourcesPage').then((m) => ({ default: m.SourcesPage })));
const SettingsPage = lazy(() => import('./pages/app/SettingsPages').then((m) => ({ default: m.SettingsPage })));
const ProfilePage = lazy(() => import('./pages/app/SettingsPages').then((m) => ({ default: m.ProfilePage })));

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#101317]">
      <Logo dark />
      <Loader2 className="h-5 w-5 animate-spin text-[#b5e36b]" />
      <p className="text-[10px] uppercase tracking-[0.16em] text-[#6f7c89]">Loading session</p>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, initialized } = useAuth();
  if (!initialized) return <Splash />;
  if (!user) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

function StationRoute() {
  const { stationId } = useParams();
  return <Navigate to={`/map?station=${stationId}`} replace />;
}

function DataSourcesRoute() {
  const { user, initialized } = useAuth();
  if (!initialized) return <Splash />;
  if (user) {
    return (
      <AppShell>
        <SourcesPage />
      </AppShell>
    );
  }
  return <PublicDataSourcesPage />;
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper px-5 text-center">
      <p className="display text-[72px] font-bold leading-none text-ink/15">404</p>
      <h1 className="display text-2xl font-bold">This route is outside the map.</h1>
      <p className="max-w-md text-sm text-ink/50">The page you requested does not exist. Return to the command centre or the public site.</p>
      <div className="flex gap-2">
        <a href="/" className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white">Home</a>
        <a href="/dashboard" className="rounded-xl border border-ink/20 px-4 py-2 text-sm font-semibold">Dashboard</a>
      </div>
    </div>
  );
}

export default function App() {
  const loadMe = useAuth((state) => state.loadMe);
  useEffect(() => {
    loadMe();
  }, [loadMe]);

  return (
    <Suspense fallback={<Splash />}>
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/report" element={<PublicReportPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/data-sources" element={<DataSourcesRoute />} />

      <Route path="/dashboard" element={<Protected><AppShell /></Protected>}>
        <Route index element={<DashboardPage />} />
      </Route>
      <Route element={<Protected><AppShell /></Protected>}>
        <Route path="/map" element={<MapPage />} />
        <Route path="/map/stations/:stationId" element={<StationRoute />} />
        <Route path="/intelligence/predictions" element={<PredictionsPage />} />
        <Route path="/ai-analyst" element={<AiAnalystPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/:reportId" element={<ReportDetailPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/alerts/:alertId" element={<AlertDetailPage />} />
        <Route path="/incidents" element={<IncidentsPage />} />
        <Route path="/incidents/:incidentId" element={<IncidentDetailPage />} />
        <Route path="/compliance" element={<CompliancePage />} />
        <Route path="/compliance/documents" element={<ComplianceDocumentsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/simulation" element={<SimulationPage />} />
        <Route path="/simulation/:sessionId" element={<SimulationSessionPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  );
}
