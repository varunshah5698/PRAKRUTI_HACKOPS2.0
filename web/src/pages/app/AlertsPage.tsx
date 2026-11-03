import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowUpRight, BellRing, Clock, MapPin, ShieldAlert, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { RiskBadge } from '../../components/Status';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel, EmptyState, LoadingBlock, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { CATEGORY_LABELS, categoryLabel, formatDate, timeAgo } from '../../lib/format';
import { useAuth } from '../../store/auth';

interface AlertRow {
  id: string; public_ref: string; category: string; level: string; state: string; trigger_type: string;
  title: string; summary: string; triggered_at: string; updated_at: string; is_simulated: boolean;
  forecast_horizon_hours: number | null; source_id: string | null; station_name: string | null;
  station_code: string | null; locality_name: string | null; locality_id: string | null;
  model_name: string | null; model_version: string | null; linked_incidents: number;
}

export function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');
  const [state, setState] = useState('');
  const [trigger, setTrigger] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    const query = new URLSearchParams({ pageSize: '60' });
    if (category) query.set('category', category);
    if (state) query.set('state', state);
    if (trigger) query.set('trigger', trigger);
    api.get<{ alerts: AlertRow[] }>(`/alerts?${query.toString()}`)
      .then((result) => { setAlerts(result.alerts); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load alerts'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [category, state, trigger]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Badge tone="amber" dot>Alert lifecycle</Badge><Badge tone="neutral">Separate observed and predictive pipelines</Badge></div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">Environmental alerts</h2>
          <p className="mt-1 text-[11px] text-[#788493]">NORMAL → WATCH → EARLY WARNING → CRITICAL → RECOVERY. Every transition is recorded. A prediction is never a violation.</p>
        </div>
        <Link to="/map"><Button variant="dark" size="sm">View on map <ArrowUpRight className="h-3.5 w-3.5" /></Button></Link>
      </div>

      <div className="grid gap-2 rounded-2xl border border-[#303945] bg-[#181d23] p-3 sm:grid-cols-3">
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 text-[11px]">
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select value={state} onChange={(e) => setState(e.target.value)} className="h-9 text-[11px]">
          <option value="">All states</option>
          {['WATCH', 'EARLY_WARNING', 'CRITICAL', 'RECOVERY', 'CLOSED'].map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
        </Select>
        <Select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="h-9 text-[11px]">
          <option value="">All triggers</option>
          <option value="PREDICTIVE">Predictive</option>
          <option value="OBSERVED">Observed</option>
          <option value="REPORT_EVIDENCE">Report evidence</option>
        </Select>
      </div>

      {loading ? <LoadingBlock label="Loading alerts" /> : error ? (
        <EmptyState title="Alerts unavailable" description={error} icon={<AlertTriangle className="h-5 w-5" />} action={<Button variant="lime" onClick={load}>Retry</Button>} />
      ) : alerts.length === 0 ? (
        <EmptyState title="No alerts match this view" description="Clear filters or wait for a new assessment." icon={<BellRing className="h-5 w-5" />} />
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <Link key={alert.id} to={`/alerts/${alert.id}`} className="group block rounded-2xl border border-[#303945] bg-[#181d23] p-4 transition hover:border-[#b5e36b]/35">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <RiskBadge level={alert.level} />
                    <Badge tone={alert.trigger_type === 'PREDICTIVE' ? 'teal' : alert.trigger_type === 'REPORT_EVIDENCE' ? 'amber' : 'neutral'}>{alert.trigger_type}</Badge>
                    <Badge tone="neutral">{categoryLabel(alert.category)}</Badge>
                    {alert.is_simulated ? <Badge tone="amber">Simulation</Badge> : null}
                    {alert.forecast_horizon_hours ? <Badge tone="teal">+{alert.forecast_horizon_hours}h</Badge> : null}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-[#e8edf2]">{alert.title}</p>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[#8d99a6]">{alert.summary}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px] text-[#6f7c89]">
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {alert.locality_name ?? alert.station_name ?? 'Mumbai'}</span>
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {timeAgo(alert.triggered_at)}</span>
                    {alert.model_name ? <span>{alert.model_name} {alert.model_version}</span> : null}
                    {alert.linked_incidents ? <span>{alert.linked_incidents} linked incident(s)</span> : null}
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-[#5f6b78] group-hover:text-[#b5e36b]" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

interface AlertDetail {
  alert: AlertRow & { summary: string; evidence: Array<Record<string, unknown>>; station_name: string | null; station_code: string | null; station_simulated: boolean; locality_lat: number | null; locality_lng: number | null; station_lat: number | null; station_lng: number | null; model_status: string | null };
  history: Array<{ from_state: string | null; to_state: string; reason: string; created_at: string; actor_name: string | null }>;
  riskAssessments: Array<{ id: string; risk_score: number | null; risk_level: string; confidence_score: number | null; confidence_level: string; alert_state: string; method: string; supporting_evidence: unknown; missing_inputs: string[]; calculated_at: string; ruleset_version: string; is_simulated: boolean }>;
  linkedIncidents: Array<{ id: string; public_ref: string; title: string; status: string; risk_level: string; detected_at: string }>;
  notifications: Array<{ id: string; audience: string; template: string; status: string; created_at: string; sent_at: string | null; delivered_at: string | null; error: string | null; is_simulated: boolean }>;
}

export function AlertDetailPage() {
  const { alertId } = useParams();
  const [data, setData] = useState<AlertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const { user, can } = useAuth();

  const load = () => {
    if (!alertId) return;
    setLoading(true);
    api.get<AlertDetail>(`/alerts/${alertId}`)
      .then((result) => { setData(result); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load alert'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [alertId]);

  const close = async () => {
    if (!data) return;
    const reason = window.prompt('Reason for closing this alert:');
    if (!reason || reason.trim().length < 5) return;
    setWorking(true);
    try {
      await api.post(`/alerts/${data.alert.id}/close`, { reason });
      toast.success('Alert closed.');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Close failed');
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <LoadingBlock className="min-h-[60vh]" label="Loading alert evidence" />;
  if (error || !data) return <EmptyState title="Alert unavailable" description={error ?? 'Alert not found.'} icon={<AlertTriangle className="h-5 w-5" />} action={<Button variant="lime" onClick={load}>Retry</Button>} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{data.alert.public_ref}</Badge>
            <RiskBadge level={data.alert.level} />
            <Badge tone={data.alert.trigger_type === 'PREDICTIVE' ? 'teal' : 'neutral'}>{data.alert.trigger_type}</Badge>
            {data.alert.is_simulated ? <Badge tone="amber">Simulation data</Badge> : null}
          </div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">{data.alert.title}</h2>
          <p className="mt-1 text-[11px] text-[#788493]">{categoryLabel(data.alert.category)} · {data.alert.locality_name ?? 'Mumbai'} · triggered {formatDate(data.alert.triggered_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/alerts"><Button variant="dark" size="sm"><ArrowLeft className="h-3.5 w-3.5" /> All alerts</Button></Link>
          {can(['AUTHORITY_ADMIN', 'SYSTEM_ADMIN']) && data.alert.state !== 'CLOSED' ? <Button variant="danger" size="sm" onClick={close} disabled={working}><XCircle className="h-3.5 w-3.5" /> Close alert</Button> : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Alert evidence</CardTitle><Badge tone="neutral">{data.alert.source_id ?? 'source'}</Badge></CardHeader>
            <div className="p-4">
              <p className="text-[12px] leading-relaxed text-[#c5d0db]">{data.alert.summary}</p>
              <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-3 text-[10px] leading-relaxed text-amber-100/70">
                <ShieldAlert className="mb-1 h-3.5 w-3.5" />
                This is an automated alert, not a confirmed regulatory violation. {data.alert.trigger_type === 'PREDICTIVE' ? 'Predictive alerts use a labelled baseline and are not confirmed future conditions.' : 'Observed-condition alerts require validation and authorised review before any determination.'}
              </div>
              <div className="mt-4">
                <DataLabel>Supporting evidence records</DataLabel>
                <div className="mt-2 space-y-2">
                  {data.alert.evidence.map((item, index) => (
                    <div key={index} className="rounded-xl border border-[#303945] bg-[#101317] p-3 text-[10px] leading-relaxed text-[#a2adba]">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={String(item.kind) === 'PREDICTED' ? 'teal' : String(item.kind) === 'REPORTED' ? 'amber' : 'green'}>{String(item.kind ?? 'EVIDENCE')}</Badge>
                        {item.pollutant ? <span className="font-semibold text-[#dbe2e9]">{String(item.pollutant)}</span> : null}
                        {item.parameter ? <span className="font-semibold text-[#dbe2e9]">{String(item.parameter)}</span> : null}
                      </div>
                      <pre className="mt-2 whitespace-pre-wrap font-sans text-[9px] text-[#788493]">{JSON.stringify(item, null, 1)}</pre>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>Risk assessments</CardTitle><Badge tone="neutral">{data.riskAssessments.length}</Badge></CardHeader>
            <div className="divide-y divide-[#252d37]">
              {data.riskAssessments.map((assessment) => (
                <div key={assessment.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><RiskBadge level={assessment.risk_level} /><Badge tone="neutral">{assessment.alert_state.replace(/_/g, ' ')}</Badge>{assessment.is_simulated ? <Badge tone="amber">Sim</Badge> : null}</div>
                    <span className="text-[9px] text-[#6f7c89]">{formatDate(assessment.calculated_at)}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3 text-[10px]">
                    <div><DataLabel>Risk</DataLabel><p className="mt-1 text-sm font-semibold">{assessment.risk_score ?? '—'}/100</p></div>
                    <div><DataLabel>Confidence</DataLabel><p className="mt-1 text-sm font-semibold">{assessment.confidence_score ?? '—'}/100 · {assessment.confidence_level}</p></div>
                  </div>
                  <p className="mt-2 text-[9px] leading-relaxed text-[#6f7c89]">{assessment.method} · {assessment.ruleset_version}</p>
                  {assessment.missing_inputs.length ? <p className="mt-1 text-[9px] text-amber-300/70">Missing inputs: {assessment.missing_inputs.join('; ')}</p> : null}
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Alert history</CardTitle><Clock className="h-4 w-4 text-[#788493]" /></CardHeader>
            <div className="p-4">
              <div className="relative space-y-3 border-l border-[#303945] pl-4">
                {data.history.map((event, index) => (
                  <div key={index} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border border-[#101317] bg-[#b5e36b]" />
                    <p className="text-[10px] font-semibold text-[#dbe2e9]">{event.from_state ?? 'NEW'} → {event.to_state}</p>
                    <p className="mt-0.5 text-[9px] text-[#788493]">{event.reason}</p>
                    <p className="mt-0.5 text-[8px] text-[#5f6b78]">{formatDate(event.created_at)}{event.actor_name ? ` · ${event.actor_name}` : ''}</p>
                  </div>
                ))}
                {data.history.length === 0 ? <p className="text-[10px] text-[#6f7c89]">No history recorded.</p> : null}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>Linked incidents</CardTitle><Badge tone="neutral">{data.linkedIncidents.length}</Badge></CardHeader>
            <div className="divide-y divide-[#252d37]">
              {data.linkedIncidents.map((incident) => (
                <Link key={incident.id} to={`/incidents/${incident.id}`} className="block px-4 py-3 hover:bg-[#1d242c]">
                  <div className="flex items-center justify-between gap-2"><RiskBadge level={incident.risk_level} /><span className="text-[9px] text-[#6f7c89]">{incident.status.replace(/_/g, ' ')}</span></div>
                  <p className="mt-1 text-[11px] font-medium text-[#dbe2e9]">{incident.title}</p>
                  <p className="mt-0.5 text-[9px] text-[#6f7c89]">{incident.public_ref}</p>
                </Link>
              ))}
              {data.linkedIncidents.length === 0 ? <p className="p-4 text-[10px] text-[#6f7c89]">No linked incident.</p> : null}
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>Notification delivery</CardTitle><Badge tone="neutral">{data.notifications.length}</Badge></CardHeader>
            <div className="divide-y divide-[#252d37]">
              {data.notifications.slice(0, 8).map((notification) => (
                <div key={notification.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2"><span className="text-[10px] text-[#a2adba]">{notification.audience} · {notification.template.replace(/_/g, ' ')}</span><Badge tone={notification.status === 'DELIVERED' ? 'green' : notification.status === 'FAILED' ? 'red' : 'amber'}>{notification.status}</Badge></div>
                  <p className="mt-1 text-[8px] text-[#5f6b78]">{formatDate(notification.created_at)} {notification.sent_at ? `· sent ${formatDate(notification.sent_at)}` : ''}</p>
                </div>
              ))}
              {data.notifications.length === 0 ? <p className="p-4 text-[10px] text-[#6f7c89]">No notifications generated.</p> : null}
            </div>
            <p className="border-t border-[#2b333e] px-4 py-2 text-[9px] leading-relaxed text-[#5f6b78]">SENT means the provider accepted the message. DELIVERED is only recorded from a provider webhook.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
