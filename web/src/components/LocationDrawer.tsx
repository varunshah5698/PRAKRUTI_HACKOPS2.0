import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  Clock,
  Droplets,
  Info,
  MapPin,
  ShieldAlert,
  Thermometer,
  Wind,
} from 'lucide-react';
import { Badge, Button, DataLabel, EmptyState, LoadingBlock, ProgressBar, Sheet } from './ui';
import { api } from '../lib/api';
import { AQI_COLORS, CATEGORY_LABELS, formatDate, number, timeAgo } from '../lib/format';
import { useAuth } from '../store/auth';

interface LocationValue {
  value: number;
  unit: string;
  observedAt: string;
  qualityState: string;
  sourceId: string;
  isSimulated: boolean;
}

interface LocationStation {
  id: string;
  name: string;
  code: string;
  stationType: string;
  localityName: string | null;
  lat: number;
  lng: number;
  distanceM: number;
  healthStatus: string;
  isSimulated: boolean;
  isStale: boolean;
  latestObservedAt: string | null;
  aqi: number | null;
  aqiCategory: string;
  dominantPollutant: string | null;
  values: Record<string, LocationValue>;
}

interface NearbyStation {
  id: string;
  name: string;
  stationType: string;
  localityName: string | null;
  distanceM: number;
  latestValue: number | null;
  latestUnit: string | null;
  latestParameter: string | null;
  aqi: number | null;
  aqiCategory: string;
  isSimulated: boolean;
  isStale: boolean;
}

interface LocationRecommendation {
  title: string;
  detail: string;
  tone: 'urgent' | 'caution' | 'action' | 'info';
}

interface LocationReport {
  id: string;
  public_ref: string;
  category: string;
  incident_type: string;
  status: string;
  verification_state: string;
  submitted_at: string;
  locality_name: string | null;
  distance_m: number;
  is_simulated: boolean;
}

interface LocationIncident {
  id: string;
  public_ref: string;
  title: string;
  category: string;
  status: string;
  risk_level: string;
  detected_at: string;
  distance_m: number;
  is_simulated: boolean;
}

interface LocationAlert {
  id: string;
  public_ref: string;
  category: string;
  level: string;
  state: string;
  trigger_type: string;
  title: string;
  triggered_at: string;
  is_simulated: boolean;
}

interface LocationAnalysis {
  generatedAt: string;
  category: string;
  withinMumbai: boolean;
  place: {
    label: string;
    reverse: { name: string; displayName: string; road: string | null; source: string; fetchedAt: string } | null;
    locality: { id: string; name: string; lat: number; lng: number } | null;
    distanceM: number | null;
    lat: number;
    lng: number;
    note: string;
  };
  primary: LocationStation | null;
  nearbyStations: NearbyStation[];
  weather: {
    temperatureC: number | null;
    relativeHumidity: number | null;
    windSpeedKmh: number | null;
    windDirectionDeg: number | null;
    precipitationMm: number | null;
    observedAt: string;
    sourceId: string;
  } | null;
  cams: { localityName: string; pm25: number | null; pm10: number | null; observedAt: string; note: string } | null;
  forecast: {
    method: string;
    modelStatus: string;
    horizons: Array<{
      horizonHours: number;
      predictedValue: number;
      lowerBound: number;
      upperBound: number;
      method: string;
      confidence: string;
      targetTime: string;
    }>;
    note: string;
  } | null;
  impact: {
    method: string;
    status: string;
    wind: { speedKmh: number; directionDeg: number; observedAt: string | null; source: string; fromLabel: string };
    impactLevel: string;
    sources: Array<{
      sourceId: string;
      sourceName: string;
      sourceType: string;
      contributionPct: number;
      estimatedContributionPm25: number;
      distanceKm: number;
      alignment: number;
      downwind: boolean;
    }>;
    note: string;
    disclaimer: string;
  } | null;
  reports: LocationReport[];
  incidents: LocationIncident[];
  alerts: LocationAlert[];
  recommendations: LocationRecommendation[];
  confidence: { level: 'HIGH' | 'MEDIUM' | 'LOW'; score: number; reasons: string[] };
  limitations: string[];
}

const STATION_TYPE_LABEL: Record<string, string> = {
  AIR_CAAQMS: 'Air monitor',
  WATER_SAMPLING: 'Water sampling point',
  INDUSTRIAL_STACK: 'Stack monitor',
};

const TONE_STYLE: Record<LocationRecommendation['tone'], { border: string; background: string; color: string; icon: typeof Info }> = {
  urgent: { border: 'border-red-500/25', background: 'bg-red-500/[0.05]', color: 'text-red-700', icon: AlertTriangle },
  caution: { border: 'border-amber-500/25', background: 'bg-amber-500/[0.05]', color: 'text-amber-700', icon: ShieldAlert },
  action: { border: 'border-[#2f8f84]/25', background: 'bg-[#2f8f84]/[0.05]', color: 'text-[#1f766d]', icon: ArrowUpRight },
  info: { border: 'border-[#dfe6db]', background: 'bg-[#f5f8f2]', color: 'text-[#5a6a5f]', icon: Info },
};

function distanceLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(1)} km`;
}

function displayValues(station: LocationStation) {
  const preferred: Record<string, string[]> = {
    AIR_CAAQMS: ['pm25', 'pm10', 'no2', 'so2', 'co', 'o3'],
    WATER_SAMPLING: ['ph', 'do', 'turbidity', 'conductivity'],
    INDUSTRIAL_STACK: ['stack_pm', 'stack_nox', 'stack_so2'],
  };
  return Object.entries(station.values)
    .filter(([code]) => (preferred[station.stationType] ?? []).includes(code))
    .sort(([a], [b]) => (preferred[station.stationType] ?? []).indexOf(a) - (preferred[station.stationType] ?? []).indexOf(b));
}

export function LocationDrawer({
  point,
  category,
  onClose,
  onOpenStation,
}: {
  point: { lat: number; lng: number } | null;
  category: string;
  onClose: () => void;
  onOpenStation: (stationId: string) => void;
}) {
  const navigate = useNavigate();
  const { isAuthority } = useAuth();
  const [analysis, setAnalysis] = useState<LocationAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!point) {
      setAnalysis(null);
      setLoading(false);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    const params = new URLSearchParams({ lat: String(point.lat), lng: String(point.lng), category });
    api
      .get<LocationAnalysis>(`/map/location?${params.toString()}`)
      .then((result) => {
        if (active) setAnalysis(result);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not analyse this location');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [point?.lat, point?.lng, category]);

  const confidenceTone = analysis?.confidence.level === 'HIGH' ? 'green' : analysis?.confidence.level === 'MEDIUM' ? 'amber' : 'neutral';
  const airPrimary = analysis?.primary?.stationType === 'AIR_CAAQMS' ? analysis.primary : null;
  const valueEntries = analysis?.primary ? displayValues(analysis.primary) : [];

  return (
    <Sheet
      open={Boolean(point)}
      onOpenChange={(open) => !open && onClose()}
      title={analysis?.place.label ?? 'Location analysis'}
      description={
        point
          ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)} · ${CATEGORY_LABELS[category] ?? category}`
          : 'Analysing selected point'
      }
      className="max-w-[620px]"
    >
      {loading ? <LoadingBlock className="min-h-[55vh]" label="Reading the evidence around this point" /> : null}
      {error ? (
        <div className="px-5 py-6">
          <EmptyState title="Location analysis unavailable" description={error} icon={<AlertTriangle className="h-5 w-5" />} />
        </div>
      ) : null}
      {analysis && !loading && !error ? (
        <div className="space-y-5 px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={analysis.withinMumbai ? 'teal' : 'amber'} dot>{analysis.withinMumbai ? 'Inside Greater Mumbai' : 'Outside boundary'}</Badge>
            <Badge tone={confidenceTone}>{analysis.confidence.level} confidence</Badge>
            <Badge tone="neutral">Point screen</Badge>
            <span className="ml-auto inline-flex items-center gap-1 text-[9px] text-[#66766b]">
              <Clock className="h-3 w-3" /> {timeAgo(analysis.generatedAt)}
            </span>
          </div>

          {!analysis.withinMumbai ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-[10px] leading-relaxed text-amber-700/85">
              This point is outside the Greater Mumbai boundary used by the platform. Evidence shown below may not be representative.
            </div>
          ) : null}

          <section>
            <DataLabel>Where you clicked</DataLabel>
            <div className="mt-2 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="display text-lg font-semibold tracking-[-0.02em] text-[#142016]">{analysis.place.label}</p>
                  {analysis.place.reverse ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-[#5a6a5f]">{analysis.place.reverse.displayName}</p>
                  ) : null}
                  <p className="mt-1 text-[10px] text-[#66766b]">
                    {analysis.place.locality
                      ? `Nearest reference locality: ${analysis.place.locality.name} · ${distanceLabel(analysis.place.distanceM)} away`
                      : 'No reference locality nearby'}
                  </p>
                </div>
                <span className="rounded-full border border-[#cfe2c8] bg-white/80 p-2 text-[#3f7d2a]"><MapPin className="h-4 w-4" /></span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-[#66766b]">
                <p>Coordinates <span className="text-[#1b2a1f]">{analysis.place.lat.toFixed(5)}, {analysis.place.lng.toFixed(5)}</span></p>
                <p>Category <span className="text-[#1b2a1f]">{CATEGORY_LABELS[analysis.category] ?? analysis.category}</span></p>
              </div>
              <p className="mt-2 text-[9px] leading-relaxed text-[#66766b]">{analysis.place.note}</p>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-2">
              <DataLabel>Local snapshot</DataLabel>
              <span className="text-[9px] text-[#66766b]">{analysis.primary ? STATION_TYPE_LABEL[analysis.primary.stationType] ?? analysis.primary.stationType : 'No reference monitor'}</span>
            </div>
            {analysis.primary ? (
              <div className="mt-2 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    {airPrimary ? (
                      <>
                        <p className="display text-4xl font-bold leading-none" style={{ color: AQI_COLORS[airPrimary.aqiCategory] ?? '#728176' }}>
                          {airPrimary.aqi ?? '—'}
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-[#26362a]">
                          Indicative AQI · {airPrimary.aqiCategory}
                          {airPrimary.dominantPollutant ? ` · dominant ${airPrimary.dominantPollutant.toUpperCase()}` : ''}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm font-semibold text-[#142016]">{STATION_TYPE_LABEL[analysis.primary.stationType] ?? analysis.primary.stationType}</p>
                    )}
                    <p className="mt-1 text-[10px] text-[#5a6a5f]">
                      {analysis.primary.name.replace(' demo air monitor', '').replace(' demo sampling point', '')} · {distanceLabel(analysis.primary.distanceM)} away
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge tone={analysis.primary.isSimulated ? 'amber' : 'green'}>{analysis.primary.isSimulated ? 'Simulation' : 'Source record'}</Badge>
                    <p className="mt-1.5 text-[9px] text-[#66766b]">{analysis.primary.isStale ? 'Stale reading' : 'Fresh reading'}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {valueEntries.map(([code, value]) => (
                    <div key={code} className="rounded-lg border border-[#dfe6db] bg-white/70 p-2.5">
                      <DataLabel>{code.replace(/_/g, ' ')}</DataLabel>
                      <p className="mt-0.5 text-sm font-semibold text-[#142016]">
                        {number(value.value)} <span className="text-[9px] font-normal text-[#6f7f74]">{value.unit}</span>
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-[#dbe5d6] pt-2">
                  <p className="text-[9px] text-[#66766b]">Observed {formatDate(analysis.primary.latestObservedAt)} · {analysis.primary.healthStatus}</p>
                  <Button size="sm" variant="dark" onClick={() => onOpenStation(analysis.primary!.id)}>
                    Open monitor <ArrowUpRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-2 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4 text-[10px] leading-relaxed text-[#66766b]">
                No reference monitor is close to this point. This location is unassessed, not clean.
              </div>
            )}
          </section>

          {analysis.weather ? (
            <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3">
              <div className="flex items-center justify-between">
                <DataLabel>Weather context</DataLabel>
                <span className="text-[9px] text-[#66766b]">{formatDate(analysis.weather.observedAt)}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-[#5a6a5f] sm:grid-cols-4">
                <span className="inline-flex items-center gap-1"><Thermometer className="h-3 w-3 text-[#3f7d2a]" /> {number(analysis.weather.temperatureC)}°C</span>
                <span className="inline-flex items-center gap-1"><Droplets className="h-3 w-3 text-[#2f8f84]" /> {number(analysis.weather.relativeHumidity, 0)}%</span>
                <span className="inline-flex items-center gap-1"><Wind className="h-3 w-3 text-[#66766b]" /> {number(analysis.weather.windSpeedKmh)} km/h · {analysis.impact?.wind.fromLabel ?? '—'}</span>
                <span className="inline-flex items-center gap-1"><Droplets className="h-3 w-3 text-[#66766b]" /> {number(analysis.weather.precipitationMm)} mm rain</span>
              </div>
            </div>
          ) : null}

          {analysis.forecast ? (
            <section>
              <DataLabel>Predicted at the nearest monitor</DataLabel>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {analysis.forecast.horizons.map((horizon) => (
                  <div key={horizon.horizonHours} className="rounded-xl border border-[#2f8f84]/20 bg-[#2f8f84]/[0.04] p-3">
                    <DataLabel>+{horizon.horizonHours} h</DataLabel>
                    <p className="mt-1 text-xl font-semibold text-[#142016]">
                      {number(horizon.predictedValue)} <span className="text-[9px] font-normal text-[#6f7f74]">µg/m³</span>
                    </p>
                    <p className="mt-0.5 text-[9px] text-[#66766b]">band {number(horizon.lowerBound)}–{number(horizon.upperBound)}</p>
                    <p className="mt-1 text-[8px] uppercase tracking-[0.08em] text-[#2f8f84]">{horizon.method}</p>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[9px] leading-relaxed text-[#66766b]">{analysis.forecast.note}</p>
            </section>
          ) : null}

          <section>
            <div className="flex items-center justify-between gap-2">
              <DataLabel>What may be affecting this place</DataLabel>
              {analysis.impact ? <Badge tone={analysis.impact.impactLevel === 'HIGH' ? 'red' : analysis.impact.impactLevel === 'MODERATE' ? 'amber' : 'neutral'}>{analysis.impact.impactLevel} screened influence</Badge> : null}
            </div>

            {analysis.impact ? (
              <div className="mt-2 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4">
                <div className="flex items-center justify-between gap-2 text-[10px] text-[#5a6a5f]">
                  <span className="inline-flex items-center gap-1"><Wind className="h-3 w-3 text-[#3f7d2a]" /> Wind from {analysis.impact.wind.fromLabel} · {number(analysis.impact.wind.speedKmh)} km/h</span>
                  <span className="text-[9px] text-[#66766b]">{analysis.impact.status.replace(/_/g, ' ')}</span>
                </div>
                <div className="mt-3 space-y-3">
                  {analysis.impact.sources.map((source) => (
                    <div key={source.sourceId}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[11px] font-semibold text-[#26362a]">{source.sourceName}</p>
                          <p className="text-[9px] text-[#66766b]">{source.sourceType} · {source.distanceKm} km · {source.downwind ? 'downwind' : 'crosswind / upwind'}</p>
                        </div>
                        <span className="text-[11px] font-semibold text-[#9a3412]">{source.contributionPct}%</span>
                      </div>
                      <ProgressBar value={source.contributionPct} tone={source.downwind ? '#c2410c' : '#a16207'} />
                      <p className="mt-1 text-[9px] text-[#66766b]">Potential PM2.5 share ≈ {number(source.estimatedContributionPm25)} µg/m³ · screening only</p>
                    </div>
                  ))}
                  {analysis.impact.sources.length === 0 ? (
                    <p className="text-[10px] text-[#66766b]">No industrial source passes the screening threshold near this point.</p>
                  ) : null}
                </div>
                <p className="mt-3 text-[9px] leading-relaxed text-[#66766b]">{analysis.impact.disclaimer}</p>
              </div>
            ) : (
              <div className="mt-2 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4 text-[10px] leading-relaxed text-[#66766b]">
                Industrial source screening is not applied to {CATEGORY_LABELS[analysis.category] ?? analysis.category}.
              </div>
            )}

            {analysis.cams ? (
              <div className="mt-2 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[#26362a]"><Wind className="h-3.5 w-3.5 text-[#2f8f84]" /> CAMS modelled context · {analysis.cams.localityName}</span>
                  <span className="text-[9px] text-[#66766b]">{formatDate(analysis.cams.observedAt)}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-[#5a6a5f]">
                  <p>PM2.5 <span className="font-semibold text-[#1b2a1f]">{number(analysis.cams.pm25)} µg/m³</span></p>
                  <p>PM10 <span className="font-semibold text-[#1b2a1f]">{number(analysis.cams.pm10)} µg/m³</span></p>
                </div>
                <p className="mt-1.5 text-[9px] text-[#66766b]">{analysis.cams.note}</p>
              </div>
            ) : null}

            {analysis.reports.length ? (
              <div className="mt-2 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4">
                <DataLabel>Citizen reports within 3 km</DataLabel>
                <div className="mt-2 space-y-2">
                  {analysis.reports.map((report) => (
                    <div key={report.id} className="flex items-start justify-between gap-2 text-[10px]">
                      <div>
                        <p className="font-medium text-[#26362a]">{report.public_ref} · {report.incident_type.replace(/_/g, ' ')}</p>
                        <p className="text-[9px] text-[#66766b]">{distanceLabel(report.distance_m)} · {timeAgo(report.submitted_at)} · {report.is_simulated ? 'simulation data · ' : ''}{report.status.replace(/_/g, ' ')}</p>
                      </div>
                      <Badge tone={report.verification_state === 'VERIFIED' ? 'green' : report.verification_state === 'REJECTED' ? 'red' : 'amber'}>{report.verification_state}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {isAuthority() && analysis.incidents.length ? (
              <div className="mt-2 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4">
                <DataLabel>Official incidents within 5 km</DataLabel>
                <div className="mt-2 space-y-2">
                  {analysis.incidents.map((incident) => (
                    <button key={incident.id} onClick={() => navigate(`/incidents/${incident.id}`)} className="block w-full text-left">
                      <p className="text-[10px] font-medium text-[#26362a]">{incident.title}</p>
                      <p className="text-[9px] text-[#66766b]">{distanceLabel(incident.distance_m)} · {incident.status.replace(/_/g, ' ')} · risk {incident.risk_level}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {analysis.alerts.length ? (
              <div className="mt-2 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4">
                <DataLabel>Active alerts for this area</DataLabel>
                <div className="mt-2 space-y-2">
                  {analysis.alerts.map((alert) => (
                    <button key={alert.id} onClick={() => navigate(`/alerts/${alert.id}`)} className="flex w-full items-start justify-between gap-2 text-left">
                      <div>
                        <p className="text-[10px] font-medium text-[#26362a]">{alert.title}</p>
                        <p className="text-[9px] text-[#66766b]">{alert.trigger_type} · {timeAgo(alert.triggered_at)}</p>
                      </div>
                      <Badge tone={alert.level === 'CRITICAL' ? 'red' : alert.level === 'WATCH' ? 'amber' : 'teal'}>{alert.level}</Badge>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {analysis.nearbyStations.length ? (
            <section>
              <DataLabel>Other monitors nearby</DataLabel>
              <div className="mt-2 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3">
                {analysis.nearbyStations.map((station) => (
                  <button key={station.id} onClick={() => onOpenStation(station.id)} className="flex w-full items-center justify-between gap-2 border-b border-dashed border-[#dbe5d6] py-2 text-left last:border-0 last:pb-0 first:pt-0">
                    <span>
                      <span className="block text-[10px] font-medium text-[#26362a]">{station.name.replace(' demo air monitor', '').replace(' demo sampling point', '')}</span>
                      <span className="block text-[9px] text-[#66766b]">{STATION_TYPE_LABEL[station.stationType] ?? station.stationType} · {distanceLabel(station.distanceM)}</span>
                    </span>
                    <span className="text-right text-[10px] text-[#5a6a5f]">
                      {station.latestValue !== null ? `${number(station.latestValue)} ${station.latestUnit ?? ''}` : station.aqi !== null ? `AQI ${station.aqi}` : '—'}
                      <ArrowUpRight className="ml-1 inline h-3 w-3 text-[#66766b]" />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <DataLabel>What you can do</DataLabel>
            <div className="mt-2 space-y-2">
              {analysis.recommendations.map((item) => {
                const style = TONE_STYLE[item.tone];
                const Icon = style.icon;
                return (
                  <div key={item.title} className={`rounded-xl border p-3 ${style.border} ${style.background}`}>
                    <div className="flex items-start gap-2">
                      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${style.color}`} />
                      <div>
                        <p className="text-[11px] font-semibold text-[#26362a]">{item.title}</p>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-[#5a6a5f]">{item.detail}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
              <Button variant="lime" size="sm" onClick={() => navigate('/report')} className="w-full">
                Report an issue at a location <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-2">
              <DataLabel>How confident is this analysis</DataLabel>
              <Badge tone={confidenceTone}>{analysis.confidence.level} · {analysis.confidence.score}/100</Badge>
            </div>
            <div className="mt-2 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4">
              <ul className="space-y-1.5 text-[10px] leading-relaxed text-[#5a6a5f]">
                {analysis.confidence.reasons.map((reason) => <li key={reason} className="flex gap-2"><span className="text-[#66766b]">—</span>{reason}</li>)}
              </ul>
              <div className="mt-3 border-t border-dashed border-[#dbe5d6] pt-3">
                <DataLabel>Limitations</DataLabel>
                <ul className="mt-1.5 space-y-1.5 text-[9px] leading-relaxed text-[#66766b]">
                  {analysis.limitations.map((limitation) => <li key={limitation} className="flex gap-2"><span>—</span>{limitation}</li>)}
                </ul>
              </div>
            </div>
          </section>

          <p className="text-[9px] leading-relaxed text-[#66766b]">
            This is a screening analysis, not a regulatory determination or a medical advisory. Follow official alerts and emergency guidance first.
          </p>
        </div>
      ) : null}
    </Sheet>
  );
}
