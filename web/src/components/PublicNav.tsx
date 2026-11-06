import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { Logo } from './Logo';
import { Button, PublicBadge } from './ui';
import { useAuth } from '../store/auth';

const links = [
  { to: '/status', label: 'Status' },
  { to: '/data-sources', label: 'Data sources' },
  { to: '/#how-it-works', label: 'How it works' },
  { to: '/#compliance', label: 'Compliance' },
];

export function PublicNav() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-6 px-5 lg:px-10">
        <Logo />
        <nav className="hidden items-center gap-8 lg:flex">
          {links.map((link) =>
            link.to.startsWith('/#') ? (
              <a key={link.label} href={link.to} className="whitespace-nowrap text-[13px] font-medium text-ink/65 transition hover:text-ink">
                {link.label}
              </a>
            ) : (
              <NavLink
                key={link.label}
                to={link.to}
                className={({ isActive }) =>
                  `whitespace-nowrap text-[13px] font-medium transition ${isActive ? 'text-ink' : 'text-ink/65 hover:text-ink'}`
                }
              >
                {link.label}
              </NavLink>
            ),
          )}
        </nav>
        <div className="hidden items-center gap-2.5 lg:flex">
          <PublicBadge tone="soft" className="hidden xl:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#32a879]" />
            Mumbai only
          </PublicBadge>
          <Link to={user ? (user.role === 'PUBLIC' ? '/citizen/dashboard' : '/dashboard') : '/citizen/login'}>
            <Button variant="ghost" size="sm" className="h-9">
              Citizen
            </Button>
          </Link>
          <Link to={user ? '/dashboard' : '/login'}>
            <Button variant="outline" size="sm" className="h-9">
              {user ? 'Open command centre' : 'Authority login'}
            </Button>
          </Link>
          <Link to="/report">
            <Button variant="lime" size="sm" className="h-9 border border-ink/10">
              Report a concern <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
        <button
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-ink/15 lg:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle navigation"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open ? (
        <div className="border-t border-ink/10 bg-paper px-5 py-5 lg:hidden">
          <div className="flex flex-col gap-4">
            {links.map((link) =>
              link.to.startsWith('/#') ? (
                <a key={link.label} href={link.to} onClick={() => setOpen(false)} className="text-sm font-medium text-ink/70">
                  {link.label}
                </a>
              ) : (
                <Link key={link.label} to={link.to} onClick={() => setOpen(false)} className="text-sm font-medium text-ink/70">
                  {link.label}
                </Link>
              ),
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Link to={user ? (user.role === 'PUBLIC' ? '/citizen/dashboard' : '/dashboard') : '/citizen/login'} onClick={() => setOpen(false)}>
                <Button variant="outline" className="w-full">
                  Citizen
                </Button>
              </Link>
              <Link to={user ? '/dashboard' : '/login'} onClick={() => setOpen(false)}>
                <Button variant="outline" className="w-full">
                  {user ? 'Dashboard' : 'Login'}
                </Button>
              </Link>
              <Link to="/report" onClick={() => setOpen(false)}>
                <Button variant="lime" className="w-full">
                  Report
                </Button>
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
