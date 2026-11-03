import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BellRing,
  BrainCircuit,
  Building2,
  Camera,
  CheckCircle2,
  CloudSun,
  Droplets,
  Factory,
  FileSearch,
  Flame,
  Gauge,
  Layers3,
  MapPin,
  Radio,
  Scale,
  ShieldAlert,
  Sparkles,
  Wind,
} from 'lucide-react';
import { PublicNav } from '../../components/PublicNav';
import { Footer } from '../../components/Footer';
import { MumbaiMap, type MapStation } from '../../components/MumbaiMap';
import { PublicBadge, Button, PublicInput, PublicLabel, PublicSelect, PublicTextarea } from '../../components/ui';
import { api } from '../../lib/api';
import { AQI_COLORS, number } from '../../lib/format';

interface Overview {
  demoMode: boolean;
  stationDataMode?: 'SIMULATION' | 'MIXED' | 'LIVE_SOURCE';
  stationCounts?: { simulated: number; connectedSource: number };
  stations: Array<{
    id: string;
    name: string;
    locality: string;
    lat: number;
    lng: number;
    aqi: number | null;
    aqiCategory: string;
    pm25: number | null;
    isSimulated: boolean;
    latestObservedAt: string | null;
  }>;
  alertCounts: Array<{ category: string; count: number }>;
  reportCounts: Array<{ category: string; count: number }>;
  latestObservationAt: string | null;
  weather: { temperature_c: number; wind_speed_kmh: number; relative_humidity: number; observed_at: string } | null;
  sources: Array<{ id: string; name: string; status: string; notes?: string }>;
  labels: Record<string, string>;
}

const categories = [
  {
    id: 'air',
    title: 'Air pollution',
    copy: 'PM2.5, PM10 and gaseous pollutants, with persistence baselines and forecast transparency.',
    stat: 'Primary predictive capability',
    icon: Wind,
    art: 'air',
    className: 'lg:col-span-2 bg-lime',
  },
  {
    id: 'water',
    title: 'Water pollution',
    copy: 'Available water-quality samples, discharge reports and reference criteria — no invented readings.',
    stat: 'Evidence dependent',
    icon: Droplets,
    art: 'water',
    className: 'bg-white',
  },
  {
    id: 'waste',
    title: 'Unsafe waste disposal',
    copy: 'Citizen reports, repeat hotspots and verification state. A single complaint is never a confirmed violation.',
    stat: 'Report evidence',
    icon: Flame,
    art: 'waste',
    className: 'bg-[#eef0e8]',
  },
  {
    id: 'industrial',
    title: 'Industrial emissions',
    copy: 'Available stack monitoring, verified reports and investigation workflows without facility blame games.',
    stat: 'Investigation led',
    icon: Factory,
    art: 'industrial',
    className: 'bg-[#111310] text-white lg:col-span-2',
  },
];

function CategoryArt({ kind }: { kind: string }) {
  if (kind === 'air') {
    return (
      <svg viewBox="0 0 220 150" className="h-full w-full" aria-hidden>
        <circle cx="156" cy="48" r="28" fill="none" stroke="#111310" strokeWidth="1.5" strokeDasharray="3 4" />
        <path d="M32 58c18-18 36-18 54 0s36 18 54 0 36-18 54 0" fill="none" stroke="#111310" strokeWidth="2" strokeLinecap="round" />
        <path d="M32 78c18-18 36-18 54 0s36 18 54 0 36-18 54 0" fill="none" stroke="#111310" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
        <path d="M32 98c18-18 36-18 54 0s36 18 54 0 36-18 54 0" fill="none" stroke="#111310" strokeWidth="2" strokeLinecap="round" opacity="0.2" />
        <rect x="142" y="70" width="8" height="44" rx="3" fill="#111310" />
        <circle cx="146" cy="66" r="7" fill="#111310" />
        <path d="M132 114h28" stroke="#111310" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'water') {
    return (
      <svg viewBox="0 0 220 150" className="h-full w-full" aria-hidden>
        <path d="M28 92c22-20 38-20 60 0s38 20 60 0 30-16 44-6" fill="none" stroke="#111310" strokeWidth="2" strokeLinecap="round" />
        <path d="M28 112c22-20 38-20 60 0s38 20 60 0 30-16 44-6" fill="none" stroke="#111310" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
        <path d="M110 32c12 18 20 30 20 41a20 20 0 1 1-40 0c0-11 8-23 20-41Z" fill="#b9ff66" stroke="#111310" strokeWidth="2" />
        <circle cx="102" cy="70" r="4" fill="#111310" opacity="0.35" />
        <path d="M166 42l8 14 8-14" fill="none" stroke="#111310" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'waste') {
    return (
      <svg viewBox="0 0 220 150" className="h-full w-full" aria-hidden>
        <path d="M64 62h80l-8 66H72l-8-66Z" fill="none" stroke="#111310" strokeWidth="2" />
        <path d="M54 62h100M88 50h32" stroke="#111310" strokeWidth="2" strokeLinecap="round" />
        <path d="M96 82v30M112 82v30M128 82v30" stroke="#111310" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
        <circle cx="166" cy="42" r="14" fill="#b9ff66" stroke="#111310" strokeWidth="2" />
        <path d="M160 42l4 4 8-9" fill="none" stroke="#111310" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 220 150" className="h-full w-full" aria-hidden>
      <path d="M40 112V68l30-18v62M70 112V50l28 18v44M98 112V68l30-18v62M128 112V50l28 18v44" fill="none" stroke="#b5e36b" strokeWidth="2" strokeLinejoin="round" />
      <path d="M30 112h160" stroke="#b5e36b" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <path d="M54 54c8-14 16-20 24-18s8 14 0 22" fill="none" stroke="#b5e36b" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <circle cx="170" cy="40" r="18" fill="none" stroke="#b5e36b" strokeWidth="1.5" strokeDasharray="3 4" />
      <path d="M162 40h16M170 32v16" stroke="#b5e36b" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Reveal({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 22 }}
      whileInView={reduce ? {} : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function LandingPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [reportCategory, setReportCategory] = useState('air');
  const [reportLocality, setReportLocality] = useState('');

  useEffect(() => {
    api.get<Overview>('/public/overview').then(setOverview).catch(() => setOverview(null));
  }, []);

  const stations: MapStation[] = (overview?.stations ?? []).map((station) => ({
    id: station.id,
    name: station.name,
    locality: station.locality,
    lat: station.lat,
    lng: station.lng,
    color: AQI_COLORS[station.aqiCategory] ?? '#b5e36b',
    valueLabel: station.aqi !== null ? `AQI ${station.aqi} · ${station.aqiCategory}` : 'No recent value',
    markerKind: 'OBSERVED',
    isSimulated: true,
    aqi: station.aqi,
    aqiCategory: station.aqiCategory,
    latestObservedAt: station.latestObservedAt,
  }));

  const activeAlerts = overview?.alertCounts.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const stationMode = overview?.stationDataMode ?? 'SIMULATION';
  const cpcbConnected = overview?.sources.some((source) => ['cpcb-caaqms', 'data-gov-in-air', 'openaq'].includes(source.id) && source.status === 'CONNECTED');
  const stationOverlay = stationMode === 'LIVE_SOURCE' ? 'Live stations' : stationMode === 'MIXED' ? 'Live + demo stations' : 'Demo stations';
  const reports7d = overview?.reportCounts.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const demoStations = overview?.stations.length ?? 0;
  const weather = overview?.weather;

  return (
    <div className="min-h-screen bg-paper text-ink">
      <PublicNav />

      <section className="relative overflow-hidden border-b border-ink/10">
        <div className="pointer-events-none absolute -right-20 top-24 h-[420px] w-[420px] rounded-full bg-lime/35 blur-[110px]" />
        <div className="mx-auto grid max-w-[1440px] gap-10 px-5 pb-16 pt-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-10 lg:pb-20 lg:pt-16">
          <div className="relative z-10">
            <PublicBadge tone="outline" className="mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-[#32a879]" />
              Mumbai-specific · Source-labelled data
            </PublicBadge>
            <h1 className="display max-w-[680px] text-[46px] font-bold leading-[0.95] tracking-[-0.055em] sm:text-[62px] lg:text-[76px]">
              Understand Mumbai&apos;s environment.
              <br />
              <span className="lime-underline">Act before</span> conditions get worse.
            </h1>
            <p className="mt-6 max-w-[560px] text-[15px] leading-relaxed text-ink/60">
              A unified environmental intelligence platform connecting monitoring data, predictive insights, citizen
              observations and compliance workflows across Greater Mumbai.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/dashboard">
                <Button variant="lime" size="lg" className="w-full border border-ink/10 sm:w-auto">
                  Explore environmental intelligence <ArrowUpRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/report">
                <Button variant="outline" size="lg" className="w-full border-ink/20 sm:w-auto">
                  Report an environmental concern
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="ghost" size="lg" className="w-full sm:w-auto">
                  Authority login <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
            <div className="mt-8 grid max-w-[540px] grid-cols-3 gap-4 border-t border-ink/15 pt-5">
              <div>
                <p className="display text-2xl font-bold">{number(demoStations, 0)}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/45">Stations shown</p>
              </div>
              <div>
                <p className="display text-2xl font-bold">{number(activeAlerts, 0)}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/45">Active alerts</p>
              </div>
              <div>
                <p className="display text-2xl font-bold">{number(reports7d, 0)}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/45">Reports · 7 days</p>
              </div>
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-ink/40">
              Counts are read from this deployment. Synthetic demo records are labelled SIMULATION DATA; connected-source
              records show their source and timestamp. Weather is live from Open-Meteo; check the source registry for CPCB/MPCB status.
            </p>
          </div>

          <div className="relative">
            <div className="relative overflow-hidden rounded-[32px] border border-ink/15 bg-[#dfe7d8] shadow-lift">
              <div className="absolute left-4 top-4 z-20 flex flex-col gap-2">
                <PublicBadge tone="lime" className="shadow-sm">{stationMode === 'SIMULATION' ? 'Demonstration map' : 'Mumbai station map'}</PublicBadge>
                <span className="w-fit rounded-full border border-ink/15 bg-white/80 px-3 py-1 text-[10px] font-medium text-ink/60 backdrop-blur">
                  Greater Mumbai boundary · OSM
                </span>
              </div>
              <MumbaiMap
                stations={stations}
                className="landing-map h-[440px] w-full sm:h-[520px]"
                compact
                theme="light"
                initialZoom={10.9}
                initialPitch={26}
                overlayLabel={stationOverlay}
              />
              <div className="absolute inset-x-4 bottom-9 z-20 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-ink/10 bg-white/90 p-3 backdrop-blur">
                  <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-ink/45">
                    <CloudSun className="h-3 w-3" /> Weather · live
                  </div>
                  <p className="mt-1 text-sm font-semibold">
                    {weather ? `${number(weather.temperature_c)}°C · ${number(weather.wind_speed_kmh)} km/h` : 'Unavailable'}
                  </p>
                </div>
                <div className="rounded-xl border border-ink/10 bg-white/90 p-3 backdrop-blur">
                  <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-ink/45">
                    <Radio className="h-3 w-3" /> CPCB / source
                  </div>
                  <p className={`mt-1 text-sm font-semibold ${cpcbConnected ? 'text-emerald-700' : 'text-amber-700'}`}>{cpcbConnected ? 'Connected' : 'Not connected'}</p>
                </div>
                <div className="rounded-xl border border-ink/10 bg-white/90 p-3 backdrop-blur">
                  <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-ink/45">
                    <BrainCircuit className="h-3 w-3" /> ML forecast
                  </div>
                  <p className="mt-1 text-sm font-semibold text-amber-700">Not trained</p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-5 py-16 lg:px-10 lg:py-24" id="categories">
        <Reveal>
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <PublicBadge tone="soft">Environmental overview</PublicBadge>
              <h2 className="display mt-4 max-w-[720px] text-[36px] font-bold leading-[1.02] sm:text-[48px]">
                Four environmental categories. <span className="text-ink/35">One evidence chain.</span>
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-ink/55">
              Air pollution receives the deepest predictive treatment. Water, waste and industrial categories remain
              evidence-bound: no coverage is invented where monitoring does not exist.
            </p>
          </div>
        </Reveal>
        <div className="mt-9 grid gap-4 lg:grid-cols-3">
          {categories.map((category, index) => {
            const Icon = category.icon;
            const count = overview?.alertCounts.find((a) => a.category === category.id)?.count ?? 0;
            return (
              <Reveal key={category.id} delay={index * 0.06} className={category.className}>
                <div className="flex h-full min-h-[280px] flex-col justify-between rounded-[28px] border border-ink/15 p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${category.id === 'industrial' ? 'bg-white/10' : 'bg-ink text-lime'}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${category.id === 'industrial' ? 'text-white/45' : 'text-ink/45'}`}>
                          {category.stat}
                        </span>
                      </div>
                      <h3 className="display mt-4 text-[26px] font-bold tracking-[-0.04em]">{category.title}</h3>
                      <p className={`mt-2 max-w-[340px] text-[13px] leading-relaxed ${category.id === 'industrial' ? 'text-white/55' : 'text-ink/55'}`}>
                        {category.copy}
                      </p>
                    </div>
                    <div className="h-[90px] w-[120px] shrink-0 opacity-90">
                      <CategoryArt kind={category.art} />
                    </div>
                  </div>
                  <div className={`mt-6 flex items-center justify-between border-t pt-4 ${category.id === 'industrial' ? 'border-white/15' : 'border-ink/15'}`}>
                    <span className={`text-[11px] ${category.id === 'industrial' ? 'text-white/50' : 'text-ink/50'}`}>
                      {count} active alert{count === 1 ? '' : 's'} · simulation-labelled
                    </span>
                    <Link to="/dashboard" className={`inline-flex items-center gap-1 text-[11px] font-semibold ${category.id === 'industrial' ? 'text-[#b5e36b]' : 'text-ink'}`}>
                      Open view <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      <section className="border-y border-ink/10 bg-[#eef0e8]">
        <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-10 lg:py-24">
          <Reveal>
            <PublicBadge tone="outline">Mumbai intelligence map</PublicBadge>
            <h2 className="display mt-4 text-[36px] font-bold leading-[1.02] sm:text-[48px]">
              A city-scale view that never pretends to know more than it does.
            </h2>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-ink/55">
              Monitoring stations, citizen reports and official incidents share one geographical frame. Measured values are
              filled. Predictions are hollow. Reports are distinct. Estimated zones are not drawn where the network is too
              sparse.
            </p>
            <ul className="mt-7 space-y-3 text-sm text-ink/65">
              {[
                ['Measured observations', 'filled markers with source and timestamp'],
                ['Predicted conditions', 'hollow markers, labelled model and horizon'],
                ['Citizen reports', 'verification state always attached'],
                ['Official incidents', 'separate workflow markers and audit history'],
              ].map(([title, detail]) => (
                <li key={title} className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ink" />
                  <span><strong className="font-semibold text-ink">{title}</strong> — {detail}</span>
                </li>
              ))}
            </ul>
            <Link to="/map" className="mt-8 inline-flex">
              <Button variant="dark" size="lg">Open the live map <ArrowUpRight className="h-4 w-4" /></Button>
            </Link>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="relative overflow-hidden rounded-[30px] border border-ink/15 bg-[#dbe4d4] shadow-lift">
              <div className="absolute left-4 top-4 z-20">
                <PublicBadge tone="lime">Demo stations + OSM boundary</PublicBadge>
              </div>
              <MumbaiMap
                stations={stations}
                className="landing-map h-[430px] w-full sm:h-[500px]"
                compact
                theme="light"
                initialZoom={11.2}
                initialPitch={34}
                overlayLabel={stationOverlay}
              />
              <div className="absolute bottom-9 right-4 z-20 max-w-[260px] rounded-xl border border-ink/10 bg-white/90 p-3 text-[10px] leading-relaxed text-ink/60 backdrop-blur">
                <strong className="text-ink">No interpolated pollution surface.</strong> The monitoring network is sparse and
                demo observations are synthetic. A point reading does not establish concentration across a locality.
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-5 py-16 lg:px-10 lg:py-24">
        <div className="overflow-hidden rounded-[32px] border border-ink/15 bg-[#111310] text-white">
          <div className="grid gap-10 p-6 sm:p-10 lg:grid-cols-[1.05fr_0.95fr] lg:p-12">
            <Reveal>
              <PublicBadge tone="lime">Predictive intelligence</PublicBadge>
              <h2 className="display mt-4 text-[36px] font-bold leading-[1.02] sm:text-[46px]">
                Forecasts with the receipts attached.
              </h2>
              <p className="mt-5 max-w-lg text-sm leading-relaxed text-white/55">
                The platform is designed for 1-hour, 3-hour and 6-hour PM2.5 forecasts, quantile intervals, a calibrated
                deterioration classifier and anomaly detection. Those models are <strong className="text-white">NOT TRAINED</strong> in
                this deployment because no verified Mumbai historical extract has been supplied.
              </p>
              <div className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4 text-xs leading-relaxed text-amber-100/80">
                <strong className="text-amber-200">What you see instead:</strong> a clearly labelled persistence baseline with an
                empirical 80% band. It is not a trained LightGBM model, not calibrated, and not presented as official skill.
              </div>
              <div className="mt-6 grid grid-cols-3 gap-3">
                {[
                  ['1 hour', 'baseline'],
                  ['3 hours', 'baseline'],
                  ['6 hours', 'baseline'],
                ].map(([horizon, status]) => (
                  <div key={horizon} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-[10px] uppercase tracking-[0.1em] text-white/40">Horizon</p>
                    <p className="mt-1 text-sm font-semibold">{horizon}</p>
                    <p className="mt-2 text-[9px] uppercase tracking-[0.08em] text-amber-300/70">{status}</p>
                  </div>
                ))}
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <div className="rounded-2xl border border-white/10 bg-[#171b1f] p-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.12em] text-white/40">Chembur demo station</p>
                    <p className="mt-1 text-sm font-semibold">PM2.5 forecast context</p>
                  </div>
                  <PublicBadge tone="lime">Baseline</PublicBadge>
                </div>
                <div className="mt-4 grid grid-cols-4 items-end gap-2">
                  {[
                    ['Now', 70, '#b5e36b'],
                    ['+1h', 69, '#8fbf5a'],
                    ['+3h', 69, '#7fa94f'],
                    ['+6h', 68, '#6d9144'],
                  ].map(([label, value, color]) => (
                    <div key={String(label)} className="flex flex-col items-center gap-2">
                      <div className="flex h-[140px] w-full items-end rounded-lg bg-white/[0.03] p-1.5">
                        <div
                          className="w-full rounded-md"
                          style={{ height: `${Number(value)}%`, background: String(color), opacity: 0.75 }}
                        />
                      </div>
                      <span className="text-[10px] text-white/40">{label}</span>
                      <span className="text-[11px] font-semibold">{value} µg/m³</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-2 text-[10px] leading-relaxed text-white/45">
                  <p className="flex items-center gap-2"><ShieldAlert className="h-3 w-3 text-amber-300" /> Not a confirmed future condition.</p>
                  <p className="flex items-center gap-2"><BadgeCheck className="h-3 w-3 text-[#b5e36b]" /> Source timestamp and method always shown.</p>
                  <p className="flex items-center gap-2"><Sparkles className="h-3 w-3 text-[#b5e36b]" /> AI explains forecasts; it cannot create them.</p>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="border-y border-ink/10 bg-white">
        <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-16 lg:grid-cols-2 lg:items-center lg:px-10 lg:py-24">
          <Reveal>
            <PublicBadge tone="soft">Citizen reporting</PublicBadge>
            <h2 className="display mt-4 text-[36px] font-bold leading-[1.02] sm:text-[46px]">
              Ground-level evidence, with its uncertainty intact.
            </h2>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-ink/55">
              Photographs, location, incident time and description become a trackable report. The platform enriches it with
              nearby stations, weather and existing reports. It never turns a photograph into a chemical measurement or a
              confirmed violation.
            </p>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {[
                [Camera, 'Private evidence', 'Photographs are served only through authorised access.'],
                [MapPin, 'Mumbai boundary', 'Locations are validated inside Greater Mumbai.'],
                [FileSearch, 'Verification state', 'Unverified is never silently upgraded.'],
                [BellRing, 'Trackable follow-up', 'Status changes are audited.'],
              ].map(([Icon, title, copy]) => {
                const Component = Icon as typeof Camera;
                return (
                  <div key={String(title)} className="rounded-2xl border border-ink/12 p-4">
                    <Component className="h-4 w-4" />
                    <p className="mt-3 text-xs font-semibold">{String(title)}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink/50">{String(copy)}</p>
                  </div>
                );
              })}
            </div>
            <Link to="/report" className="mt-7 inline-flex">
              <Button variant="lime" size="lg" className="border border-ink/10">Submit a report <ArrowUpRight className="h-4 w-4" /></Button>
            </Link>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="rounded-[28px] border border-ink/15 bg-[#f3f4ed] p-4 shadow-card">
              <div className="rounded-2xl border border-ink/12 bg-white p-5">
                <div className="flex items-center justify-between">
                  <PublicBadge tone="soft">Report preview</PublicBadge>
                  <span className="text-[10px] text-ink/40">EP-R-2026-1042</span>
                </div>
                <div className="mt-4 flex items-start gap-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-ink/20 bg-[#f4f5ef]">
                    <Camera className="h-5 w-5 text-ink/25" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Visible smoke from open burning</p>
                    <p className="mt-1 text-[11px] text-ink/50">Chembur · Air pollution · 0.8 km from demo monitor</p>
                    <p className="mt-2 text-[11px] leading-relaxed text-ink/55">
                      Smoke drifting towards residential buildings for about 30 minutes. No flame visible from the road.
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-ink/10 pt-3 text-center">
                  <div><p className="text-[9px] uppercase tracking-[0.1em] text-ink/35">AI vision</p><p className="mt-1 text-[11px] font-semibold text-amber-700">Not configured</p></div>
                  <div><p className="text-[9px] uppercase tracking-[0.1em] text-ink/35">Verification</p><p className="mt-1 text-[11px] font-semibold">Verified</p></div>
                  <div><p className="text-[9px] uppercase tracking-[0.1em] text-ink/35">Incident</p><p className="mt-1 text-[11px] font-semibold">Linked</p></div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-3 py-2 text-[10px] text-ink/50">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                A report is not an official violation. Verification requires an authorised reviewer.
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="compliance" className="mx-auto max-w-[1440px] px-5 py-16 lg:px-10 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <Reveal>
            <PublicBadge tone="outline">Compliance intelligence</PublicBadge>
            <h2 className="display mt-4 text-[36px] font-bold leading-[1.02] sm:text-[46px]">
              Connect evidence to standards without overstating the conclusion.
            </h2>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-ink/55">
              Readings are checked for pollutant, unit, averaging period and source type before any comparison. A single
              hourly value is never labelled an official 24-hour exceedance. Only an authorised officer can record a
              determination.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              {['NAAQS 2009', 'CPCB water criteria', 'EP Rules Schedule VI', 'SWM Rules 2016'].map((label) => (
                <PublicBadge key={label} tone="soft">{label}</PublicBadge>
              ))}
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="rounded-[28px] border border-ink/15 bg-white p-5 shadow-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-ink/40">Reference comparison</p>
                  <p className="mt-1 text-sm font-semibold">PM2.5 · demo station</p>
                </div>
                <PublicBadge tone="lime">Reference only</PublicBadge>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-[#f4f5ef] p-3">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-ink/40">Observation</p>
                  <p className="mt-1 text-lg font-semibold">70 <span className="text-[10px] font-normal text-ink/40">µg/m³</span></p>
                </div>
                <div className="rounded-xl bg-[#f4f5ef] p-3">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-ink/40">Standard</p>
                  <p className="mt-1 text-lg font-semibold">60 <span className="text-[10px] font-normal text-ink/40">µg/m³</span></p>
                </div>
                <div className="rounded-xl bg-amber-50 p-3">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-amber-700/60">Averaging</p>
                  <p className="mt-1 text-[11px] font-semibold text-amber-800">Not comparable</p>
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900">
                <strong>NO COMPLIANCE CONCLUSION.</strong> A single hourly reading cannot be compared with a 24-hour standard.
                A valid 24-hour average and authorised review are required.
              </div>
              <div className="mt-3 flex items-center justify-between text-[10px] text-ink/40">
                <span>NAAQS 2009 · 24-hour limit</span>
                <span>Official determination: none</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="how-it-works" className="border-y border-ink/10 bg-[#eef0e8]">
        <div className="mx-auto max-w-[1440px] px-5 py-16 lg:px-10 lg:py-24">
          <Reveal>
            <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div>
                <PublicBadge tone="outline">How it works</PublicBadge>
                <h2 className="display mt-4 text-[36px] font-bold leading-[1.02] sm:text-[48px]">Observe. Analyse. Assess. Act.</h2>
              </div>
              <p className="max-w-sm text-sm leading-relaxed text-ink/55">
                Every step preserves provenance. Every transition is auditable. Simulation is isolated from real observations.
              </p>
            </div>
          </Reveal>
          <div className="mt-9 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              ['01', 'Observe', 'Ingest observations and reports with source timestamps, quality state and simulation flags.', Gauge],
              ['02', 'Analyse', 'Apply category-specific risk methods, anomaly checks and labelled persistence baselines.', BrainCircuit],
              ['03', 'Assess', 'Compare evidence with applicable standards only where unit, averaging and source type match.', Scale],
              ['04', 'Act', 'Route alerts, assign investigations, record corrective actions and close with authorised approval.', ShieldAlert],
            ].map(([step, title, copy, Icon], index) => {
              const Component = Icon as typeof Gauge;
              return (
                <Reveal key={String(step)} delay={index * 0.06}>
                  <div className="flex h-full flex-col rounded-[24px] border border-ink/15 bg-white p-5">
                    <div className="flex items-center justify-between">
                      <span className="display text-[28px] font-bold text-ink/15">{String(step)}</span>
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-lime"><Component className="h-4 w-4" /></span>
                    </div>
                    <h3 className="mt-8 text-base font-semibold">{String(title)}</h3>
                    <p className="mt-2 text-[12px] leading-relaxed text-ink/50">{String(copy)}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-5 py-16 lg:px-10 lg:py-24">
        <Reveal>
          <div className="relative overflow-hidden rounded-[36px] border border-ink/15 bg-lime p-7 sm:p-10 lg:p-14">
            <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full border border-ink/10" />
            <div className="pointer-events-none absolute -right-4 -top-12 h-48 w-48 rounded-full border border-ink/10" />
            <div className="relative grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
              <div>
                <PublicBadge tone="dark">Start here</PublicBadge>
                <h2 className="display mt-4 max-w-[720px] text-[38px] font-bold leading-[0.98] sm:text-[54px]">
                  Environmental intelligence is only useful when it leads to action.
                </h2>
                <p className="mt-5 max-w-xl text-sm leading-relaxed text-ink/60">
                  Explore the command centre, report a concern, or sign in to review alerts and investigations. Demonstration
                  data is always labelled.
                </p>
              </div>
              <div className="flex flex-col gap-2.5">
                <Link to="/dashboard"><Button variant="dark" size="lg" className="w-full justify-between">Environmental monitoring dashboard <ArrowUpRight className="h-4 w-4" /></Button></Link>
                <Link to="/report"><Button variant="default" size="lg" className="w-full justify-between bg-white text-ink hover:bg-white/90">Public reporting <ArrowUpRight className="h-4 w-4" /></Button></Link>
                <Link to="/login"><Button variant="outline" size="lg" className="w-full justify-between border-ink/25">Authority login <ArrowUpRight className="h-4 w-4" /></Button></Link>
                <p className="mt-1 text-center text-[10px] text-ink/40">Demo accounts are listed on the login page.</p>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      <Footer />
    </div>
  );
}
