import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Droplets,
  Factory,
  FlaskConical,
  Gauge,
  Mail,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Shuffle,
  SkipForward,
  Sparkles,
  Timer,
  Trash2,
  TrendingUp,
  Wind,
} from 'lucide-react';
import { toast } from 'sonner';
import { Chart, chartAxis, chartGrid, chartTooltip } from '../../components/Chart';
import { RiskBadge } from '../../components/Status';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel, Dialog, DialogContent, EmptyState, Input, LoadingBlock, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { RISK_COLORS, classNames, formatDate, number } from '../../lib/format';
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
interface StationOption { id: string; name: string; stationType: string; localityName?: string | null }

const CATEGORY: Record<string, { label: string; icon: LucideIcon; color: string; soft: string; border: string }> = {
  air: { label: 'Air', icon: Wind, color: '#2d7c94', soft: '#e8f5f8', border: '#c7e3ea' },
  water: { label: 'Water', icon: Droplets, color: '#2f8f84', soft: '#e9f7f3', border: '#c3e5de' },
  waste: { label: 'Waste', icon: Trash2, color: '#9a7620', soft: '#fbf4df', border: '#eadcb2' },
  industrial: { label: 'Industrial', icon: Factory, color: '#74639a', soft: '#f1edf8', border: '#d9d0eb' },
};

const REQUIRED_STATION: Record<string, string | undefined> = {
  air: 'AIR_CAAQMS',
  water: 'WATER_SAMPLING',
  industrial: 'INDUSTRIAL_STACK',
};

const METRIC_LABELS: Record<string, string> = {
  pm25: 'PM2.5',
  pm10: 'PM10',
  no2: 'NO₂',
  so2: 'SO₂',
  co: 'CO',
  o3: 'O₃',
  ph: 'pH',
  do: 'Dissolved oxygen',
  turbidity: 'Turbidity',
  stack_pm: 'Stack PM',
  stack_nox: 'Stack NOx',
  stack_so2: 'Stack SO₂',
  verified_reports: 'Verified reports',
  unverified_reports: 'Unverified reports',
};

const metricLabel = (code: string) => METRIC_LABELS[code] ?? code.replace(/_/g, ' ').toUpperCase();

const alertTone = (state?: string | null) => RISK_COLORS[String(state ?? 'UNKNOWN').toUpperCase()] ?? '#728176';

const scenarioName = (id: string, scenarios: Scenario[]) => scenarios.find((item) => item.id === id)?.name ?? id.replace(/_/g, ' ');

function GaugeRing({
  progress,
  size = 116,
  stroke = 9,
  color = '#2d7c94',
  track = 'rgba(255,255,255,.7)',
  children,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children: React.ReactNode;
}) {
  const radius = (size - stroke) / 2 - 3;
  const circumference = 2 * Math.PI * radius;
  const value = Math.max(0, Math.min(1, progress));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${value * circumference} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 500ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

function CategoryPill({ category }: { category: string }) {
  const meta = CATEGORY[category] ?? CATEGORY.air;
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em]" style={{ color: meta.color, background: meta.soft, borderColor: meta.border }}>
      <Icon className="h-3 w-3" /> {meta.label}
    </span>
  );
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/45 px-3 py-2.5 backdrop-blur-sm">
      <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-[#6e8b95]">{label}</p>
      <p className="display mt-1 text-[17px] font-bold leading-none tracking-[-0.03em] text-[#173d4a]">{value}</p>
      {note ? <p className="mt-1 truncate text-[8px] text-[#8ba1a9]">{note}</p> : null}
    </div>
  );
}

export function SimulationPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [sessions, setSessions] = useState<SimulationSession[]>([]);
  const [stations, setStations] = useState<StationOption[]>([]);
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
      api.get<{ stations: StationOption[] }>('/map/stations'),
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

  const selected = scenarios.find((item) => item.id === scenario);

  const eligibleStations = useMemo(() => {
    const required = selected ? REQUIRED_STATION[selected.category] : undefined;
    if (!required) return stations;
    return stations.filter((station) => station.stationType === required);
  }, [selected, stations]);

  useEffect(() => {
    if (!eligibleStations.length) return;
    if (!eligibleStations.some((station) => station.id === stationId)) {
      setStationId(eligibleStations[0].id);
    }
  }, [eligibleStations, stationId]);

  const create = async () => {
    if (!selected) return;
    if (!stationId) {
      toast.error('No eligible station is available for this scenario.');
      return;
    }
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

  if (loading) return <LoadingBlock className="min-h-[60vh]" label="Loading replay lab" />;
  if (error) return <EmptyState title="Simulation unavailable" description={error} icon={<FlaskConical className="h-5 w-5" />} />;

  const category = selected ? CATEGORY[selected.category] ?? CATEGORY.air : CATEGORY.air;

  return (
    <div className="space-y-4">
      <section className="atmo-hero relative overflow-hidden rounded-[30px]">
        <div className="atmo-sun right-[8%] top-[-74px] h-[92px] w-[92px]" aria-hidden />
        <div className="atmo-cloud right-[18%] top-[34px] h-[14px] w-[68px]" aria-hidden />
        <div className="atmo-cloud right-[3%] top-[126px] h-[9px] w-[44px] opacity-50 [animation-delay:-9s]" aria-hidden />
        <div className="atmo-skyline" aria-hidden />

        <div className="relative z-10 grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#bcdde5] bg-white/65 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#2d7083] backdrop-blur">
                <FlaskConical className="h-3 w-3" /> Replay lab
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#ecd9b9] bg-[#fdf6e8] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#9b6a25]">
                Simulation only
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/55 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#5f7f8b]">
                <ShieldCheck className="h-3 w-3" /> Real data untouched
              </span>
            </div>
            <h1 className="display mt-3 text-[32px] font-bold leading-[0.98] tracking-[-0.055em] text-[#123240] sm:text-[42px]">
              Replay the city.<br className="hidden sm:block" /> Isolate the evidence.
            </h1>
            <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-[#527482]">
              Run deterministic pollution scenarios minute by minute — see how readings, risk, alerts, emails and incidents respond, without ever touching a real observation.
            </p>
            <div className="mt-5 grid max-w-xl grid-cols-3 gap-2">
              <Stat label="Scenarios" value={scenarios.length} note="air · water · waste · industrial" />
              <Stat label="Replays run" value={sessions.length} note="latest 100 sessions" />
              <Stat label="Isolation" value="100%" note="simulated + session-labelled" />
            </div>
          </div>

          <div className="rounded-[24px] border border-white/80 bg-white/55 p-4 shadow-[0_20px_45px_-40px_rgba(23,61,74,.65)] backdrop-blur-md">
            <div className="flex items-center justify-between gap-2">
              <DataLabel>Selected scenario</DataLabel>
              {selected ? <CategoryPill category={selected.category} /> : null}
            </div>
            <p className="display mt-2 text-[19px] font-bold leading-tight tracking-[-0.03em] text-[#123240]">{selected?.name ?? 'Choose a scenario'}</p>
            <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[#5f7f8b]">{selected?.description}</p>
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#d9e9ee]">
                <div className="h-full w-2/5 rounded-full" style={{ background: `linear-gradient(90deg, ${category.color}, ${category.color}aa)` }} />
              </div>
              <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#6e8b95]">{selected?.steps ?? 0} steps</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {[
                { icon: Timer, label: 'Deterministic' },
                { icon: ShieldCheck, label: 'Labelled' },
                { icon: TrendingUp, label: 'Stepwise' },
              ].map(({ icon: Icon, label }) => (
                <span key={label} className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/70 bg-white/45 px-2 py-1.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-[#557480]">
                  <Icon className="h-3 w-3" /> {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {!isAuthority() ? (
        <Card>
          <EmptyState title="Authority role required" description="Simulation creation is limited to authority roles. You can still inspect the platform's evidence and reporting workflows." icon={<ShieldAlert className="h-5 w-5" />} />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
          <Card className="overflow-hidden">
            <CardHeader className="items-center">
              <div>
                <CardTitle>Build a replay</CardTitle>
                <p className="mt-1 text-[10px] text-[#66766b]">Pick a scenario, a matching station and a seed. Same inputs always produce the same replay.</p>
              </div>
              <Badge tone="teal">{scenarios.length} ready</Badge>
            </CardHeader>
            <div className="grid gap-2 p-4 sm:grid-cols-2">
              {scenarios.map((item) => {
                const meta = CATEGORY[item.category] ?? CATEGORY.air;
                const Icon = meta.icon;
                const active = scenario === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setScenario(item.id)}
                    aria-pressed={active}
                    className={classNames(
                      'group relative overflow-hidden rounded-[18px] border p-3.5 text-left transition-all duration-200',
                      active
                        ? 'border-[#9ccfdb] bg-white shadow-[0_18px_36px_-30px_rgba(35,110,132,.75)]'
                        : 'border-white/70 bg-white/45 hover:-translate-y-0.5 hover:border-white hover:bg-white/75',
                    )}
                  >
                    <span className="absolute inset-x-0 top-0 h-[2px] opacity-0 transition group-hover:opacity-100" style={{ background: `linear-gradient(90deg, transparent, ${meta.color}, transparent)`, opacity: active ? 1 : undefined }} />
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl border" style={{ color: meta.color, background: meta.soft, borderColor: meta.border }}>
                        <Icon className="h-4 w-4" />
                      </span>
                      {active ? (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full text-white" style={{ background: meta.color }}>
                          <Check className="h-3 w-3" />
                        </span>
                      ) : (
                        <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-[#8ba1a9]">{item.steps} steps</span>
                      )}
                    </div>
                    <p className="mt-2.5 text-[12px] font-semibold leading-tight text-[#173d4a]">{item.name}</p>
                    <p className="mt-1 line-clamp-2 text-[9.5px] leading-relaxed text-[#6e8b95]">{item.description}</p>
                    <div className="mt-2.5 flex items-center justify-between">
                      <span className="text-[8px] font-semibold uppercase tracking-[0.1em]" style={{ color: meta.color }}>{meta.label}</span>
                      <span className="text-[8px] text-[#8ba1a9]">{active ? `${item.steps} steps · selected` : `${item.steps} steps`}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="overflow-hidden self-start">
            <CardHeader>
              <div>
                <CardTitle>Session settings</CardTitle>
                <p className="mt-1 text-[10px] text-[#66766b]">Inputs are stored with the session for a repeatable demo.</p>
              </div>
              <Gauge className="h-4 w-4 text-[#5f7f8b]" />
            </CardHeader>
            <div className="space-y-4 p-5">
              <div>
                <DataLabel>Station / locality context</DataLabel>
                <Select value={stationId} onChange={(event) => setStationId(event.target.value)} className="mt-1.5 h-11 rounded-xl text-[12px]">
                  {eligibleStations.map((station) => (
                    <option key={station.id} value={station.id}>
                      {station.name}{station.localityName ? ` · ${station.localityName}` : ''}
                    </option>
                  ))}
                </Select>
                <p className="mt-1.5 text-[9px] leading-relaxed text-[#8ba1a9]">
                  {selected?.category === 'waste'
                    ? 'Waste scenarios use the station only as a locality anchor.'
                    : 'Only stations matching this category are shown.'}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <DataLabel>Deterministic seed</DataLabel>
                  <button onClick={() => setSeed(String(Math.floor(Math.random() * 900) + 100))} className="inline-flex items-center gap-1 text-[9px] font-semibold text-[#2d7083] hover:text-[#1f5a6b]" type="button">
                    <Shuffle className="h-3 w-3" /> Randomise
                  </button>
                </div>
                <Input type="number" min={1} max={1000000} value={seed} onChange={(event) => setSeed(event.target.value)} className="mt-1.5 h-11 rounded-xl text-[12px]" />
                <p className="mt-1.5 text-[9px] leading-relaxed text-[#8ba1a9]">Keep the seed to replay the exact same sequence later.</p>
              </div>

              <div className="rounded-2xl border border-[#d7e7ea] bg-gradient-to-br from-[#f0f9fb] to-[#f7fbf4] p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <CategoryPill category={selected?.category ?? 'air'} />
                  <span className="text-[9px] font-semibold text-[#557480]">{selected?.steps ?? 0} steps</span>
                </div>
                <p className="mt-2 text-[11px] font-semibold leading-tight text-[#173d4a]">{selected?.name}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(selected?.demonstrates ?? []).slice(0, 4).map((item) => (
                    <span key={item} className="rounded-full border border-white/80 bg-white/70 px-2 py-0.5 text-[8px] font-medium text-[#557480]">{item}</span>
                  ))}
                </div>
              </div>

              <Button variant="teal" className="w-full" onClick={create} disabled={creating || !eligibleStations.length}>
                <Play className="h-4 w-4" /> {creating ? 'Building replay…' : 'Create simulation session'}
              </Button>
              <p className="text-[9px] leading-relaxed text-[#8ba1a9]">
                <ShieldCheck className="mr-1 inline h-3 w-3 align-[-1px]" />
                Every reading, alert, email and incident is written with <code className="rounded bg-[#eef5f6] px-1 text-[#557480]">is_simulated=true</code> and this session id.
              </p>
            </div>
          </Card>
        </div>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="items-center">
          <div>
            <CardTitle>Recent replays</CardTitle>
            <p className="mt-1 text-[10px] text-[#66766b]">Open any session to replay, step through or preview its generated communications.</p>
          </div>
          <Badge tone="neutral">{sessions.length} sessions</Badge>
        </CardHeader>
        {sessions.length === 0 ? (
          <EmptyState title="No replays yet" description="Build a scenario above to create your first isolated simulation session." icon={<FlaskConical className="h-5 w-5" />} />
        ) : (
          <div className="grid gap-2.5 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {sessions.map((session) => {
              const meta = CATEGORY[session.category] ?? CATEGORY.air;
              const Icon = meta.icon;
              const progress = Math.round((session.current_step / Math.max(1, session.total_steps - 1)) * 100);
              return (
                <Link
                  key={session.id}
                  to={`/simulation/${session.id}`}
                  className="group relative overflow-hidden rounded-[20px] border border-white/80 bg-white/55 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-white hover:bg-white/80 hover:shadow-[0_22px_45px_-38px_rgba(23,61,74,.7)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl border" style={{ color: meta.color, background: meta.soft, borderColor: meta.border }}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <Badge tone={session.status === 'COMPLETED' ? 'teal' : 'amber'} dot>{session.status}</Badge>
                  </div>
                  <p className="mt-2.5 text-[12px] font-semibold leading-tight text-[#173d4a]">{scenarioName(session.scenario, scenarios)}</p>
                  <p className="mt-1 truncate text-[9.5px] text-[#6e8b95]">{session.station_name} · {session.locality_name ?? 'Mumbai'}</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e4eff1]">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(3, progress)}%`, background: `linear-gradient(90deg, ${meta.color}, ${meta.color}90)` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[8px] text-[#8ba1a9]">
                    <span>Seed {session.seed} · step {session.current_step}/{Math.max(0, session.total_steps - 1)}</span>
                    <span className="inline-flex items-center gap-1 font-semibold text-[#557480]">
                      {formatDate(session.created_at)} <ArrowUpRight className="h-3 w-3 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </Link>
              );
            })}
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
  const loadRef = useRef<(quiet?: boolean) => void>(() => {});

  const load = (quiet = false) => {
    if (!sessionId) return;
    if (!quiet) setLoading(true);
    api.get<SimulationDetail>(`/simulations/${sessionId}`)
      .then((result) => { setData(result); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load simulation'))
      .finally(() => { if (!quiet) setLoading(false); });
  };
  loadRef.current = load;

  useEffect(() => { load(); }, [sessionId]);

  useEffect(() => {
    if (!playing || !sessionId) return;
    let active = true;
    let timer = 0;

    const tick = async () => {
      try {
        const result = await api.post<{ status: string; step: number }>(`/simulations/${sessionId}/step`);
        if (!active) return;
        await loadRef.current(true);
        if (!active) return;
        if (result.status === 'COMPLETED') {
          setPlaying(false);
          return;
        }
        timer = window.setTimeout(tick, 1400);
      } catch {
        if (active) setPlaying(false);
      }
    };

    timer = window.setTimeout(tick, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [playing, sessionId]);

  const togglePlay = async () => {
    if (!sessionId) return;
    if (playing) {
      setPlaying(false);
      api.post(`/simulations/${sessionId}/pause`).catch(() => {});
      return;
    }
    setPlaying(true);
    api.post(`/simulations/${sessionId}/play`).catch((err) => {
      setPlaying(false);
      toast.error(err instanceof Error ? err.message : 'Could not start the replay');
    });
  };

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

  const events = data?.events ?? [];
  const latest = events[events.length - 1]?.payload;
  const previous = events[events.length - 2]?.payload;
  const atEnd = data ? data.session.current_step >= data.session.total_steps - 1 : false;
  const currentStep = data?.session.current_step ?? 0;
  const totalSteps = data?.session.total_steps ?? 1;

  const metricKey = latest
    ? (['pm25', 'ph', 'stack_pm'].find((key) => latest.values[key]) ?? Object.keys(latest.values)[0] ?? 'pm25')
    : 'pm25';
  const metric = latest?.values[metricKey];
  const previousMetric = previous?.values[metricKey];
  const delta = metric && previousMetric ? metric.value - previousMetric.value : null;

  const chartOption = useMemo(() => {
    const points = events.map((event) => ({
      step: event.payload.step,
      value: event.payload.values[metricKey]?.value ?? null,
    }));
    const color = '#2d7c94';
    return {
      grid: { ...chartGrid, left: 44, right: 18, top: 24, bottom: 28 },
      tooltip: {
        ...chartTooltip,
        formatter: (params: Array<{ dataIndex: number; value: number }> | { dataIndex: number; value: number }) => {
          const point = Array.isArray(params) ? params[0] : params;
          if (!point) return '';
          return `<div style="font-size:10px;color:#6e8b95">Step ${point.dataIndex}</div><div style="font-size:13px;font-weight:600;color:#173d4a">${number(point.value)} ${metric?.unit ?? ''}</div>`;
        },
      },
      xAxis: {
        type: 'category',
        data: points.map((point) => `S${point.step}`),
        boundaryGap: false,
        ...chartAxis,
        axisLine: { lineStyle: { color: '#d7e7ea' } },
        axisLabel: { ...chartAxis.axisLabel, color: '#78919a', interval: Math.max(1, Math.floor(points.length / 9)) },
      },
      yAxis: {
        type: 'value',
        name: metric?.unit ?? '',
        nameTextStyle: { color: '#8ba1a9', fontSize: 9 },
        ...chartAxis,
        splitLine: { lineStyle: { color: '#e9f1f2', type: 'dashed' } },
        axisLabel: { ...chartAxis.axisLabel, color: '#78919a' },
      },
      series: [{
        type: 'line',
        smooth: 0.35,
        symbol: 'circle',
        symbolSize: points.length > 30 ? 0 : 5,
        data: points.map((point) => point.value),
        lineStyle: { color, width: 2.6 },
        itemStyle: { color, borderColor: '#ffffff', borderWidth: 1.5 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(45,124,148,.20)' },
              { offset: 1, color: 'rgba(45,124,148,0)' },
            ],
          },
        },
      }],
    };
  }, [events, metricKey, metric?.unit]);

  if (loading) return <LoadingBlock className="min-h-[60vh]" label="Loading simulation replay" />;
  if (error || !data) return <EmptyState title="Simulation unavailable" description={error ?? 'Simulation not found.'} icon={<FlaskConical className="h-5 w-5" />} action={<Button variant="teal" onClick={() => load()}>Retry</Button>} />;

  const meta = CATEGORY[data.session.category] ?? CATEGORY.air;
  const scenario = data.scenario?.name ?? scenarioName(data.session.scenario, []);
  const progress = Math.min(1, currentStep / Math.max(1, totalSteps - 1));
  const peak = events.reduce((best, event) => Math.max(best, event.payload.values[metricKey]?.value ?? 0), 0);
  const riskColor = alertTone(latest?.risk.alertState);
  const riskScore = latest?.risk.riskScore;

  return (
    <div className="space-y-4">
      <section className="atmo-hero relative overflow-hidden rounded-[30px]">
        <div className="atmo-sun right-[7%] top-[-80px] h-[104px] w-[104px]" aria-hidden />
        <div className="atmo-cloud right-[20%] top-[26px] h-[14px] w-[72px]" aria-hidden />
        <div className="atmo-skyline" aria-hidden />

        <div className="relative z-10 grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#bcdde5] bg-white/65 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#2d7083] backdrop-blur">
                <FlaskConical className="h-3 w-3" /> Replay lab
              </span>
              <CategoryPill category={data.session.category} />
              <Badge tone={data.session.status === 'COMPLETED' ? 'teal' : 'amber'} dot>{data.session.status}</Badge>
              <span className="rounded-full border border-white/80 bg-white/50 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-[#5f7f8b]">Seed {data.session.seed}</span>
            </div>
            <h1 className="display mt-2.5 text-[28px] font-bold leading-[1.02] tracking-[-0.05em] text-[#123240] sm:text-[36px]">{scenario}</h1>
            <p className="mt-1.5 text-[11px] text-[#527482]">
              <span className="font-semibold text-[#305d6c]">{data.session.station_name}</span>
              {' · '}{data.session.locality_name ?? 'Mumbai'}{' · '}created by {data.session.created_by_name ?? '—'}{' · '}{formatDate(data.session.created_at)}
            </p>
            <div className="mt-4 grid max-w-lg grid-cols-3 gap-2">
              <Stat label="Timeline" value={`${currentStep}/${Math.max(0, totalSteps - 1)}`} note={`${events.length} events revealed`} />
              <Stat label="Alerts" value={data.alerts.length} note="simulation-labelled" />
              <Stat label="Incidents" value={data.incidents.length} note="isolated records" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 lg:justify-end">
            <GaugeRing progress={progress} size={126} stroke={10} color={meta.color} track="rgba(255,255,255,.62)">
              <span className="text-[8px] font-semibold uppercase tracking-[0.14em] text-[#6e8b95]">Step</span>
              <span className="display mt-0.5 text-[30px] font-bold leading-none tracking-[-0.05em] text-[#123240]">{currentStep}</span>
              <span className="mt-1 text-[8px] text-[#8ba1a9]">of {Math.max(0, totalSteps - 1)}</span>
            </GaugeRing>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="teal" size="md" onClick={togglePlay} disabled={(atEnd && !playing) || working} className="col-span-2 min-w-[152px]">
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {playing ? 'Pause replay' : atEnd ? 'Replay complete' : 'Play replay'}
              </Button>
              <Button variant="dark" size="sm" onClick={step} disabled={working || atEnd}><SkipForward className="h-3.5 w-3.5" /> Step</Button>
              <Button variant="dark" size="sm" onClick={reset} disabled={working}><RotateCcw className="h-3.5 w-3.5" /> Reset</Button>
              <Link to="/simulation" className="col-span-2">
                <Button variant="ghost" size="sm" className="w-full"><ArrowLeft className="h-3.5 w-3.5" /> All sessions</Button>
              </Link>
            </div>
          </div>
        </div>

        <div className="relative z-10 px-5 pb-5 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="text-[8px] font-semibold uppercase tracking-[0.1em] text-[#6e8b95]">S0</span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/55">
              <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500" style={{ width: `${Math.max(2, progress * 100)}%`, background: `linear-gradient(90deg, ${meta.color}, ${meta.color}bb)` }} />
              {Array.from({ length: 9 }, (_, index) => (
                <span key={index} className="absolute top-0 h-full w-px bg-white/70" style={{ left: `${(index / 8) * 100}%` }} />
              ))}
            </div>
            <span className="text-[8px] font-semibold uppercase tracking-[0.1em] text-[#6e8b95]">S{Math.max(0, totalSteps - 1)}</span>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#cfe2e6] bg-white/55 px-4 py-2.5 text-[10px] leading-relaxed text-[#557480] backdrop-blur">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#2d7c94]" />
        <span>{data.isolation.note} Every event below is simulation-labelled. Emails are previews or SIMULATED records only.</span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <CardHeader className="items-end">
              <div>
                <CardTitle>Replay trajectory</CardTitle>
                <p className="mt-1 text-[10px] text-[#66766b]">{metricLabel(metricKey)} · {data.session.station_name}</p>
              </div>
              <div className="text-right">
                <p className="display text-[30px] font-bold leading-none tracking-[-0.05em]" style={{ color: meta.color }}>
                  {number(metric?.value)}<span className="ml-1 align-middle text-[10px] font-medium tracking-normal text-[#8ba1a9]">{metric?.unit ?? ''}</span>
                </p>
                <p className="mt-1 flex items-center justify-end gap-1 text-[9px] font-semibold" style={{ color: delta !== null && delta > 0.004 ? '#cf7227' : '#3f9a83' }}>
                  <TrendingUp className={classNames('h-3 w-3', delta !== null && delta < -0.004 && 'rotate-180')} />
                  {delta === null
                    ? 'first revealed step'
                    : Math.abs(delta) < 0.005
                      ? 'unchanged vs previous step'
                      : `${delta > 0 ? '+' : ''}${number(delta)} ${metric?.unit ?? ''} vs previous step`}
                </p>
              </div>
            </CardHeader>
            <div className="px-2 pb-2 pt-3">
              <Chart height={300} empty={events.length === 0} option={chartOption} />
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-dashed border-[#dbe5d6] p-3 sm:grid-cols-4">
              <Stat label="Peak" value={`${number(peak)}`} note={metric?.unit} />
              <Stat label="At step" value={currentStep} note={`${events.length} revealed`} />
              <Stat label="Alert state" value={latest?.risk.alertState ?? '—'} note={latest?.risk.riskLevel ?? 'no assessment'} />
              <Stat label="Confidence" value={latest?.risk.confidenceScore ?? '—'} note={latest?.risk.confidenceLevel ?? '—'} />
            </div>
          </Card>

          {latest ? (
            <Card className="overflow-hidden">
              <CardHeader className="items-center">
                <div>
                  <CardTitle>Current simulated state</CardTitle>
                  <p className="mt-1 text-[10px] text-[#66766b]">Step {latest.step} · {formatDate(latest.observedAt)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <RiskBadge level={latest.risk.alertState} />
                  {latest.suppressAlert ? <Badge tone="amber">Alert suppressed</Badge> : null}
                </div>
              </CardHeader>
              <div className="p-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  {Object.entries(latest.values).map(([code, value]) => (
                    <div key={code} className={classNames('rounded-2xl border p-3', value.qualityState === 'SUSPECT' ? 'border-[#eed9a8] bg-[#fdf8ec]' : 'border-white/80 bg-white/55')}>
                      <div className="flex items-center justify-between">
                        <DataLabel>{metricLabel(code)}</DataLabel>
                        <span className={classNames('h-1.5 w-1.5 rounded-full', value.qualityState === 'SUSPECT' ? 'bg-amber-500' : 'bg-emerald-500')} />
                      </div>
                      <p className="display mt-1 text-[22px] font-bold leading-none tracking-[-0.04em] text-[#173d4a]">
                        {number(value.value)} <span className="text-[10px] font-medium tracking-normal text-[#8ba1a9]">{value.unit}</span>
                      </p>
                      <p className={classNames('mt-1.5 text-[8px] font-semibold uppercase tracking-[0.1em]', value.qualityState === 'SUSPECT' ? 'text-amber-600' : 'text-[#8ba1a9]')}>{value.qualityState}</p>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#e5eff1]">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(4, (value.value / Math.max(1, peak)) * 100))}%`, background: value.qualityState === 'SUSPECT' ? '#d5a32a' : meta.color }} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 rounded-2xl border border-[#e4eef0] bg-[#f7fbfb] px-3.5 py-2.5 text-[11px] leading-relaxed text-[#405f6b]">{latest.note}</p>
                {latest.neighbour ? (
                  <p className="mt-2 flex items-start gap-2 rounded-2xl border border-[#c7e3ea] bg-[#eef8fa] px-3.5 py-2.5 text-[10px] leading-relaxed text-[#2d7083]">
                    <Wind className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span><b>{latest.neighbour.name}</b> · {latest.neighbour.pm25} µg/m³. {latest.neighbour.note}</span>
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}

          <Card className="overflow-hidden">
            <CardHeader className="items-center">
              <div>
                <CardTitle>Event history</CardTitle>
                <p className="mt-1 text-[10px] text-[#66766b]">Only revealed steps are listed. Reset moves the replay position, not the records.</p>
              </div>
              <Badge tone="neutral">{events.length} events</Badge>
            </CardHeader>
            <div className="scrollbar-thin max-h-[380px] overflow-auto px-5 py-4">
              {events.length === 0 ? <p className="text-[10px] text-[#66766b]">No steps revealed yet.</p> : (
                <div className="relative">
                  <span className="absolute bottom-2 left-[5px] top-2 w-px bg-[#dbe8ea]" aria-hidden />
                  {events.map((event) => (
                    <div key={event.step} className="relative pb-4 pl-6 last:pb-0">
                      <span className="absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-white shadow-sm" style={{ background: alertTone(event.payload.risk.alertState) }} aria-hidden />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#2d7083]">Step {event.payload.step}</span>
                          <RiskBadge level={event.payload.risk.alertState} />
                          <span className="text-[8px] text-[#8ba1a9]">{formatDate(event.payload.observedAt)}</span>
                        </div>
                        {event.payload.suppressAlert ? <Badge tone="amber">Suppressed</Badge> : null}
                      </div>
                      <p className="mt-1 text-[10.5px] leading-relaxed text-[#527482]">{event.payload.note}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {latest ? (
            <Card className="overflow-hidden">
              <CardHeader className="items-center">
                <div>
                  <CardTitle>Risk assessment</CardTitle>
                  <p className="mt-1 text-[10px] text-[#66766b]">Severity and confidence are separate signals.</p>
                </div>
                <RiskBadge level={latest.risk.alertState} />
              </CardHeader>
              <div className="p-5">
                <div className="flex items-center gap-4">
                  <GaugeRing progress={riskScore !== null && riskScore !== undefined ? riskScore / 100 : 0} size={108} stroke={9} color={riskColor} track="#e8eff0">
                    <span className="display text-[27px] font-bold leading-none tracking-[-0.05em] text-[#173d4a]">{riskScore ?? '—'}</span>
                    <span className="mt-0.5 text-[8px] uppercase tracking-[0.1em] text-[#8ba1a9]">of 100</span>
                  </GaugeRing>
                  <div className="min-w-0">
                    <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-[#8ba1a9]">Risk level</p>
                    <p className="display mt-0.5 text-[18px] font-bold leading-tight tracking-[-0.03em] text-[#173d4a]">{latest.risk.riskLevel}</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e8eff0]">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(3, (latest.risk.confidenceScore ?? 0))}%`, background: '#3f9a83' }} />
                    </div>
                    <p className="mt-1 text-[9px] text-[#6e8b95]">Confidence {latest.risk.confidenceScore ?? '—'}/100 · {latest.risk.confidenceLevel}</p>
                  </div>
                </div>
                <p className="mt-4 border-t border-dashed border-[#dbe5d6] pt-3 text-[9px] leading-relaxed text-[#6e8b95]">{latest.risk.method}</p>
                {latest.risk.missingInputs.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {latest.risk.missingInputs.map((item) => (
                      <span key={item} className="rounded-full border border-[#ead9b6] bg-[#fdf6e8] px-2 py-0.5 text-[8px] text-[#9b6a25]">{item}</span>
                    ))}
                  </div>
                ) : null}
                {latest.suppressAlert ? (
                  <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-[#ead9b6] bg-[#fdf6e8] px-2.5 py-2 text-[9px] leading-relaxed text-[#9b6a25]">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Alert suppressed because the reading quality is degraded.
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}

          <Card className="overflow-hidden">
            <CardHeader className="items-center">
              <div>
                <CardTitle>Simulated alerts</CardTitle>
                <p className="mt-1 text-[10px] text-[#66766b]">Generated only by this session.</p>
              </div>
              <Badge tone="neutral">{data.alerts.length}</Badge>
            </CardHeader>
            <div className="divide-y divide-[#e7ece3]">
              {data.alerts.map((alert) => (
                <div key={alert.id} className="p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <RiskBadge level={alert.level} />
                    <span className="text-[8px] font-semibold uppercase tracking-[0.08em] text-[#8ba1a9]">{alert.trigger_type}</span>
                  </div>
                  <p className="mt-1.5 text-[10.5px] font-medium leading-snug text-[#173d4a]">{alert.title}</p>
                  <p className="mt-0.5 text-[8px] text-[#8ba1a9]">{alert.public_ref} · {formatDate(alert.triggered_at)}</p>
                </div>
              ))}
              {data.alerts.length === 0 ? <p className="px-4 py-5 text-[10px] leading-relaxed text-[#66766b]">No simulated alert yet. Advance the replay until an alert transition occurs.</p> : null}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="items-center">
              <div>
                <CardTitle>Replay actions</CardTitle>
                <p className="mt-1 text-[10px] text-[#66766b]">Preview the workflow, not a real mailing list.</p>
              </div>
              <Sparkles className="h-4 w-4 text-[#2d7c94]" />
            </CardHeader>
            <div className="space-y-2 p-4">
              <Button variant="dark" size="sm" className="w-full justify-start" onClick={previewEmail} disabled={data.alerts.length === 0}>
                <Mail className="h-3.5 w-3.5" /> Preview public & authority email
              </Button>
              <Button variant="teal" size="sm" className="w-full justify-start" onClick={createIncident} disabled={working || data.alerts.length === 0}>
                <ShieldAlert className="h-3.5 w-3.5" /> Create simulated incident
              </Button>
              <p className="text-[9px] leading-relaxed text-[#8ba1a9]">
                <CheckCircle2 className="mr-1 inline h-3 w-3 align-[-1px]" />
                No real recipient is emailed. Incidents are written with this simulation session id and stay out of operational lists.
              </p>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="items-center">
              <div>
                <CardTitle>Simulated notifications</CardTitle>
                <p className="mt-1 text-[10px] text-[#66766b]">Stored as SIMULATED records.</p>
              </div>
              <Badge tone="neutral">{data.notifications.length}</Badge>
            </CardHeader>
            <div className="divide-y divide-[#e7ece3]">
              {data.notifications.slice(0, 6).map((notification) => (
                <div key={notification.id} className="px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-[#557480]">{notification.audience} · {notification.template.replace(/_/g, ' ')}</span>
                    <Badge tone={notification.status === 'SIMULATED' ? 'amber' : 'neutral'}>{notification.status}</Badge>
                  </div>
                  <p className="mt-0.5 truncate text-[9px] text-[#8ba1a9]">{notification.subject}</p>
                </div>
              ))}
              {data.notifications.length === 0 ? <p className="px-4 py-5 text-[10px] text-[#66766b]">No simulated notifications yet.</p> : null}
              {data.notifications.length > 6 ? <p className="px-3.5 py-2 text-[8px] text-[#8ba1a9]">Showing the latest 6 of {data.notifications.length} simulated notifications.</p> : null}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="items-center">
              <div>
                <CardTitle>Simulated incidents</CardTitle>
                <p className="mt-1 text-[10px] text-[#66766b]">Evidence from this replay only.</p>
              </div>
              <Badge tone="neutral">{data.incidents.length}</Badge>
            </CardHeader>
            <div className="divide-y divide-[#e7ece3]">
              {data.incidents.map((incident) => (
                <Link key={incident.id} to={`/incidents/${incident.id}`} className="block px-3.5 py-2.5 transition hover:bg-white/70">
                  <div className="flex items-center justify-between gap-2">
                    <RiskBadge level={incident.risk_level} />
                    <span className="text-[8px] uppercase tracking-[0.06em] text-[#8ba1a9]">{incident.status.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="mt-1 text-[10px] font-medium leading-snug text-[#173d4a]">{incident.title}</p>
                  <p className="mt-0.5 text-[8px] text-[#8ba1a9]">{incident.public_ref}</p>
                </Link>
              ))}
              {data.incidents.length === 0 ? <p className="px-4 py-5 text-[10px] text-[#66766b]">No simulated incident created.</p> : null}
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent title="Replay email preview" description="Simulation-generated email. Not sent to a real mailing list." className="!max-w-4xl">
          {preview ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="amber" dot>Simulated</Badge>
                <span className="text-[9px] text-[#8ba1a9]">Public and authority variants of the latest generated alert.</span>
              </div>
              <div className="space-y-3">
                <div className="overflow-hidden rounded-2xl border border-[#dfe6db] bg-white">
                  <div className="border-b border-[#e7ece3] bg-[#f7fbfb] px-3.5 py-2.5">
                    <DataLabel>Public email</DataLabel>
                    <p className="mt-1 truncate text-[10px] font-medium text-[#173d4a]">{preview.public.subject}</p>
                  </div>
                  <iframe title="Public email preview" srcDoc={preview.public.html} sandbox="" className="h-[44vh] w-full bg-white" />
                </div>
                <div className="overflow-hidden rounded-2xl border border-[#dfe6db] bg-white">
                  <div className="border-b border-[#e7ece3] bg-[#f7fbfb] px-3.5 py-2.5">
                    <DataLabel>Authority email</DataLabel>
                    <p className="mt-1 truncate text-[10px] font-medium text-[#173d4a]">{preview.authority.subject}</p>
                  </div>
                  <iframe title="Authority email preview" srcDoc={preview.authority.html} sandbox="" className="h-[44vh] w-full bg-white" />
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
