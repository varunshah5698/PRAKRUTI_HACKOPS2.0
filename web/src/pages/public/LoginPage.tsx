import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { isValidEmail } from './login-validation';
import './login-experience.css';

const DEMO_AQI = 84;
const DEMO_STATIONS = 24;

function PulseMark() {
  return (
    <svg className="ep-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M16 4.7v5.7" />
        <path d="M16 21.6v5.7" />
        <path d="m6.25 10.4 5 2.9" />
        <path d="m20.75 18.7 5 2.9" />
        <path d="m6.25 21.6 5-2.9" />
        <path d="m20.75 10.4 5 2.9" />
      </g>
      <circle cx="16" cy="16" r="3" fill="currentColor" />
      <circle cx="16" cy="4.7" r="1.35" fill="#F6B733" />
    </svg>
  );
}

function StationMark() {
  return (
    <svg className="ep-station-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <path d="M16 4.5v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="16" cy="15.4" r="2.1" fill="currentColor" />
      <path d="M11.6 26.5 16 15.4l4.4 11.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.7 26.5h12.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity=".6" />
      <path d="M9.4 14.1c-2 1.6-3.3 3.8-3.9 6.3M22.6 14.1c2 1.6 3.3 3.8 3.9 6.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".42" />
    </svg>
  );
}

function AqiGauge() {
  return (
    <svg className="ep-gauge" viewBox="0 0 70 40" role="img" aria-label={`Illustrative preview AQI ${DEMO_AQI}, moderate`}>
      <path d="M9 34a26 26 0 0 1 52 0" fill="none" stroke="#D8E2DA" strokeWidth="5" strokeLinecap="round" />
      <path
        d="M9 34a26 26 0 0 1 52 0"
        fill="none"
        stroke="#F6B733"
        strokeWidth="5"
        strokeLinecap="round"
        pathLength="100"
        strokeDasharray="34 100"
      />
      <circle cx="21.1" cy="12" r="3.1" fill="#F6B733" stroke="#FFFFFF" strokeWidth="1.7" />
    </svg>
  );
}

export function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const login = useAuth((state) => state.login);
  const prefilledEmail =
    location.state && typeof location.state === 'object' && typeof (location.state as { email?: unknown }).email === 'string'
      ? (location.state as { email: string }).email
      : '';

  const [email, setEmail] = useState(prefilledEmail);
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  const requestedNext = new URLSearchParams(location.search).get('next') ?? '/dashboard';
  const next = requestedNext.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/dashboard';

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Sign in · EnviroPulse';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => {
      setReducedMotion(media.matches);
      if (media.matches) {
        setVideoReady(false);
        videoRef.current?.pause();
      }
    };
    onChange();
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const animations: Animation[] = [];
    root.querySelectorAll<HTMLElement>('[data-enter]').forEach((element) => {
      const kind = element.dataset.enter;
      const delay = Number(element.dataset.delay ?? 0);
      const keyframes: Keyframe[] =
        kind === 'drop'
          ? [
              { opacity: 0, transform: 'translateY(-18px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ]
          : kind === 'blur'
            ? [
                { opacity: 0, filter: 'blur(10px)', transform: 'translateY(16px)' },
                { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0)' },
              ]
            : kind === 'rise'
              ? [
                  { opacity: 0, transform: 'translateY(16px)' },
                  { opacity: 1, transform: 'translateY(0)' },
                ]
              : [{ opacity: 0 }, { opacity: 1 }];

      const animation = element.animate(keyframes, {
        delay,
        duration: kind === 'blur' ? 900 : 780,
        easing: 'cubic-bezier(.22,.8,.25,1)',
        fill: 'both',
      });
      animation.addEventListener('finish', () => animation.cancel());
      animations.push(animation);
    });

    return () => animations.forEach((animation) => animation.cancel());
  }, []);

  const handleVideoReady = () => {
    setVideoReady(true);
    if (!reducedMotion) void videoRef.current?.play().catch(() => undefined);
  };

  const clearError = (field: 'email' | 'password') => {
    setFormError(null);
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;

    const trimmedEmail = email.trim();
    const nextErrors: { email?: string; password?: string } = {};
    if (!trimmedEmail) nextErrors.email = 'Enter your email address.';
    else if (!isValidEmail(trimmedEmail)) nextErrors.email = 'Enter a valid email address.';
    if (!password) nextErrors.password = 'Enter your password.';

    setFieldErrors(nextErrors);
    setFormError(null);

    if (nextErrors.email || nextErrors.password) {
      requestAnimationFrame(() => {
        if (nextErrors.email) emailRef.current?.focus();
        else passwordRef.current?.focus();
      });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await login(trimmedEmail, password, rememberMe);
      toast.success('Signed in.');
      navigate(next, { replace: true });
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Unable to sign in right now. Check your connection and try again.',
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="ep-login" ref={rootRef}>
      <section className="ep-visual" aria-labelledby="ep-headline">
        <div className="ep-photo" aria-hidden="true" />
        {!reducedMotion && !videoFailed ? (
          <video
            ref={videoRef}
            className={`ep-video${videoReady ? ' is-ready' : ''}`}
            src="/videos/enviropulse-city-background.mp4"
            poster="/images/enviropulse-login-hero.jpg"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            aria-hidden="true"
            tabIndex={-1}
            disablePictureInPicture
            onCanPlay={handleVideoReady}
            onError={() => {
              setVideoFailed(true);
              setVideoReady(false);
            }}
          />
        ) : null}
        <div className="ep-scrim" aria-hidden="true" />

        <div className="ep-visual-inner">
          <header className="ep-brand" data-enter="drop" data-delay="0">
            <span className="ep-brand-tile">
              <PulseMark />
            </span>
            <span className="ep-brand-copy">
              <span className="ep-brand-name">EnviroPulse</span>
              <span className="ep-brand-desc">Environmental intelligence</span>
            </span>
          </header>

          <div className="ep-hero-copy">
            <h1 id="ep-headline" className="ep-headline" data-enter="blur" data-delay="150">
              Understand the air.
              <br />
              Predict the change.
            </h1>
            <p className="ep-support" data-enter="fade" data-delay="350">
              AI-powered environmental intelligence
              <span className="ep-support-extra"> for a healthier, more informed world.</span>
            </p>
          </div>

          <div className="ep-widgets">
            <article className="ep-widget ep-widget-aqi" aria-label="Illustrative air quality preview" data-enter="rise" data-delay="500">
              <div className="ep-widget-top">
                <p className="ep-widget-label">::Air quality</p>
                <span className="ep-preview-chip">Preview</span>
              </div>
              <div className="ep-aqi-row">
                <div>
                  <p className="ep-aqi-value">{DEMO_AQI}</p>
                  <p className="ep-aqi-category">
                    <span className="ep-status-dot" aria-hidden="true" />
                    Moderate
                  </p>
                </div>
                <AqiGauge />
              </div>
              <p className="ep-widget-caption">Current AQI</p>
            </article>

            <article className="ep-widget ep-widget-insight" aria-label="Illustrative AI insight preview" data-enter="rise" data-delay="620">
              <div className="ep-widget-top">
                <p className="ep-widget-label">::AI insight</p>
                <span className="ep-ai-indicator" aria-hidden="true">
                  <Sparkles size={10} strokeWidth={1.8} />
                </span>
              </div>
              <p className="ep-insight">Air quality is moderate. Monitor particulate levels during peak traffic hours.</p>
              <p className="ep-widget-caption">Illustrative preview</p>
            </article>

            <article className="ep-widget ep-widget-network" aria-label="Illustrative monitoring network preview" data-enter="rise" data-delay="740">
              <div className="ep-widget-top">
                <p className="ep-widget-label">::Monitoring network</p>
                <span className="ep-preview-chip">Demo</span>
              </div>
              <div className="ep-network-row">
                <p className="ep-network-value">{DEMO_STATIONS}</p>
                <span className="ep-network-icon">
                  <StationMark />
                </span>
              </div>
              <p className="ep-widget-caption">Active stations</p>
            </article>
          </div>

          <p className="ep-preview-note" data-enter="fade" data-delay="900">
            Widget values are illustrative previews, not live measurements
          </p>

          <div className="ep-visual-footer" data-enter="fade" data-delay="900">
            <p className="ep-visual-footer-line">Environmental intelligence. Meaningful action.</p>
            <p className="ep-visual-footer-mono">Monitor • Understand • Act</p>
          </div>
        </div>
      </section>

      <main className="ep-auth" aria-labelledby="ep-login-heading">
        <div className="ep-auth-inner">
          <header>
            <span className="ep-auth-mark" data-enter="fade" data-delay="250" aria-hidden="true">
              <PulseMark />
            </span>
            <h2 id="ep-login-heading" className="ep-auth-heading" data-enter="rise" data-delay="400">
              Welcome back.
            </h2>
            <p className="ep-auth-desc" data-enter="rise" data-delay="520">
              Sign in to continue to your environmental intelligence workspace.
            </p>
          </header>

          <form onSubmit={submit} noValidate aria-busy={submitting}>
            <div className="ep-field" data-enter="rise" data-delay="720">
              <label className="ep-label" htmlFor="ep-email">
                ::Email address
              </label>
              <div className="ep-input-wrap">
                <Mail className="ep-input-icon" size={16} strokeWidth={1.6} aria-hidden="true" />
                <input
                  ref={emailRef}
                  id="ep-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="ep-input ep-input-with-icon"
                  placeholder="Enter your email address"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    clearError('email');
                  }}
                  aria-invalid={fieldErrors.email ? true : undefined}
                  aria-describedby={fieldErrors.email ? 'ep-email-error' : undefined}
                  required
                />
              </div>
              {fieldErrors.email ? (
                <p id="ep-email-error" className="ep-field-error" role="alert">
                  {fieldErrors.email}
                </p>
              ) : null}
            </div>

            <div className="ep-field" data-enter="rise" data-delay="840">
              <label className="ep-label" htmlFor="ep-password">
                ::Password
              </label>
              <div className="ep-input-wrap">
                <input
                  ref={passwordRef}
                  id="ep-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="ep-input ep-input-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    clearError('password');
                  }}
                  aria-invalid={fieldErrors.password ? true : undefined}
                  aria-describedby={fieldErrors.password ? 'ep-password-error' : undefined}
                  required
                />
                <button
                  type="button"
                  className="ep-eye"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={17} strokeWidth={1.7} /> : <Eye size={17} strokeWidth={1.7} />}
                </button>
              </div>
              {fieldErrors.password ? (
                <p id="ep-password-error" className="ep-field-error" role="alert">
                  {fieldErrors.password}
                </p>
              ) : null}
            </div>

            <div className="ep-controls" data-enter="fade" data-delay="980">
              <label className="ep-check">
                <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
                <span>Remember me</span>
              </label>
              <Link to="/forgot-password" className="ep-forgot">
                Forgot password?
              </Link>
            </div>

            {formError ? (
              <p className="ep-alert" role="alert">
                {formError}
              </p>
            ) : null}

            <button type="submit" className="ep-submit" disabled={submitting} aria-busy={submitting} data-enter="fade" data-delay="1120">
              {submitting ? <span className="ep-spinner" aria-hidden="true" /> : null}
              <span>{submitting ? 'Signing in…' : 'Sign In'}</span>
            </button>
          </form>

          <section className="ep-security" aria-label="Secure access" data-enter="fade" data-delay="1700">
            <span className="ep-security-icon" aria-hidden="true">
              <ShieldCheck size={15} strokeWidth={1.7} />
            </span>
            <div>
              <p className="ep-security-label">::Secure access</p>
              <p className="ep-security-text">Your environmental intelligence workspace is protected.</p>
            </div>
          </section>
        </div>

        <footer className="ep-auth-footer" data-enter="fade" data-delay="2000">
          <span>© 2026 EnviroPulse</span>
          <span className="ep-footer-sep" aria-hidden="true">
            ·
          </span>
          <Link to="/privacy">Privacy</Link>
          <span className="ep-footer-sep" aria-hidden="true">
            ·
          </span>
          <Link to="/terms">Terms</Link>
        </footer>
      </main>
    </div>
  );
}
