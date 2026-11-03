import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  BellRing,
  BrainCircuit,
  ChevronDown,
  Database,
  FileWarning,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  Scale,
  Settings,
  ShieldAlert,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { Logo } from './Logo';
import { DemoBanner } from './DemoBanner';
import { Badge, Button } from './ui';
import { useAuth } from '../store/auth';
import { classNames } from '../lib/format';

const groups: Array<{
  label: string;
  items: Array<{ to: string; label: string; icon: typeof LayoutDashboard; roles?: string[]; end?: boolean }>;
}> = [
  {
    label: 'Command',
    items: [
      { to: '/dashboard', label: 'Command centre', icon: LayoutDashboard },
      { to: '/map', label: 'Mumbai map', icon: Map },
      { to: '/intelligence/predictions', label: 'Predictive intelligence', icon: BrainCircuit },
      { to: '/ai-analyst', label: 'AI analyst', icon: Sparkles },
    ],
  },
  {
    label: 'Evidence',
    items: [
      { to: '/reports', label: 'Citizen reports', icon: FileWarning },
      { to: '/alerts', label: 'Alerts', icon: BellRing },
      { to: '/incidents', label: 'Incidents', icon: ShieldAlert },
      { to: '/compliance', label: 'Compliance', icon: Scale },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/notifications', label: 'Notifications', icon: Bell },
      { to: '/simulation', label: 'Simulation & replay', icon: FlaskConical, roles: ['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN', 'SYSTEM_ADMIN'] },
      { to: '/data-sources', label: 'Data sources', icon: Database },
    ],
  },
];

const titles: Array<[string, string]> = [
  ['/dashboard', 'Environmental command centre'],
  ['/map', 'Live environmental intelligence map'],
  ['/intelligence/predictions', 'Predictive environmental intelligence'],
  ['/ai-analyst', 'AI environmental analyst'],
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
  const location = useLocation();
  const navigate = useNavigate();
  const title = titles.find(([path]) => location.pathname.startsWith(path))?.[1] ?? 'प्रकृति';

  useEffect(() => {
    setMobileOpen(false);
    setUserMenu(false);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const sidebar = (
    <div className="flex h-full flex-col bg-[#14191f]">
      <div className="flex h-[68px] items-center justify-between border-b border-[#252d37] px-5">
        <Logo dark />
        <button className="lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
          <X className="h-5 w-5 text-[#8d99a6]" />
        </button>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4">
        <Link
          to="/report"
          className="mb-4 flex items-center justify-between rounded-xl border border-[#b5e36b]/20 bg-[#b5e36b]/[0.06] px-3 py-2.5 text-xs font-semibold text-[#d5f2a8] transition hover:bg-[#b5e36b]/10"
        >
          Submit a field report
          <span className="text-[10px] uppercase tracking-[0.1em] text-[#9fbf72]">Public</span>
        </Link>
        {groups.map((group) => {
          const items = group.items.filter((item) => !item.roles || (user && item.roles.includes(user.role)));
          if (!items.length) return null;
          return (
            <div key={group.label} className="mb-5">
              <p className="mb-1.5 px-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-[#5f6b78]">{group.label}</p>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        classNames(
                          'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] font-medium transition',
                          isActive
                            ? 'bg-[#29323d] text-[#f3f5f7] shadow-[inset_2px_0_0_#b5e36b]'
                            : 'text-[#95a1ae] hover:bg-[#1d242c] hover:text-[#e8edf2]',
                        )
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0 opacity-75" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-[#252d37] p-3">
        <div className="rounded-xl border border-[#303945] bg-[#181d23] p-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#b5e36b]/15 text-[11px] font-bold text-[#c8ef8d]">
              {user?.name?.slice(0, 1).toUpperCase() ?? 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-[#e8edf2]">{user?.name}</p>
              <p className="truncate text-[10px] text-[#788493]">{user?.role.replace(/_/g, ' ')}</p>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.1em] text-[#6f7c89]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#32a879]" /> Session active
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="dashboard-root min-h-screen">
      <div className="fixed inset-y-0 left-0 z-30 hidden w-[236px] border-r border-[#252d37] lg:block">{sidebar}</div>
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[280px] shadow-2xl">{sidebar}</div>
        </div>
      ) : null}

      <div className="lg:pl-[236px]">
        <header className="sticky top-0 z-20 border-b border-[#252d37] bg-[#101317]/92 backdrop-blur-xl">
          <div className="flex h-[64px] items-center gap-3 px-4 lg:px-6">
            <button className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Menu className="h-5 w-5 text-[#a2adba]" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-semibold tracking-tight text-[#f3f5f7]">{title}</h1>
              <p className="hidden text-[10px] uppercase tracking-[0.12em] text-[#6f7c89] sm:block">
                Greater Mumbai · Asia/Kolkata · {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
            </div>
            <div className="hidden items-center gap-2 md:flex">
              <Badge tone="lime" dot>Demo data</Badge>
              <Link to="/data-sources" className="rounded-lg border border-[#303945] bg-[#181d23] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#95a1ae] hover:text-white">
                Sources
              </Link>
            </div>
            <Link
              to="/notifications"
              className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-[#303945] bg-[#181d23] text-[#a2adba] hover:text-white"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
            </Link>
            <div className="relative">
              <button
                onClick={() => setUserMenu((v) => !v)}
                className="flex items-center gap-2 rounded-lg border border-[#303945] bg-[#181d23] px-2 py-1.5 text-[#dbe2e9] hover:bg-[#202730]"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#b5e36b]/15 text-[10px] font-bold text-[#c8ef8d]">
                  {user?.name?.slice(0, 1).toUpperCase() ?? 'U'}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-[#788493]" />
              </button>
              {userMenu ? (
                <div className="absolute right-0 top-11 z-30 w-56 rounded-xl border border-[#303945] bg-[#181d23] p-1.5 shadow-2xl">
                  <div className="px-3 py-2">
                    <p className="text-xs font-semibold text-[#f3f5f7]">{user?.name}</p>
                    <p className="truncate text-[10px] text-[#788493]">{user?.email}</p>
                    {user?.department ? <p className="mt-1 text-[10px] text-[#95a1ae]">{user.department}</p> : null}
                  </div>
                  <div className="my-1 h-px bg-[#2b333e]" />
                  <Link to="/profile" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-[#a2adba] hover:bg-[#29323d] hover:text-white">
                    <UserRound className="h-3.5 w-3.5" /> Profile
                  </Link>
                  <Link to="/settings" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-[#a2adba] hover:bg-[#29323d] hover:text-white">
                    <Settings className="h-3.5 w-3.5" /> Settings
                  </Link>
                  {isAuthority() ? (
                    <Link to="/simulation" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-[#a2adba] hover:bg-[#29323d] hover:text-white">
                      <FlaskConical className="h-3.5 w-3.5" /> Simulation
                    </Link>
                  ) : null}
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-[#e8a0a3] hover:bg-[#29323d]"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <DemoBanner compact />
        </header>
        <main className="min-h-[calc(100vh-96px)] px-4 py-5 lg:px-6 lg:py-6">
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}
