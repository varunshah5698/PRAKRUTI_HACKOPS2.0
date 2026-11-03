import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  CloudFog,
  CloudRain,
  CloudSun,
  Compass,
  Droplets,
  Eye,
  Gauge,
  Layers3,
  MapPin,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Sun,
  Thermometer,
  Waves,
  Wind,
} from 'lucide-react';
import { Chart, chartAxis, chartGrid, chartTooltip } from '../../components/Chart';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel } from '../../components/ui';
import { api } from '../../lib/api';
import { AQI_COLORS, formatDate, number, timeAgo } from '../../lib/format';

/* ------------------------------------------------------------------ */
/*  Types and deterministic simulation model                           */
/* ------------------------------------------------------------------ */

interface WeatherSeed {
  observed_at: string;
  temperature_c: number;
  relative_humidity: number;
  wind_speed_kmh: number;
  wind_direction_deg: number;
  precipitation_mm: number;
  is_simulated: boolean;
}

interface StationSeed {
  id: string;
  name: string;
  locality: string;
  lat: number;
  lng: number;
  aqi: number | null;
  aqiCategory: string;
  pm25: number | null;
  pm10: number | null;
  isSimulated: boolean;
  isStale: boolean;
}

interface DashboardSeed {
  generatedAt: string;
  weather: WeatherSeed | null;
  mapStations: StationSeed[];
  charts: { pm25Series: Array<{ bucket: string; value: number }> };
}

type ScenarioKey = 'clean' | 'baseline' | 'stagnant';
type LayerKey = 'aqi' | 'pm25' | 'no2';

export const HISTORY_HOURS = 24;
export const FORECAST_HOURS = 48;

const SCENARIOS: Record<ScenarioKey, {
  label: string;
  short: string;
  factor: number;
  wind: number;
  boundaryLayer: number;
  color: string;
  note: string;
}> = {
  clean: {
    label: 'Clean-air measures',
    short: 'Clean',
    factor: 0.68,
    wind: 1.22,
    boundaryLayer: 1.16,
    color: '#3d9f7c',
    note: 'Traffic curbs, dust suppression and a stronger onshore breeze.',
  },
  baseline: {
    label: 'Current trajectory',
    short: 'Baseline',
    factor: 1,
    wind: 1,
    boundaryLayer: 1,
    color: '#2d7c94',
    note: 'Today’s weather, traffic and emission pattern continues unchanged.',
  },
  stagnant: {
    label: 'Stagnant inversion',
    short: 'Stagnant',
    factor: 1.34,
    wind: 0.58,
    boundaryLayer: 0.66,
    color: '#c97445',
    note: 'A low boundary layer and weak wind trap emissions near the ground.',
  },
};

const LAYERS: Record<LayerKey, { label: string; unit: string; max: number }> = {
  aqi: { label: 'AQI', unit: 'index', max: 300 },
  pm25: { label: 'PM2.5', unit: 'µg/m³', max: 180 },
  no2: { label: 'NO₂', unit: 'µg/m³', max: 120 },
};

const FALLBACK_WEATHER: WeatherSeed = {
  observed_at: new Date().toISOString(),
  temperature_c: 30.4,
  relative_humidity: 76,
  wind_speed_kmh: 11,
  wind_direction_deg: 242,
  precipitation_mm: 0,
  is_simulated: true,
};

const FALLBACK_STATIONS: StationSeed[] = [
  ['Colaba', 18.906, 72.815, 42, 78],
  ['Worli', 19.017, 72.817, 58, 101],
  ['Bandra', 19.059, 72.829, 72, 124],
  ['Andheri', 19.119, 72.846, 84, 142],
  ['Borivali', 19.23, 72.857, 55, 96],
  ['Malad', 19.187, 72.848, 69, 118],
  ['Powai', 19.119, 72.905, 49, 88],
  ['BKC', 19.06, 72.867, 80, 135],
  ['Chembur', 19.052, 72.9, 94, 156],
  ['Sion', 19.043, 72.862, 75, 128],
  ['Dadar', 19.018, 72.844, 65, 112],
  ['Kurla', 19.072, 72.884, 88, 147],
  ['Mulund', 19.172, 72.956, 71, 121],
  ['Thane', 19.218, 72.978, 60, 104],
  ['Navi Mumbai', 19.033, 73.029, 52, 92],
].map(([name, lat, lng, pm25, aqi], index) => ({
  id: `fallback-${index}`,
  name: String(name),
  locality: String(name),
  lat: Number(lat),
  lng: Number(lng),
  aqi: Number(aqi),
  aqiCategory: '',
  pm25: Number(pm25),
  pm10: Math.round(Number(pm25) * 1.72),
  isSimulated: true,
  isStale: false,
}));

interface SimPoint {
  time: Date;
  hour: number;
  label: string;
  dayLabel: string;
  pm25: number;
  aqi: number;
  lower: number;
  upper: number;
  temperature: number;
  humidity: number;
  wind: number;
  boundaryLayer: number;
  traffic: number;
  rain: number;
}

interface Simulation {
  points: SimPoint[];
  scenario: ScenarioKey;
}

export interface Seed {
  basePm25: number;
  baseAqi: number;
  weather: WeatherSeed;
  stations: StationSeed[];
  generatedAt: string | null;
  source: 'live' | 'sandbox';
  summary: DashboardSeed | null;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

/** CPCB sub-index breakpoints applied to an indicative PM2.5 value. */
export function aqiFromPm25(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const points = [
    { concentration: 0, aqi: 0 },
    { concentration: 30, aqi: 50 },
    { concentration: 60, aqi: 100 },
    { concentration: 90, aqi: 200 },
    { concentration: 120, aqi: 300 },
    { concentration: 250, aqi: 400 },
    { concentration: 500, aqi: 500 },
  ];
  for (let i = 1; i < points.length; i += 1) {
    const low = points[i - 1];
    const high = points[i];
    if (value <= high.concentration) {
      return Math.round(((high.aqi - low.aqi) / (high.concentration - low.concentration)) * (value - low.concentration) + low.aqi);
    }
  }
  return 500;
}

export function aqiCategory(value: number): string {
  if (value <= 50) return 'Good';
  if (value <= 100) return 'Satisfactory';
  if (value <= 200) return 'Moderate';
  if (value <= 300) return 'Poor';
  if (value <= 400) return 'Very Poor';
  return 'Severe';
}

function aqiColor(value: number): string {
  return AQI_COLORS[aqiCategory(value)] ?? '#728176';
}

function hexAlpha(hex: string, alpha: string): string {
  return `${hex}${alpha}`;
}

function istHour(date: Date): number {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(date));
  return Number.isFinite(hour) ? hour % 24 : date.getHours();
}

function hourLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', timeZone: 'Asia/Kolkata' }).format(date);
}

function dayLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' }).format(date);
}

function pseudoNoise(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function buildSimulation(seed: Seed, scenario: ScenarioKey, anchor: Date): Simulation {
  const spec = SCENARIOS[scenario];
  const weather = seed.weather;
  const total = HISTORY_HOURS + FORECAST_HOURS + 1;
  const start = new Date(anchor.getTime() - HISTORY_HOURS * 3_600_000);
  const rawPm: number[] = [];
  const rawWeather: Array<{ temperature: number; humidity: number; wind: number; boundaryLayer: number; traffic: number; rain: number }> = [];
  const baselineSpec = SCENARIOS.baseline;
  let baselineRawAtNow = 0;

  const concentration = (base: number, traffic: number, boundaryLayer: number, wind: number, humidity: number, temperature: number, rain: number, index: number) =>
    base *
      (0.84 + traffic * 0.42) *
      (1.1 + (1 - boundaryLayer) * 0.22) *
      (1 - Math.min(0.24, wind / 130)) *
      (1 + (humidity - 60) * 0.0018) *
      (1 + (temperature - 28) * 0.004) *
      (1 - Math.min(0.15, rain * 0.035)) *
      (0.96 + Math.sin((index + 2) / 5.4) * 0.06) +
    (pseudoNoise(index, 11) - 0.5) * 5;

  for (let i = 0; i < total; i += 1) {
    const time = new Date(start.getTime() + i * 3_600_000);
    const hour = istHour(time);
    const traffic = Math.exp(-((hour - 9.5) ** 2) / 6) * 0.62 + Math.exp(-((hour - 19) ** 2) / 8) * 0.9 + 0.16;
    const daytime = Math.max(0, Math.sin(((hour - 6) / 24) * Math.PI * 2));
    const boundaryLayer = clamp((0.3 + daytime * 0.95) * spec.boundaryLayer, 0.2, 1.7);
    const wind = Math.max(2, (weather.wind_speed_kmh + Math.sin((hour / 24) * Math.PI * 2) * 3.4) * spec.wind);
    const temperature = weather.temperature_c + daytime * 4.2 - (hour < 6 ? 2.6 : 0) + (pseudoNoise(i, 3) - 0.5);
    const humidity = clamp(weather.relative_humidity + (1 - daytime) * 7 - temperature * 0.2 + (pseudoNoise(i, 7) - 0.5) * 3, 30, 98);
    const rain = weather.precipitation_mm > 0.4 ? weather.precipitation_mm * Math.max(0, Math.sin((i / 8) * Math.PI)) : 0;

    if (i === HISTORY_HOURS) {
      const baselineBoundary = clamp((0.3 + daytime * 0.95) * baselineSpec.boundaryLayer, 0.2, 1.7);
      const baselineWind = Math.max(2, (weather.wind_speed_kmh + Math.sin((hour / 24) * Math.PI * 2) * 3.4) * baselineSpec.wind);
      baselineRawAtNow = concentration(seed.basePm25 * baselineSpec.factor, traffic, baselineBoundary, baselineWind, humidity, temperature, rain, i);
    }

    rawPm.push(Math.max(4, concentration(seed.basePm25 * spec.factor, traffic, boundaryLayer, wind, humidity, temperature, rain, i)));
    rawWeather.push({ temperature, humidity, wind, boundaryLayer, traffic, rain });
  }

  const nowIndex = HISTORY_HOURS;
  const normalize = seed.basePm25 / Math.max(4, baselineRawAtNow);
  const points: SimPoint[] = rawPm.map((raw, index) => {
    const pm25 = clamp(raw * normalize, 4, 420);
    const horizon = index - nowIndex;
    const spread = 4.5 + Math.sqrt(Math.max(0, horizon)) * 2.35;
    const values = rawWeather[index];
    return {
      time: new Date(start.getTime() + index * 3_600_000),
      hour: istHour(new Date(start.getTime() + index * 3_600_000)),
      label: hourLabel(new Date(start.getTime() + index * 3_600_000)),
      dayLabel: dayLabel(new Date(start.getTime() + index * 3_600_000)),
      pm25,
      aqi: aqiFromPm25(pm25) ?? 0,
      lower: clamp(pm25 - spread, 0, 500),
      upper: pm25 + spread,
      temperature: values.temperature,
      humidity: values.humidity,
      wind: values.wind,
      boundaryLayer: values.boundaryLayer,
      traffic: values.traffic,
      rain: values.rain,
    };
  });

  return { points, scenario };
}

function weatherCondition(weather: WeatherSeed): string {
  if (weather.precipitation_mm > 1) return 'Rain drifting across the bay';
  if (weather.relative_humidity >= 78) return 'Humid haze over the city';
  if (weather.temperature_c >= 32) return 'Warm, hazy sunshine';
  return 'Hazy sunshine between clouds';
}

function WeatherGlyph({ weather, className }: { weather: WeatherSeed; className?: string }) {
  if (weather.precipitation_mm > 0.6) return <CloudRain className={className} strokeWidth={1.5} />;
  if (weather.relative_humidity >= 80) return <CloudFog className={className} strokeWidth={1.5} />;
  if (weather.temperature_c >= 32) return <Sun className={className} strokeWidth={1.5} />;
  return <CloudSun className={className} strokeWidth={1.5} />;
}

function AqiRing({ value, category, size = 196 }: { value: number; category: string; size?: number }) {
  const radius = 76;
  const circumference = 2 * Math.PI * radius;
  const progress = clamp(value / 300, 0.015, 1);
  const color = AQI_COLORS[category] ?? '#728176';
  const angle = -90 + progress * 360;
  const markerX = 100 + radius * Math.cos((angle * Math.PI) / 180);
  const markerY = 100 + radius * Math.sin((angle * Math.PI) / 180);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 200 200" className="h-full w-full" role="img" aria-label={`Indicative air quality index ${value}, ${category}`}>
        <defs>
          <linearGradient id="atmo-aqi-arc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#58b991" />
            <stop offset="34%" stopColor="#c4ca5f" />
            <stop offset="66%" stopColor="#e8a24c" />
            <stop offset="100%" stopColor="#cb5b5e" />
          </linearGradient>
          <filter id="atmo-aqi-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx="100" cy="100" r={radius} fill="none" stroke="rgba(255,255,255,.68)" strokeWidth="16" />
        <circle cx="100" cy="100" r={radius} fill="none" stroke="rgba(31,92,108,.08)" strokeWidth="1" strokeDasharray="2 5" />
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke="url(#atmo-aqi-arc)"
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={`${progress * circumference} ${circumference}`}
          transform="rotate(-90 100 100)"
          filter="url(#atmo-aqi-glow)"
        />
        <circle cx={markerX} cy={markerY} r="5.5" fill="#ffffff" stroke={color} strokeWidth="3" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#5f7f8b]">Indicative AQI</span>
        <span className="display mt-1 text-[46px] font-bold leading-none tracking-[-0.06em] text-[#123240]">{number(value, 0)}</span>
        <span className="mt-1.5 text-[11px] font-semibold" style={{ color }}>{category}</span>
        <span className="mt-0.5 text-[9px] text-[#6e8b95]">simulated city mean</span>
      </div>
    </div>
  );
}

function TinyArea({ values, color = '#2d7c94', className = '' }: { values: number[]; color?: string; className?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => `${(index / (values.length - 1)) * 100},${34 - ((value - min) / span) * 28}`)
    .join(' ');
  return (
    <svg viewBox="0 0 100 38" preserveAspectRatio="none" className={className} aria-hidden>
      <polygon points={`0,38 ${points} 100,38`} fill={color} opacity="0.13" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function ScenarioSwitch({ value, onChange }: { value: ScenarioKey; onChange: (value: ScenarioKey) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-full border border-[#d8e7ea] bg-white/70 p-1">
      {(Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => {
        const active = value === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            aria-pressed={active}
            className="rounded-full px-2 py-1.5 text-[10px] font-semibold transition"
            style={active ? { background: SCENARIOS[key].color, color: '#ffffff', boxShadow: `0 8px 18px -12px ${SCENARIOS[key].color}` } : { color: '#557480' }}
          >
            {SCENARIOS[key].short}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  3D atmosphere scene                                                */
/* ------------------------------------------------------------------ */

function sceneColor(layer: LayerKey, value: number): string {
  if (layer === 'aqi') return aqiColor(value);
  if (layer === 'pm25') {
    if (value <= 30) return '#4fa98d';
    if (value <= 60) return '#8caf57';
    if (value <= 90) return '#d3a947';
    if (value <= 120) return '#d97c4b';
    return '#bf5459';
  }
  if (value <= 40) return '#59a9a4';
  if (value <= 80) return '#3d8fae';
  if (value <= 120) return '#426f9d';
  return '#545387';
}

function AtmosphereScene({
  stations,
  simulation,
  horizon,
  basePm25,
  layer,
  onLayerChange,
}: {
  stations: StationSeed[];
  simulation: Simulation;
  horizon: number;
  basePm25: number;
  layer: LayerKey;
  onLayerChange: (layer: LayerKey) => void;
}) {
  const [pose, setPose] = useState({ yaw: -22, pitch: 58 });
  const [zoom, setZoom] = useState(1.25);
  const [selectedId, setSelectedId] = useState(stations[0]?.id ?? '');
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const nowPoint = simulation.points[HISTORY_HOURS];
  const scenePoint = simulation.points[HISTORY_HOURS + horizon];
  const layerSpec = LAYERS[layer];
  const scale = layer === 'aqi'
    ? scenePoint.aqi / Math.max(1, nowPoint.aqi)
    : scenePoint.pm25 / Math.max(1, nowPoint.pm25);

  const bars = useMemo(() => {
    const lats = stations.map((station) => station.lat);
    const lngs = stations.map((station) => station.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latSpan = maxLat - minLat || 1;
    const lngSpan = maxLng - minLng || 1;

    return stations.map((station, index) => {
      const stationPm = station.pm25 ?? basePm25 * (0.82 + ((index * 37) % 41) / 100);
      const stationAqi = station.aqi ?? aqiFromPm25(stationPm) ?? scenePoint.aqi;
      const raw = layer === 'aqi' ? stationAqi : layer === 'pm25' ? stationPm : stationPm * 0.52 + 14;
      const value = clamp(raw * scale, 1, layer === 'aqi' ? 500 : 400);
      const height = 28 + Math.pow(clamp(value / layerSpec.max, 0, 1), 0.8) * 188;
      const x = 46 + ((station.lng - minLng) / lngSpan) * 468;
      const y = 34 + ((maxLat - station.lat) / latSpan) * 232;
      return {
        station,
        value,
        height,
        x,
        y,
        color: sceneColor(layer, value),
      };
    });
  }, [stations, layer, scale, layerSpec.max, basePm25, scenePoint.aqi]);

  const selected = bars.find((bar) => bar.station.id === selectedId) ?? bars[0];
  const ranked = [...bars].sort((a, b) => b.value - a.value);
  const selectedPm = selected ? clamp((selected.station.pm25 ?? basePm25) * scale, 1, 400) : basePm25;
  const selectedAqi = selected ? (layer === 'aqi' ? selected.value : (aqiFromPm25(selectedPm) ?? scenePoint.aqi)) : scenePoint.aqi;
  const profileFactors = [1, 0.76 - (scenePoint.boundaryLayer - 0.7) * 0.12, 0.46 - (scenePoint.boundaryLayer - 0.7) * 0.16, 0.2];
  const profile = profileFactors.map((factor, index) => ({
    label: ['Street level', '500 m', '1.5 km', '3 km'][index],
    value: Math.max(2, selectedPm * clamp(factor, 0.08, 1)),
  }));
  const profileMax = Math.max(...profile.map((row) => row.value));

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, yaw: pose.yaw, pitch: pose.pitch };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    setPose({
      yaw: drag.current.yaw + dx * 0.38,
      pitch: clamp(drag.current.pitch + dy * 0.18, 34, 74),
    });
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <Card className="overflow-hidden xl:col-span-8">
      <CardHeader className="items-center">
        <div>
          <CardTitle>Atmosphere, in three dimensions</CardTitle>
          <p className="mt-1 text-[10px] text-[#66766b]">Extruded locality columns · simulated forecast at H+{horizon} · drag to orbit</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(Object.keys(LAYERS) as LayerKey[]).map((key) => (
            <button key={key} onClick={() => onLayerChange(key)} className="atmo-chip" data-active={layer === key}>
              {LAYERS[key].label}
            </button>
          ))}
        </div>
      </CardHeader>

      <div className="grid lg:grid-cols-[1fr_250px]">
        <div
          className="atmo-scene h-[400px] sm:h-[520px]"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="atmo-axis left-4 top-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[#557480]">H+{horizon} · {layerSpec.label}</p>
            <p className="mt-0.5 text-[10px] text-[#78919a]">Simulated column height</p>
          </div>
          <div className="atmo-axis right-4 top-4 flex items-center gap-1.5 rounded-full border border-white/80 bg-white/70 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] backdrop-blur">
            <Compass className="h-3 w-3" /> N
          </div>

          <div
            className="atmo-stage"
            style={{ transform: `translate(-50%, -50%) rotateX(${pose.pitch}deg) rotateZ(${pose.yaw}deg) scale(calc(var(--atmo-fit) * ${zoom}))` }}
          >
            <div className="atmo-floor">
              <svg className="atmo-wind-path" viewBox="0 0 560 320" aria-hidden>
                <defs>
                  <marker id="atmo-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" fill="rgba(58,137,158,.55)" />
                  </marker>
                </defs>
                <path d="M 30 268 C 154 238, 245 216, 526 96" fill="none" stroke="rgba(58,137,158,.34)" strokeWidth="1.4" strokeDasharray="4 6" markerEnd="url(#atmo-arrow)" />
                <path d="M 44 108 C 174 92, 328 72, 518 210" fill="none" stroke="rgba(58,137,158,.22)" strokeWidth="1.2" strokeDasharray="3 7" markerEnd="url(#atmo-arrow)" />
              </svg>
              {bars.map((bar) => {
                const isSelected = selected?.station.id === bar.station.id;
                return (
                  <button
                    key={bar.station.id}
                    className={`atmo-bar ${isSelected ? 'is-selected' : ''}`}
                    style={{
                      left: bar.x - 14,
                      top: bar.y - 14,
                      width: 28,
                      height: 28,
                      '--h': `${bar.height}px`,
                      '--bar': bar.color,
                    } as React.CSSProperties}
                    onClick={() => setSelectedId(bar.station.id)}
                    aria-label={`${bar.station.name}, ${layerSpec.label} ${number(bar.value, 0)} ${layerSpec.unit}`}
                    aria-pressed={isSelected}
                  >
                    <span className="atmo-bar-base" />
                    <span className="atmo-bar-wall" />
                    <span className="atmo-bar-top" />
                    {isSelected ? (
                      <span className="atmo-bar-label">
                        {bar.station.name.replace(' demo air monitor', '')} · {number(bar.value, 0)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="absolute bottom-3 left-4 z-10">
            <div className="flex items-center gap-2 text-[9px] font-semibold text-[#557480]">
              <span>{layerSpec.label}</span>
              <span className="h-[4px] w-28 rounded-full" style={{ background: layer === 'aqi' ? 'linear-gradient(90deg,#3aa981,#c4ca5f,#e8a24c,#cb5b5e)' : 'linear-gradient(90deg,#4fa98d,#d3a947,#bf5459)' }} />
              <span className="text-[#78919a]">0 → {layerSpec.max}+</span>
            </div>
          </div>

          <div className="atmo-scene-controls">
            <button onClick={() => setZoom((value) => clamp(Number((value + 0.1).toFixed(2)), 0.7, 1.55))} aria-label="Zoom in"><Plus className="h-3.5 w-3.5" /></button>
            <button onClick={() => setZoom((value) => clamp(Number((value - 0.1).toFixed(2)), 0.7, 1.55))} aria-label="Zoom out"><Minus className="h-3.5 w-3.5" /></button>
            <button onClick={() => { setPose({ yaw: -22, pitch: 58 }); setZoom(1.25); }} aria-label="Reset view"><RotateCcw className="h-3.5 w-3.5" /></button>
          </div>
        </div>

        <aside className="border-t border-dashed border-[#dbe5d6] p-4 lg:border-l lg:border-t-0">
          <DataLabel>Selected locality</DataLabel>
          <div className="mt-1.5 flex items-start justify-between gap-2">
            <div>
              <p className="display text-[18px] font-bold leading-tight tracking-[-0.03em] text-[#123240]">{selected?.station.name.replace(' demo air monitor', '') ?? 'No station'}</p>
              <p className="mt-0.5 text-[9px] text-[#6e8b95]">{selected?.station.isSimulated ? 'Simulated station' : 'Connected source'} · H+{horizon}</p>
            </div>
            <span className="rounded-full px-2 py-1 text-[9px] font-semibold" style={{ color: aqiColor(selectedAqi), background: hexAlpha(aqiColor(selectedAqi), '18') }}>
              {aqiCategory(selectedAqi)}
            </span>
          </div>

          <div className="mt-4 flex items-end gap-2">
            <p className="display text-[38px] font-bold leading-none tracking-[-0.06em]" style={{ color: aqiColor(selectedAqi) }}>{number(selectedAqi, 0)}</p>
            <span className="mb-1 text-[10px] text-[#6e8b95]">AQI</span>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {[
              ['PM2.5', selectedPm, 'µg/m³'],
              ['PM10', selectedPm * 1.72, 'µg/m³'],
              ['NO₂', selectedPm * 0.52 + 14, 'µg/m³'],
            ].map(([label, value, unit]) => (
              <div key={String(label)} className="rounded-xl border border-white/80 bg-white/55 p-2">
                <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-[#78919a]">{label}</p>
                <p className="mt-0.5 text-[12px] font-semibold text-[#20424f]">{number(Number(value), 0)}</p>
                <p className="text-[7px] text-[#8ba1a9]">{unit}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 border-t border-dashed border-[#dbe5d6] pt-3">
            <div className="flex items-center justify-between">
              <DataLabel>Vertical mixing</DataLabel>
              <span className="text-[9px] text-[#6e8b95]">BLH {number(scenePoint.boundaryLayer, 2)} km</span>
            </div>
            <div className="mt-2 space-y-2">
              {profile.map((row) => (
                <div key={row.label}>
                  <div className="flex items-center justify-between text-[9px] text-[#557480]">
                    <span>{row.label}</span>
                    <span className="font-semibold text-[#20424f]">{number(row.value, 0)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#e4eff1]">
                    <div className="h-full rounded-full" style={{ width: `${(row.value / profileMax) * 100}%`, background: `linear-gradient(90deg, ${selected?.color ?? '#2d7c94'}, ${hexAlpha(selected?.color ?? '#2d7c94', '99')})` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[8px] leading-relaxed text-[#8ba1a9]">Illustrative dispersion profile, not a lidar or sounding measurement.</p>
          </div>

          <div className="mt-4 border-t border-dashed border-[#dbe5d6] pt-3">
            <div className="flex items-center justify-between">
              <DataLabel>Hotspots</DataLabel>
              <span className="text-[8px] text-[#8ba1a9]">{layerSpec.unit}</span>
            </div>
            <div className="mt-1.5 space-y-1">
              {ranked.slice(0, 3).map((bar) => (
                <button key={bar.station.id} onClick={() => setSelectedId(bar.station.id)} className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-white/70">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: bar.color }} />
                  <span className="min-w-0 flex-1 truncate text-[9px] text-[#557480]">{bar.station.name.replace(' demo air monitor', '')}</span>
                  <span className="text-[9px] font-semibold text-[#20424f]">{number(bar.value, 0)}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function AtmospherePage() {
  const [summary, setSummary] = useState<DashboardSeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scenario, setScenario] = useState<ScenarioKey>('baseline');
  const [horizon, setHorizon] = useState(6);
  const [playing, setPlaying] = useState(false);
  const [layer, setLayer] = useState<LayerKey>('aqi');

  const anchor = useMemo(() => {
    const date = new Date();
    date.setMinutes(0, 0, 0);
    return date;
  }, []);

  const load = (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    api
      .get<DashboardSeed>('/dashboard/summary')
      .then((result) => setSummary(result))
      .catch(() => setSummary(null))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setHorizon((value) => (value >= FORECAST_HOURS ? 0 : value + 1)), 900);
    return () => clearInterval(timer);
  }, [playing]);

  const seed: Seed = useMemo(() => {
    const weather = summary?.weather ?? FALLBACK_WEATHER;
    const stations = summary?.mapStations?.length ? summary.mapStations : FALLBACK_STATIONS;
    const stationPm = stations.map((station) => station.pm25).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const latestSeries = summary?.charts?.pm25Series?.at(-1)?.value;
    const basePm25 = clamp(latestSeries ?? mean(stationPm) ?? 62, 14, 220);
    return {
      basePm25,
      baseAqi: aqiFromPm25(basePm25) ?? 100,
      weather,
      stations,
      generatedAt: summary?.generatedAt ?? null,
      source: summary ? 'live' : 'sandbox',
      summary,
    };
  }, [summary]);

  const simulation = useMemo(() => buildSimulation(seed, scenario, anchor), [seed, scenario, anchor]);
  const nowPoint = simulation.points[HISTORY_HOURS];
  const selectedPoint = simulation.points[HISTORY_HOURS + horizon];
  const forecastPoints = simulation.points.slice(HISTORY_HOURS);
  const deltaAqi = selectedPoint.aqi - nowPoint.aqi;
  const category = aqiCategory(nowPoint.aqi);
  const aqiTone = AQI_COLORS[category] ?? '#728176';
  const weather = seed.weather;
  const liveWeather = Boolean(summary?.weather && !summary.weather.is_simulated);

  const forecastOption = useMemo(() => {
    const points = simulation.points;
    const times = points.map((point) => point.label);
    const history = points.map((point, index) => (index <= HISTORY_HOURS ? point.pm25 : null));
    const forecast = points.map((point, index) => (index >= HISTORY_HOURS ? point.pm25 : null));
    const lower = points.map((point, index) => (index >= HISTORY_HOURS ? point.lower : null));
    const band = points.map((point, index) => (index >= HISTORY_HOURS ? point.upper - point.lower : null));
    const markLabel = points[HISTORY_HOURS + horizon]?.label ?? '';
    return {
      grid: { ...chartGrid, top: 34, right: 24, bottom: 30 },
      tooltip: chartTooltip,
      legend: {
        top: 0,
        left: 4,
        itemWidth: 10,
        itemHeight: 8,
        textStyle: { color: '#6e8490', fontSize: 10 },
        data: ['Modelled history', 'Simulated forecast', 'NAAQS 24h reference'],
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: times,
        ...chartAxis,
        axisLabel: {
          ...chartAxis.axisLabel,
          interval: 11,
          color: '#78919a',
          formatter: (value: string, index: number) => `${points[index]?.dayLabel.split(',')[0] ?? ''} ${value}`,
        },
      },
      yAxis: {
        type: 'value',
        ...chartAxis,
        splitLine: { lineStyle: { color: '#e9f1f2', type: 'dashed' } },
      },
      series: [
        {
          name: '_bandLower',
          type: 'line',
          stack: 'confidence',
          data: lower,
          symbol: 'none',
          lineStyle: { opacity: 0 },
          areaStyle: { opacity: 0 },
          silent: true,
          tooltip: { show: false },
        },
        {
          name: '_bandUpper',
          type: 'line',
          stack: 'confidence',
          data: band,
          symbol: 'none',
          lineStyle: { opacity: 0 },
          areaStyle: { color: 'rgba(45,124,148,.13)' },
          silent: true,
          tooltip: { show: false },
        },
        {
          name: 'Modelled history',
          type: 'line',
          data: history,
          smooth: 0.35,
          symbol: 'none',
          lineStyle: { color: '#3f9a83', width: 2.2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(63,154,131,.18)' },
                { offset: 1, color: 'rgba(63,154,131,0)' },
              ],
            },
          },
        },
        {
          name: 'Simulated forecast',
          type: 'line',
          data: forecast,
          smooth: 0.35,
          symbol: 'none',
          lineStyle: { color: '#2d7c94', width: 2.6, type: 'dashed' },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#c97445', type: 'dotted', width: 1.2, opacity: 0.7 },
            label: { color: '#b06033', fontSize: 9, formatter: `H+${horizon}` },
            data: [{ xAxis: markLabel }],
          },
        },
        {
          name: 'NAAQS 24h reference',
          type: 'line',
          data: points.map(() => 60),
          symbol: 'none',
          lineStyle: { color: '#c97445', width: 1, type: 'dotted', opacity: 0.65 },
          silent: true,
        },
      ],
    };
  }, [simulation, horizon]);

  const sourceMix = useMemo(() => {
    const tables: Record<ScenarioKey, number[]> = {
      clean: [28, 18, 16, 7, 31],
      baseline: [34, 22, 17, 9, 18],
      stagnant: [36, 20, 19, 10, 15],
    };
    const values = tables[scenario];
    return [
      { name: 'Traffic & transport', value: values[0], color: '#3b82a0' },
      { name: 'Construction dust', value: values[1], color: '#d9a65a' },
      { name: 'Industry & energy', value: values[2], color: '#7b8f9c' },
      { name: 'Waste burning', value: values[3], color: '#c97567' },
      { name: 'Regional & marine', value: values[4], color: '#62b39b' },
    ];
  }, [scenario]);

  const sourceOption = useMemo(() => ({
    tooltip: { ...chartTooltip, trigger: 'item', formatter: '{b}: {c}%' },
    series: [
      {
        type: 'pie',
        radius: ['58%', '80%'],
        center: ['50%', '50%'],
        startAngle: 96,
        padAngle: 3,
        itemStyle: { borderRadius: 8, borderColor: '#fbfdf9', borderWidth: 3 },
        label: { show: false },
        emphasis: { scale: true, scaleSize: 4 },
        data: sourceMix.map((source) => ({ name: source.name, value: source.value, itemStyle: { color: source.color } })),
      },
    ],
  }), [sourceMix]);

  const radarOption = useMemo(() => {
    const pm = selectedPoint.pm25;
    const values = [pm, pm * 1.72, pm * 0.52 + 14, 38 + pm * 0.28, 0.6 + pm * 0.012, 7 + pm * 0.1];
    const reference = [1, 1, 1, 1, 1, 1];
    const ratios = [values[0] / 60, values[1] / 100, values[2] / 80, values[3] / 100, values[4] / 2, values[5] / 80];
    return {
      tooltip: { ...chartTooltip, trigger: 'item' },
      radar: {
        indicator: [
          { name: 'PM2.5', max: 2.4 },
          { name: 'PM10', max: 2.4 },
          { name: 'NO₂', max: 2.4 },
          { name: 'O₃', max: 2.4 },
          { name: 'CO', max: 2.4 },
          { name: 'SO₂', max: 2.4 },
        ],
        center: ['50%', '52%'],
        radius: '64%',
        splitNumber: 4,
        axisName: { color: '#5f7f8b', fontSize: 9 },
        splitLine: { lineStyle: { color: '#dfecef' } },
        splitArea: { areaStyle: { color: ['rgba(255,255,255,0)', 'rgba(233,244,246,.45)'] } },
        axisLine: { lineStyle: { color: '#d5e6ea' } },
      },
      legend: { bottom: 0, itemWidth: 10, itemHeight: 8, textStyle: { color: '#6e8490', fontSize: 9 } },
      series: [
        {
          type: 'radar',
          data: [
            {
              value: ratios.map((value) => Number(value.toFixed(2))),
              name: `H+${horizon} scenario`,
              symbolSize: 4,
              lineStyle: { color: '#2d7c94', width: 2 },
              itemStyle: { color: '#2d7c94' },
              areaStyle: { color: 'rgba(45,124,148,.18)' },
            },
            {
              value: reference,
              name: 'NAAQS reference',
              symbol: 'none',
              lineStyle: { color: '#c97445', width: 1.2, type: 'dashed' },
              areaStyle: { color: 'transparent' },
            },
          ],
        },
      ],
    };
  }, [selectedPoint, horizon]);

  const heatmapOption = useMemo(() => {
    const busy = 0.36 + (scenario === 'stagnant' ? 0.16 : scenario === 'clean' ? -0.12 : 0);
    const days: string[] = [];
    const data: Array<[number, number, number]> = [];
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(anchor.getTime() - (6 - day) * 86_400_000);
      days.push(dayLabel(date));
      for (let hour = 0; hour < 24; hour += 1) {
        const traffic = Math.exp(-((hour - 9.5) ** 2) / 6) * 0.5 + Math.exp(-((hour - 19) ** 2) / 8) * 0.8 + 0.15;
        const night = hour < 6 || hour > 21 ? 1.22 : 1;
        const value = seed.basePm25 * (0.7 + traffic * busy) * night * (0.75 + pseudoNoise(day * 24 + hour, 5) * 0.55);
        data.push([hour, day, Math.round(value)]);
      }
    }
    return {
      tooltip: { ...chartTooltip, formatter: (params: { value: [number, number, number] }) => `${days[params.value[1]]} · ${params.value[0]}:00<br/>PM2.5 ${params.value[2]} µg/m³` },
      grid: { left: 46, right: 12, top: 8, bottom: 42 },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, index) => `${String(index).padStart(2, '0')}`),
        ...chartAxis,
        splitArea: { show: false },
        axisLabel: { ...chartAxis.axisLabel, interval: 2, color: '#78919a', fontSize: 9 },
      },
      yAxis: {
        type: 'category',
        data: days,
        ...chartAxis,
        axisLabel: { ...chartAxis.axisLabel, color: '#78919a', fontSize: 9 },
      },
      visualMap: {
        min: 15,
        max: Math.max(90, Math.round(seed.basePm25 * 1.5)),
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        itemWidth: 9,
        itemHeight: 70,
        textStyle: { color: '#78919a', fontSize: 9 },
        text: ['high', 'low'],
        inRange: { color: ['#dff0e4', '#f2e9b0', '#efc06c', '#df8a55', '#b94e58'] },
      },
      series: [
        {
          type: 'heatmap',
          data,
          itemStyle: { borderRadius: 3, borderColor: '#fbfdf9', borderWidth: 2 },
          emphasis: { itemStyle: { borderColor: '#2d7c94', borderWidth: 1 } },
        },
      ],
    };
  }, [anchor, seed.basePm25, scenario]);

  const windOption = useMemo(() => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const speeds = directions.map((_, index) => {
      const base = 4 + Math.abs(Math.sin(index * 1.7 + 0.4)) * 13;
      return Number((base * (scenario === 'stagnant' ? 0.62 : scenario === 'clean' ? 1.18 : 1)).toFixed(1));
    });
    return {
      tooltip: { ...chartTooltip, trigger: 'axis', formatter: (params: Array<{ name: string; value: number }>) => `${params[0]?.name ?? ''} · ${params[0]?.value ?? 0} km/h` },
      polar: { center: ['50%', '52%'], radius: '68%' },
      angleAxis: {
        type: 'category',
        data: directions,
        startAngle: 90,
        axisLine: { lineStyle: { color: '#d5e6ea' } },
        axisTick: { show: false },
        axisLabel: { color: '#5f7f8b', fontSize: 9 },
      },
      radiusAxis: {
        max: 24,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { lineStyle: { color: '#e3eef1', type: 'dashed' } },
      },
      series: [
        {
          type: 'bar',
          coordinateSystem: 'polar',
          data: speeds.map((speed) => ({ value: speed, itemStyle: { color: speed > 12 ? '#2d7c94' : speed > 7 ? '#63a7b7' : '#a8d0d8' } })),
          barWidth: '58%',
          roundCap: true,
        },
      ],
    };
  }, [scenario]);

  const featureData = useMemo(() => {
    const windEffect = -(selectedPoint.wind / 22) * 16 - 2;
    const boundaryEffect = -(selectedPoint.boundaryLayer - 0.5) * 22;
    const trafficEffect = selectedPoint.traffic * 15;
    const humidityEffect = (selectedPoint.humidity - 68) * 0.16;
    const temperatureEffect = (selectedPoint.temperature - 29) * 1.1;
    const regionalEffect = 6.8 * (scenario === 'stagnant' ? 1.3 : scenario === 'clean' ? 0.7 : 1);
    return [
      { label: 'Wind dispersion', value: windEffect },
      { label: 'Boundary layer', value: boundaryEffect },
      { label: 'Traffic index', value: trafficEffect },
      { label: 'Humidity', value: humidityEffect },
      { label: 'Temperature', value: temperatureEffect },
      { label: 'Regional transport', value: regionalEffect },
    ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  }, [selectedPoint, scenario]);

  const futureSlice = forecastPoints.slice(0, FORECAST_HOURS + 1);
  const futurePeak = Math.max(...futureSlice.map((point) => point.pm25));
  const futurePeakAqi = aqiFromPm25(futurePeak) ?? 0;
  const futureAverage = mean(futureSlice.map((point) => point.pm25)) ?? 0;
  const exceedanceHours = futureSlice.filter((point) => point.pm25 >= 60).length;
  const confidence = Math.max(58, Math.round(93 - horizon * 0.42 - (scenario === 'stagnant' ? 6 : 0)));
  const bestPoint = futureSlice.reduce((best, point) => (point.aqi < best.aqi ? point : best), futureSlice[0]);
  const peakPoint = futureSlice.reduce((peak, point) => (point.aqi > peak.aqi ? point : peak), futureSlice[0]);

  return (
    <div className="atmo-page space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#c7e2e8] bg-[#eef8fa] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#2d7083]">
              <Sparkles className="h-3 w-3" /> Atmosphere lab
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#ecd9b9] bg-[#fdf6e8] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#9b6a25]">
              Scenario simulation
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/65 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#5f7f8b]">
              <span className={`h-1.5 w-1.5 rounded-full ${seed.source === 'live' ? 'bg-[#4e9b3f]' : 'bg-[#d0a14c]'}`} />
              {seed.source === 'live' ? 'Live data seed' : 'Sandbox seed'}
            </span>
          </div>
          <h1 className="display mt-2 text-[30px] font-bold leading-[1.02] tracking-[-0.05em] text-[#123240] sm:text-[38px]">
            Air, in three dimensions.
          </h1>
          <p className="mt-1.5 max-w-2xl text-[11px] leading-relaxed text-[#5f7f8b]">
            An immersive weather, dispersion and prediction workspace for Mumbai. The forecast, pollutants and 3D columns are simulated from live station and weather seeds — not an official CPCB reading.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing || loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh seed
          </Button>
          <Link to="/intelligence/predictions">
            <Button variant="dark" size="sm">Model page <ArrowUpRight className="h-3.5 w-3.5" /></Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <section className="atmo-hero relative rounded-[30px] xl:col-span-8">
          <div className="atmo-sun right-[29%] top-[-58px]" aria-hidden />
          <div className="atmo-cloud right-[24%] top-[22px] h-[16px] w-[76px]" aria-hidden />
          <div className="atmo-cloud right-[4%] top-[128px] h-[11px] w-[52px] opacity-60 [animation-delay:-8s]" aria-hidden />
          <div className="atmo-skyline" aria-hidden />

          <div className="relative z-10 flex h-full flex-col p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/80 bg-white/60 text-[#2d7c94]">
                  <MapPin className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-[12px] font-semibold text-[#173d4a]">Mumbai · Maharashtra</p>
                  <p className="text-[9px] text-[#5f7f8b]">Greater Mumbai airshed · Asia/Kolkata</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/85 bg-white/65 px-2.5 py-1 text-[9px] font-semibold text-[#3f6570] backdrop-blur">
                  <span className={`h-1.5 w-1.5 rounded-full ${liveWeather ? 'bg-[#4e9b3f]' : 'bg-[#d0a14c]'}`} />
                  {liveWeather ? 'Live weather' : 'Simulated weather'}
                </span>
                <span className="hidden text-[9px] text-[#5f7f8b] sm:block">{formatDate(weather.observed_at)}</span>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-5 sm:mt-7">
              <div className="min-w-0">
                <div className="flex items-start gap-2">
                  <p className="display text-[78px] font-bold leading-[0.78] tracking-[-0.08em] text-[#123240] sm:text-[92px]">
                    {number(weather.temperature_c, 0)}
                  </p>
                  <span className="display mt-1 text-[30px] font-semibold tracking-[-0.04em] text-[#39616d]">°C</span>
                </div>
                <div className="mt-4 flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/55 text-[#c49a1c]">
                    <WeatherGlyph weather={weather} className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[12px] font-semibold text-[#173d4a]">{weatherCondition(weather)}</p>
                    <p className="text-[9px] text-[#5f7f8b]">
                      Feels like {number(weather.temperature_c + Math.max(0, weather.relative_humidity - 60) * 0.06, 0)}° · {weather.wind_speed_kmh} km/h {Math.round(weather.wind_direction_deg)}° wind
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-center sm:gap-4">
                <AqiRing value={nowPoint.aqi} category={category} size={188} />
                <div className="min-w-[120px] rounded-2xl border border-white/80 bg-white/55 p-3 backdrop-blur">
                  <DataLabel>Dominant</DataLabel>
                  <p className="mt-1 text-[13px] font-semibold text-[#173d4a]">PM2.5</p>
                  <p className="mt-0.5 text-[9px] text-[#5f7f8b]">{number(nowPoint.pm25, 0)} µg/m³ city mean</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/80">
                    <div className="h-full rounded-full" style={{ width: `${clamp((nowPoint.pm25 / 120) * 100, 4, 100)}%`, background: aqiTone }} />
                  </div>
                  <p className="mt-2 text-[8px] leading-relaxed text-[#6e8b95]">24h NAAQS screening reference 60 µg/m³. Hourly values are indicative.</p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { icon: Droplets, label: 'Humidity', value: `${number(weather.relative_humidity, 0)}%`, note: 'surface air' },
                { icon: Wind, label: 'Wind', value: `${number(weather.wind_speed_kmh, 0)} km/h`, note: 'onshore drift' },
                { icon: CloudRain, label: 'Rain', value: `${number(weather.precipitation_mm, 1)} mm`, note: 'last hour' },
                { icon: Eye, label: 'Visibility', value: `${number(clamp(10 - nowPoint.pm25 / 18, 2.5, 10), 1)} km`, note: 'simulated' },
              ].map(({ icon: Icon, label, value, note }) => (
                <div key={label} className="flex items-center gap-2.5 rounded-2xl border border-white/70 bg-white/45 p-2.5 backdrop-blur-sm">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/75 text-[#2d7c94]">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-[#5f7f8b]">{label}</p>
                    <p className="text-[12px] font-semibold text-[#173d4a]">{value}</p>
                    <p className="text-[7px] text-[#6e8b95]">{note}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="atmo-hero-strip mt-5 flex gap-1.5 overflow-x-auto pb-1">
              {simulation.points.slice(HISTORY_HOURS, HISTORY_HOURS + 10).map((point, index) => {
                const pointCategory = aqiCategory(point.aqi);
                return (
                  <div key={point.time.toISOString()} className={`flex min-w-[62px] flex-col items-center gap-1.5 rounded-2xl px-2 py-2 ${index === 0 ? 'bg-white/70 shadow-[0_10px_24px_-20px_rgba(23,61,74,.6)]' : 'bg-white/28'}`}>
                    <span className={`text-[8px] font-semibold uppercase tracking-[0.08em] ${index === 0 ? 'text-[#2d7083]' : 'text-[#6e8b95]'}`}>{index === 0 ? 'Now' : point.label}</span>
                    {point.hour >= 6 && point.hour <= 18 ? <Sun className="h-3.5 w-3.5 text-[#d5a32a]" /> : <CloudSun className="h-3.5 w-3.5 text-[#7a98a2]" />}
                    <span className="text-[11px] font-semibold text-[#173d4a]">{number(point.temperature, 0)}°</span>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: AQI_COLORS[pointCategory] }} />
                    <span className="text-[8px] text-[#5f7f8b]">{point.aqi}</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-auto grid grid-cols-2 gap-2 pt-5 sm:grid-cols-4">
              {[
                { label: 'Cleanest window', value: bestPoint.label, note: `AQI ${bestPoint.aqi} · ${number(bestPoint.pm25, 0)} µg/m³`, tone: '#3f9a83' },
                { label: 'Peak window', value: peakPoint.label, note: `AQI ${peakPoint.aqi} · ${number(peakPoint.pm25, 0)} µg/m³`, tone: '#c97445' },
                { label: 'Dominant source', value: `${sourceMix[0].value}%`, note: sourceMix[0].name, tone: '#2d7c94' },
                { label: 'Directional trust', value: `${confidence}%`, note: `simulated spread · H+${horizon}`, tone: '#6b8f9b' },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/65 bg-white/35 px-3 py-2.5 backdrop-blur-sm">
                  <p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-[#6e8b95]">{item.label}</p>
                  <p className="display mt-1 text-[16px] font-bold leading-none tracking-[-0.03em]" style={{ color: item.tone }}>{item.value}</p>
                  <p className="mt-1 truncate text-[8px] text-[#6e8b95]">{item.note}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Card className="relative overflow-hidden xl:col-span-4">
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#ecf8fa] to-transparent" />
          <CardHeader className="relative">
            <div>
              <CardTitle>Forecast cockpit</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Deterministic scenario surrogate · 48h horizon</p>
            </div>
            <Badge tone="teal">Simulated</Badge>
          </CardHeader>
          <div className="relative p-5">
            <div className="flex items-end justify-between gap-2">
              <div>
                <DataLabel>At H+{horizon}</DataLabel>
                <p className="display mt-1 text-[40px] font-bold leading-none tracking-[-0.06em]" style={{ color: aqiColor(selectedPoint.aqi) }}>
                  {number(selectedPoint.aqi, 0)}
                  <span className="ml-1.5 align-middle text-[10px] font-medium tracking-normal text-[#6e8b95]">AQI</span>
                </p>
                <p className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold" style={{ color: deltaAqi > 0 ? '#c97445' : '#3f9a83' }}>
                  {deltaAqi > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {deltaAqi > 0 ? '+' : ''}{number(deltaAqi, 0)} vs now · {aqiCategory(selectedPoint.aqi)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] uppercase tracking-[0.12em] text-[#6e8b95]">Confidence</p>
                <p className="display mt-0.5 text-[20px] font-bold text-[#173d4a]">{confidence}%</p>
                <p className="text-[8px] text-[#8ba1a9]">simulated spread</p>
              </div>
            </div>

            <TinyArea values={forecastPoints.slice(0, FORECAST_HOURS + 1).map((point) => point.aqi)} color="#2d7c94" className="mt-3 h-[62px] w-full" />

            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {[6, 24, 36].map((step) => {
                const point = simulation.points[HISTORY_HOURS + step];
                return (
                  <div key={step} className="rounded-xl border border-white/80 bg-white/55 p-2">
                    <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-[#78919a]">+{step}h</p>
                    <p className="mt-0.5 text-[13px] font-semibold text-[#20424f]">{point.aqi}</p>
                    <p className="text-[7px] text-[#8ba1a9]">{number(point.pm25, 0)} µg/m³</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <DataLabel>Scenario</DataLabel>
                <span className="text-[8px] text-[#8ba1a9]">switch to compare</span>
              </div>
              <ScenarioSwitch value={scenario} onChange={setScenario} />
              <p className="mt-2 min-h-[24px] text-[9px] leading-relaxed text-[#6e8b95]">{SCENARIOS[scenario].note}</p>
            </div>

            <div className="mt-4 rounded-2xl border border-dashed border-[#cfe2e6] bg-white/45 p-3">
              <div className="flex items-center justify-between">
                <DataLabel>Scenario clock</DataLabel>
                <span className="text-[10px] font-semibold text-[#2d7083]">H+{horizon} · {hourLabel(selectedPoint.time)}</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => setPlaying((value) => !value)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2d7c94] text-white transition hover:bg-[#246a7f]"
                  aria-label={playing ? 'Pause scenario clock' : 'Play scenario clock'}
                >
                  {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={FORECAST_HOURS}
                  value={horizon}
                  onChange={(event) => { setHorizon(Number(event.target.value)); setPlaying(false); }}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#d8e8ec] accent-[#2d7c94]"
                  aria-label="Forecast horizon"
                />
                <button onClick={() => { setHorizon(0); setPlaying(false); }} className="text-[8px] font-semibold uppercase tracking-[0.08em] text-[#6e8b95] hover:text-[#2d7083]">Now</button>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-white/45 px-3 py-2 text-[8px] text-[#78919a]">
              <span>BLH <b className="text-[10px] text-[#20424f]">{number(selectedPoint.boundaryLayer, 2)} km</b></span>
              <span>Wind <b className="text-[10px] text-[#20424f]">{number(selectedPoint.wind, 0)} km/h</b></span>
              <span>Peak <b className="text-[10px] text-[#20424f]">{number(futurePeak, 0)} µg/m³</b></span>
            </div>
            <p className="mt-3 flex items-start gap-1.5 text-[8px] leading-relaxed text-[#8ba1a9]">
              <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
              An illustrative scenario model, not the registered LightGBM forecast of record. See the model card below.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <AtmosphereScene
          stations={seed.stations}
          simulation={simulation}
          horizon={horizon}
          basePm25={seed.basePm25}
          layer={layer}
          onLayerChange={setLayer}
        />

        <Card className="xl:col-span-4">
          <CardHeader>
            <div>
              <CardTitle>Now vs the next 48 hours</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Simulated PM2.5 distribution</p>
            </div>
            <Badge tone="neutral">Scenario</Badge>
          </CardHeader>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Forecast peak', value: `${number(futurePeak, 0)}`, unit: 'µg/m³', tone: '#c97445' },
                { label: '48h average', value: `${number(futureAverage, 0)}`, unit: 'µg/m³', tone: '#2d7c94' },
                { label: 'Hours above 60', value: `${exceedanceHours}`, unit: `/ ${FORECAST_HOURS}h`, tone: exceedanceHours > 12 ? '#c97445' : '#3f9a83' },
                { label: 'Peak category', value: aqiCategory(futurePeakAqi), unit: 'indicative', tone: aqiColor(futurePeakAqi) },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/80 bg-white/50 p-3">
                  <p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-[#78919a]">{item.label}</p>
                  <p className="display mt-1.5 text-[24px] font-bold leading-none tracking-[-0.04em]" style={{ color: item.tone }}>{item.value}</p>
                  <p className="mt-0.5 text-[8px] text-[#8ba1a9]">{item.unit}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-2xl border border-dashed border-[#d7e7ea] bg-white/40 p-3">
              <div className="flex items-center justify-between">
                <DataLabel>Next 12 hours</DataLabel>
                <span className="text-[9px] text-[#78919a]">{hourLabel(forecastPoints[0]?.time ?? anchor)} → {hourLabel(forecastPoints[12]?.time ?? anchor)}</span>
              </div>
              <div className="mt-2 flex items-end gap-1">
                {forecastPoints.slice(0, 12).map((point, index) => {
                  const height = clamp((point.pm25 / Math.max(1, futurePeak)) * 72, 8, 72);
                  return (
                    <div key={point.time.toISOString()} className="group flex flex-1 flex-col items-center gap-1">
                      <span className="text-[7px] font-semibold text-transparent transition group-hover:text-[#557480]">{number(point.pm25, 0)}</span>
                      <div className="w-full rounded-full transition group-hover:opacity-80" style={{ height, background: `linear-gradient(180deg, ${aqiColor(point.aqi)}, ${hexAlpha(aqiColor(point.aqi), '88')})` }} />
                      <span className={`text-[7px] text-[#8ba1a9] ${index % 2 === 0 ? '' : 'opacity-0'}`}>{point.label.replace(' ', '')}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="mt-3 text-[8px] leading-relaxed text-[#8ba1a9]">
              The 48h band is an empirical spread widened with horizon; it is not a calibrated prediction interval. Missing or stale observations are not silently filled.
            </p>
            <div className="mt-3 rounded-2xl border border-[#eadfc5] bg-[#fdf7e8] p-3">
              <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-[#9b6a25]">Scenario advisory</p>
              <p className="mt-1 text-[9px] leading-relaxed text-[#8a6c3e]">
                {peakPoint.aqi > 150
                  ? 'Sensitive groups should avoid prolonged outdoor exertion near the peak window; the general population may notice effects.'
                  : peakPoint.aqi > 100
                    ? 'Sensitive groups should reduce prolonged outdoor exertion near the peak window, especially during the evening build-up.'
                    : 'Air quality stays relatively comfortable; normal outdoor activity is reasonable across the airshed.'}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {[`Peak ${peakPoint.label}`, `Cleanest ${bestPoint.label}`, `${exceedanceHours}h above 60`].map((label) => (
                  <span key={label} className="rounded-full border border-[#e7d9b8] bg-white/60 px-2 py-0.5 text-[8px] font-medium text-[#8a6c3e]">{label}</span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader className="flex-wrap">
            <div>
              <CardTitle>PM2.5 outlook &amp; confidence</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Simulated history · dashed forecast · shaded uncertainty envelope</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#3f9a83]" /> <span className="text-[9px] text-[#6e8b95]">history</span>
              <span className="h-2 w-2 rounded-full bg-[#2d7c94]" /> <span className="text-[9px] text-[#6e8b95]">forecast</span>
              <Badge tone="teal">H+{horizon}</Badge>
            </div>
          </CardHeader>
          <div className="px-2 pb-1 pt-2">
            <Chart height={310} option={forecastOption} />
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-dashed border-[#dbe5d6] p-3 sm:grid-cols-4">
            {[
              ['Forecast peak', `${number(futurePeak, 0)} µg/m³`],
              ['48h mean', `${number(futureAverage, 0)} µg/m³`],
              ['Above 60', `${exceedanceHours} h of ${FORECAST_HOURS}`],
              ['Confidence', `${confidence}% · H+${horizon}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-white/45 px-2.5 py-2">
                <p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-[#78919a]">{label}</p>
                <p className="mt-0.5 text-[11px] font-semibold text-[#20424f]">{value}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader>
            <div>
              <CardTitle>Source fingerprint</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Illustrative apportionment by sector</p>
            </div>
            <Badge tone="neutral">Modelled</Badge>
          </CardHeader>
          <div className="p-4">
            <div className="relative">
              <Chart height={196} option={sourceOption} />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-2">
                <p className="display text-[26px] font-bold leading-none text-[#173d4a]">{number(selectedPoint.pm25, 0)}</p>
                <p className="mt-0.5 text-[8px] uppercase tracking-[0.12em] text-[#8ba1a9]">µg/m³ PM2.5</p>
              </div>
            </div>
            <div className="mt-2 space-y-1.5">
              {sourceMix.map((source) => (
                <div key={source.name} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: source.color }} />
                  <span className="flex-1 text-[10px] text-[#557480]">{source.name}</span>
                  <span className="text-[10px] font-semibold text-[#20424f]">{source.value}%</span>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t border-dashed border-[#dbe5d6] pt-2 text-[8px] leading-relaxed text-[#8ba1a9]">
              Sector shares are a scenario visualisation, not a source-attribution calculation from measured data.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-5">
          <CardHeader>
            <div>
              <CardTitle>Pollutant signature</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Multiple of the NAAQS screening reference</p>
            </div>
            <Badge tone="neutral">H+{horizon}</Badge>
          </CardHeader>
          <div className="px-2 pb-2 pt-1">
            <Chart height={280} option={radarOption} />
          </div>
          <div className="grid grid-cols-3 gap-1.5 border-t border-dashed border-[#dbe5d6] p-3">
            {[
              ['PM2.5', selectedPoint.pm25, 'µg/m³'],
              ['PM10', selectedPoint.pm25 * 1.72, 'µg/m³'],
              ['NO₂', selectedPoint.pm25 * 0.52 + 14, 'µg/m³'],
            ].map(([label, value, unit]) => (
              <div key={String(label)}>
                <p className="text-[8px] uppercase tracking-[0.1em] text-[#8ba1a9]">{label}</p>
                <p className="mt-0.5 text-[12px] font-semibold text-[#20424f]">{number(Number(value), 0)} <span className="text-[8px] font-normal text-[#8ba1a9]">{unit}</span></p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="xl:col-span-7">
          <CardHeader>
            <div>
              <CardTitle>Seven-day hourly rhythm</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Simulated PM2.5 by local hour · night-time accumulation visible</p>
            </div>
            <Badge tone="neutral">Simulated</Badge>
          </CardHeader>
          <div className="px-1 pb-1 pt-2">
            <Chart height={280} option={heatmapOption} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-[#dbe5d6] px-4 py-2 text-[9px] text-[#8ba1a9]">
            <span>Darker cells = higher concentration. The pattern is synthetic, tuned to Mumbai commuting and mixing cycles.</span>
            <span className="font-semibold text-[#557480]">{selectedPoint.pm25 > 60 ? 'Above 24h screening reference' : 'Within 24h screening reference'}</span>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-4">
          <CardHeader>
            <div>
              <CardTitle>Wind rose</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Speed by bearing · simulated circulation</p>
            </div>
            <Wind className="h-4 w-4 text-[#78919a]" />
          </CardHeader>
          <div className="px-2 pb-2">
            <Chart height={238} option={windOption} />
          </div>
          <div className="grid grid-cols-3 gap-1.5 border-t border-dashed border-[#dbe5d6] p-3">
            <div><DataLabel>Surface wind</DataLabel><p className="mt-1 text-[13px] font-semibold text-[#20424f]">{number(selectedPoint.wind, 0)} <span className="text-[8px] font-normal text-[#8ba1a9]">km/h</span></p></div>
            <div><DataLabel>Direction</DataLabel><p className="mt-1 text-[13px] font-semibold text-[#20424f]">{number(weather.wind_direction_deg, 0)}°</p></div>
            <div><DataLabel>Dispersion</DataLabel><p className="mt-1 text-[13px] font-semibold" style={{ color: selectedPoint.wind > 12 ? '#3f9a83' : '#c97445' }}>{selectedPoint.wind > 12 ? 'Good' : 'Weak'}</p></div>
          </div>
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader>
            <div>
              <CardTitle>Why the model says this</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Simulated feature contributions at H+{horizon}</p>
            </div>
            <BrainCircuit className="h-4 w-4 text-[#78919a]" />
          </CardHeader>
          <div className="p-4">
            <div className="space-y-2.5">
              {featureData.map((feature) => {
                const width = clamp((Math.abs(feature.value) / 20) * 48, 2, 48);
                const positive = feature.value >= 0;
                return (
                  <div key={feature.label}>
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-[#557480]">{feature.label}</span>
                      <span className={`font-semibold ${positive ? 'text-[#c97445]' : 'text-[#3f9a83]'}`}>{positive ? '+' : ''}{feature.value.toFixed(1)}</span>
                    </div>
                    <div className="relative mt-1 h-2 rounded-full bg-[#eef5f6]">
                      <div className="absolute inset-y-0 left-1/2 w-px bg-[#cfdee2]" />
                      <div
                        className="absolute inset-y-0 rounded-full"
                        style={{
                          width: `${width}%`,
                          left: positive ? '50%' : `${50 - width}%`,
                          background: positive ? '#d9955d' : '#5aab92',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 rounded-xl border border-dashed border-[#d7e7ea] bg-white/45 p-3 text-[8px] leading-relaxed text-[#8ba1a9]">
              Contributions are visual approximations of the surrogate’s inputs. A trained LightGBM model reports real SHAP values only when its artifacts and registry entry are active.
            </div>
          </div>
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader>
            <div>
              <CardTitle>What would change the call?</CardTitle>
              <p className="mt-1 text-[10px] text-[#66766b]">Sensitivity levers inside the simulation</p>
            </div>
            <Layers3 className="h-4 w-4 text-[#78919a]" />
          </CardHeader>
          <div className="p-4">
            <div className="space-y-2.5">
              {[
                { label: 'Onshore wind', value: selectedPoint.wind, max: 24, unit: 'km/h', note: selectedPoint.wind > 12 ? 'Ventilates the airshed' : 'Allows local build-up', tone: '#3f9a83' },
                { label: 'Boundary layer', value: selectedPoint.boundaryLayer, max: 1.7, unit: 'km', note: selectedPoint.boundaryLayer > 0.9 ? 'Deep mixing' : 'Shallow mixing', tone: '#2d7c94' },
                { label: 'Traffic pressure', value: selectedPoint.traffic, max: 1.8, unit: 'index', note: selectedPoint.traffic > 1 ? 'Peak movement' : 'Quiet roads', tone: '#d9955d' },
                { label: 'Rain washout', value: selectedPoint.rain, max: 6, unit: 'mm', note: selectedPoint.rain > 0.2 ? 'Wet deposition active' : 'No washout', tone: '#5a9ec4' },
              ].map((lever) => (
                <div key={lever.label} className="rounded-xl border border-white/80 bg-white/45 p-2.5">
                  <div className="flex items-center justify-between text-[9px]">
                    <span className="font-medium text-[#557480]">{lever.label}</span>
                    <span className="font-semibold text-[#20424f]">{number(lever.value, lever.label === 'Boundary layer' ? 2 : 0)} {lever.unit}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#e4eff1]">
                    <div className="h-full rounded-full transition-all" style={{ width: `${clamp((lever.value / lever.max) * 100, 3, 100)}%`, background: lever.tone }} />
                  </div>
                  <p className="mt-1 text-[8px] text-[#8ba1a9]">{lever.note}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#eef8f2] p-2.5">
              <Gauge className="h-4 w-4 shrink-0 text-[#3f9a83]" />
              <p className="text-[8px] leading-relaxed text-[#457767]">Changing the scenario changes the whole model chain, not just the headline number.</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="atmo-model-card text-white">
        <div className="relative z-10 grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.45fr_1fr]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#b8e0e6]">
                <BrainCircuit className="h-3 w-3" /> Model transparency
              </span>
              <span className="text-[9px] uppercase tracking-[0.12em] text-white/40">Reference model card · local artifact</span>
            </div>
            <h2 className="display mt-3 text-[24px] font-bold leading-tight tracking-[-0.04em] sm:text-[28px]">How the forecast is built.</h2>
            <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/55">
              The lab forecast is a deterministic surrogate for exploration. The production path uses a trained LightGBM pipeline with explicit feature assembly, quantile intervals and a spatial holdout — never an unlabelled number.
            </p>
            <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {[
                ['01', 'Feature assembly', 'Lagged PM2.5, weather, boundary layer, traffic and seasonality are assembled per station-hour.'],
                ['02', 'Quantile ensemble', 'A LightGBM median forecast plus 10th–90th quantile heads describe the likely range.'],
                ['03', 'Spatial holdout', 'Five geographically spread stations are held back to test generalisation, not just memory.'],
                ['04', 'Guardrails', 'Stale data is excluded, simulated inputs stay labelled, and no output is an official determination.'],
              ].map(([step, title, body]) => (
                <div key={step} className="rounded-2xl border border-white/10 bg-white/[0.055] p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#5bb5a3]/20 text-[8px] font-bold text-[#8fd8c8]">{step}</span>
                    <p className="text-[10px] font-semibold text-white/90">{title}</p>
                  </div>
                  <p className="mt-1.5 text-[9px] leading-relaxed text-white/45">{body}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-4">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/45">Temporal holdout · Jul–Oct 2026</p>
              <Activity className="h-3.5 w-3.5 text-[#8fd8c8]" />
            </div>
            <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
              <table className="w-full text-left text-[10px]">
                <thead className="bg-white/[0.06] text-[8px] uppercase tracking-[0.1em] text-white/40">
                  <tr><th className="px-3 py-2">Horizon</th><th className="px-3 py-2">MAE</th><th className="px-3 py-2">Skill</th></tr>
                </thead>
                <tbody className="divide-y divide-white/10 text-white/70">
                  <tr><td className="px-3 py-2">1 hour</td><td className="px-3 py-2">3.48</td><td className="px-3 py-2 text-[#8fd8c8]">+3.6%</td></tr>
                  <tr><td className="px-3 py-2">3 hours</td><td className="px-3 py-2">5.33</td><td className="px-3 py-2 text-[#8fd8c8]">+13.2%</td></tr>
                  <tr><td className="px-3 py-2">6 hours</td><td className="px-3 py-2">6.06</td><td className="px-3 py-2 text-[#8fd8c8]">+19.4%</td></tr>
                </tbody>
              </table>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/[0.06] p-2.5">
                <p className="text-[8px] uppercase tracking-[0.1em] text-white/35">3h classifier</p>
                <p className="display mt-1 text-[20px] font-bold text-white/90">0.973</p>
                <p className="text-[8px] text-white/35">ROC-AUC</p>
              </div>
              <div className="rounded-xl bg-white/[0.06] p-2.5">
                <p className="text-[8px] uppercase tracking-[0.1em] text-white/35">Interval coverage</p>
                <p className="display mt-1 text-[20px] font-bold text-white/90">0.823</p>
                <p className="text-[8px] text-white/35">80% band · 6h</p>
              </div>
            </div>
            <p className="mt-3 text-[8px] leading-relaxed text-white/35">
              Metrics from the local OpenAQ Mumbai artifact. This page’s surrogate is not the registered model; the trained path is surfaced on Predictive intelligence when artifacts are present.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to="/intelligence/predictions" className="inline-flex items-center gap-1 rounded-full bg-[#a7e0c9] px-3 py-1.5 text-[9px] font-semibold text-[#12333a] transition hover:bg-[#b9ecd7]">
                Open trained predictions <ArrowRight className="h-3 w-3" />
              </Link>
              <Link to="/map" className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-[9px] font-semibold text-white/70 transition hover:bg-white/10">
                Explore map <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#dce9e6] bg-white/45 px-4 py-3 text-[9px] leading-relaxed text-[#78919a]">
        <p className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[#b3860f]" />
          Atmosphere lab is a simulation surface. Air-quality values, source shares and 3D columns are generated from live seeds; they are not official CPCB/MPCB readings and must not drive enforcement, health or legal decisions.
        </p>
        <span className="font-semibold uppercase tracking-[0.1em] text-[#557480]">Updated {timeAgo(seed.generatedAt)}</span>
      </div>
    </div>
  );
}
