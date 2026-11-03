import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { AuthLayout } from './AuthLayout';
import { Button, PublicBadge, PublicInput, PublicLabel, Spinner } from '../../components/ui';
import { useAuth } from '../../store/auth';

const demoAccounts = [
  ['Authority admin', 'authority@enviropulse.local'],
  ['Environmental analyst', 'analyst@enviropulse.local'],
  ['Field officer', 'officer@enviropulse.local'],
  ['System admin', 'admin@enviropulse.local'],
  ['Citizen', 'citizen@enviropulse.local'],
];

export function LoginPage() {
  const [email, setEmail] = useState('authority@enviropulse.local');
  const [password, setPassword] = useState('Demo@1234');
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
    <AuthLayout title="Sign in to the command centre." subtitle="Authority and citizen accounts use the same secure session. Authority permissions are checked server-side and are never granted by selecting a role at registration.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <PublicLabel htmlFor="email">Email</PublicLabel>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/30" />
            <PublicInput id="email" type="email" autoComplete="email" className="pl-10" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <PublicLabel htmlFor="password">Password</PublicLabel>
            <Link to="/forgot-password" className="mb-1.5 text-[11px] font-medium text-ink/50 hover:text-ink">Forgot password?</Link>
          </div>
          <div className="relative">
            <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/30" />
            <PublicInput
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="pl-10 pr-10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/35 hover:text-ink" aria-label="Show or hide password">
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-ink/55">
          <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="h-4 w-4 accent-[#111310]" />
          Remember me for 7 days
        </label>
        {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}
        <Button type="submit" variant="lime" size="lg" className="w-full border border-ink/10" disabled={submitting}>
          {submitting ? <Spinner /> : null}
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="text-center text-xs text-ink/50">
          New citizen account? <Link to="/register" className="font-semibold text-ink underline underline-offset-2">Register</Link>
        </p>
      </form>

      <div className="mt-7 rounded-2xl border border-ink/10 bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/45">Demo accounts</p>
          <PublicBadge tone="soft">Password: Demo@1234</PublicBadge>
        </div>
        <div className="mt-3 grid gap-1.5">
          {demoAccounts.map(([role, account]) => (
            <button
              key={account}
              type="button"
              onClick={() => { setEmail(account); setPassword('Demo@1234'); }}
              className="flex items-center justify-between rounded-lg px-2.5 py-2 text-left text-[11px] text-ink/60 hover:bg-[#f2f3ec]"
            >
              <span>{role}</span>
              <span className="font-mono text-[10px] text-ink/40">{account}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-ink/40">
          Authority registration requires approval. Selecting an authority role does not grant authority permissions.
        </p>
      </div>
    </AuthLayout>
  );
}
