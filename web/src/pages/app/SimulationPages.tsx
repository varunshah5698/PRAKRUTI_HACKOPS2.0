import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  FlaskConical,
  Mail,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  SkipForward,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Chart, chartAxis, chartGrid, chartTooltip } from '../../components/Chart';
import { RiskBadge } from '../../components/Status';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel, Dialog, DialogContent, EmptyState, Input, LoadingBlock, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate, number } from '../../lib/format';
import { useAuth } from '../../store/auth';

interface Scenario {
  id: string; name: string; category: string; steps: number; description: string; stationRequired: boolean; demonstrates: string[];
}
interface SimulationSession {
  id: string; scenario: string; category: string; seed: number; status: string; current_step: number; total_steps: number;
  created_at: string; updated_at: string; station_name: string; station_code: string; locality_name: string | null; created_by_name: string | null;
}
interface SimulationEvent {
  step: number;
  payload: {
    step: number; observedAt: string; values: Record<string, { value: number; unit: string; qualityState: string; isSimulated: boolean }>;
    risk: { riskScore: number | null; riskLevel: string; confidenceScore: number | null; confidenceLevel: string; alertState: string; method: string; missingInputs: string[]; factors: Array<{ factor: string; contribution: number; detail: string }> };
    note: string; suppressAlert: boolean; neighbour?: { name: string; pm25: number; note: string }; emailPreviewAvailable: boolean; alertId?: string;
  };
}
interface SimulationDetail {
  session: SimulationSession;
  scenario: Scenario | null;
  events: SimulationEvent[];
  alerts: Array<{ id: string; public_ref: string; level: string; state: string; trigger_type: string; title: string; triggered_at: string; is_simulated: boolean }>;
  notifications: Array<{ id: string; audience: string; template: string; subject: string; status: string; is_simulated: boolean; created_at: string }>;
  incidents: Array<{ id: string; public_ref: string; title: string; status: string; risk_level: string; detected_at: string; is_simulated: boolean }>;
  isolation: { isSimulated: boolean; simulationSessionId: string; note: string };
}

export function SimulationPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [sessions, setSessions] = useState<SimulationSession[]>([]);
  const [stations, setStations] = useState<Array<{ id: string; name: string; stationType: string }>>([]);
  const [scenario, setScenario] = useState('gradual_pm25');
  const [stationId, setStationId] = useState('');
  const [seed, setSeed] = useState('42');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isAuthority } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api.get<{ scenarios: Scenario[] }>('/simulations/scenarios'),
      api.get<{ sessions: SimulationSession[] }>('/simulations'),
      api.get<{ stations: Array<{ id: string; name: string; stationType: string }> }>('/map/stations'),
    ])
      .then(([scenarioResult, sessionResult, stationResult]) => {
        setScenarios(scenarioResult.scenarios);
        setSessions(sessionResult.sessions);
        setStations(stationResult.stations);
        if (stationResult.stations[0]) setStationId(stationResult.stations[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load simulations'))
      .finally(() => setLoading(false));
  }, []);

  const create = async () => {
    setCreating(true);
    try {
      const result = await api.post<{ session: { id: string } }>('/simulations', { scenario, stationId, seed: Number(seed) || 42 });
      navigate(`/simulation/${result.session.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create simulation');
    } finally {
      setCreating(false);
    }
  };

  const selected = scenarios.find((s) => s.id === scenario);

  if (loading) return <LoadingBlock className="min-h-[60vh]" label="Loading simulation scenarios" />;
  if (error) return <EmptyState title="Simulation unavailable" description={error} icon={<FlaskConical className="h-5 w-5" />} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Badge tone="amber" dot>Isolated replay</Badge><Badge tone="neutral">Deterministic seed</Badge></div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">Simulation & historical replay</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[#6f7f74]">
            Demonstrate the full workflow without touching real observations. Every generated record is marked <code className="rounded bg-[#eaf2e4] px-1">is_simulated=true</code> and carries a simulation session id. Reset never deletes real environmental records.
          </p>
        </div>
      </div>

      {!isAuthority() ? (
        <EmptyState title="Authority role required" description="Simulation creation is limited to authority roles. You can still inspect the platform's evidence and reporting workflows." icon={<ShieldAlert className="h-5 w-5" />} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
          <Card>
            <CardHeader><CardTitle>Start a simulation</CardTitle><FlaskConical className="h-4 w-4 text-[#3f7d2a]" /></CardHeader>
            <div className="space-y-3 p-4">
              <div>
                <DataLabel>Scenario</DataLabel>
                <Select value={scenario} onChange={(e) => setScenario(e.target.value)} className="mt-1 h-9 text-[11px]">
                  {scenarios.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              </div>
              <div>
                <DataLabel>Station / locality context</DataLabel>
                <Select value={stationId} onChange={(e) => setStationId(e.target.value)} className="mt-1 h-9 text-[11px]">
                  {stations.map((station) => <option key={station.id} value={station.id}>{station.name} · {station.stationType.replace(/_/g, ' ')}</option>)}
                </Select>
              </div>
              <div>
                <DataLabel>Deterministic seed</DataLabel>
                <Input type="number" min={1} max={1000000} value={seed} onChange={(e) => setSeed(e.target.value)} className="mt-1 h-9 text-[11px]" />
              </div>
              {selected ? (
                <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3 text-[10px] leading-relaxed text-[#68786d]">
                  <p className="font-semibold text-[#26362a]">{selected.name}</p>
                  <p className="mt-1">{selected.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">{selected.demonstrates.map((item) => <Badge key={item} tone="neutral">{item}</Badge>)}</div>
                  <p className="mt-2 text-[9px] text-[#7b8a80]">{selected.steps} steps · {selected.category}</p>
                </div>
              ) : null}
              <Button variant="lime" size="sm" className="w-full" onClick={create} disabled={creating}><Play className="h-3.5 w-3.5" /> {creating ? 'Creating…' : 'Create simulation session'}</Button>
              <p className="text-[9px] leading-relaxed text-[#7b8a80]">Only configured demonstration recipients can receive replay emails. No real mailing list is used.</p>
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>Scenarios</CardTitle><Badge tone="neutral">{scenarios.length}</Badge></CardHeader>
            <div className="grid gap-2 p-3 sm:grid-cols-2">
              {scenarios.map((item) => (
                <button key={item.id} onClick={() => setScenario(item.id)} className={`rounded-xl border p-3 text-left transition ${scenario === item.id ? 'border-[#5b9e46]/40 bg-[#5b9e46]/[0.05]' : 'border-[#dfe6db] bg-[#f5f8f2] hover:border-[#c3d0bf]'}`}>
                  <div className="flex items-center justify-between"><Badge tone={item.category === 'air' ? 'lime' : 'neutral'}>{item.category}</Badge><span className="text-[9px] text-[#7b8a80]">{item.steps} steps</span></div>
                  <p className="mt-2 text-[11px] font-semibold text-[#26362a]">{item.name}</p>
                  <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-[#74847a]">{item.description}</p>
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Recent simulation sessions</CardTitle><Badge tone="neutral">{sessions.length}</Badge></CardHeader>
        {sessions.length === 0 ? <EmptyState title="No simulations yet" description="Create a scenario to demonstrate the workflow." /> : (
          <div className="divide-y divide-[#e7ece3]">
            {sessions.map((session) => (
              <Link key={session.id} to={`/simulation/${session.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-[#f3f7f0]">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5"><Badge tone="amber">Simulation</Badge><Badge tone="neutral">{session.scenario}</Badge><Badge tone={session.status === 'COMPLETED' ? 'green' : 'amber'}>{session.status}</Badge></div>
                  <p className="mt-1 text-[11px] font-medium text-[#26362a]">{session.station_name} · {session.locality_name ?? 'Mumbai'}</p>
                  <p className="mt-0.5 text-[9px] text-[#74847a]">Seed {session.seed} · step {session.current_step}/{session.total_steps - 1} · {formatDate(session.created_at)}</p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-[#7b8a80]" />
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function SimulationSessionPage() {
  const { sessionId } = useParams();
  const [data, setData] = useState<SimulationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState<{ public: { subject: string; html: string }; authority: { subject: string; html: string } } | null>(null);
  const { isAuthority } = useAuth();

  const load = (quiet = false) => {
    if (!sessionId) return;
    if (!quiet) setLoading(true);
    api.get<SimulationDetail>(`/simulations/${sessionId}`)
      .then((result) => { setData(result); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load simulation'))
      .finally(() => { if (!quiet) setLoading(false); });
  };

  useEffect(load, [sessionId]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(async () => {
      try {
        const result = await api.post<{ status: string; step: number }>(`/simulations/${sessionId}/step`);
        await load(true);
        if (result.status === 'COMPLETED') setPlaying(false);
      } catch {
        setPlaying(false);
      }
    }, 1800);
    return () => window.clearInterval(timer);
  }, [playing, sessionId]);

  const step = async () => {
    setWorking(true);
    try {
      await api.post(`/simulations/${sessionId}/step`);
      await load(true);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Step failed'); }
    finally { setWorking(false); }
  };

  const reset = async () => {
    setPlaying(false);
    setWorking(true);
    try {
      await api.post(`/simulations/${sessionId}/reset`);
      toast.success('Replay reset. Real observations untouched.');
      await load(true);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Reset failed'); }
    finally { setWorking(false); }
  };

  const previewEmail = async () => {
    try {
      const result = await api.post<{ public: { subject: string; html: string }; authority: { subject: string; html: string } }>(`/simulations/${sessionId}/email-preview`);
      setPreview(result);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Preview unavailable'); }
  };

  const createIncident = async () => {
    setWorking(true);
    try {
      const result = await api.post<{ incident: { id: string; publicRef: string } }>(`/simulations/${sessionId}/incident`);
      toast.success(`Simulated incident ${result.incident.publicRef} created.`);
      await load(true);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Incident creation failed'); }
    finally { setWorking(false); }
  };

  const chartOption = useMemo(() => {
    if (!data) return {};
    const points = data.events.map((event) => ({
      step: event.payload.step,
      value: event.payload.values.pm25?.value ?? event.payload.values.ph?.value ?? event.payload.values.stack_pm?.value ?? null,
      label: event.payload.values.pm25 ? 'PM2.5' : event.payload.values.ph ? 'pH' : 'Stack PM',
    }));
    return {
      grid: { ...chartGrid, top: 30 },
      tooltip: chartTooltip,
      xAxis: { type: 'category', data: points.map((p) => `Step ${p.step}`), ...chartAxis, axisLabel: { ...chartAxis.axisLabel, interval: Math.max(1, Math.floor(points.length / 8)) } },
      yAxis: { type: 'value', ...chartAxis },
      series: [{ type: 'line', smooth: 0.3, symbol: 'circle', symbolSize: 4, data: points.map((p) => p.value), lineStyle: { color: '#5b9e46', width: 2 }, areaStyle: { color: 'rgba(91,158,70,0.08)' }, itemStyle: { color: '#5b9e46' } }],
    };
  }, [data]);

  if (loading) return <LoadingBlock className="min-h-[60vh]" label="Loading simulation replay" />;
  if (error || !data) return <EmptyState title="Simulation unavailable" description={error ?? 'Simulation not found.'} icon={<FlaskConical className="h-5 w-5" />} action={<Button variant="lime" onClick={() => load()}>Retry</Button>} />;

  const latest = data.events[data.events.length - 1]?.payload;
  const atEnd = data.session.current_step >= data.session.total_steps - 1;
  const metricKey = latest?.values.pm25 ? 'pm25' : latest?.values.ph ? 'ph' : 'stack_pm';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="amber" dot>Simulation data</Badge>
            <Badge tone="neutral">{data.scenario?.name ?? data.session.scenario}</Badge>
            <Badge tone={data.session.status === 'COMPLETED' ? 'green' : 'amber'}>{data.session.status}</Badge>
            <Badge tone="neutral">Seed {data.session.seed}</Badge>
          </div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">{data.session.station_name}</h2>
          <p className="mt-1 text-[11px] text-[#6f7f74]">{data.session.locality_name ?? 'Mumbai'} · step {data.session.current_step}/{data.session.total_steps - 1} · created by {data.session.created_by_name ?? '—'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/simulation"><Button variant="dark" size="sm"><ArrowLeft className="h-3.5 w-3.5" /> Sessions</Button></Link>
          <Button variant="dark" size="sm" onClick={reset} disabled={working}><RotateCcw className="h-3.5 w-3.5" /> Reset</Button>
          <Button variant={playing ? 'lime' : 'dark'} size="sm" onClick={() => setPlaying((v) => !v)} disabled={atEnd && !playing}>
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {playing ? 'Pause' : 'Play'}
          </Button>
          <Button variant="dark" size="sm" onClick={step} disabled={working || atEnd}><SkipForward className="h-3.5 w-3.5" /> Step</Button>
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-2.5 text-[10px] leading-relaxed text-amber-700/80">
        {data.isolation.note} Every event below is simulation-labelled. Emails are previews or SIMULATED records only.
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Replay timeline</CardTitle><Badge tone="neutral">{data.events.length} events revealed</Badge></CardHeader>
            <div className="px-2 pb-3 pt-2"><Chart height={260} empty={data.events.length === 0} option={chartOption} /></div>
            <div className="border-t border-[#e7ece3] p-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#eaf2e4]">
                <div className="h-full rounded-full bg-[#5b9e46] transition-all" style={{ width: `${(data.session.current_step / Math.max(1, data.session.total_steps - 1)) * 100}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-[8px] text-[#7b8a80]"><span>Step 0</span><span>Step {data.session.total_steps - 1}</span></div>
            </div>
          </Card>

          {latest ? (
            <Card>
              <CardHeader><CardTitle>Current simulated state · step {latest.step}</CardTitle><RiskBadge level={latest.risk.alertState} /></CardHeader>
              <div className="p-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  {Object.entries(latest.values).map(([code, value]) => (
                    <div key={code} className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3">
                      <DataLabel>{code.toUpperCase()}</DataLabel>
                      <p className="mt-1 text-lg font-semibold">{number(value.value)} <span className="text-[10px] font-normal text-[#6f7f74]">{value.unit}</span></p>
                      <p className={`mt-1 text-[9px] ${value.qualityState === 'SUSPECT' ? 'text-amber-600' : 'text-[#74847a]'}`}>{value.qualityState}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-[#405246]">{latest.note}</p>
                {latest.neighbour ? <p className="mt-2 rounded-xl border border-[#2f8f84]/20 bg-[#2f8f84]/[0.04] p-3 text-[10px] leading-relaxed text-[#217a70]">{latest.neighbour.name}: {latest.neighbour.pm25} µg/m³. {latest.neighbour.note}</p> : null}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3">
                    <DataLabel>Risk assessment</DataLabel>
                    <p className="mt-1 text-sm font-semibold">{latest.risk.riskScore ?? '—'}/100 · {latest.risk.riskLevel}</p>
                    <p className="mt-1 text-[9px] text-[#74847a]">{latest.risk.method}</p>
                    {latest.risk.missingInputs.length ? <p className="mt-1 text-[9px] text-amber-600/70">Missing: {latest.risk.missingInputs.join('; ')}</p> : null}
                  </div>
                  <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3">
                    <DataLabel>Confidence</DataLabel>
                    <p className="mt-1 text-sm font-semibold">{latest.risk.confidenceScore ?? '—'}/100 · {latest.risk.confidenceLevel}</p>
                    <p className="mt-1 text-[9px] text-[#74847a]">Confidence is separate from severity. {latest.suppressAlert ? 'Alert suppressed due to data quality.' : ''}</p>
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader><CardTitle>Event history</CardTitle><Badge tone="neutral">{data.events.length}</Badge></CardHeader>
            <div className="scrollbar-thin max-h-[340px] overflow-auto">
              {data.events.map((event) => (
                <div key={event.step} className="border-b border-[#e7ece3] px-4 py-2.5 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2"><span className="text-[9px] font-semibold text-[#3f7d2a]">STEP {event.payload.step}</span><RiskBadge level={event.payload.risk.alertState} /><span className="text-[8px] text-[#7b8a80]">{formatDate(event.payload.observedAt)}</span></div>
                    {event.payload.suppressAlert ? <Badge tone="amber">Alert suppressed</Badge> : null}
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-[#68786d]">{event.payload.note}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Simulated alerts</CardTitle><Badge tone="neutral">{data.alerts.length}</Badge></CardHeader>
            <div className="divide-y divide-[#e7ece3]">
              {data.alerts.map((alert) => (
                <div key={alert.id} className="p-3">
                  <div className="flex items-center justify-between gap-2"><RiskBadge level={alert.level} /><Badge tone="neutral">{alert.trigger_type}</Badge></div>
                  <p className="mt-1 text-[10px] font-medium text-[#26362a]">{alert.title}</p>
                  <p className="mt-0.5 text-[8px] text-[#7b8a80]">{alert.public_ref} · {formatDate(alert.triggered_at)}</p>
                </div>
              ))}
              {data.alerts.length === 0 ? <p className="p-4 text-[10px] text-[#74847a]">No simulated alert yet. Advance the replay until an alert transition occurs.</p> : null}
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>Replay actions</CardTitle><Sparkles className="h-4 w-4 text-[#3f7d2a]" /></CardHeader>
            <div className="space-y-2 p-4">
              <Button variant="dark" size="sm" className="w-full" onClick={previewEmail} disabled={data.alerts.length === 0}><Mail className="h-3.5 w-3.5" /> Preview early-warning / critical email</Button>
              <Button variant="lime" size="sm" className="w-full" onClick={createIncident} disabled={working || data.alerts.length === 0}><ShieldAlert className="h-3.5 w-3.5" /> Create simulated incident</Button>
              <p className="text-[9px] leading-relaxed text-[#7b8a80]">Incident creation uses the real incident service but writes only simulation-labelled records with this session id.</p>
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>Simulated notifications</CardTitle><Badge tone="neutral">{data.notifications.length}</Badge></CardHeader>
            <div className="divide-y divide-[#e7ece3]">
              {data.notifications.slice(0, 6).map((notification) => (
                <div key={notification.id} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2"><span className="text-[9px] text-[#5a6a5f]">{notification.audience} · {notification.template.replace(/_/g, ' ')}</span><Badge tone={notification.status === 'SIMULATED' ? 'amber' : 'neutral'}>{notification.status}</Badge></div>
                  <p className="mt-0.5 truncate text-[8px] text-[#7b8a80]">{notification.subject}</p>
                </div>
              ))}
              {data.notifications.length === 0 ? <p className="p-4 text-[10px] text-[#74847a]">No simulated notifications yet.</p> : null}
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>Simulated incidents</CardTitle><Badge tone="neutral">{data.incidents.length}</Badge></CardHeader>
            <div className="divide-y divide-[#e7ece3]">
              {data.incidents.map((incident) => (
                <Link key={incident.id} to={`/incidents/${incident.id}`} className="block px-3 py-2 hover:bg-[#f3f7f0]">
                  <div className="flex items-center justify-between gap-2"><RiskBadge level={incident.risk_level} /><span className="text-[8px] text-[#7b8a80]">{incident.status.replace(/_/g, ' ')}</span></div>
                  <p className="mt-1 text-[10px] text-[#26362a]">{incident.title}</p>
                </Link>
              ))}
              {data.incidents.length === 0 ? <p className="p-4 text-[10px] text-[#74847a]">No simulated incident created.</p> : null}
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent title="Replay email preview" description="Simulation-generated email. Not sent to a real mailing list." className="max-w-4xl">
          {preview ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <div><DataLabel>Public email</DataLabel><p className="mt-1 text-[10px] text-[#68786d]">{preview.public.subject}</p><iframe title="Public email preview" srcDoc={preview.public.html} sandbox="" className="mt-2 h-[50vh] w-full rounded-xl border border-[#dfe6db] bg-white" /></div>
              <div><DataLabel>Authority email</DataLabel><p className="mt-1 text-[10px] text-[#68786d]">{preview.authority.subject}</p><iframe title="Authority email preview" srcDoc={preview.authority.html} sandbox="" className="mt-2 h-[50vh] w-full rounded-xl border border-[#dfe6db] bg-white" /></div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
