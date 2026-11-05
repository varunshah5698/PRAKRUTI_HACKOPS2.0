import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Chrome, MapPin, ShieldCheck } from 'lucide-react';
import { AuthLayout } from './AuthLayout';
import { Button } from '../../components/ui';

const ERRORS: Record<string, string> = {
  google_not_configured:
    'Google sign-in is not configured on this deployment yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.',
  google_cancelled: 'Google sign-in was cancelled. No account was created.',
  google_state: 'The sign-in session expired. Please try again.',
  google_email_unverified: 'Google did not return a verified email address, so no account was created.',
  account_inactive: 'This account is not active. Contact the platform administrator.',
  google_failed: 'Google sign-in failed. Please try again.',
};

export function CitizenLoginPage() {
  const [params] = useSearchParams();
  const error = params.get('error');
  const message = error ? (ERRORS[error] ?? ERRORS.google_failed) : null;

  return (
    <AuthLayout
      title="Citizen portal"
      subtitle="Sign in with Google to register your location and receive weather alerts for the place you actually live in."
    >
      <div className="space-y-4">
        {message ? (
          <div className="flex items-start gap-2 rounded-2xl border border-[#e8b7b1] bg-[#fff4f2] px-4 py-3 text-[12px] leading-relaxed text-[#8a2f2a]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{message}</span>
          </div>
        ) : null}

        <a href="/api/v1/auth/google/start" className="block">
          <Button size="lg" variant="ink" className="w-full justify-center gap-3">
            <Chrome className="h-5 w-5" />
            Continue with Google
          </Button>
        </a>

        <div className="rounded-2xl border border-[#dbe5d6] bg-white/60 p-4 text-[11px] leading-relaxed text-ink/55">
          <p className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#4e9b3f]" />
            Google verifies your identity. We receive only your verified email, name and profile photo — never your
            password. Your verified email is the alert recipient and cannot be changed from the browser.
          </p>
          <p className="mt-3 flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#4e9b3f]" />
            After signing in you choose a city and location. Email alerts are opt-in and can be disabled at any time.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 text-[11px] text-ink/45">
          <Link to="/login" className="underline underline-offset-2 hover:text-ink/70">
            Citizen email & password
          </Link>
          <Link to="/login" className="underline underline-offset-2 hover:text-ink/70">
            Authority login
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
