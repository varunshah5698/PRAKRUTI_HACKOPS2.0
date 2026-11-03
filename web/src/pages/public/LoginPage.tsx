import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { AuthLayout } from './AuthLayout';
import { Button, PublicInput, PublicLabel, Spinner } from '../../components/ui';
import { classNames } from '../../lib/format';
import { useAuth } from '../../store/auth';

const DEMO_PASSWORD = 'Demo@1234';

const demoAccounts = [
  ['Authority', 'authority@enviropulse.local'],
  ['Analyst', 'analyst@enviropulse.local'],
  ['Officer', 'officer@enviropulse.local'],
  ['Admin', 'admin@enviropulse.local'],
  ['Citizen', 'citizen@enviropulse.local'],
];

export function LoginPage() {
  const [email, setEmail] = useState('authority@enviropulse.local');
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedNext = new URLSearchParams(location.search).get('next') ?? '/dashboard';
  const next = requestedNext.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/dashboard';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, rememberMe);
      toast.success('Signed in.');
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title={<>Sign in to the <span className="relative whitespace-nowrap">command centre.<span aria-hidden className="absolute -bottom-0.5 left-0 h-[6px] w-full rounded-full bg-lime" /></span></>}
      subtitle="Authority and citizen accounts share one secure session. Permissions are verified server-side and never granted by role selection."
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <PublicLabel htmlFor="email">Email</PublicLabel>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/30" />
            <PublicInput
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@organisation.in"
              className="pl-11"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <PublicLabel htmlFor="password">Password</PublicLabel>
            <Link to="/forgot-password" className="mb-1.5 text-[10px] font-medium text-ink/45 hover:text-ink">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/30" />
            <PublicInput
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="pl-11 pr-11"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-ink/35 transition-colors hover:text-ink"
              aria-label="Show or hide password"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 pt-0.5 text-[11px] text-ink/55">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 rounded accent-[#111310]"
          />
          Remember me for 7 days
        </label>

        {error ? <p className="rounded-2xl border border-red-200 bg-red-50/80 px-3.5 py-2.5 text-xs text-red-800">{error}</p> : null}

        <Button type="submit" variant="ink" size="lg" className="group mt-1 w-full justify-between pl-6 pr-2" disabled={submitting}>
          <span className="flex items-center gap-2">
            {submitting ? <Spinner /> : null}
            {submitting ? 'Signing in…' : 'Sign in'}
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-lime text-ink transition-transform duration-200 group-hover:translate-x-0.5">
            <ArrowRight className="h-4 w-4" />
          </span>
        </Button>

        <p className="text-center text-[11px] text-ink/45">
          New citizen account?{' '}
          <Link to="/register" className="font-semibold text-ink underline decoration-lime decoration-2 underline-offset-4">
            Create an account
          </Link>
        </p>
      </form>

      <div className="mt-7 rounded-[22px] border border-white/80 bg-[#f3f5ee]/85 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink/35">Demo accounts</p>
          <span className="rounded-full border border-ink/10 bg-white px-2.5 py-1 font-mono text-[9px] text-ink/45">Demo@1234</span>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {demoAccounts.map(([role, account]) => {
            const selected = email === account;
            return (
              <button
                key={account}
                type="button"
                title={account}
                aria-pressed={selected}
                onClick={() => { setEmail(account); setPassword(DEMO_PASSWORD); }}
                className={classNames(
                  'rounded-full border px-2.5 py-1.5 text-[10.5px] font-medium transition-colors',
                  selected
                    ? 'border-ink bg-ink text-white shadow-sm'
                    : 'border-ink/10 bg-white/80 text-ink/55 hover:border-ink/20 hover:text-ink',
                )}
              >
                {role}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-ink/35">
          One click fills the credentials. Authority access is approved manually; choosing a role never grants permissions.
        </p>
      </div>
    </AuthLayout>
  );
}
