import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { Button, PublicBadge, PublicInput, PublicLabel, Spinner } from '../../components/ui';
import { api } from '../../lib/api';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.post<{ message: string }>('/auth/forgot-password', { email });
      setMessage(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Reset your password." subtitle="A reset token is generated server-side. In local development it is printed in the API log; it is never returned in the API response.">
      {message ? (
        <div className="rounded-2xl border border-ink/12 bg-white p-6">
          <PublicBadge tone="lime">Request received</PublicBadge>
          <p className="mt-4 text-sm leading-relaxed text-ink/60">{message}</p>
          <p className="mt-3 text-[11px] text-ink/40">
            Check the API terminal for the local reset link. No email provider is configured by default.
          </p>
          <Link to="/login" className="mt-5 inline-flex"><Button variant="dark">Back to sign in</Button></Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <PublicLabel htmlFor="email">Account email</PublicLabel>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/30" />
              <PublicInput id="email" type="email" className="pl-10" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          </div>
          {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}
          <Button type="submit" variant="ink" size="lg" className="w-full" disabled={submitting}>
            {submitting ? <Spinner /> : null} {submitting ? 'Generating…' : 'Generate reset instruction'}
          </Button>
          <p className="text-center text-xs text-ink/50"><Link to="/login" className="underline underline-offset-2">Back to sign in</Link></p>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Choose a new password." subtitle="Reset tokens expire after 30 minutes and can only be used once.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <PublicLabel htmlFor="token">Reset token</PublicLabel>
          <PublicInput id="token" value={token} onChange={(e) => setToken(e.target.value)} required minLength={20} />
        </div>
        <div>
          <PublicLabel htmlFor="password">New password</PublicLabel>
          <PublicInput id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
        </div>
        <div>
          <PublicLabel htmlFor="confirm">Confirm password</PublicLabel>
          <PublicInput id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={10} />
        </div>
        {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}
        <Button type="submit" variant="ink" size="lg" className="w-full" disabled={submitting}>
          {submitting ? <Spinner /> : null} {submitting ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </AuthLayout>
  );
}
