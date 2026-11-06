import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './store/auth';
import { AppShell } from './components/AppShell';
import { LandingPage } from './pages/public/LandingPage';
import { AboutPage } from './pages/public/AboutPage';
import { DataSourcesPage as PublicDataSourcesPage } from './pages/public/DataSourcesPage';
import { StatusPage } from './pages/public/StatusPage';
import { PrivacyPage, TermsPage } from './pages/public/PrivacyTerms';
import { PublicReportPage } from './pages/public/PublicReportPage';
import { LoginPage } from './pages/public/LoginPage';
import { CitizenLoginPage } from './pages/public/CitizenLoginPage';
import { CitizenOnboardingPage } from './pages/public/CitizenOnboardingPage';
import { RegisterPage } from './pages/public/RegisterPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/public/PasswordPages';
import { Logo } from './components/Logo';

const DashboardPage = lazy(() => import('./pages/app/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const CitizenDashboardPage = lazy(() => import('./pages/app/CitizenDashboardPage').then((m) => ({ default: m.CitizenDashboardPage })));
const AtmospherePage = lazy(() => import('./pages/app/AtmospherePage').then((m) => ({ default: m.AtmospherePage })));
const MapPage = lazy(() => import('./pages/app/MapPage').then((m) => ({ default: m.MapPage })));
const CityPulsePage = lazy(() => import('./pages/app/CityPulsePage').then((m) => ({ default: m.CityPulsePage })));
const NewsPage = lazy(() => import('./pages/app/NewsPage').then((m) => ({ default: m.NewsPage })));
const PredictionsPage = lazy(() => import('./pages/app/PredictionsPage').then((m) => ({ default: m.PredictionsPage })));
const AiAnalystPage = lazy(() => import('./pages/app/AiAnalystPage').then((m) => ({ default: m.AiAnalystPage })));
const ReportsPage = lazy(() => import('./pages/app/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const MyReportsPage = lazy(() => import('./pages/app/MyReportsPage').then((m) => ({ default: m.MyReportsPage })));
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
const AuthorityPage = lazy(() => import('./pages/app/AuthorityPage').then((m) => ({ default: m.AuthorityPage })));
const AuthorityAdminPage = lazy(() => import('./pages/app/AuthorityAdminPage').then((m) => ({ default: m.AuthorityAdminPage })));
const SourcesPage = lazy(() => import('./pages/app/SourcesPage').then((m) => ({ default: m.SourcesPage })));
const SettingsPage = lazy(() => import('./pages/app/SettingsPages').then((m) => ({ default: m.SettingsPage })));
const ProfilePage = lazy(() => import('./pages/app/SettingsPages').then((m) => ({ default: m.ProfilePage })));

function Splash() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-4 overflow-hidden bg-[#eef3ec]">
      <div className="app-sky" aria-hidden />
      <div className="relative flex flex-col items-center gap-4">
        <Logo />
        <Loader2 className="h-5 w-5 animate-spin text-[#4e9b3f]" />
        <p className="text-[10px] uppercase tracking-[0.16em] text-[#74847a]">Loading session</p>
      </div>
    </div>
  );
}

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname, hash]);
  return null;
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

function CitizenProtected({ children }: { children: React.ReactNode }) {
  const { user, initialized } = useAuth();
  if (!initialized) return <Splash />;
  if (!user) return <Navigate to="/citizen/login" replace />;
  if (user.role !== 'PUBLIC') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AccessGate({ access, children }: { access: 'authority' | 'citizen'; children: React.ReactNode }) {
  const { user, isAuthority } = useAuth();
  const allowed = access === 'authority' ? isAuthority() : user?.role === 'PUBLIC';
  if (!allowed) return <Navigate to={access === 'authority' ? '/dashboard' : '/reports'} replace />;
  return <>{children}</>;
}

function SystemAdminGate({ children }: { children: React.ReactNode }) {
  const { user, initialized } = useAuth();
  if (!initialized) return <Splash />;
  if (user?.role !== 'SYSTEM_ADMIN') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AuthorityDeskRoute() {
  const { user, initialized } = useAuth();
  if (!initialized) return <Splash />;
  if (user?.role === 'SYSTEM_ADMIN') return <Navigate to="/authority/admin" replace />;
  return (
    <AccessGate access="authority">
      <AuthorityPage />
    </AccessGate>
  );
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
    <>
      <ScrollToTop />
      <Suspense fallback={<Splash />}>
        <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/report" element={<PublicReportPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/citizen/login" element={<CitizenLoginPage />} />
      <Route path="/citizen/onboarding" element={<CitizenProtected><CitizenOnboardingPage /></CitizenProtected>} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/data-sources" element={<DataSourcesRoute />} />
      <Route path="/status" element={<StatusPage />} />

      <Route path="/dashboard" element={<Protected><AppShell /></Protected>}>
        <Route index element={<DashboardPage />} />
      </Route>
      <Route path="/citizen/dashboard" element={<CitizenProtected><AppShell /></CitizenProtected>}>
        <Route index element={<CitizenDashboardPage />} />
      </Route>
      <Route element={<Protected><AppShell /></Protected>}>
        <Route path="/atmosphere" element={<AccessGate access="authority"><AtmospherePage /></AccessGate>} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/city" element={<CityPulsePage />} />
        <Route path="/news" element={<NewsPage />} />
        <Route path="/map/stations/:stationId" element={<StationRoute />} />
        <Route path="/intelligence/predictions" element={<AccessGate access="authority"><PredictionsPage /></AccessGate>} />
        <Route path="/ai-analyst" element={<AccessGate access="authority"><AiAnalystPage /></AccessGate>} />
        <Route path="/reports" element={<AccessGate access="authority"><ReportsPage /></AccessGate>} />
        <Route path="/my-reports" element={<AccessGate access="citizen"><MyReportsPage /></AccessGate>} />
        <Route path="/reports/:reportId" element={<AccessGate access="authority"><ReportDetailPage /></AccessGate>} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/alerts/:alertId" element={<AlertDetailPage />} />
        <Route path="/incidents" element={<AccessGate access="authority"><IncidentsPage /></AccessGate>} />
        <Route path="/incidents/:incidentId" element={<AccessGate access="authority"><IncidentDetailPage /></AccessGate>} />
        <Route path="/compliance" element={<AccessGate access="authority"><CompliancePage /></AccessGate>} />
        <Route path="/compliance/documents" element={<AccessGate access="authority"><ComplianceDocumentsPage /></AccessGate>} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/authority" element={<AuthorityDeskRoute />} />
        <Route path="/authority/admin" element={<SystemAdminGate><AuthorityAdminPage /></SystemAdminGate>} />
        <Route path="/simulation" element={<AccessGate access="authority"><SimulationPage /></AccessGate>} />
        <Route path="/simulation/:sessionId" element={<AccessGate access="authority"><SimulationSessionPage /></AccessGate>} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
      </Suspense>
    </>
  );
}
