import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { AuthLayout } from './AuthLayout';
import { Button, PublicBadge, PublicInput, PublicLabel, PublicSelect, PublicTextarea, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { CATEGORY_LABELS } from '../../lib/format';

interface Locality {
  id: string;
  name: string;
}

export function RegisterPage() {
  const [accountType, setAccountType] = useState<'citizen' | 'authority'>('citizen');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localityId, setLocalityId] = useState('');
  const [categories, setCategories] = useState<string[]>(['air', 'water', 'waste', 'industrial']);
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [radiusKm, setRadiusKm] = useState('10');
  const [consent, setConsent] = useState(true);
  const [department, setDepartment] = useState('');
  const [designation, setDesignation] = useState('');
  const [jurisdiction, setJurisdiction] = useState('Mumbai');
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<{ localities: Locality[] }>('/public/localities').then((result) => {
      setLocalities(result.localities);
      const bandra = result.localities.find((l) => l.name === 'Bandra') ?? result.localities[0];
      if (bandra) setLocalityId(bandra.id);
    });
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.post<{ pendingApproval: boolean; message: string }>('/auth/register', {
        name,
        email,
        password,
        accountType,
        localityId: localityId || null,
        alertCategories: categories,
        notifyEmail,
        radiusKm: radiusKm ? Number(radiusKm) : null,
        consent,
        department: accountType === 'authority' ? department : undefined,
        designation: accountType === 'authority' ? designation : undefined,
        jurisdiction: accountType === 'authority' ? jurisdiction : undefined,
      });
      if (result.pendingApproval) {
        setPending(true);
      } else {
        toast.success('Account created. Sign in to continue.');
        navigate('/login', { state: { email } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (pending) {
    return (
      <AuthLayout title="Authority access is pending approval." subtitle="Your registration was received. No authority permissions have been granted.">
        <div className="rounded-2xl border border-ink/12 bg-white p-6">
          <PublicBadge tone="lime">Pending verification</PublicBadge>
          <p className="mt-4 text-sm leading-relaxed text-ink/60">
            A system administrator must verify your official email, department and designation before authority access is
            activated. You will not be able to sign in as an authority until then.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-ink/45">
            In this demonstration, the seeded authority account is already verified. The approval API is available at
            <code className="mx-1 rounded bg-[#f2f3ec] px-1.5 py-0.5 text-[10px]">/api/v1/auth/admin/approve-authority</code>
            for a system administrator.
          </p>
          <Link to="/login" className="mt-6 inline-flex"><Button variant="dark">Back to sign in</Button></Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create an account." subtitle="Citizen accounts are active immediately. Authority accounts require verification before any authority permission is granted.">
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-ink/12 bg-white p-1">
        {[
          ['citizen', 'Public citizen'],
          ['authority', 'Environmental authority'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setAccountType(value as 'citizen' | 'authority')}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${accountType === value ? 'bg-ink text-white' : 'text-ink/50 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-3.5">
        <div>
          <PublicLabel htmlFor="name">Full name</PublicLabel>
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/30" />
            <PublicInput id="name" className="pl-10" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          </div>
        </div>
        <div>
          <PublicLabel htmlFor="email">{accountType === 'authority' ? 'Official email' : 'Email'}</PublicLabel>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/30" />
            <PublicInput id="email" type="email" className="pl-10" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
        </div>
        <div>
          <PublicLabel htmlFor="password">Password</PublicLabel>
          <div className="relative">
            <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/30" />
            <PublicInput
              id="password"
              type={showPassword ? 'text' : 'password'}
              className="pl-10 pr-10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
            />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/35" aria-label="Show password">
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-ink/40">Minimum 10 characters.</p>
        </div>
        <div>
          <PublicLabel htmlFor="locality">Registered Mumbai locality</PublicLabel>
          <PublicSelect id="locality" value={localityId} onChange={(e) => setLocalityId(e.target.value)}>
            {localities.map((locality) => <option key={locality.id} value={locality.id}>{locality.name}</option>)}
          </PublicSelect>
        </div>

        {accountType === 'authority' ? (
          <div className="grid gap-3 rounded-xl border border-ink/10 bg-[#f5f6f0] p-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <PublicLabel htmlFor="department">Department</PublicLabel>
              <PublicInput id="department" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. MPCB regional office" required />
            </div>
            <div>
              <PublicLabel htmlFor="designation">Designation</PublicLabel>
              <PublicInput id="designation" value={designation} onChange={(e) => setDesignation(e.target.value)} required />
            </div>
            <div>
              <PublicLabel htmlFor="jurisdiction">Assigned jurisdiction</PublicLabel>
              <PublicInput id="jurisdiction" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} required />
            </div>
            <p className="sm:col-span-2 text-[10px] leading-relaxed text-ink/45">
              Authority registration is reviewed. Selecting this option does not grant authority permissions.
            </p>
          </div>
        ) : (
          <>
            <div>
              <PublicLabel>Preferred alert categories</PublicLabel>
              <div className="flex flex-wrap gap-2">
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <label key={value} className={`cursor-pointer rounded-full border px-3 py-1.5 text-[11px] font-medium ${categories.includes(value) ? 'border-ink bg-ink text-white' : 'border-ink/15 text-ink/50'}`}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={categories.includes(value)}
                      onChange={(e) => setCategories((prev) => e.target.checked ? [...prev, value] : prev.filter((v) => v !== value))}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <PublicLabel htmlFor="radius">Notification radius (km)</PublicLabel>
                <PublicInput id="radius" type="number" min={0.5} max={100} step={0.5} value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} />
              </div>
              <label className="flex items-start gap-2 pt-6 text-[11px] leading-relaxed text-ink/55">
                <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#111310]" />
                Email notifications for my locality and categories
              </label>
            </div>
            <label className="flex items-start gap-2 rounded-xl border border-ink/10 bg-[#f7f8f2] p-3 text-[11px] leading-relaxed text-ink/55">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#111310]" />
              I consent to notification processing. In demo mode, notifications are simulated unless a demonstration recipient is configured.
            </label>
          </>
        )}

        {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}
        <Button type="submit" variant="lime" size="lg" className="w-full border border-ink/10" disabled={submitting}>
          {submitting ? <Spinner /> : null}
          {submitting ? 'Creating account…' : accountType === 'authority' ? 'Request authority access' : 'Create citizen account'}
        </Button>
        <p className="text-center text-xs text-ink/50">
          Already registered? <Link to="/login" className="font-semibold text-ink underline underline-offset-2">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
