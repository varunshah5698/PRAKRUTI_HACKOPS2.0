import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  BrainCircuit,
  CheckCircle2,
  Compass,
  Copy,
  Gauge,
  Layers3,
  Minus,
  Orbit,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Target,
  Wind,
} from 'lucide-react';
import { toast } from 'sonner';
import { ReportScene3D, type ReportSceneHandle, type SceneSelection } from './ReportScene3D';
import { FreshnessPill, type FreshnessStatus } from './FreshnessPill';
import { Badge, Card, CardHeader, CardTitle, DataLabel, ProgressBar } from './ui';
import { CATEGORY_LABELS, categoryLabel, formatDate, number, timeAgo } from '../lib/format';
import {
  buildReportAnalysis,
  type AnalysisInput,
  type ComparisonStatus,
  type RawNearbyReport,
  type ReadingComparison,
  type ReportAnalysis as AnalysisResult,
  type ReportCategory,
  type ReportFacts,
  type StationInsight,
} from '../lib/report-analysis';

const ACCENTS: Record<ReportCategory, string> = {
  air: '#2d7c94',
  water: '#2f8f84',
  waste: '#b3860f',
  industrial: '#c97445',
};

const SCENE_VIEW = { x: 120, y: 0, width: 320, height: 320 };

const STEP_LABELS: Array<{ id: string; label: string }> = [
  { id: 'site', label: 'Incident site' },
  { id: 'context', label: 'Environmental context' },
  { id: 'dispersion', label: 'Dispersion' },
  { id: 'community', label: 'Community signals' },
  { id: 'dossier', label: 'Dossier strength' },
];

type Selection = SceneSelection;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function shortName(name: string) {
  return name.replace(/ demo (air monitor|sampling point|stack monitor)/i, '');
}

function comparisonTone(comparison: ReadingComparison): string {
  if (comparison.status === 'meets' || comparison.status === 'within') return '#2f8f66';
  if (comparison.code === 'do' && comparison.status === 'below') return '#c94a50';
  if (comparison.status === 'exceeds' || comparison.status === 'below' || comparison.status === 'above') return '#c97445';
  return '#2d7c94';
}

function comparisonStatusLabel(status: ComparisonStatus): string {
  if (status === 'meets') return 'within reference';
  if (status === 'exceeds') return 'above reference';
  if (status === 'below') return 'below reference';
  if (status === 'above') return 'above range';
  if (status === 'within') return 'within range';
  return 'no reference';
}

function ScoreRing({ value, tone, size = 116 }: { value: number; tone: string; size?: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const progress = (mounted ? clamp(value, 0, 100) : 0) / 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="h-full w-full" role="img" aria-label={`Dossier completeness ${value} out of 100`}>
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#e6eee4" strokeWidth="9" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${progress * circumference} ${circumference}`}
          transform="rotate(-90 60 60)"
          style={{ transition: 'stroke-dasharray 900ms cubic-bezier(.22,1,.36,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="display text-[28px] font-bold leading-none tracking-[-0.04em] text-[#142016]">{value}</span>
        <span className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-[#66766b]">of 100</span>
      </div>
    </div>
  );
}

function ComparisonStrip({ comparison, compact = false }: { comparison: ReadingComparison; compact?: boolean }) {
  const tone = comparisonTone(comparison);
  const reference = comparison.reference;
  const bandLeft = reference?.kind === 'range' ? (Number(reference.min ?? 0) / comparison.scaleMax) * 100 : 0;
  const bandWidth = reference?.kind === 'range'
    ? ((Number(reference.max ?? 0) - Number(reference.min ?? 0)) / comparison.scaleMax) * 100
    : 0;
  const marker = reference?.kind === 'range' ? null : reference?.value;

  return (
    <div className={compact ? 'mt-2' : 'mt-2.5'}>
      <div className="flex items-baseline justify-between gap-2 text-[9px]">
        <span className="min-w-0 truncate text-[#5a6a5f]">
          {comparison.label} <b className="font-semibold text-[#26362a]">{number(comparison.value, 1)}</b>{' '}
          <span className="text-[8px] text-[#718277]">{comparison.unit}</span>
        </span>
        <span className="shrink-0 font-medium" style={{ color: tone }}>{comparisonStatusLabel(comparison.status)}</span>
      </div>
      <div className="relative mt-1 h-[6px] overflow-hidden rounded-full bg-[#e8f0e5]">
        {reference?.kind === 'range' ? (
          <span className="absolute inset-y-0 bg-[#d7e8de]" style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }} />
        ) : null}
        {typeof marker === 'number' ? (
          <span className="absolute -top-[2px] -bottom-[2px] z-10 w-[2px] bg-[#52685b]/70" style={{ left: `${(marker / comparison.scaleMax) * 100}%` }} />
        ) : null}
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${comparison.fraction * 100}%`, background: tone }} />
      </div>
      {!compact ? (
        <p className="mt-1 text-[8px] leading-relaxed text-[#7a8b80]">
          {reference?.label ?? comparison.note}
        </p>
      ) : null}
    </div>
  );
}

function StationPanel({ station }: { station: StationInsight }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold leading-tight text-[#1b2a1f]">{shortName(station.name)}</p>
          <p className="mt-0.5 text-[9px] text-[#66766b]">{station.typeLabel} · {Math.round(station.distance_m)} m away</p>
        </div>
        <Badge tone={station.comparisons.length === 0 ? 'neutral' : station.isSimulated ? 'amber' : 'teal'}>
          {station.comparisons.length === 0 ? 'No reading' : station.isSimulated ? 'Sim' : 'Observed'}
        </Badge>
      </div>
      <div className="mt-3 space-y-1">
        {station.comparisons.slice(0, 4).map((comparison) => (
          <ComparisonStrip key={comparison.code} comparison={comparison} compact />
        ))}
        {station.comparisons.length === 0 ? <p className="text-[10px] text-[#66766b]">No recent readings for this category.</p> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[8px] text-[#718277]">
        <span>{station.observedAt ? `Observed ${timeAgo(station.observedAt)}` : 'No recent reading'}</span>
        {station.isStale ? <span className="font-semibold text-amber-700">Stale &gt; 6h</span> : null}
      </div>
      <Link to={`/map?station=${station.id}`} className="mt-3 inline-flex items-center gap-1 text-[9px] font-semibold text-[#2d7083] hover:text-[#1d5363]">
        Open station on map <ArrowUpRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function CommunityPanel({ report }: { report: RawNearbyReport }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{report.public_ref}</Badge>
        <Badge tone={report.verification_state === 'VERIFIED' ? 'green' : report.verification_state === 'REJECTED' ? 'red' : 'amber'}>
          {report.verification_state}
        </Badge>
        {report.is_simulated ? <Badge tone="amber">Sim</Badge> : null}
      </div>
      <p className="mt-2 text-[12px] font-semibold leading-tight text-[#1b2a1f]">{report.incident_type.replace(/_/g, ' ')}</p>
      <p className="mt-1 text-[9px] text-[#66766b]">{categoryLabel(report.category)} · {Math.round(report.distance_m)} m · {timeAgo(report.submitted_at)}</p>
      <p className="mt-3 rounded-xl border border-dashed border-[#dbe5d6] bg-white/45 p-2.5 text-[9px] leading-relaxed text-[#66766b]">
        A nearby report is an independent assertion, not proof. Co-location raises the value of a field check; it does not confirm either report.
      </p>
      <Link to={`/reports/${report.id}`} className="mt-3 inline-flex items-center gap-1 rounded-full bg-[#eef8f5] px-2.5 py-1.5 text-[9px] font-semibold text-[#2d7083] hover:bg-[#e1f2ed]">
        Open nearby report <ArrowUpRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function WindDial({ degrees, speed }: { degrees: number; speed: number }) {
  const travel = (degrees + 180) % 360;
  return (
    <div className="relative h-[72px] w-[72px] shrink-0 rounded-full border border-[#d7e6e2] bg-white/55">
      {['N', 'E', 'S', 'W'].map((label, index) => (
        <span
          key={label}
          className="absolute text-[7px] font-semibold text-[#7d9186]"
          style={{
            top: index === 0 ? 3 : index === 2 ? undefined : '50%',
            bottom: index === 2 ? 3 : undefined,
            left: index === 1 ? undefined : index === 3 ? 4 : '50%',
            right: index === 1 ? 4 : undefined,
            transform: index === 0 || index === 2 ? 'translateX(-50%)' : 'translateY(-50%)',
          }}
        >
          {label}
        </span>
      ))}
      <span
        className="absolute left-1/2 top-1/2 h-[24px] w-[2px] origin-bottom rounded-full bg-[#2d7c94]"
        style={{ transform: `translate(-50%, -100%) rotate(${travel}deg)` }}
      >
        <span className="absolute -left-[2px] -top-[4px] h-[8px] w-[6px] border-b-[8px] border-b-[#2d7c94] border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent" />
      </span>
      <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2d7c94]" />
      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap text-[7px] font-semibold text-[#557480]">{number(speed, 0)} km/h</span>
    </div>
  );
}

function StepBody({
  step,
  analysis,
  report,
  onSelectCommunity,
}: {
  step: number;
  analysis: AnalysisResult;
  report: ReportFacts;
  onSelectCommunity: (id: string) => void;
}) {
  if (step === 0) {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{CATEGORY_LABELS[analysis.category]}</Badge>
          <Badge tone={analysis.grade.label === 'Robust' || analysis.grade.label === 'Solid' ? 'green' : analysis.grade.label === 'Insufficient' ? 'red' : 'amber'}>
            {analysis.grade.label}
          </Badge>
        </div>
        <p className="mt-2 text-[11px] font-semibold leading-tight text-[#1b2a1f]">{report.incident_type.replace(/_/g, ' ')}</p>
        <p className="mt-1 line-clamp-4 text-[10px] leading-relaxed text-[#5a6a5f]">{report.description}</p>
        <p className="mt-3 text-[10px] leading-relaxed text-[#405246]">
          The site is anchored at the claimed coordinates. The rings are true relative distance. Markers very close to the site are fanned slightly so they stay legible; exact distances are listed in the panel.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[9px]">
          <div className="rounded-xl border border-white/80 bg-white/55 p-2.5">
            <DataLabel>Matched monitors</DataLabel>
            <p className="mt-1 text-[12px] font-semibold text-[#26362a]">{analysis.stations.length}</p>
            <p className="mt-0.5 text-[8px] text-[#718277]">within 3 km</p>
          </div>
          <div className="rounded-xl border border-white/80 bg-white/55 p-2.5">
            <DataLabel>Community</DataLabel>
            <p className="mt-1 text-[12px] font-semibold text-[#26362a]">{analysis.nearbySameCategory.length}</p>
            <p className="mt-0.5 text-[8px] text-[#718277]">nearby reports</p>
          </div>
        </div>
        <p className="mt-3 text-[9px] leading-relaxed text-[#718277]">
          Select any monitor ring or community pin to inspect what it contributes.
        </p>
      </div>
    );
  }

  if (step === 1) {
    if (!analysis.primaryStation) {
      return (
        <div>
          <p className="text-[11px] leading-relaxed text-[#405246]">
            {analysis.stations.length
              ? `A ${analysis.category === 'waste' ? 'waste' : 'category-matched'} monitor is within 3 km, but it has no reading in the last 24h. This is a blind spot, not a finding of safety.`
              : `No ${analysis.category === 'waste' ? 'waste' : 'category-matched'} monitor sits within 3 km. This is a blind spot, not a finding of safety.`}
          </p>
          <div className="mt-3 rounded-xl border border-dashed border-[#dbe5d6] bg-white/45 p-2.5 text-[9px] leading-relaxed text-[#66766b]">
            The dossier lowers its environmental-context score and recommends a targeted sample or operator record.
          </div>
        </div>
      );
    }
    return (
      <div>
        <StationPanel station={analysis.primaryStation} />
        <p className="mt-3 text-[9px] leading-relaxed text-[#718277]">
          A nearby monitor is independent context, not proof of this specific incident. Local sources can spike between hourly readings.
        </p>
      </div>
    );
  }

  if (step === 2) {
    if (!analysis.weather) {
      return <p className="text-[11px] leading-relaxed text-[#405246]">No nearby weather observation. Dispersion cannot be described from this dossier.</p>;
    }
    return (
      <div>
        <div className="flex items-center gap-3">
          <WindDial degrees={analysis.weather.raw.wind_direction_deg} speed={analysis.weather.raw.wind_speed_kmh} />
          <div>
            <p className="text-[11px] font-semibold text-[#26362a]">{analysis.weather.dispersion}</p>
            <p className="mt-0.5 text-[9px] text-[#66766b]">Wind from {analysis.weather.direction}</p>
            <p className="mt-0.5 text-[8px] text-[#718277]">{analysis.weather.note}</p>
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-dashed border-[#dbe5d6] bg-white/45 p-2.5 text-[9px] leading-relaxed text-[#66766b]">
          The dashed lane shows the reported wind travel direction. It is a visual aid, not a dispersion model or a plume prediction.
        </div>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div>
        <div className="grid grid-cols-2 gap-2 text-[9px]">
          {[
            ['Same-category reports', analysis.nearbySameCategory.length],
            ['Verified nearby', analysis.nearbyVerified.length],
            ['Open alerts', analysis.alerts.length],
            ['Nearby incidents', analysis.incidents.length],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-white/80 bg-white/55 p-2.5">
              <DataLabel>{label}</DataLabel>
              <p className="mt-1 text-[14px] font-semibold text-[#26362a]">{value}</p>
            </div>
          ))}
        </div>
        {analysis.nearbySameCategory.length ? (
          <div className="mt-3 space-y-1">
            {analysis.nearbySameCategory.slice(0, 3).map((report) => (
              <button
                key={report.id}
                onClick={() => onSelectCommunity(report.id)}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-white/70"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENTS[analysis.category] }} />
                <span className="min-w-0 flex-1 truncate text-[9px] text-[#557480]">{report.incident_type.replace(/_/g, ' ')}</span>
                <span className="text-[8px] text-[#718277]">{Math.round(report.distance_m)} m</span>
              </button>
            ))}
          </div>
        ) : null}
        <p className="mt-3 text-[9px] leading-relaxed text-[#718277]">
          Pins inside 500 m are fanned around the site so they stay legible; the exact distance is listed here. Reports and alerts raise review priority. They do not establish a violation.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <ScoreRing value={analysis.overall} tone={analysis.grade.tone} size={92} />
        <div>
          <p className="text-[11px] font-semibold" style={{ color: analysis.grade.tone }}>{analysis.grade.label} dossier</p>
          <p className="mt-0.5 text-[9px] leading-relaxed text-[#66766b]">{analysis.grade.note}</p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {analysis.dimensions.map((dimension) => (
          <div key={dimension.key}>
            <div className="flex items-center justify-between text-[9px] text-[#557480]">
              <span>{dimension.label}</span>
              <span className="font-semibold text-[#26362a]">{dimension.score}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#e6eee4]">
              <div className="h-full rounded-full" style={{ width: `${dimension.score}%`, background: analysis.grade.tone }} />
            </div>
          </div>
        ))}
      </div>
      <a href="#dossier-breakdown" className="mt-3 inline-flex items-center gap-1 text-[9px] font-semibold text-[#2d7083] hover:text-[#1d5363]">
        Open the full breakdown <ArrowUpRight className="h-3 w-3" />
      </a>
    </div>
  );
}

export function ReportAnalysisPanel(props: AnalysisInput) {
  const { report, evidence, aiAssessments, enrichment, audit } = props;
  const analysis = useMemo(
    () => buildReportAnalysis({ report, evidence, aiAssessments, enrichment, audit }),
    [report, evidence, aiAssessments, enrichment, audit],
  );
  const accent = ACCENTS[analysis.category];
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<Selection>({ kind: 'report' });
  const [layers, setLayers] = useState({ stations: true, community: true, wind: true, rings: true });
  const [dimensionKey, setDimensionKey] = useState<'evidence' | 'environment' | 'community'>('evidence');
  const [openFactor, setOpenFactor] = useState<string | null>(null);
  const [signalTab, setSignalTab] = useState<'signals' | 'timeline'>('signals');
  const [orbit, setOrbit] = useState(() => typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const sceneRef = useRef<ReportSceneHandle>(null);

  const primaryStation = analysis.primaryStation;
  const firstCommunity = analysis.nearbySameCategory[0] ?? null;
  const selectedStation = selected.kind === 'station' ? analysis.stations.find((station) => station.id === selected.id) ?? null : null;
  const selectedCommunity = selected.kind === 'community' ? enrichment.nearbyReports.find((row) => row.id === selected.id) ?? null : null;
  const activeDimension = analysis.dimensions.find((dimension) => dimension.key === dimensionKey) ?? analysis.dimensions[0];

  const focusForStep = (index: number) => {
    if (index === 1 && primaryStation) return { kind: 'station' as const, id: primaryStation.id };
    if (index === 3 && firstCommunity) return { kind: 'community' as const, id: firstCommunity.id };
    return { kind: 'report' as const };
  };

  const jumpToStep = (index: number) => {
    setStep(index);
    setPlaying(false);
    setSelected(focusForStep(index));
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (step >= STEP_LABELS.length - 1) {
      setStep(0);
      setSelected({ kind: 'report' });
    }
    setPlaying(true);
  };

  useEffect(() => {
    if (!playing) return;
    if (step >= STEP_LABELS.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      const next = step + 1;
      setStep(next);
      setSelected(focusForStep(next));
    }, 5200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, step, primaryStation?.id, firstCommunity?.id]);

  const weather = analysis.weather;
  const weatherStatus: FreshnessStatus = weather
    ? weather.raw.is_simulated
      ? 'DEMO'
      : Date.now() - Date.parse(weather.raw.observed_at) > 90 * 60_000
        ? 'STALE'
        : 'LIVE'
    : 'UNAVAILABLE';

  const categoryNote =
    analysis.category === 'air'
      ? 'Hourly PM2.5 and PM10 are compared with 24h NAAQS screening references for context. This is not a compliance calculation.'
      : analysis.category === 'water'
        ? 'Grab samples are compared with loaded outdoor-bathing criteria. Turbidity and conductivity have no loaded reference here.'
        : analysis.category === 'waste'
          ? 'There is no waste-monitor station type. Field inspection and collection records carry this category.'
          : 'Stack readings have no loaded numeric reference in this deployment. Bars show relative magnitude across nearby monitors.';

  const copyBrief = async () => {
    const text = [
      analysis.brief.headline,
      '',
      ...analysis.brief.paragraphs,
      '',
      'Next checks',
      ...analysis.brief.nextChecks.map((check) => `- ${check.title}: ${check.detail}`),
      '',
      'Limits',
      ...analysis.brief.limitations.map((limitation) => `- ${limitation}`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Analyst brief copied.');
    } catch {
      toast.error('Clipboard access is unavailable in this browser.');
    }
  };

  return (
    <div className="space-y-4" style={{ '--ra-accent': accent } as CSSProperties}>
      <Card className="overflow-hidden">
        <CardHeader className="flex-wrap items-center gap-3">
          <div>
            <CardTitle>Forensic site analysis</CardTitle>
            <p className="mt-1 text-[10px] text-[#66766b]">A guided, evidence-bound read of this report · positions are drawn to scale within 3 km</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{report.public_ref}</Badge>
            <Badge tone={analysis.grade.label === 'Robust' || analysis.grade.label === 'Solid' ? 'green' : analysis.grade.label === 'Insufficient' ? 'red' : 'amber'}>
              <Gauge className="h-3 w-3" /> Dossier {analysis.overall}
            </Badge>
            <Badge tone="teal">{analysis.stations.length} monitor{analysis.stations.length === 1 ? '' : 's'}</Badge>
          </div>
        </CardHeader>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-dashed border-[#dbe5d6] px-4 py-2">
          <span className="mr-1 inline-flex items-center gap-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-[#78919a]">
            <Layers3 className="h-3 w-3" /> Layers
          </span>
          {([
            ['stations', `Monitors ${analysis.stations.length}`],
            ['community', `Community ${enrichment.nearbyReports.length}`],
            ['wind', weather ? 'Wind' : 'Wind n/a'],
            ['rings', 'Distance rings'],
          ] as Array<[keyof typeof layers, string]>).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setLayers((current) => ({ ...current, [key]: !current[key] }))}
              className="atmo-chip"
              data-active={layers[key]}
              aria-pressed={layers[key]}
              disabled={key === 'wind' && !weather}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto hidden text-[8px] text-[#78919a] sm:block">Select a monitor or pin to inspect</span>
        </div>

                        <div className="grid lg:grid-cols-[1fr_380px]">
          <div className="atmo-scene ra-scene h-[500px] sm:h-[580px]">
            <div className="atmo-axis left-4 top-4">
              <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[#557480]">Site model · {report.public_ref}</p>
              <p className="mt-0.5 text-[10px] text-[#78919a]">True positions within 3 km · taller column = stronger signal · drag to orbit</p>
            </div>
            <div className="atmo-axis right-4 top-4 flex items-center gap-1.5 rounded-full border border-white/80 bg-white/70 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[#557480] backdrop-blur">
              <Compass className="h-3 w-3" /> N
            </div>

            <ReportScene3D
              ref={sceneRef}
              reportLat={report.lat}
              reportLng={report.lng}
              reportRef={report.public_ref}
              accent={accent}
              stations={analysis.stations}
              community={enrichment.nearbyReports}
              selected={selected}
              layers={layers}
              step={step}
              autoOrbit={orbit}
              weather={weather?.raw ?? null}
              onUserInteract={() => setOrbit(false)}
              onSelectStation={(id) => setSelected({ kind: 'station', id })}
              onSelectCommunity={(id) => setSelected({ kind: 'community', id })}
              onSelectReport={() => setSelected({ kind: 'report' })}
            />

            <div className="ra-legend absolute bottom-3 left-4 z-10 flex flex-wrap items-center gap-2">
              <span className="ra-legend-chip">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} /> Report site
              </span>
              <span className="ra-legend-chip">
                <span className="h-1.5 w-3 rounded-full" style={{ background: 'linear-gradient(90deg,#2f8f66,#b3860f,#c97445)' }} /> Monitor signal
              </span>
              <span className="ra-legend-chip">
                <span className="h-1.5 w-1.5 rounded-[1px]" style={{ background: '#b3860f', transform: 'rotate(45deg)' }} /> Community pin
              </span>
              {layers.wind && weather ? (
                <span className="ra-legend-chip">
                  <Wind className="h-3 w-3" /> From {weather.direction} · {number(weather.raw.wind_speed_kmh, 0)} km/h
                </span>
              ) : null}
            </div>

            <div className="atmo-scene-controls" onPointerDown={(event) => event.stopPropagation()}>
              <button onClick={() => sceneRef.current?.zoomIn()} aria-label="Zoom in"><Plus className="h-3.5 w-3.5" /></button>
              <button onClick={() => sceneRef.current?.zoomOut()} aria-label="Zoom out"><Minus className="h-3.5 w-3.5" /></button>
              <button onClick={() => setOrbit((value) => !value)} data-active={orbit} aria-label={orbit ? 'Pause automatic orbit' : 'Start automatic orbit'} aria-pressed={orbit}>
                <Orbit className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => sceneRef.current?.reset()} aria-label="Reset view"><RotateCcw className="h-3.5 w-3.5" /></button>
            </div>
          </div>

<aside className="scrollbar-thin border-t border-dashed border-[#dbe5d6] p-5 lg:max-h-[580px] lg:overflow-y-auto lg:border-l lg:border-t-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <DataLabel>Guided analysis</DataLabel>
                <p className="mt-0.5 text-[9px] text-[#718277]">Five steps through the dossier</p>
              </div>
              <button
                onClick={togglePlay}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#2d7c94] px-3 text-[9px] font-semibold text-white transition hover:bg-[#246a7f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fc47a]"
                aria-label={playing ? 'Pause guided analysis' : 'Play guided analysis'}
              >
                {playing ? <Pause className="h-3 w-3" /> : <Play className="ml-0.5 h-3 w-3" />}
                {playing ? 'Pause' : 'Play'}
              </button>
            </div>

            {playing ? (
              <div className="ra-step-progress mt-2" aria-hidden>
                <span key={step} style={{ background: accent }} />
              </div>
            ) : null}

            <div className="mt-3 space-y-1">
              {STEP_LABELS.map((item, index) => {
                const active = index === step;
                const done = index < step;
                return (
                  <button
                    key={item.id}
                    onClick={() => jumpToStep(index)}
                    className={`flex w-full items-start gap-2 rounded-xl border px-2.5 py-2 text-left transition ${active ? 'border-[#bfe2dd] bg-[#eef8f5]' : 'border-transparent hover:bg-white/65'}`}
                    aria-current={active ? 'step' : undefined}
                  >
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold ${active ? 'bg-[#2d7c94] text-white' : done ? 'bg-[#e6f2ec] text-[#2f8f66]' : 'bg-[#edf2e9] text-[#718277]'}`}>
                      {done ? <CheckCircle2 className="h-3 w-3" /> : String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[10px] font-semibold ${active ? 'text-[#173d4a]' : 'text-[#4d5e52]'}`}>{item.label}</span>
                      <span className="mt-0.5 block truncate text-[8px] text-[#7a8f84]">
                        {index === 0 ? `${categoryLabel(report.category)} · ${report.locality_name ?? 'Mumbai'}` : null}
                        {index === 1 ? (primaryStation ? `${shortName(primaryStation.name)} · ${Math.round(primaryStation.distance_m)} m` : 'No monitor reading') : null}
                        {index === 2 ? (weather ? `${weather.direction} · ${weather.dispersion.toLowerCase()}` : 'No weather context') : null}
                        {index === 3 ? `${analysis.nearbySameCategory.length} nearby · ${analysis.alerts.length + analysis.incidents.length} case signals` : null}
                        {index === 4 ? `${analysis.overall}/100 · ${analysis.grade.label}` : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 border-t border-dashed border-[#dbe5d6] pt-3" aria-live="polite">
              {selectedStation ? (
                <div>
                  <button onClick={() => setSelected({ kind: 'report' })} className="mb-3 text-[8px] font-semibold uppercase tracking-[0.1em] text-[#2d7083] hover:text-[#1d5363]">
                    ← Back to step {step + 1}
                  </button>
                  <StationPanel station={selectedStation} />
                </div>
              ) : selectedCommunity ? (
                <div>
                  <button onClick={() => setSelected({ kind: 'report' })} className="mb-3 text-[8px] font-semibold uppercase tracking-[0.1em] text-[#2d7083] hover:text-[#1d5363]">
                    ← Back to step {step + 1}
                  </button>
                  <CommunityPanel report={selectedCommunity} />
                </div>
              ) : (
                <StepBody step={step} analysis={analysis} report={report} onSelectCommunity={(id) => setSelected({ kind: 'community', id })} />
              )}
            </div>

            <p className="mt-3 text-[8px] leading-relaxed text-[#8ba1a9]">
              Select a monitor or pin to inspect. Monitor ring fill is a visual signal, not a measurement of harm; the site beacon is a fixed anchor.
            </p>
          </aside>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card id="dossier-breakdown" className="scroll-mt-24">
          <CardHeader>
            <div>
              <CardTitle>Dossier strength</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Completeness, not risk or probability</p>
            </div>
            <Badge tone={analysis.grade.label === 'Robust' || analysis.grade.label === 'Solid' ? 'green' : analysis.grade.label === 'Insufficient' ? 'red' : 'amber'} dot>
              {analysis.grade.label}
            </Badge>
          </CardHeader>
          <div className="p-4">
            <div className="flex items-center gap-4">
              <ScoreRing value={analysis.overall} tone={analysis.grade.tone} />
              <div>
                <p className="display text-[19px] font-bold leading-tight tracking-[-0.03em] text-[#142016]">{analysis.grade.label}</p>
                <p className="mt-1 text-[9px] leading-relaxed text-[#66766b]">{analysis.grade.note}</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-1 rounded-full border border-[#dfe8db] bg-white/55 p-1">
              {analysis.dimensions.map((dimension) => (
                <button
                  key={dimension.key}
                  onClick={() => { setDimensionKey(dimension.key); setOpenFactor(null); }}
                  className={`rounded-full px-1.5 py-1.5 text-[8px] font-semibold uppercase tracking-[0.04em] transition ${dimensionKey === dimension.key ? 'bg-[#2d7c94] text-white' : 'text-[#66766b] hover:bg-white/80'}`}
                  aria-pressed={dimensionKey === dimension.key}
                >
                  {dimension.label.replace(' ', '\n')}
                  <span className={`ml-1 ${dimensionKey === dimension.key ? 'text-white/70' : 'text-[#8ba1a9]'}`}>{dimension.score}</span>
                </button>
              ))}
            </div>

            <p className="mt-3 text-[9px] leading-relaxed text-[#66766b]">{activeDimension.summary}</p>

            <div className="mt-2 space-y-1.5">
              {activeDimension.factors.map((factor) => {
                const open = openFactor === factor.id;
                const percentage = factor.applicable ? (factor.points / factor.max) * 100 : 0;
                const tone = percentage >= 66 ? '#2f8f8f' : percentage >= 34 ? '#b3860f' : '#c97445';
                return (
                  <button
                    key={factor.id}
                    onClick={() => setOpenFactor(open ? null : factor.id)}
                    className={`w-full rounded-xl border border-[#e7ece3] bg-white/45 px-2.5 py-2 text-left transition hover:border-[#bfe2dd] ${factor.applicable ? '' : 'opacity-55'}`}
                    aria-expanded={open}
                  >
                    <div className="flex items-center justify-between gap-2 text-[9px]">
                      <span className="text-[#405246]">{factor.label}</span>
                      <span className="shrink-0 text-[8px] text-[#718277]">{factor.applicable ? `${factor.points}/${factor.max}` : 'n/a'}</span>
                    </div>
                    <div className="mt-1.5">
                      <ProgressBar value={percentage} tone={tone} />
                    </div>
                    {open ? <p className="mt-1.5 text-[8px] leading-relaxed text-[#66766b]">{factor.detail}</p> : null}
                  </button>
                );
              })}
            </div>

            <details className="mt-3 rounded-xl border border-dashed border-[#dbe5d6] bg-white/40 p-2.5">
              <summary className="cursor-pointer text-[8px] font-semibold uppercase tracking-[0.1em] text-[#557480]">How this is scored</summary>
              <p className="mt-2 text-[8px] leading-relaxed text-[#66766b]">
                Evidence integrity is 45% of the index, environmental context 30%, and community corroboration 25%. Each dimension is out of 100 and missing evidence scores zero; nothing is reweighted to make a gap disappear. This is not an official evidence grade.
              </p>
            </details>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Environmental context</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Nearby records compared with loaded screening references</p>
            </div>
            <Badge tone="teal">
              {analysis.stations.filter((station) => station.comparisons.length > 0).length} with readings
            </Badge>
          </CardHeader>
          <div className="p-4">
            {analysis.stations.length ? (
              <div className="space-y-2">
                {analysis.stations.map((station) => {
                  const active = selectedStation?.id === station.id;
                  return (
                    <button
                      key={station.id}
                      onClick={() => setSelected({ kind: 'station', id: station.id })}
                      className={`w-full rounded-2xl border p-3 text-left transition ${active ? 'border-[#bfe2dd] bg-[#eef8f5]' : 'border-[#e7ece3] bg-white/45 hover:border-[#cfe2dc]'}`}
                      aria-pressed={active}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-semibold text-[#26362a]">{shortName(station.name)}</p>
                          <p className="mt-0.5 text-[8px] text-[#718277]">
                            {Math.round(station.distance_m)} m · {station.comparisons.length === 0 ? 'No recent reading' : `${station.isSimulated ? 'Simulated' : 'Observed'}${station.isStale ? ' · stale' : ''}`}
                          </p>
                        </div>
                        <span className="shrink-0 text-[8px] font-semibold" style={{ color: station.tone }}>{station.primary?.label ?? 'No recent'}</span>
                      </div>
                      {station.comparisons.slice(0, 2).map((comparison) => (
                        <ComparisonStrip key={comparison.code} comparison={comparison} compact />
                      ))}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[#dbe5d6] bg-white/40 p-4 text-center">
                <Target className="mx-auto h-5 w-5 text-[#8ba1a9]" />
                <p className="mt-2 text-[10px] font-semibold text-[#405246]">No category-matched monitor within 3 km</p>
                <p className="mt-1 text-[9px] leading-relaxed text-[#718277]">The dossier marks the context gap and recommends a targeted sample or operator record.</p>
              </div>
            )}

            <div className="mt-4 border-t border-dashed border-[#dbe5d6] pt-3">
              <div className="flex items-center justify-between">
                <DataLabel>Weather context</DataLabel>
                <FreshnessPill
                  status={weatherStatus}
                  observedAt={weather?.raw.observed_at}
                  sourceId={weather?.raw.source_id}
                />
              </div>
              {weather ? (
                <>
                  <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {[
                      ['Wind', `${number(weather.raw.wind_speed_kmh, 0)} km/h`],
                      ['Temp', `${number(weather.raw.temperature_c, 0)}°C`],
                      ['Humidity', `${number(weather.raw.relative_humidity, 0)}%`],
                      ['Rain', `${number(weather.raw.precipitation_mm ?? 0, 1)} mm`],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl border border-white/80 bg-white/55 p-2">
                        <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-[#78919a]">{label}</p>
                        <p className="mt-0.5 text-[11px] font-semibold text-[#26362a]">{value}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[9px] leading-relaxed text-[#66766b]">
                    <span className="font-semibold" style={{ color: weather.dispersionTone }}>{weather.dispersion}</span> · {weather.direction}. {weather.note}.
                  </p>
                </>
              ) : (
                <p className="mt-2 text-[9px] leading-relaxed text-[#66766b]">No nearby weather observation. Dispersion cannot be described.</p>
              )}
            </div>

            <p className="mt-3 text-[8px] leading-relaxed text-[#8ba1a9]">{categoryNote}</p>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Corroboration &amp; case journey</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Independent signals around this report</p>
            </div>
            <div className="flex gap-1 rounded-full border border-[#dfe8db] bg-white/55 p-0.5">
              <button
                onClick={() => setSignalTab('signals')}
                className={`rounded-full px-2 py-1 text-[8px] font-semibold ${signalTab === 'signals' ? 'bg-[#2d7c94] text-white' : 'text-[#66766b]'}`}
                aria-pressed={signalTab === 'signals'}
              >
                Signals
              </button>
              <button
                onClick={() => setSignalTab('timeline')}
                className={`rounded-full px-2 py-1 text-[8px] font-semibold ${signalTab === 'timeline' ? 'bg-[#2d7c94] text-white' : 'text-[#66766b]'}`}
                aria-pressed={signalTab === 'timeline'}
              >
                Journey
              </button>
            </div>
          </CardHeader>
          <div className="p-4">
            {signalTab === 'signals' ? (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    ['Same-category nearby', analysis.nearbySameCategory.length],
                    ['Verified nearby', analysis.nearbyVerified.length],
                    ['Open alerts', analysis.alerts.length],
                    ['Nearby incidents', analysis.incidents.length],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl border border-white/80 bg-white/55 p-2.5">
                      <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-[#78919a]">{label}</p>
                      <p className="mt-1 text-[16px] font-semibold text-[#26362a]">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 space-y-1.5">
                  {analysis.nearbySameCategory.slice(0, 3).map((row) => (
                    <Link key={row.id} to={`/reports/${row.id}`} className="flex items-center gap-2 rounded-lg px-1 py-1 text-[9px] text-[#557480] transition hover:bg-white/70 hover:text-[#142016]">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
                      <span className="min-w-0 flex-1 truncate">{row.public_ref} · {row.incident_type.replace(/_/g, ' ')}</span>
                      <span className="text-[8px] text-[#718277]">{Math.round(row.distance_m)} m</span>
                    </Link>
                  ))}
                  {analysis.alerts.map((row) => (
                    <Link key={row.id} to={`/alerts/${row.id}`} className="flex items-center gap-2 rounded-lg px-1 py-1 text-[9px] text-[#7a5e1f] transition hover:bg-amber-50">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{row.public_ref} · {row.title}</span>
                      <span className="text-[8px]">{row.level}</span>
                    </Link>
                  ))}
                  {analysis.incidents.map((row) => (
                    <Link key={row.id} to={`/incidents/${row.id}`} className="flex items-center gap-2 rounded-lg px-1 py-1 text-[9px] text-[#6b4f67] transition hover:bg-[#f7eef6]">
                      <ShieldCheck className="h-3 w-3 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{row.public_ref} · {row.title}</span>
                      <span className="text-[8px]">{row.risk_level}</span>
                    </Link>
                  ))}
                  {!analysis.nearbySameCategory.length && !analysis.alerts.length && !analysis.incidents.length ? (
                    <div className="rounded-xl border border-dashed border-[#dbe5d6] bg-white/40 p-3 text-center text-[9px] leading-relaxed text-[#718277]">
                      Nothing nearby independently repeats the concern. This is a corroboration gap, not evidence that nothing happened.
                    </div>
                  ) : null}
                </div>

                <p className="mt-3 text-[8px] leading-relaxed text-[#8ba1a9]">
                  Co-location raises review priority. It does not confirm a report or establish a violation.
                </p>
              </>
            ) : analysis.timeline.length ? (
              <>
                <ol className="relative space-y-3 border-l border-[#dbe5d6] pl-3">
                  {analysis.timeline.map((entry) => (
                    <li key={entry.id} className="relative">
                      <span className="absolute -left-[19px] top-1 h-2 w-2 rounded-full border-2 border-white" style={{ background: accent }} />
                      <p className="text-[10px] font-semibold text-[#26362a]">{entry.label}</p>
                      <p className="mt-0.5 text-[8px] text-[#718277]">{formatDate(entry.at)}</p>
                      {entry.detail ? <p className="mt-1 text-[9px] leading-relaxed text-[#5a6a5f]">{entry.detail}</p> : null}
                    </li>
                  ))}
                </ol>
                <details className="mt-3 rounded-xl border border-dashed border-[#dbe5d6] bg-white/40 p-2.5">
                  <summary className="cursor-pointer text-[8px] font-semibold uppercase tracking-[0.1em] text-[#557480]">Raw governance ledger</summary>
                  <div className="mt-2 space-y-1.5">
                    {audit.map((row, index) => (
                      <p key={`${row.action}-${row.created_at}-${index}`} className="break-words text-[8px] leading-relaxed text-[#718277]">
                        <span className="font-semibold text-[#557480]">{row.action.replace(/_/g, ' ')}</span> · {formatDate(row.created_at)} · {JSON.stringify(row.after ?? {}).slice(0, 220)}
                      </p>
                    ))}
                  </div>
                </details>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-[#dbe5d6] bg-white/40 p-3 text-center text-[9px] leading-relaxed text-[#718277]">
                No audit events recorded for this report.
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <div>
            <CardTitle>Analyst brief</CardTitle>
            <p className="mt-1 text-[10px] text-[#66766b]">A plain-language read of the dossier · derived from the records on this page</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge tone={analysis.grade.label === 'Robust' || analysis.grade.label === 'Solid' ? 'green' : analysis.grade.label === 'Insufficient' ? 'red' : 'amber'}>{analysis.grade.label}</Badge>
            <button onClick={copyBrief} className="inline-flex items-center gap-1 rounded-full border border-[#d5e0d1] bg-white/70 px-2.5 py-1.5 text-[9px] font-semibold text-[#4d5e52] transition hover:bg-white" aria-label="Copy analyst brief">
              <Copy className="h-3 w-3" /> Copy
            </button>
          </div>
        </CardHeader>
        <div className="grid gap-5 p-5 lg:grid-cols-[1.35fr_1fr]">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eef8f5] text-[#2d7c94]"><BrainCircuit className="h-4 w-4" /></span>
              <div>
                <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-[#78919a]">Reading</p>
                <h4 className="display text-[19px] font-bold leading-tight tracking-[-0.03em] text-[#142016]">{analysis.brief.headline}</h4>
              </div>
            </div>
            <div className="mt-4 space-y-2.5">
              {analysis.brief.paragraphs.map((paragraph) => (
                <p key={paragraph} className="text-[11px] leading-relaxed text-[#405246]">{paragraph}</p>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-1">
              {analysis.brief.provenance.map((item) => (
                <span key={item} className="rounded-full border border-[#dfe8db] bg-white/55 px-2 py-0.5 text-[8px] font-medium text-[#66766b]">{item}</span>
              ))}
            </div>
            <details className="mt-3 rounded-xl border border-dashed border-[#dbe5d6] bg-white/40 p-3">
              <summary className="cursor-pointer text-[9px] font-semibold text-[#557480]">Limits of this analysis</summary>
              <ul className="mt-2 space-y-1">
                {analysis.brief.limitations.map((limitation) => (
                  <li key={limitation} className="flex gap-1.5 text-[8px] leading-relaxed text-[#718277]">
                    <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-[#b3860f]" />{limitation}
                  </li>
                ))}
              </ul>
            </details>
          </div>

          <div className="rounded-2xl border border-[#dfe8db] bg-white/40 p-4">
            <div className="flex items-center justify-between">
              <DataLabel>What would strengthen this dossier</DataLabel>
              <ScanLine className="h-4 w-4 text-[#78919a]" />
            </div>
            <div className="mt-2 space-y-1.5">
              {analysis.brief.nextChecks.map((check) => {
                const tone = check.priority === 'high' ? '#c94a50' : check.priority === 'medium' ? '#b3860f' : '#2d7c94';
                return (
                  <div key={check.title} className="rounded-xl border border-white/80 bg-white/55 p-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
                      <p className="text-[10px] font-semibold text-[#26362a]">{check.title}</p>
                      <span className="ml-auto text-[7px] font-semibold uppercase tracking-[0.1em]" style={{ color: tone }}>{check.priority}</span>
                    </div>
                    <p className="mt-1 pl-3 text-[8px] leading-relaxed text-[#718277]">{check.detail}</p>
                  </div>
                );
              })}
              {analysis.brief.nextChecks.length === 0 ? <p className="text-[9px] text-[#718277]">No immediate gap identified. Verify through the normal workflow.</p> : null}
            </div>
            <p className="mt-3 border-t border-dashed border-[#dbe5d6] pt-2 text-[8px] leading-relaxed text-[#8ba1a9]">
              Suggested checks prioritise missing evidence. They do not assert wrongdoing and do not replace an authorised determination.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
