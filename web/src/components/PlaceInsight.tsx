import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CloudRain,
  Compass,
  Droplets,
  Factory,
  MapPin,
  Thermometer,
  Wind,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { aqiCategory, aqiFromPm25 } from '../lib/aqi';
import { AQI_COLORS, CATEGORY_LABELS, number, timeAgo } from '../lib/format';
import { Badge, Button, Spinner } from './ui';
import type { LocationAnalysis } from './LocationDrawer';

interface SeriesPoint {
  observedAt: string;
  value: number;
  qualityState: string;
  isSimulated: boolean;
}

interface SeriesResponse {
  observations: SeriesPoint[];
  unit: string | null;
  note: string;
}

function hourLabel(value: string): string {
  return new Date(value).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function confidenceTone(level?: string): 'green' | 'amber' | 'neutral' {
  return level === 'HIGH' ? 'green' : level === 'MEDIUM' ? 'amber' : 'neutral';
}

function MetricBubble({
  icon: Icon,
  value,
  label,
  accent = '#3f7d2a',
  className = '',
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  accent?: string;
  className?: string;
}) {
  return (
    <div
      className={`pointer-events-none flex h-[84px] w-[84px] flex-col items-center justify-center rounded-full border border-white/90 bg-white/90 text-center shadow-[0_20px_45px_-28px_rgba(20,42,27,.55)] backdrop-blur-xl ${className}`}
    >
      <Icon className="h-4 w-4" style={{ color: accent }} />
      <p className="display mt-1 text-[15px] font-semibold leading-none text-[#142016]">{value}</p>
      <p className="mt-1 text-[8px] font-medium text-[#7b8a7d]">{label}</p>
    </div>
  );
}

function MiniMetric({
  icon: Icon,
  value,
  label,
  accent = '#3f7d2a',
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  accent?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center rounded-2xl border border-white/90 bg-white/80 px-1.5 py-2 text-center shadow-[0_14px_30px_-26px_rgba(20,42,27,.45)]">
      <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
      <p className="display mt-0.5 truncate text-[12px] font-semibold leading-none text-[#142016]">{value}</p>
      <p className="mt-0.5 truncate text-[7px] text-[#8a938b]">{label}</p>
    </div>
  );
}

function AqiChart({ series }: { series: SeriesPoint[] }) {
  const values = series.map((point) => aqiFromPm25(point.value));
  const maxAqi = Math.max(60, ...values.filter((value): value is number => value !== null));
  return (
    <div>
      <div className="relative mt-3 h-[98px]">
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {[0, 1, 2, 3].map((line) => (
            <span key={line} className="block border-t border-dashed border-[#e8eee4]" />
          ))}
        </div>
        <div className="absolute inset-0 flex items-end gap-1">
          {series.map((point) => {
            const aqi = aqiFromPm25(point.value);
            const category = aqi === null ? 'INSUFFICIENT DATA' : aqiCategory(aqi);
            const color = AQI_COLORS[category] ?? '#728176';
            const height = aqi === null ? 4 : Math.max(7, Math.min(100, (aqi / maxAqi) * 100));
            return (
              <div
                key={`${point.observedAt}-${point.value}`}
                title={`${hourLabel(point.observedAt)} · PM2.5 ${number(point.value)} µg/m³ · ${category}`}
                className="min-w-[3px] flex-1 rounded-t-[3px] transition hover:opacity-80"
                style={{ height: `${height}%`, background: color }}
              />
            );
          })}
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[8px] text-[#9aa39b]">
        <span>{series[0] ? hourLabel(series[0].observedAt) : '—'}</span>
        <span>{series.at(-1) ? hourLabel(series.at(-1)!.observedAt) : '—'}</span>
      </div>
    </div>
  );
}

type ForecastHorizon = NonNullable<LocationAnalysis['forecast']>['horizons'][number];

function ForecastChart({ horizons }: { horizons: ForecastHorizon[] }) {
  const maxValue = Math.max(40, ...horizons.map((horizon) => horizon.predictedValue));
  return (
    <div>
      <div className="relative mt-3 h-[98px]">
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {[0, 1, 2, 3].map((line) => (
            <span key={line} className="block border-t border-dashed border-[#e8eee4]" />
          ))}
        </div>
        <div className="absolute inset-0 flex items-end justify-around gap-3 px-2">
          {horizons.map((horizon) => {
            const aqi = aqiFromPm25(horizon.predictedValue);
            const category = aqi === null ? 'INSUFFICIENT DATA' : aqiCategory(aqi);
            const color = AQI_COLORS[category] ?? '#728176';
            const height = Math.max(12, Math.min(100, (horizon.predictedValue / maxValue) * 100));
            return (
              <div
                key={horizon.horizonHours}
                title={`+${horizon.horizonHours} h · ${number(horizon.predictedValue)} µg/m³ · ${category}`}
                className="flex h-full w-full max-w-[42px] flex-col items-center justify-end gap-1"
              >
                <span className="text-[8px] font-semibold text-[#5f7065]">{number(horizon.predictedValue, 0)}</span>
                <span className="w-full rounded-t-[4px] transition hover:opacity-80" style={{ height: `${height}%`, background: color }} />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-around gap-3 px-2 text-[8px] text-[#9aa39b]">
        {horizons.map((horizon) => (
          <span key={horizon.horizonHours}>+{horizon.horizonHours} h</span>
        ))}
      </div>
    </div>
  );
}

function compassLabel(degrees: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return directions[Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16];
}

function WindCompass({ direction, speed, fromLabel }: { direction: number | null; speed: number | null; fromLabel: string | null }) {
  const directionValue = direction === null ? 0 : direction;
  const ticks = useMemo(
    () =>
      Array.from({ length: 24 }, (_, index) => {
        const angle = index * 15;
        const radius = 53;
        const rad = (angle * Math.PI) / 180;
        const x1 = 60 + Math.sin(rad) * radius;
        const y1 = 60 - Math.cos(rad) * radius;
        const x2 = 60 + Math.sin(rad) * (radius - (index % 6 === 0 ? 7 : 3.5));
        const y2 = 60 - Math.cos(rad) * (radius - (index % 6 === 0 ? 7 : 3.5));
        return { angle, x1, y1, x2, y2 };
      }),
    [],
  );
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 120 120" className="h-[96px] w-[96px] shrink-0" aria-label="Wind direction compass">
        <circle cx="60" cy="60" r="53" fill="none" stroke="#e3ebe0" strokeWidth="1" />
        {ticks.map((tick) => (
          <line key={tick.angle} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} stroke="#d6e2d2" strokeWidth="1" />
        ))}
        <text x="60" y="13" textAnchor="middle" fontSize="8" fontWeight="700" fill="#6f8072">N</text>
        <text x="111" y="63" textAnchor="middle" fontSize="8" fontWeight="700" fill="#6f8072">E</text>
        <text x="60" y="113" textAnchor="middle" fontSize="8" fontWeight="700" fill="#6f8072">S</text>
        <text x="9" y="63" textAnchor="middle" fontSize="8" fontWeight="700" fill="#6f8072">W</text>
        <g transform={`rotate(${directionValue} 60 60)`}>
          <path d="M60 30 L65 60 L60 57 L55 60 Z" fill="#2f8f84" />
          <line x1="60" y1="60" x2="60" y2="89" stroke="#2f8f84" strokeWidth="1.4" strokeDasharray="3 3" opacity="0.45" />
        </g>
        <circle cx="60" cy="60" r="3" fill="#173d2a" />
      </svg>
      <div className="min-w-0">
        <p className="display text-[24px] font-semibold leading-none tracking-[-0.04em] text-[#142016]">
          {speed === null ? '—' : number(speed)}
          <span className="ml-1 text-[9px] font-medium tracking-normal text-[#8a938b]">km/h</span>
        </p>
        <p className="mt-1 text-[9px] text-[#6f7f74]">from {fromLabel ?? '—'}</p>
        <p className="mt-2 text-[8px] leading-relaxed text-[#9aa39b]">Arrow points toward the wind source.</p>
      </div>
    </div>
  );
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    const update = () => setMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}

export function PlaceInsight({
  point,
  category,
  onClose,
  onOpenFull,
}: {
  point: { lat: number; lng: number } | null;
  category: string;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const isMobile = useIsMobile();
  const [analysis, setAnalysis] = useState<LocationAnalysis | null>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!point) {
      setAnalysis(null);
      setSeries([]);
      setLoading(false);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setSeries([]);
    const params = new URLSearchParams({ lat: String(point.lat), lng: String(point.lng), category });
    api
      .get<LocationAnalysis>(`/map/location?${params.toString()}`)
      .then((result) => {
        if (active) setAnalysis(result);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not read this place');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [point?.lat, point?.lng, category]);

  useEffect(() => {
    const primary = analysis?.primary;
    if (!primary || primary.stationType !== 'AIR_CAAQMS') {
      setSeries([]);
      return;
    }
    let active = true;
    api
      .get<SeriesResponse>(`/map/stations/${primary.id}/observations?pollutant=pm25&hours=12`)
      .then((result) => {
        if (!active) return;
        setSeries(result.observations.slice(-12));
      })
      .catch(() => {
        if (active) {
          setSeries([]);
        }
      });
    return () => {
      active = false;
    };
  }, [analysis?.primary?.id, analysis?.primary?.stationType]);

  const air = analysis?.primary?.stationType === 'AIR_CAAQMS' ? analysis.primary : null;
  const airAqi = air?.aqi ?? null;
  const camsAqi = analysis?.cams?.pm25 !== null && analysis?.cams?.pm25 !== undefined ? aqiFromPm25(analysis.cams.pm25) : null;
  const currentAqi = airAqi ?? camsAqi;
  const currentCategory = currentAqi !== null ? aqiCategory(currentAqi) : 'INSUFFICIENT DATA';
  const aqiColor = AQI_COLORS[currentCategory] ?? '#728176';
  const weather = analysis?.weather ?? null;
  const impactWind = analysis?.impact?.wind ?? null;
  const windDirection = impactWind?.directionDeg ?? weather?.windDirectionDeg ?? null;
  const windSpeed = impactWind?.speedKmh ?? weather?.windSpeedKmh ?? null;
  const windFrom = impactWind?.fromLabel ?? (windDirection === null ? null : compassLabel(windDirection));
  const sources = analysis?.impact?.sources ?? [];

  const metrics = [
    { icon: Thermometer, value: weather?.temperatureC === null || weather?.temperatureC === undefined ? '—' : `${number(weather.temperatureC)}°`, label: 'Temperature', accent: '#3f7d2a' },
    { icon: Droplets, value: weather?.relativeHumidity === null || weather?.relativeHumidity === undefined ? '—' : `${number(weather.relativeHumidity, 0)}%`, label: 'Humidity', accent: '#2f8f84' },
    { icon: CloudRain, value: weather?.precipitationMm === null || weather?.precipitationMm === undefined ? '—' : `${number(weather.precipitationMm, 1)} mm`, label: 'Rainfall', accent: '#5b8faf' },
    { icon: Activity, value: currentAqi === null ? '—' : String(currentAqi), label: 'Air quality', accent: aqiColor },
  ];

  const sheet = (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] sm:absolute sm:inset-x-3 sm:bottom-3 sm:z-30">
      <div className="pointer-events-auto relative mx-auto w-full max-w-[980px]">
        <div className="pointer-events-none absolute inset-x-0 -top-[112px] hidden items-end justify-between gap-3 px-8 sm:flex lg:px-14">
          {metrics.map((metric, index) => (
            <MetricBubble
              key={metric.label}
              icon={metric.icon}
              value={metric.value}
              label={metric.label}
              accent={metric.accent}
              className={index === 0 ? 'translate-y-5' : index === 1 ? '-translate-y-2' : index === 2 ? 'translate-y-3' : '-translate-y-4'}
            />
          ))}
        </div>

        <div className="relative max-h-[84dvh] overflow-y-auto rounded-t-[26px] border border-white/95 bg-[#fbfdf9]/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_32px_90px_-44px_rgba(15,40,25,.7)] backdrop-blur-2xl scrollbar-thin sm:max-h-[78vh] sm:rounded-[26px] sm:pb-0">
          <div className="pointer-events-none absolute -left-16 -top-24 h-56 w-56 rounded-full bg-[#b9ff66]/15 blur-3xl" />
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-[#d7e2d0] sm:hidden" />
          <div className="relative flex items-start justify-between gap-3 px-4 pt-3 sm:px-5 sm:pt-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="teal" dot>Place insight</Badge>
                <span className="text-[9px] text-[#8a938b]">{CATEGORY_LABELS[category] ?? category}</span>
                {analysis?.confidence ? <Badge tone={confidenceTone(analysis.confidence.level)}>{analysis.confidence.level} confidence</Badge> : null}
              </div>
              <h3 className="display mt-2 truncate text-[21px] font-semibold tracking-[-0.035em] text-[#142016]">
                {analysis?.place.label ?? (loading ? 'Reading this place…' : 'Selected place')}
              </h3>
              <p className="mt-0.5 truncate text-[9px] text-[#8a938b]">
                {point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : ''}
                {analysis?.place.locality ? ` · near ${analysis.place.locality.name}` : ''}
                {analysis ? ` · ${timeAgo(analysis.generatedAt)}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close place insight"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#e0e8db] bg-white/80 text-[#66766b] transition hover:bg-white hover:text-[#142016] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fc47a]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="relative mt-3 grid grid-cols-4 gap-1.5 px-3 sm:hidden">
            {metrics.map((metric) => (
              <MiniMetric key={metric.label} icon={metric.icon} value={metric.value} label={metric.label} accent={metric.accent} />
            ))}
          </div>

          {loading && !analysis ? (
            <div className="flex min-h-[150px] flex-col items-center justify-center gap-2 px-5 py-8 text-[#7b8a7d]">
              <Spinner />
              <p className="text-[9px] font-medium">Reading the evidence around this point</p>
            </div>
          ) : null}

          {error && !analysis ? (
            <div className="mx-4 my-4 rounded-2xl border border-[#efd3bd] bg-[#fffaf4] px-4 py-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#b06b3a]" />
                <div>
                  <p className="text-[11px] font-semibold text-[#7c4a2a]">This place could not be read</p>
                  <p className="mt-0.5 text-[9px] leading-relaxed text-[#9a6e50]">{error}</p>
                </div>
              </div>
            </div>
          ) : null}

          {analysis ? (
            <>
              {!analysis.withinMumbai ? (
                <p className="mx-4 mt-3 rounded-xl border border-[#eddeae] bg-[#fdf5df] px-3 py-2 text-[9px] leading-relaxed text-[#8a6710]">
                  This point is outside the Greater Mumbai boundary used by the platform. Readings below may not be representative.
                </p>
              ) : null}

              <div className="relative mt-3 grid gap-2 px-3 pb-3 md:grid-cols-3 sm:px-4">
                <div className="rounded-2xl border border-[#e7ece3] bg-white/85 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8a938b]">Air quality</p>
                      <p className="mt-0.5 text-[9px] text-[#9aa39b]">{series.length > 1 ? 'PM2.5 hourly pulse' : analysis.forecast ? 'PM2.5 next 6 hours' : 'Current reading'}</p>
                    </div>
                    <Badge tone="neutral">{airAqi !== null ? 'Station' : analysis.cams ? 'CAMS model' : 'No reading'}</Badge>
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <div>
                      <p className="display text-[28px] font-semibold leading-none tracking-[-0.05em]" style={{ color: aqiColor }}>
                        {currentAqi ?? '—'}
                      </p>
                      <p className="mt-1 text-[9px] font-medium text-[#5f7065]">{currentCategory}</p>
                    </div>
                    {airAqi !== null && air?.values.pm25 ? (
                      <p className="text-right text-[9px] text-[#8a938b]">
                        PM2.5 <span className="font-semibold text-[#26362a]">{number(air.values.pm25.value)}</span> µg/m³
                      </p>
                    ) : analysis.cams?.pm25 !== null && analysis.cams?.pm25 !== undefined ? (
                      <p className="text-right text-[9px] text-[#8a938b]">
                        CAMS <span className="font-semibold text-[#26362a]">{number(analysis.cams.pm25)}</span> µg/m³
                      </p>
                    ) : null}
                  </div>
                  {series.length > 1 ? (
                    <AqiChart series={series} />
                  ) : analysis.forecast?.horizons.length ? (
                    <ForecastChart horizons={analysis.forecast.horizons} />
                  ) : (
                    <p className="mt-4 rounded-xl bg-[#f5f8f2] px-2.5 py-2 text-[8px] leading-relaxed text-[#8a938b]">
                      {airAqi !== null ? 'Hourly PM2.5 series is unavailable for this monitor. The current reading is shown above.' : 'No nearby station series. The air-quality value shown is derived from CAMS modelled PM2.5, not a local station measurement.'}
                    </p>
                  )}
                  {series.length <= 1 && analysis.forecast?.horizons.length ? (
                    <p className="mt-1 text-[7.5px] text-[#9aa39b]">Persistence baseline · not confirmed future conditions.</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[7.5px] text-[#9aa39b]">
                    {['Good', 'Moderate', 'Poor'].map((label) => (
                      <span key={label} className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: AQI_COLORS[label] }} /> {label}
                      </span>
                    ))}
                    <span className="ml-auto">PM2.5 bars · indicative, not CPCB record</span>
                  </div>
                </div>

                <div className="rounded-2xl border border-[#e7ece3] bg-white/85 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8a938b]">Pollution sources</p>
                      <p className="mt-0.5 text-[9px] text-[#9aa39b]">Wind-screen context</p>
                    </div>
                    <Badge tone="amber">Screen</Badge>
                  </div>
                  {sources.length ? (
                    <div className="mt-2 space-y-2">
                      {sources.slice(0, 4).map((source) => (
                        <div key={source.sourceId}>
                          <div className="flex items-center justify-between gap-2 text-[9px]">
                            <span className="inline-flex min-w-0 items-center gap-1.5 truncate font-medium text-[#26362a]">
                              <Factory className="h-3 w-3 shrink-0 text-[#8a938b]" />
                              <span className="truncate">{source.sourceName}</span>
                            </span>
                            <span className="shrink-0 font-semibold text-[#9a5a2e]">{number(source.contributionPct, 0)}%</span>
                          </div>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-[#f0eee7]">
                            <div className="h-full rounded-full bg-[#cf8a4a]" style={{ width: `${Math.max(4, source.contributionPct)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 rounded-xl bg-[#f5f8f2] px-2.5 py-2 text-[8px] leading-relaxed text-[#8a938b]">
                      No industrial source passes the wind-screen threshold near this point. This does not mean the air is clean.
                    </p>
                  )}
                  <p className="mt-2 text-[7.5px] leading-relaxed text-[#9aa39b]">
                    Estimated share from OSM facilities in the wind corridor. Not measured attribution.
                  </p>
                </div>

                <div className="rounded-2xl border border-[#e7ece3] bg-white/85 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#8a938b]">Wind status</p>
                      <p className="mt-0.5 text-[9px] text-[#9aa39b]">Local dispersion context</p>
                    </div>
                    <Compass className="h-4 w-4 text-[#6f8a6b]" />
                  </div>
                  <div className="mt-2">
                    <WindCompass direction={windDirection} speed={windSpeed} fromLabel={windFrom} />
                  </div>
                </div>
              </div>

              <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-[#e8eee3] px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2 text-[8px] text-[#8a938b]">
                  <MapPin className="h-3 w-3 text-[#6f8a6b]" />
                  {analysis.place.note}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="dark" size="sm" onClick={onOpenFull}>
                    Full analysis <ArrowUpRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );

  if (isMobile) {
    return createPortal(
      <>
        <div className="fixed inset-0 z-[69] bg-[#15251a]/20 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
        {sheet}
      </>,
      document.body,
    );
  }

  return sheet;
}
