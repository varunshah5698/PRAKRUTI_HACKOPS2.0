import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Bell,
  BellRing,
  BrainCircuit,
  ChevronDown,
  CloudSun,
  Database,
  FileWarning,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  Plus,
  Scale,
  Settings,
  ShieldAlert,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { Logo } from './Logo';
import { Badge } from './ui';
import { useAuth } from '../store/auth';
import { classNames } from '../lib/format';

const AUTHORITY_ROLES = ['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN', 'SYSTEM_ADMIN'];

const groups: Array<{
  label: string;
  items: Array<{ to: string; label: string; short: string; icon: typeof LayoutDashboard; roles?: string[]; end?: boolean }>;
}> = [
  {
    label: 'Command',
    items: [
      { to: '/dashboard', label: 'Command centre', short: 'Home', icon: LayoutDashboard, end: true },
      { to: '/map', label: 'Mumbai map', short: 'Map', icon: Map },
      { to: '/intelligence/predictions', label: 'Predictive intelligence', short: 'Predict', icon: BrainCircuit },
      { to: '/ai-analyst', label: 'AI analyst', short: 'Analyst', icon: Sparkles },
    ],
  },
  {
    label: 'Evidence',
    items: [
      { to: '/my-reports', label: 'My reports', short: 'Reports', icon: FileWarning, roles: ['PUBLIC'] },
      { to: '/reports', label: 'Citizen reports', short: 'Reports', icon: FileWarning, roles: AUTHORITY_ROLES },
      { to: '/alerts', label: 'Alerts', short: 'Alerts', icon: BellRing },
      { to: '/incidents', label: 'Incidents', short: 'Incidents', icon: ShieldAlert },
      { to: '/compliance', label: 'Compliance', short: 'Policy', icon: Scale },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/notifications', label: 'Notifications', short: 'Notify', icon: Bell },
      { to: '/simulation', label: 'Simulation & replay', short: 'Simulate', icon: FlaskConical, roles: AUTHORITY_ROLES },
      { to: '/data-sources', label: 'Data sources', short: 'Sources', icon: Database },
    ],
  },
];

const titles: Array<[string, string]> = [
  ['/dashboard', 'Environmental command centre'],
  ['/map', 'Live environmental intelligence map'],
  ['/intelligence/predictions', 'Predictive environmental intelligence'],
  ['/ai-analyst', 'AI environmental analyst'],
  ['/my-reports', 'Your reports & authority responses'],
  ['/reports', 'Citizen reports & evidence'],
  ['/alerts', 'Environmental alerts'],
  ['/incidents', 'Incident & compliance centre'],
  ['/compliance', 'Regulatory intelligence'],
  ['/notifications', 'Notifications'],
  ['/simulation', 'Simulation & historical replay'],
  ['/data-sources', 'Data sources & ingestion'],
  ['/settings', 'Settings'],
  ['/profile', 'Profile'],
];

export function AppShell({ children }: { children?: React.ReactNode } = {}) {
  const { user, logout, isAuthority } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [now, setNow] = useState(new Date());
  const location = useLocation();
  const navigate = useNavigate();
  const title = titles.find(([path]) => location.pathname.startsWith(path))?.[1] ?? 'प्रकृति';

  useEffect(() => {
    setMobileOpen(false);
    setUserMenu(false);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const visibleGroups = groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || (user && item.roles.includes(user.role))),
  }));

  const iconRail = (
    <div className="flex h-full flex-col">
      <div className="flex h-[88px] shrink-0 items-center justify-center">
        <Logo compact />
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <Link
          to="/report"
          title="Submit a field report"
          className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-[#b3df7c] bg-[#d3f8a1] text-[#25461c] shadow-pill transition hover:bg-[#c7f28b]"
        >
          <Plus className="h-4 w-4" />
          <span className="sr-only">Submit a field report</span>
        </Link>
        {visibleGroups.map((group) => (
          <div key={group.label} className="mb-3 border-t border-white/70 pt-3 first:border-0 first:pt-0">
            <p className="mb-1 text-center text-[8px] font-semibold uppercase tracking-[0.2em] text-[#8a988e]">{group.label}</p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={`${item.to}-${item.label}`}
                    to={item.to}
                    end={item.end}
                    title={item.label}
                    className={({ isActive }) =>
                      classNames(
                        'group flex w-full flex-col items-center gap-1 rounded-2xl px-1 py-2 transition',
                        isActive
                          ? 'bg-[#e4f5d8] text-[#2f6a24]'
                          : 'text-[#5f7065] hover:bg-white/70 hover:text-[#142016]',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={classNames(
                            'flex h-8 w-8 items-center justify-center rounded-full transition',
                            isActive ? 'bg-[#4e9b3f] text-white shadow-[0_8px_18px_-8px_rgba(45,94,34,.8)]' : 'bg-transparent',
                          )}
                        >
                          <Icon className="h-[17px] w-[17px]" />
                        </span>
                        <span className="max-w-full truncate text-[8.5px] font-semibold leading-none tracking-[0.01em]">{item.short}</span>
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-white/70 p-2">
        <Link to="/settings" title="Settings" className="flex h-11 items-center justify-center rounded-2xl text-[#5f7065] transition hover:bg-white/70 hover:text-[#142016]">
          <Settings className="h-[17px] w-[17px]" />
          <span className="sr-only">Settings</span>
        </Link>
        <Link to="/profile" title={user?.name ?? 'Profile'} className="flex h-11 items-center justify-center">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/80 bg-[#4e9b3f] text-[11px] font-bold text-white shadow-pill">
            {user?.name?.slice(0, 1).toUpperCase() ?? 'U'}
          </span>
          <span className="sr-only">Profile</span>
        </Link>
        <button onClick={handleLogout} title="Sign out" className="flex h-11 w-full items-center justify-center rounded-2xl text-[#a05a5e] transition hover:bg-[#fdeeee] hover:text-[#8f343a]">
          <LogOut className="h-[17px] w-[17px]" />
          <span className="sr-only">Sign out</span>
        </button>
      </div>
    </div>
  );

  const mobileNav = (
    <div className="flex h-full flex-col bg-[#f8fbf5] backdrop-blur-2xl">
      <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-dashed border-[#dbe5d6] px-5">
        <Logo />
        <button onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="flex h-9 w-9 items-center justify-center rounded-full border border-white/80 bg-white/70 text-[#5f7065]">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4">
        <Link
          to="/report"
          className="mb-4 flex items-center justify-between rounded-2xl border border-[#b3df7c] bg-[#e9fbd3] px-4 py-3 text-xs font-semibold text-[#2f5f20]"
        >
          Submit a field report
          <Plus className="h-4 w-4" />
        </Link>
        {visibleGroups.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="mb-1.5 px-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-[#8a988e]">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={`${item.to}-${item.label}`}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      classNames(
                        'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[12.5px] font-medium transition',
                        isActive
                          ? 'bg-[#e4f5d8] text-[#2f6a24]'
                          : 'text-[#5f7065] hover:bg-white/75 hover:text-[#142016]',
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-dashed border-[#dbe5d6] p-4">
        <div className="flex items-center gap-2.5 rounded-2xl border border-white/80 bg-white/60 p-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4e9b3f] text-[11px] font-bold text-white">
            {user?.name?.slice(0, 1).toUpperCase() ?? 'U'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-[#142016]">{user?.name}</p>
            <p className="truncate text-[9px] uppercase tracking-[0.08em] text-[#74847a]">{user?.role.replace(/_/g, ' ')}</p>
          </div>
          <button onClick={handleLogout} aria-label="Sign out" className="rounded-full p-1.5 text-[#a05a5e] hover:bg-[#fdeeee]">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="dashboard-root relative flex h-[100dvh] flex-col overflow-hidden lg:p-7 xl:p-12">
      <div className="app-sky" aria-hidden />
      <div className="app-frame relative z-10 flex min-h-0 flex-1 overflow-hidden lg:rounded-[34px]">
        <aside className="hidden w-[94px] shrink-0 flex-col border-r border-white/70 bg-white/25 backdrop-blur-xl lg:flex">
          {iconRail}
        </aside>

        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-[#15251a]/30 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-[290px] shadow-2xl">{mobileNav}</div>
          </div>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="relative z-20 shrink-0 px-3 pt-3 lg:px-5 lg:pt-4">
            <div className="flex items-center gap-2 rounded-[22px] border border-white/85 bg-white/55 px-2.5 py-2 shadow-pill backdrop-blur-xl">
              <button className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#5f7065] hover:bg-white/70 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
                <Menu className="h-5 w-5" />
              </button>
              <div className="flex min-w-0 items-center gap-2.5 rounded-full border border-white/80 bg-white/65 px-3 py-1.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#e4f5d8] text-[#3f7d2a]">
                  <Activity className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[11.5px] font-semibold leading-tight text-[#223328]">{title}</p>
                  <p className="hidden text-[8px] font-semibold uppercase tracking-[0.16em] text-[#8a988e] sm:block">Greater Mumbai · Asia/Kolkata</p>
                </div>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <div className="hidden items-center gap-2 rounded-full border border-white/80 bg-white/65 px-3 py-2 md:flex">
                  <CloudSun className="h-4 w-4 text-[#c49a1c]" />
                  <span className="text-[10px] font-semibold text-[#223328]">Mumbai</span>
                  <span className="text-[10px] text-[#74847a]">
                    {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                  </span>
                </div>
                <Badge tone="lime" dot className="hidden xl:inline-flex">
                  Demo data
                </Badge>
                <Link
                  to="/notifications"
                  className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white/80 bg-white/65 text-[#5f7065] transition hover:bg-white hover:text-[#142016]"
                  aria-label="Notifications"
                >
                  <Bell className="h-4 w-4" />
                </Link>
                <div className="relative">
                  <button
                    onClick={() => setUserMenu((v) => !v)}
                    className="flex items-center gap-1.5 rounded-full border border-white/80 bg-white/65 py-1 pl-1 pr-2 text-[#3f5045] transition hover:bg-white"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#4e9b3f] text-[10px] font-bold text-white">
                      {user?.name?.slice(0, 1).toUpperCase() ?? 'U'}
                    </span>
                    <span className="hidden max-w-[110px] truncate text-[10px] font-semibold md:block">{user?.name?.split(' ')[0]}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-[#74847a]" />
                  </button>
                  {userMenu ? (
                    <div className="absolute right-0 top-12 z-30 w-60 rounded-[20px] border border-white/85 bg-[#fbfdf9] p-1.5 shadow-2xl backdrop-blur-2xl">
                      <div className="px-3 py-2">
                        <p className="text-xs font-semibold text-[#142016]">{user?.name}</p>
                        <p className="truncate text-[10px] text-[#74847a]">{user?.email}</p>
                        {user?.department ? <p className="mt-1 text-[10px] text-[#5d6e63]">{user.department}</p> : null}
                      </div>
                      <div className="my-1 h-px bg-[#e8eee4]" />
                      <Link to="/profile" className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-[#5d6e63] hover:bg-[#edf4e9] hover:text-[#142016]">
                        <UserRound className="h-3.5 w-3.5" /> Profile
                      </Link>
                      <Link to="/settings" className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-[#5d6e63] hover:bg-[#edf4e9] hover:text-[#142016]">
                        <Settings className="h-3.5 w-3.5" /> Settings
                      </Link>
                      {isAuthority() ? (
                        <Link to="/simulation" className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-[#5d6e63] hover:bg-[#edf4e9] hover:text-[#142016]">
                          <FlaskConical className="h-3.5 w-3.5" /> Simulation
                        </Link>
                      ) : null}
                      <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-[#a05a5e] hover:bg-[#fdeeee]"
                      >
                        <LogOut className="h-3.5 w-3.5" /> Sign out
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </header>

          <main className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-5 pt-3 lg:px-5 lg:pb-6 lg:pt-4">
            {children ?? <Outlet />}
          </main>
        </div>
      </div>
    </div>
  );
}
