import { useEffect, useState } from 'react';
import { Bell, CheckCircle2, Eye, FileWarning, Mail, RefreshCw, Save, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel, Dialog, DialogContent, DialogTrigger, EmptyState, Input, LoadingBlock, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { CATEGORY_LABELS, categoryLabel, formatDate, timeAgo } from '../../lib/format';
import { useAuth } from '../../store/auth';

interface NotificationRow {
  id: string; alert_id: string | null; incident_id: string | null; report_id: string | null; audience: string; channel: string; template: string;
  subject: string; status: string; provider_message_id: string | null; sent_at: string | null; delivered_at: string | null;
  error: string | null; is_simulated: boolean; created_at: string; acknowledged_at: string | null;
  alert_ref: string | null; alert_category: string | null; alert_level: string | null; trigger_type: string | null;
  report_status: string | null;
  locality_name: string | null;
}
interface Locality { id: string; name: string }

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [preferences, setPreferences] = useState<Record<string, unknown> | null>(null);
  const [provider, setProvider] = useState<{ configured: boolean; mode: string; demoMode: boolean; demoRecipientConfigured: boolean; note: string } | null>(null);
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>(['air', 'water', 'waste', 'industrial']);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [localityId, setLocalityId] = useState('');
  const [radiusKm, setRadiusKm] = useState('10');
  const [consent, setConsent] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; body_html: string } | null>(null);
  const { user, isAuthority } = useAuth();

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<{ notifications: NotificationRow[] }>('/notifications?pageSize=50'),
      api.get<{ preferences: Record<string, unknown> | null; provider: { configured: boolean; mode: string; demoMode: boolean; demoRecipientConfigured: boolean; note: string } }>('/notifications/preferences'),
      api.get<{ localities: Locality[] }>('/public/localities'),
    ])
      .then(([notificationResult, preferenceResult, localityResult]) => {
        setNotifications(notificationResult.notifications);
        setPreferences(preferenceResult.preferences);
        setProvider(preferenceResult.provider);
        setLocalities(localityResult.localities);
        const prefs = preferenceResult.preferences;
        if (prefs) {
          setCategories((prefs.alert_categories as string[]) ?? ['air', 'water', 'waste', 'industrial']);
          setNotifyEmail(Boolean(prefs.notify_email));
          setLocalityId((prefs.locality_id as string) ?? '');
          setRadiusKm(prefs.radius_km ? String(prefs.radius_km) : '10');
          setConsent(Boolean(prefs.consent_at));
        }
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load notifications'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/notifications/preferences', {
        alertCategories: categories,
        notifyEmail,
        localityId: localityId || null,
        radiusKm: radiusKm ? Number(radiusKm) : null,
        consent,
      });
      toast.success('Notification preferences updated.');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save preferences');
    } finally {
      setSaving(false);
    }
  };

  const acknowledge = async (id: string) => {
    try {
      await api.post(`/notifications/${id}/acknowledge`);
      toast.success('Notification acknowledged.');
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not acknowledge'); }
  };

  const openPreview = async (id: string) => {
    try {
      const result = await api.get<{ notification: { subject: string; body_html: string } }>(`/notifications/${id}/preview`);
      setPreview(result.notification);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not load preview'); }
  };

  if (loading) return <LoadingBlock className="min-h-[60vh]" label="Loading notifications" />;
  if (error) return <EmptyState title="Notifications unavailable" description={error} icon={<Bell className="h-5 w-5" />} action={<Button variant="lime" onClick={load}>Retry</Button>} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Badge tone="amber" dot>Simulation delivery</Badge><Badge tone="neutral">{notifications.length} records</Badge></div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">Environmental notifications</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[#6f7f74]">
            Predictive and critical observed-condition alerts have independent trigger pipelines. In demo mode, emails are stored as SIMULATED records and are not sent to real mailing lists.
          </p>
        </div>
        <Button variant="dark" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader><CardTitle>Notification history</CardTitle><Badge tone="neutral">{user?.role.replace(/_/g, ' ')}</Badge></CardHeader>
          {notifications.length === 0 ? (
            <EmptyState title="No notifications yet" description="Alerts that match your preferences will generate notification records. Delivery status is shown separately from creation." icon={<Mail className="h-5 w-5" />} />
          ) : (
            <div className="divide-y divide-[#e7ece3]">
              {notifications.map((notification) => (
                <div key={notification.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={notification.audience === 'AUTHORITY' ? 'teal' : 'neutral'}>{notification.audience}</Badge>
                        <Badge tone={notification.status === 'DELIVERED' ? 'green' : notification.status === 'FAILED' ? 'red' : notification.status === 'ACKNOWLEDGED' ? 'teal' : 'amber'}>{notification.status}</Badge>
                        {notification.alert_level ? <Badge tone={notification.alert_level === 'CRITICAL' ? 'red' : 'amber'}>{notification.alert_level}</Badge> : null}
                        {notification.report_status ? <Badge tone="lime">{notification.report_status.replace(/_/g, ' ')}</Badge> : null}
                        {notification.is_simulated && notification.status !== 'SIMULATED' ? <Badge tone="amber">Simulated</Badge> : null}
                      </div>
                      <p className="mt-2 text-[12px] font-semibold text-[#1b2a1f]">{notification.subject}</p>
                      <p className="mt-1 text-[9px] text-[#66766b]">
                        {notification.alert_ref ?? '—'} · {notification.alert_category ? categoryLabel(notification.alert_category) : '—'} · {notification.locality_name ?? 'Mumbai'} · {timeAgo(notification.created_at)}
                      </p>
                      <p className="mt-1 text-[8px] text-[#66766b]">
                        {notification.sent_at ? `Sent ${formatDate(notification.sent_at)}` : 'Not sent'} · {notification.delivered_at ? `Delivered ${formatDate(notification.delivered_at)}` : 'Delivery not confirmed'}
                        {notification.error ? ` · ${notification.error}` : ''}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      {notification.report_id && notification.template === 'REPORT_STATUS_UPDATE' ? (
                        <Link to={isAuthority() ? `/reports/${notification.report_id}` : '/my-reports'}>
                          <Button variant="dark" size="sm"><FileWarning className="h-3.5 w-3.5" /> {isAuthority() ? 'Open report' : 'Track my report'}</Button>
                        </Link>
                      ) : null}
                      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
                        <DialogTrigger asChild>
                          <Button variant="dark" size="sm" onClick={() => openPreview(notification.id)}><Eye className="h-3.5 w-3.5" /> Preview</Button>
                        </DialogTrigger>
                        <DialogContent title={preview?.subject ?? 'Email preview'} description="Rendered notification template. Preview only; no email is sent." className="max-w-3xl">
                          {preview ? <iframe title="Email preview" srcDoc={preview.body_html} sandbox="" className="h-[65vh] w-full rounded-xl border border-[#dfe6db] bg-white" /> : null}
                        </DialogContent>
                      </Dialog>
                      {!notification.acknowledged_at ? <Button variant="lime" size="sm" onClick={() => acknowledge(notification.id)}><CheckCircle2 className="h-3.5 w-3.5" /> Ack</Button> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Email provider</CardTitle><Badge tone={provider?.configured ? 'green' : 'amber'}>{provider?.configured ? 'Configured' : 'Not configured'}</Badge></CardHeader>
            <div className="p-4 text-[10px] leading-relaxed text-[#5a6a5f]">
              <p>{provider?.note}</p>
              <div className="mt-3 space-y-1.5 border-t border-[#e7ece3] pt-3">
                <div className="flex justify-between"><span>Mode</span><span className="text-[#26362a]">{provider?.mode}</span></div>
                <div className="flex justify-between"><span>Demo mode</span><span className="text-[#26362a]">{provider?.demoMode ? 'ON' : 'OFF'}</span></div>
                <div className="flex justify-between"><span>Demo recipient</span><span className="text-[#26362a]">{provider?.demoRecipientConfigured ? 'Configured' : 'Not configured'}</span></div>
              </div>
              <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-2.5 text-[9px] text-amber-700/70">
                <ShieldAlert className="mb-1 h-3.5 w-3.5" /> SENT is not DELIVERED. Delivery is only confirmed by a provider webhook.
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>Preferences</CardTitle><Save className="h-4 w-4 text-[#3f7d2a]" /></CardHeader>
            <div className="space-y-3 p-4">
              <div>
                <DataLabel>Alert categories</DataLabel>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <label key={value} className={`cursor-pointer rounded-full border px-2.5 py-1 text-[9px] font-medium ${categories.includes(value) ? 'border-[#5b9e46]/40 bg-[#5b9e46]/10 text-[#3f7d2a]' : 'border-[#dfe6db] text-[#6f7f74]'}`}>
                      <input type="checkbox" className="sr-only" checked={categories.includes(value)} onChange={(e) => setCategories((prev) => e.target.checked ? [...prev, value] : prev.filter((v) => v !== value))} />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <DataLabel>Locality</DataLabel>
                <Select value={localityId} onChange={(e) => setLocalityId(e.target.value)} className="mt-1 h-9 text-[11px]">
                  <option value="">All Mumbai</option>
                  {localities.map((locality) => <option key={locality.id} value={locality.id}>{locality.name}</option>)}
                </Select>
              </div>
              <div>
                <DataLabel>Radius (km)</DataLabel>
                <Input type="number" min={0.5} max={100} step={0.5} value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} className="mt-1 h-9 text-[11px]" />
              </div>
              <label className="flex items-start gap-2 text-[10px] leading-relaxed text-[#5a6a5f]">
                <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[#5b9e46]" />
                Email notifications for matching alerts
              </label>
              <label className="flex items-start gap-2 text-[10px] leading-relaxed text-[#5a6a5f]">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[#5b9e46]" />
                I consent to notification processing
              </label>
              <Button variant="lime" size="sm" className="w-full" onClick={save} disabled={saving}><Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save preferences'}</Button>
              <p className="text-[9px] leading-relaxed text-[#66766b]">Consent is required for email. Preferences are applied to future alerts; no retroactive sends are made.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
