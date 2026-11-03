import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  Copy,
  Droplets,
  ExternalLink,
  Footprints,
  Gauge,
  Info,
  Leaf,
  Loader2,
  LocateFixed,
  MapPin,
  Moon,
  Navigation,
  RefreshCw,
  Route,
  Search,
  Share2,
  ShieldAlert,
  Snowflake,
  Star,
  Sun,
  Sunrise,
  Sunset,
  Thermometer,
  Trees,
  Waves,
  Wind,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Chart, chartAxis, chartGrid, chartTooltip } from '../../components/Chart';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  DataLabel,
  EmptyState,
  Input,
  LoadingBlock,
  ProgressBar,
  Select,
  Spinner,
} from '../../components/ui';
import { api } from '../../lib/api';
import { formatTime, number, timeAgo, windDirection } from '../../lib/format';
import {
  aqiColor,
  beachBand,
  bestWindow,
  burnMinutes,
  dateLabel,
  exposureEstimate,
  healthHeadline,
  hhmm,
  pm25Category,
  shortDate,
  sunProgress,
  uvBand,
  weatherLabel,
  weatherMood,
  type Activity as ActivityKind,
  type ArchiveDay,
  type CityComparisonRow,
  type CityDay,
  type CityHour,
  type CityOverview,
  type CityPlace,
  type FloodConditions,
  type MarineConditions,
  type Mask,
  type NearbyPlace,
  type PlanetEvent,
  type PlanetEvents,
  type WalkRoute,
} from '../../lib/city';

const MUMBAI_BOUNDS = { minLat: 18.85, maxLat: 19.35, minLng: 72.7, maxLng: 73.05 };
const FAVORITES_KEY = 'prakriti.city.favorites';

interface CityPoint {
  name: string;
  lat: number;
  lng: number;
}

const DEFAULT_POINT: CityPoint = { name: 'Mumbai centre', lat: 19.076, lng: 72.8777 };

const POLLUTANT_LABELS: Record<'pm25' | 'pm10' | 'no2' | 'o3' | 'so2' | 'co', string> = {
  pm25: 'PM2.5',
  pm10: 'PM10',
  no2: 'NO₂',
  o3: 'O₃',
  so2: 'SO₂',
  co: 'CO',
};

const PRESETS: CityPoint[] = [
  { name: 'Colaba', lat: 18.9067, lng: 72.8147 },
  { name: 'Bandra', lat: 19.0607, lng: 72.8362 },
  { name: 'Andheri', lat: 19.1197, lng: 72.8468 },
  { name: 'Chembur', lat: 19.0522, lng: 72.9005 },
  { name: 'Powai', lat: 19.1176, lng: 72.906 },
  { name: 'Borivali', lat: 19.2307, lng: 72.8567 },
];

function withinMumbai(lat: number, lng: number) {
  return lat >= MUMBAI_BOUNDS.minLat && lat <= MUMBAI_BOUNDS.maxLat && lng >= MUMBAI_BOUNDS.minLng && lng <= MUMBAI_BOUNDS.maxLng;
}

function pointFromParams(params: URLSearchParams): CityPoint {
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  if (Number.isFinite(lat) && Number.isFinite(lng) && withinMumbai(lat, lng)) {
    return { name: params.get('name') || 'Selected point', lat, lng };
  }
  return DEFAULT_POINT;
}

function loadFavorites(): CityPoint[] {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Partial<CityPoint>>;
    return parsed.filter((item): item is CityPoint => (
      typeof item?.name === 'string'
      && typeof item?.lat === 'number'
      && typeof item?.lng === 'number'
      && withinMumbai(item.lat, item.lng)
    )).slice(0, 8);
  } catch {
    return [];
  }
}

function samePoint(a: CityPoint, b: CityPoint) {
  return Math.abs(a.lat - b.lat) < 0.0001 && Math.abs(a.lng - b.lng) < 0.0001;
}

function pointQuery(point: CityPoint) {
  return `lat=${point.lat.toFixed(5)}&lng=${point.lng.toFixed(5)}`;
}

function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<T>(path)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Request failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  return { data, loading, error, reload: () => setNonce((value) => value + 1) };
}

function lastYearDate(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

function yesterdayDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function hourLabel(value: string): string {
  return `${shortDate(value)} · ${hhmm(value)}`;
}

function WeatherGlyph({ code, isDay, className = 'h-6 w-6' }: { code: number | null; isDay?: boolean | null; className?: string }) {
  const mood = weatherMood(code);
  if (mood === 'clear') return isDay === false ? <Moon className={className} /> : <Sun className={className} />;
  if (mood === 'partly') return <CloudSun className={className} />;
  if (mood === 'fog') return <CloudFog className={className} />;
  if (mood === 'drizzle') return <CloudRain className={className} />;
  if (mood === 'rain') return <CloudRain className={className} />;
  if (mood === 'snow') return <Snowflake className={className} />;
  if (mood === 'storm') return <CloudLightning className={className} />;
  return <Cloud className={className} />;
}

function Metric({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-white/75 bg-white/45 p-3">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#66766b]">{label}</p>
      <p className="display mt-1.5 text-[20px] font-bold leading-none text-[#142016]" style={tone ? { color: tone } : undefined}>{value}</p>
      {note ? <p className="mt-1 truncate text-[9px] text-[#66766b]">{note}</p> : null}
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: typeof Wind; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/75 bg-white/45 px-2.5 py-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-[#5f8f79]" />
      <div className="min-w-0">
        <p className="truncate text-[8px] font-semibold uppercase tracking-[0.1em] text-[#66766b]">{label}</p>
        <p className="truncate text-[10px] font-semibold text-[#223328]">{value}</p>
      </div>
    </div>
  );
}

function SectionHeader({ title, detail, badge }: { title: string; detail: string; badge?: React.ReactNode }) {
  return (
    <CardHeader>
      <div>
        <CardTitle>{title}</CardTitle>
        <p className="mt-1 text-[10px] text-[#66766b]">{detail}</p>
      </div>
      {badge}
    </CardHeader>
  );
}

export function CityPulsePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [point, setPoint] = useState<CityPoint>(() => pointFromParams(searchParams));
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<CityPlace[]>([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [favorites, setFavorites] = useState<CityPoint[]>(loadFavorites);
  const [locating, setLocating] = useState(false);
  const [selectedHour, setSelectedHour] = useState(0);
  const [selectedDay, setSelectedDay] = useState(0);
  const [historyDay, setHistoryDay] = useState<string | null>(null);
  const [pollutant, setPollutant] = useState<'pm25' | 'pm10' | 'no2' | 'o3' | 'so2' | 'co' | 'aqi'>('pm25');
  const [airRange, setAirRange] = useState(24);
  const [skinType, setSkinType] = useState(2);
  const [activity, setActivity] = useState<ActivityKind>('walk');
  const [duration, setDuration] = useState(60);
  const [mask, setMask] = useState<Mask>('none');
  const [indoor, setIndoor] = useState(false);
  const [archiveDate, setArchiveDate] = useState(lastYearDate);
  const [archivePath, setArchivePath] = useState<string | null>(null);
  const [nearbyPath, setNearbyPath] = useState<string | null>(null);
  const [routes, setRoutes] = useState<Record<string, WalkRoute | 'loading' | 'error'>>({});
  const [planetTab, setPlanetTab] = useState<'events' | 'earthquakes'>('events');
  const [copied, setCopied] = useState<string | null>(null);

  const overview = useApi<CityOverview>(`/city/overview?${pointQuery(point)}`);
  const marine = useApi<MarineConditions>(`/city/marine?${pointQuery(point)}`);
  const flood = useApi<FloodConditions>(`/city/flood?${pointQuery(point)}`);
  const events = useApi<PlanetEvents>(`/city/events?${pointQuery(point)}`);
  const nearby = useApi<{ items: NearbyPlace[]; source: string; note: string }>(nearbyPath);
  const archive = useApi<ArchiveDay>(archivePath);
  const compare = useApi<{ rows: CityComparisonRow[] }>(
    `/city/compare?points=${PRESETS.map((preset) => `${preset.lat.toFixed(4)},${preset.lng.toFixed(4)}`).join(';')}`,
  );

  useEffect(() => {
    if (!query.trim()) {
      setPlaces([]);
      setPlacesError(null);
      return;
    }
    if (query.trim().length < 2) {
      setPlaces([]);
      return;
    }
    setPlacesLoading(true);
    const timer = setTimeout(() => {
      api.get<{ results: CityPlace[] }>(`/city/places?q=${encodeURIComponent(query.trim())}`)
        .then((result) => {
          setPlaces(result.results);
          setPlacesError(null);
          setSearchOpen(true);
        })
        .catch((error) => setPlacesError(error instanceof Error ? error.message : 'Locality search failed'))
        .finally(() => setPlacesLoading(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const next = pointFromParams(searchParams);
    if (!samePoint(next, point) || next.name !== point.name) setPoint(next);
  }, [searchParams, point]);

  useEffect(() => {
    setSelectedHour(0);
    setSelectedDay(0);
    setRoutes({});
    setNearbyPath(null);
    setArchivePath(null);
    setHistoryDay(null);
  }, [point.lat, point.lng]);

  const selectPoint = (next: CityPoint) => {
    setPoint(next);
    const params = new URLSearchParams(searchParams);
    params.set('lat', next.lat.toFixed(5));
    params.set('lng', next.lng.toFixed(5));
    params.set('name', next.name);
    setSearchParams(params, { replace: true });
    setSearchOpen(false);
    setQuery('');
    setPlaces([]);
  };

  const isFavorite = favorites.some((favorite) => samePoint(favorite, point));
  const toggleFavorite = () => {
    if (isFavorite) {
      const next = favorites.filter((favorite) => !samePoint(favorite, point));
      setFavorites(next);
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      toast.success('Removed from saved places');
      return;
    }
    const next = [...favorites, point].slice(-8);
    setFavorites(next);
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    toast.success('Saved for next time');
  };

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      toast.error('This browser does not expose location.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setLocating(false);
        if (!withinMumbai(latitude, longitude)) {
          toast.error('You are outside the Greater Mumbai coverage area.');
          return;
        }
        selectPoint({ name: 'My location', lat: latitude, lng: longitude });
        toast.success('Centred the live city on your location');
      },
      () => {
        setLocating(false);
        toast.error('Location permission was not granted.');
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  };

  const data = overview.data;
  const current = data?.current;
  const air = data?.air;
  const hourly = data?.hourly ?? [];
  const daily = data?.daily ?? [];
  const history = data?.history ?? [];
  const selectedHourData: CityHour | undefined = hourly[selectedHour] ?? hourly[0];
  const selectedDayData: CityDay | undefined = daily[selectedDay] ?? daily[0];
  const best = bestWindow(hourly);
  const headline = data ? healthHeadline(data) : null;
  const exposure = exposureEstimate(air?.pm25, activity, duration, mask, indoor);
  const sunPosition = sunProgress(current?.time, selectedDayData?.sunrise, selectedDayData?.sunset);
  const marineCurrent = marine.data?.current;
  const beach = beachBand(marineCurrent?.waveHeightM, current?.windSpeedKmh);
  const uv = current?.uvIndex;
  const uvInfo = uvBand(uv);
  const burn = burnMinutes(uv, skinType);
  const historySelected = history.find((day) => day.date === historyDay) ?? history.at(-1);
  const planetRows = planetTab === 'events' ? events.data?.events ?? [] : events.data?.earthquakes ?? [];
  const compareRows = compare.data?.rows ?? [];
  const isRefreshing = overview.loading || marine.loading || flood.loading;

  const refresh = () => {
    overview.reload();
    marine.reload();
    flood.reload();
    events.reload();
    compare.reload();
    toast.success('Refreshing open-data layers');
  };

  const shareSnapshot = async () => {
    if (!data) return;
    const text = [
      `${point.name}: ${number(current?.temperatureC)}°C, ${weatherLabel(current?.weatherCode)}`,
      `Modelled AQI ${air?.aqi.aqi ?? '—'} (${air?.aqi.category ?? 'no data'}) · PM2.5 ${number(air?.pm25)} µg/m³`,
      `Live city on प्रकृति`,
    ].join('\n');
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Mumbai live city', text, url });
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        toast.success('Snapshot copied to the clipboard');
      }
    } catch {
      // The user dismissed the share sheet; no error state is needed.
    }
  };

  const copyEndpoint = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      toast.success('Endpoint copied');
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.error('Could not copy the endpoint');
    }
  };

  const loadRoute = async (place: NearbyPlace) => {
    setRoutes((currentRoutes) => ({ ...currentRoutes, [place.id]: 'loading' }));
    try {
      const result = await api.get<WalkRoute>(
        `/city/route?fromLat=${point.lat}&fromLng=${point.lng}&toLat=${place.lat}&toLng=${place.lng}`,
      );
      setRoutes((currentRoutes) => ({ ...currentRoutes, [place.id]: result }));
    } catch {
      setRoutes((currentRoutes) => ({ ...currentRoutes, [place.id]: 'error' }));
    }
  };

  const chooseDay = (index: number) => {
    setSelectedDay(index);
    const date = daily[index]?.date;
    const firstIndex = hourly.findIndex((hour) => hour.time.startsWith(date ?? ''));
    if (firstIndex >= 0) setSelectedHour(Math.min(firstIndex + 12, hourly.length - 1));
  };

  if (overview.loading && !data) {
    return <LoadingBlock className="min-h-[70vh]" label="Gathering open weather, air and coastal layers" />;
  }

  if (!data) {
    return (
      <EmptyState
        title="Live city unavailable"
        description={overview.error ?? 'The open-data layers could not be loaded.'}
        icon={<AlertTriangle className="h-6 w-6" />}
        action={<Button variant="default" onClick={overview.reload}><RefreshCw className="h-4 w-4" /> Retry</Button>}
      />
    );
  }

  const weatherIconTone = weatherMood(current?.weatherCode);
  const aqi = air?.aqi.aqi ?? null;
  const category = air?.aqi.category ?? 'INSUFFICIENT DATA';
  const categoryColor = aqiColor(category);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="green" dot>Keyless open data</Badge>
            <Badge tone="amber">CAMS modelled air</Badge>
            <Badge tone="neutral">{overview.loading ? 'Updating…' : `Updated ${timeAgo(data.generatedAt)}`}</Badge>
          </div>
          <h1 className="display mt-2 text-[30px] font-bold leading-[1.02] tracking-[-0.05em] text-[#142016] sm:text-[38px]">
            Mumbai, hour by hour.
          </h1>
          <p className="mt-1.5 max-w-3xl text-[11px] leading-relaxed text-[#5f7065]">
            Weather, CAMS air quality, coastal conditions, river discharge and city nature — stitched together from free
            open APIs. This is context, not a CPCB station reading.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={shareSnapshot}>
            <Share2 className="h-3.5 w-3.5" /> Share snapshot
          </Button>
          <Button variant="default" size="sm" onClick={refresh} disabled={isRefreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_84%_0%,#dff2cf_0%,#eef7e4_42%,#f9fbf5_76%)]" />
          <div className="relative p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-[#4e9b3f]" />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#66766b]">Selected point</p>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <h2 className="display max-w-[420px] truncate text-[24px] font-bold tracking-[-0.04em] text-[#142016]">{point.name}</h2>
                  <button
                    type="button"
                    onClick={toggleFavorite}
                    aria-label={isFavorite ? 'Remove saved place' : 'Save this place'}
                    className={`flex h-7 w-7 items-center justify-center rounded-full border transition ${isFavorite ? 'border-[#b3df7c] bg-[#e7f9cf] text-[#3f7d2a]' : 'border-white/80 bg-white/65 text-[#66766b] hover:text-[#3f7d2a]'}`}
                  >
                    <Star className={`h-3.5 w-3.5 ${isFavorite ? 'fill-current' : ''}`} />
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-[#66766b]">
                  {point.lat.toFixed(3)}, {point.lng.toFixed(3)} · {hhmm(current?.time)} IST · {data.point.timezone}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className="rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em]" style={{ borderColor: `${categoryColor}55`, background: `${categoryColor}14`, color: categoryColor }}>
                  {category}
                </span>
                <span className="text-[9px] text-[#66766b]">CAMS modelled AQI</span>
              </div>
            </div>

            <div className="mt-7 grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <div className="flex items-center gap-3">
                  <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${weatherIconTone === 'clear' ? 'bg-[#fff5cc] text-[#c49a1c]' : weatherIconTone === 'rain' ? 'bg-[#e9f3f6] text-[#4f7f94]' : 'bg-[#eef3ee] text-[#5f8f79]'}`}>
                    <WeatherGlyph code={current?.weatherCode ?? null} isDay={current?.isDay ?? null} className="h-7 w-7" />
                  </span>
                  <p className="display text-[58px] font-bold leading-none tracking-[-0.07em] text-[#142016] sm:text-[72px]">
                    {number(current?.temperatureC, 0)}
                    <span className="ml-1 align-top text-[22px] font-semibold tracking-normal text-[#3f5045]">°C</span>
                  </p>
                </div>
                <p className="mt-2 text-[15px] font-semibold text-[#223328]">{weatherLabel(current?.weatherCode)}</p>
                <p className="mt-0.5 text-[10px] text-[#66766b]">
                  Feels like {number(current?.apparentTemperatureC, 0)}°C · {current?.relativeHumidity ?? '—'}% humidity · {hhmm(current?.time)} IST
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:w-[260px]">
                <MiniStat icon={Wind} label="Wind" value={current?.windSpeedKmh !== null && current?.windSpeedKmh !== undefined ? `${number(current.windSpeedKmh)} km/h` : '—'} />
                <MiniStat icon={CloudRain} label="Rain now" value={`${number(current?.precipitationMm, 1)} mm`} />
                <MiniStat icon={Sun} label="UV index" value={uv !== null && uv !== undefined ? `${number(uv)} · ${uvInfo.label}` : '—'} />
                <MiniStat icon={Gauge} label="Pressure" value={current?.pressureHpa !== null && current?.pressureHpa !== undefined ? `${number(current.pressureHpa, 0)} hPa` : '—'} />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-dashed border-[#dbe5d6] pt-4">
              <span className="flex items-center gap-1.5 rounded-full border border-white/80 bg-white/55 px-2.5 py-1 text-[9px] text-[#5f7065]">
                <Wind className="h-3 w-3" /> {windDirection(current?.windDirectionDeg)}
              </span>
              <span className="flex items-center gap-1.5 rounded-full border border-white/80 bg-white/55 px-2.5 py-1 text-[9px] text-[#5f7065]">
                <Droplets className="h-3 w-3" /> Sea {number(marineCurrent?.seaSurfaceTemperatureC)}°C
              </span>
              <span className="flex items-center gap-1.5 rounded-full border border-white/80 bg-white/55 px-2.5 py-1 text-[9px] text-[#5f7065]">
                <Waves className="h-3 w-3" /> Wave {number(marineCurrent?.waveHeightM)} m
              </span>
              <span className="ml-auto text-[9px] text-[#7a8b7e]">
                {data.weatherProvider === 'met-no' ? (
                  <a className="underline decoration-[#b8cbb3] underline-offset-2" href="https://api.met.no/" target="_blank" rel="noreferrer">MET Norway</a>
                ) : (
                  <a className="underline decoration-[#b8cbb3] underline-offset-2" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>
                )}
                {' '}· CAMS modelled
              </span>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <SectionHeader title="Find a place" detail="Search Mumbai localities or use your current position" badge={<LocateFixed className="h-4 w-4 text-[#5f8f79]" />} />
          <div className="p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#7a8b7e]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setSearchOpen(true)}
                placeholder="Powai, Bandra, Colaba…"
                className="pl-9"
                aria-label="Search Mumbai localities"
              />
              {placesLoading ? <Loader2 className="absolute right-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-[#4e9b3f]" /> : null}
            </div>

            {searchOpen && (places.length > 0 || placesError) ? (
              <div className="mt-2 overflow-hidden rounded-xl border border-[#d9e3d5] bg-white/90">
                {places.map((place) => (
                  <button
                    key={place.id}
                    type="button"
                    onClick={() => selectPoint({ name: place.name, lat: place.lat, lng: place.lng })}
                    className="flex w-full items-start justify-between gap-3 border-b border-dashed border-[#e7ece3] px-3 py-2.5 text-left transition last:border-0 hover:bg-[#f4f8f1]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-semibold text-[#223328]">{place.name}</span>
                      <span className="block truncate text-[9px] text-[#66766b]">{place.label}</span>
                    </span>
                    <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-[#a9b7ac]" />
                  </button>
                ))}
                {placesError ? <p className="px-3 py-2 text-[9px] text-amber-700">{placesError}</p> : null}
                <p className="border-t border-[#eef2ea] bg-[#fbfdf9] px-3 py-1.5 text-[8px] text-[#7a8b7e]">
                  {places[0]?.provider ?? 'OpenStreetMap Nominatim'} · fallback Open-Meteo geocoding
                </p>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locating}
                className="inline-flex items-center gap-1 rounded-full border border-[#cbe8a5] bg-[#eefbdc] px-2.5 py-1 text-[9px] font-semibold text-[#3f7d2a] transition hover:bg-[#e4f8c9] disabled:opacity-60"
              >
                {locating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Navigation className="h-3 w-3" />}
                My location
              </button>
              {favorites.map((favorite) => (
                <span key={`${favorite.name}-${favorite.lat}-${favorite.lng}`} className="inline-flex items-center rounded-full border border-white/80 bg-white/60 text-[9px] text-[#3f5045]">
                  <button type="button" onClick={() => selectPoint(favorite)} className="inline-flex items-center gap-1 px-2.5 py-1 font-semibold">
                    <Star className="h-2.5 w-2.5 fill-current text-[#c49a1c]" /> {favorite.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${favorite.name}`}
                    onClick={() => {
                      const next = favorites.filter((item) => !samePoint(item, favorite));
                      setFavorites(next);
                      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
                    }}
                    className="pr-1.5 text-[#97a69a] hover:text-[#a05a5e]"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>

            <div className="mt-4 border-t border-dashed border-[#dbe5d6] pt-3">
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#66766b]">Jump to a locality</p>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {PRESETS.map((preset) => {
                  const row = compareRows.find((item) => Math.abs(item.lat - preset.lat) < 0.001 && Math.abs(item.lng - preset.lng) < 0.001);
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => selectPoint(preset)}
                      className={`flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-left transition ${
                        samePoint(point, preset) ? 'border-[#b3df7c] bg-[#effbe2]' : 'border-white/80 bg-white/45 hover:bg-white/75'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[10px] font-semibold text-[#223328]">{preset.name}</span>
                        <span className="block text-[8px] text-[#66766b]">{row ? `AQI ${row.aqi.aqi ?? '—'} · ${row.temperatureC !== null ? `${number(row.temperatureC, 0)}°C` : '—'}` : 'CAMS grid'}</span>
                      </span>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row ? aqiColor(row.aqi.category) : '#cdd9c9' }} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="overflow-hidden xl:col-span-8">
          <SectionHeader
            title="The next 72 hours"
            detail="Scrub the timeline to inspect any hour. Rain probability is from Open-Meteo; the AQI line uses the CAMS model."
            badge={<Badge tone="neutral">{selectedHourData ? hourLabel(selectedHourData.time) : 'No data'}</Badge>}
          />
          <div className="p-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Metric label="Condition" value={weatherLabel(selectedHourData?.weatherCode)} note={selectedHourData ? hourLabel(selectedHourData.time) : ''} />
              <Metric label="Temperature" value={`${number(selectedHourData?.temperatureC, 0)}°C`} note={`Feels ${number(selectedHourData?.apparentTemperatureC, 0)}°C`} />
              <Metric label="Rain chance" value={`${number(selectedHourData?.precipitationProbability, 0)}%`} note={`${number(selectedHourData?.precipitationMm, 1)} mm`} />
              <Metric label="Wind" value={`${number(selectedHourData?.windSpeedKmh)} km/h`} note={windDirection(selectedHourData?.windDirectionDeg)} />
              <Metric label="Modelled AQI" value={`${selectedHourData?.aqi ?? '—'}`} note={selectedHourData?.aqiCategory ?? '—'} tone={aqiColor(selectedHourData?.aqiCategory)} />
            </div>

            <div className="mt-3">
              <Chart
                height={240}
                empty={hourly.length === 0}
                option={{
                  grid: { ...chartGrid, top: 28, right: 22 },
                  tooltip: chartTooltip,
                  legend: { top: 0, textStyle: { color: '#6f7f74', fontSize: 10 } },
                  xAxis: {
                    type: 'category',
                    data: hourly.map((hour) => hhmm(hour.time)),
                    ...chartAxis,
                    axisLabel: { ...chartAxis.axisLabel, interval: 6, fontSize: 9 },
                  },
                  yAxis: [
                    { type: 'value', name: '°C', nameTextStyle: { color: '#6f7f74', fontSize: 10 }, ...chartAxis },
                    { type: 'value', name: '% rain', max: 100, nameTextStyle: { color: '#6f7f74', fontSize: 10 }, ...chartAxis, splitLine: { show: false } },
                  ],
                  series: [
                    {
                      name: 'Temperature',
                      type: 'line',
                      smooth: 0.35,
                      symbol: 'none',
                      data: hourly.map((hour) => hour.temperatureC),
                      lineStyle: { color: '#4e9b3f', width: 2.4 },
                      areaStyle: { color: 'rgba(78,155,63,0.12)' },
                      markLine: {
                        silent: true,
                        symbol: 'none',
                        lineStyle: { color: '#2f8f84', width: 1, type: 'dashed' },
                        label: { color: '#2f8f84', fontSize: 9, formatter: 'selected hour' },
                        data: [{ xAxis: selectedHour }],
                      },
                    },
                    {
                      name: 'Rain probability',
                      type: 'bar',
                      yAxisIndex: 1,
                      barWidth: '42%',
                      data: hourly.map((hour) => hour.precipitationProbability),
                      itemStyle: { color: 'rgba(79,127,148,0.45)', borderRadius: [4, 4, 0, 0] },
                    },
                  ],
                }}
              />
            </div>

            <div className="mt-3 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={Math.max(0, hourly.length - 1)}
                value={Math.min(selectedHour, Math.max(0, hourly.length - 1))}
                onChange={(event) => setSelectedHour(Number(event.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#dce5d8] accent-[#4e9b3f]"
                aria-label="Select a forecast hour"
              />
              <span className="w-24 shrink-0 text-right text-[9px] font-semibold text-[#5f7065]">{selectedHourData ? hhmm(selectedHourData.time) : '—'}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[0, 6, 12, 24, 48].filter((offset) => offset < hourly.length).map((offset) => (
                <button
                  key={offset}
                  type="button"
                  onClick={() => setSelectedHour(offset)}
                  className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold transition ${selectedHour === offset ? 'border-[#4e9b3f] bg-[#4e9b3f] text-white' : 'border-white/80 bg-white/55 text-[#5f7065] hover:bg-white'}`}
                >
                  {offset === 0 ? 'Now' : `+${offset}h`}
                </button>
              ))}
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden xl:col-span-4">
          <SectionHeader title="What this means for you" detail="Advice from modelled air, heat and UV — not medical advice" badge={<Badge tone={headline?.tone === 'red' ? 'red' : headline?.tone === 'amber' ? 'amber' : 'green'}>{headline?.tone === 'red' ? 'Take care' : headline?.tone === 'amber' ? 'Plan ahead' : 'Settled'}</Badge>} />
          <div className="p-4">
            {headline ? (
              <div className={`rounded-2xl border p-4 ${headline.tone === 'red' ? 'border-[#f0cdce] bg-[#fdf0f0]' : headline.tone === 'amber' ? 'border-[#eddeae] bg-[#fdf8e9]' : 'border-[#cbe8a5] bg-[#f0fbdf]'}`}>
                <p className="text-[13px] font-semibold text-[#223328]">{headline.title}</p>
                <p className="mt-1 text-[10px] leading-relaxed text-[#5f7065]">{headline.detail}</p>
              </div>
            ) : null}

            <div className="mt-4 rounded-2xl border border-dashed border-[#dbe5d6] bg-white/45 p-3">
              <div className="flex items-center justify-between">
                <DataLabel>Cleaner 2-hour window</DataLabel>
                <Activity className="h-3.5 w-3.5 text-[#5f8f79]" />
              </div>
              {best ? (
                <>
                  <p className="display mt-2 text-[20px] font-bold text-[#142016]">{hhmm(best.start)} – {hhmm(best.end)}</p>
                  <p className="mt-1 text-[9px] text-[#66766b]">Modelled AQI {best.aqi ?? '—'} · rain {best.rain ?? 0}% · UV {number(best.uv)}</p>
                </>
              ) : (
                <p className="mt-2 text-[10px] text-[#66766b]">Not enough hourly modelled values to rank a window.</p>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric label="UV right now" value={uv !== null && uv !== undefined ? number(uv) : '—'} note={uvInfo.label} tone={uvInfo.color} />
              <Metric label="Burn estimate" value={burn ? `${burn} min` : '—'} note="Fitzpatrick select below" />
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-white/80 bg-white/45 px-3 py-2">
              <span className="text-[9px] font-semibold text-[#5f7065]">Skin type</span>
              <Select value={String(skinType)} onChange={(event) => setSkinType(Number(event.target.value))} className="h-8 w-[150px] text-[10px]">
                {['I · very fair', 'II · fair', 'III · medium', 'IV · olive', 'V · brown', 'VI · deeply pigmented'].map((label, index) => (
                  <option key={label} value={index + 1}>{label}</option>
                ))}
              </Select>
            </div>

            <p className="mt-3 flex items-start gap-1.5 text-[9px] leading-relaxed text-[#7a8b7e]">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Burn time is a rough UV estimate, not medical advice. Shade, clouds and medication change the real exposure.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="overflow-hidden xl:col-span-7">
          <SectionHeader
            title="Air quality forecast"
            detail="CAMS regional model via Open-Meteo. Values are modelled, not a station measurement."
            badge={<Badge tone="amber">Modelled</Badge>}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-[#dbe5d6] px-4 py-2.5">
            <div className="flex flex-wrap gap-1">
              {([
                ['pm25', 'PM2.5'], ['pm10', 'PM10'], ['no2', 'NO₂'], ['o3', 'O₃'], ['so2', 'SO₂'], ['co', 'CO'], ['aqi', 'AQI'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPollutant(key)}
                  className={`rounded-full border px-2 py-1 text-[9px] font-semibold transition ${pollutant === key ? 'border-[#4e9b3f] bg-[#4e9b3f] text-white' : 'border-white/80 bg-white/55 text-[#5f7065] hover:bg-white'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {[24, 48, 72].map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setAirRange(range)}
                  className={`rounded-full border px-2 py-1 text-[9px] font-semibold transition ${airRange === range ? 'border-[#2f8f84] bg-[#2f8f84] text-white' : 'border-white/80 bg-white/55 text-[#5f7065] hover:bg-white'}`}
                >
                  {range}h
                </button>
              ))}
            </div>
          </div>
          <div className="p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <DataLabel>Current modelled {pollutant === 'aqi' ? 'AQI' : POLLUTANT_LABELS[pollutant]}</DataLabel>
                <p className="display mt-1 text-[28px] font-bold leading-none text-[#142016]">
                  {pollutant === 'aqi' ? (air?.aqi.aqi ?? '—') : number(air?.[pollutant] ?? null)}
                  <span className="ml-1.5 text-[10px] font-medium tracking-normal text-[#66766b]">
                    {pollutant === 'aqi' ? 'index' : pollutant === 'co' ? 'µg/m³' : 'µg/m³'}
                  </span>
                </p>
              </div>
              <p className="max-w-[280px] text-right text-[9px] leading-relaxed text-[#66766b]">
                {air?.aqi.dominantPollutant ? `Current dominant sub-index: ${air.aqi.dominantPollutant.toUpperCase()}. ` : ''}
                CPCB breakpoints applied to hourly CAMS values — indicative only.
              </p>
            </div>

            <div className="mt-3">
              <Chart
                height={250}
                empty={hourly.length === 0}
                option={(() => {
                  const rows = hourly.slice(0, airRange);
                  const values = rows.map((hour) => (pollutant === 'aqi' ? hour.aqi : hour[pollutant] ?? null));
                  const reference = pollutant === 'pm25' ? 60 : pollutant === 'pm10' ? 100 : pollutant === 'no2' ? 80 : pollutant === 'o3' ? 100 : pollutant === 'so2' ? 80 : null;
                  return {
                    grid: { ...chartGrid, top: 28, right: 20 },
                    tooltip: chartTooltip,
                    xAxis: { type: 'category', data: rows.map((hour) => hhmm(hour.time)), ...chartAxis, axisLabel: { ...chartAxis.axisLabel, interval: 5, fontSize: 9 } },
                    yAxis: { type: 'value', name: pollutant === 'aqi' ? 'index' : 'µg/m³', nameTextStyle: { color: '#6f7f74', fontSize: 10 }, ...chartAxis },
                    series: [
                      {
                        name: pollutant === 'aqi' ? 'Indicative AQI' : POLLUTANT_LABELS[pollutant],
                        type: 'line',
                        smooth: 0.35,
                        symbol: 'none',
                        data: values,
                        lineStyle: { color: pollutant === 'aqi' ? '#2f8f84' : '#c47a2c', width: 2.2 },
                        areaStyle: { color: pollutant === 'aqi' ? 'rgba(47,143,132,0.10)' : 'rgba(196,122,44,0.08)' },
                        markLine: reference
                          ? {
                              silent: true,
                              symbol: 'none',
                              lineStyle: { color: '#c94a50', type: 'dashed', width: 1, opacity: 0.55 },
                              label: { color: '#c94a50', fontSize: 9, formatter: `NAAQS ${reference}` },
                              data: [{ yAxis: reference }],
                            }
                          : undefined,
                      },
                    ],
                  };
                })()}
              />
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden xl:col-span-5">
          <SectionHeader title="What is in the air" detail="Current CAMS modelled pollutant mix" badge={<span className="text-[10px] font-semibold" style={{ color: categoryColor }}>AQI {aqi ?? '—'}</span>} />
          <div className="p-4">
            <div className="flex items-center gap-4 rounded-2xl border border-white/80 bg-white/45 p-3">
              <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border-4" style={{ borderColor: categoryColor }}>
                <span className="display text-[20px] font-bold leading-none text-[#142016]">{aqi ?? '—'}</span>
                <span className="mt-0.5 text-[7px] font-semibold uppercase tracking-[0.1em]" style={{ color: categoryColor }}>AQI</span>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[#223328]">{category}</p>
                <p className="mt-0.5 text-[9px] leading-relaxed text-[#66766b]">
                  Dominant sub-index: {air?.aqi.dominantPollutant ? air.aqi.dominantPollutant.toUpperCase() : '—'}. CAMS is a regional model, not a CPCB station.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {([
                ['pm25', 'PM2.5', 60, 'µg/m³'],
                ['pm10', 'PM10', 100, 'µg/m³'],
                ['no2', 'NO₂', 80, 'µg/m³'],
                ['o3', 'O₃', 100, 'µg/m³'],
                ['so2', 'SO₂', 80, 'µg/m³'],
                ['co', 'CO', 2000, 'µg/m³'],
              ] as const).map(([key, label, reference, unit]) => {
                const value = air?.[key] ?? null;
                const ratio = value === null ? 0 : Math.min(1, value / reference);
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold text-[#34463a]">{label}</span>
                      <span className="text-[9px] text-[#5d6e63]">{number(value)} <span className="text-[8px] text-[#66766b]">{unit}</span></span>
                    </div>
                    <div className="mt-1.5"><ProgressBar value={ratio * 100} tone={ratio > 0.8 ? '#c94a50' : ratio > 0.5 ? '#c47a2c' : '#4e9b3f'} /></div>
                  </div>
                );
              })}
            </div>

            <p className="mt-4 border-t border-dashed border-[#dbe5d6] pt-3 text-[9px] leading-relaxed text-[#7a8b7e]">
              Bars are scaled to indicative reference values for visual comparison, not compliance. Averaging periods differ by pollutant.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="overflow-hidden xl:col-span-7">
          <SectionHeader
            title="Seven-day outlook"
            detail="Pick a day to inspect it and move the hourly timeline."
            badge={<CalendarDays className="h-4 w-4 text-[#5f8f79]" />}
          />
          <div className="p-4">
            <div className="hide-scrollbar flex gap-1.5 overflow-x-auto pb-1">
              {daily.map((day, index) => (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => chooseDay(index)}
                  className={`flex min-w-[92px] flex-1 flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 transition ${selectedDay === index ? 'border-[#b3df7c] bg-[#effbe2] shadow-[0_12px_30px_-24px_rgba(52,110,41,.6)]' : 'border-white/80 bg-white/45 hover:bg-white/75'}`}
                >
                  <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#66766b]">{index === 0 ? 'Today' : dateLabel(day.date).split(' ')[0].replace(',', '')}</span>
                  <span className="text-[8px] text-[#7a8b7e]">{shortDate(day.date)}</span>
                  <WeatherGlyph code={day.weatherCode} className="h-5 w-5 text-[#5f8f79]" />
                  <span className="display text-[15px] font-bold leading-none text-[#142016]">{number(day.temperatureMaxC, 0)}°</span>
                  <span className="text-[9px] text-[#66766b]">{number(day.temperatureMinC, 0)}°</span>
                  <span className="inline-flex items-center gap-0.5 text-[8px] text-[#4f7f94]"><Droplets className="h-2.5 w-2.5" /> {number(day.precipitationProbabilityMax, 0)}%</span>
                </button>
              ))}
            </div>

            {selectedDayData ? (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="Sunrise" value={hhmm(selectedDayData.sunrise)} note="local IST" />
                <Metric label="Sunset" value={hhmm(selectedDayData.sunset)} note="local IST" />
                <Metric label="Rain total" value={`${number(selectedDayData.precipitationSumMm, 1)} mm`} note={`${number(selectedDayData.precipitationProbabilityMax, 0)}% chance`} />
                <Metric label="Peak UV" value={number(selectedDayData.uvIndexMax)} note={uvBand(selectedDayData.uvIndexMax).label} />
                <Metric label="Wind gusts" value={`${number(selectedDayData.windGustsMaxKmh, 0)} km/h`} note={`max ${number(selectedDayData.windSpeedMaxKmh, 0)} km/h`} />
                <Metric label="PM2.5 mean" value={`${number(selectedDayData.pm25Mean)} µg/m³`} note="CAMS model" />
                <Metric label="Daily max AQI" value={number(selectedDayData.aqiMax, 0)} note={aqiToneText(selectedDayData.aqiMax)} tone={aqiColor(aqiToneText(selectedDayData.aqiMax))} />
                <Metric label="Apparent range" value={`${number(selectedDayData.apparentMinC, 0)}–${number(selectedDayData.apparentMaxC, 0)}°C`} note="feels like" />
              </div>
            ) : null}
          </div>
        </Card>

        <Card className="overflow-hidden xl:col-span-5">
          <SectionHeader title="Sun and UV" detail="Sunrise, sunset and the current UV position" badge={<Sun className="h-4 w-4 text-[#c49a1c]" />} />
          <div className="p-4">
            <div className="relative flex items-center justify-center">
              <svg viewBox="0 0 320 150" className="w-full max-w-[360px]" role="img" aria-label="Sun position between sunrise and sunset">
                <path d="M 30 120 A 130 110 0 0 1 290 120" fill="none" stroke="#e8eee4" strokeWidth="3" strokeDasharray="4 6" />
                <path d="M 30 120 A 130 110 0 0 1 290 120" fill="none" stroke="#e2c95c" strokeWidth="3" pathLength={1} strokeDasharray={`${sunPosition ?? 0} 1`} strokeLinecap="round" />
                <line x1="30" y1="120" x2="290" y2="120" stroke="#dce5d8" strokeWidth="1" />
                {sunPosition !== null ? (
                  <circle
                    cx={30 + 260 * sunPosition}
                    cy={120 - 96 * Math.sin(Math.PI * sunPosition)}
                    r="7"
                    fill="#fff6d7"
                    stroke="#d6a51b"
                    strokeWidth="3"
                  />
                ) : null}
                <text x="30" y="140" textAnchor="middle" fontSize="9" fill="#66766b">{selectedDayData ? hhmm(selectedDayData.sunrise) : '—'}</text>
                <text x="290" y="140" textAnchor="middle" fontSize="9" fill="#66766b">{selectedDayData ? hhmm(selectedDayData.sunset) : '—'}</text>
              </svg>
              <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 flex-col items-center">
                <span className="display text-[28px] font-bold leading-none text-[#142016]">{uv !== null && uv !== undefined ? number(uv) : '—'}</span>
                <span className="text-[8px] font-semibold uppercase tracking-[0.14em]" style={{ color: uvInfo.color }}>{uvInfo.label}</span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric label="Burn estimate" value={burn ? `${burn} min` : '—'} note="current UV, selected skin" />
              <Metric label="Daylight" value={selectedDayData ? `${hhmm(selectedDayData.sunrise)} – ${hhmm(selectedDayData.sunset)}` : '—'} note="local IST" />
            </div>
            <div className="mt-3 rounded-xl border border-white/80 bg-white/45 p-3 text-[9px] leading-relaxed text-[#5f7065]">
              <p className="font-semibold text-[#34463a]">{uvInfo.label} UV today</p>
              <p className="mt-0.5">
                {uv !== null && uv !== undefined && uv >= 6
                  ? 'Use sunscreen, a hat and shade. UV peaks near midday even when the sky looks hazy.'
                  : 'UV is not showing a high warning right now. Reapply sunscreen if you are outside for long.'}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="overflow-hidden xl:col-span-7">
          <SectionHeader
            title="The last 30 days"
            detail="Daily mean PM2.5 from CAMS hourly values. Colour shows the PM2.5 band; hover for the daily max AQI."
            badge={<span className="text-[9px] text-[#66766b]">{history.length} days</span>}
          />
          <div className="p-4">
            <div className="grid grid-cols-10 gap-1.5">
              {history.map((day) => (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => setHistoryDay(day.date)}
                  title={`${day.date} · PM2.5 mean ${day.pm25Mean ?? '—'} µg/m³ (${pm25Category(day.pm25Mean)}) · daily max AQI ${day.aqiMax ?? '—'} (${day.category})`}
                  className={`aspect-square rounded-md border transition ${historySelected?.date === day.date ? 'ring-2 ring-[#142016] ring-offset-1' : 'hover:scale-105'}`}
                  style={{ background: aqiColor(pm25Category(day.pm25Mean)), borderColor: `${aqiColor(pm25Category(day.pm25Mean))}aa`, opacity: 0.55 + Math.min(0.45, (day.pm25Mean ?? 0) / 100) }}
                >
                  <span className="sr-only">{day.date}</span>
                </button>
              ))}
              {history.length === 0 ? <p className="col-span-10 py-6 text-center text-[10px] text-[#66766b]">No CAMS history was returned for this point.</p> : null}
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {(['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very Poor'] as const).map((label) => (
                <div key={label} className="flex items-center gap-1.5 text-[9px] text-[#66766b]">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: aqiColor(label) }} /> {label}
                </div>
              ))}
            </div>

            {historySelected ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-dashed border-[#dbe5d6] bg-white/45 p-3">
                <div>
                  <DataLabel>{dateLabel(historySelected.date)}</DataLabel>
                  <p className="display mt-1 text-[20px] font-bold text-[#142016]">{number(historySelected.pm25Mean)} <span className="text-[10px] font-normal text-[#66766b]">µg/m³ mean PM2.5</span></p>
                  <p className="mt-1 text-[9px]" style={{ color: aqiColor(pm25Category(historySelected.pm25Mean)) }}>{pm25Category(historySelected.pm25Mean)}</p>
                </div>
                <div className="text-right text-[9px] text-[#66766b]">
                  <p>Max AQI <span className="font-semibold text-[#223328]">{historySelected.aqiMax ?? '—'}</span></p>
                  <p className="mt-0.5">Mean AQI <span className="font-semibold text-[#223328]">{number(historySelected.aqiMean, 0)}</span></p>
                  <p className="mt-0.5">Max category <span style={{ color: aqiColor(historySelected.category) }}>{historySelected.category}</span></p>
                </div>
              </div>
            ) : null}
          </div>
        </Card>

        <Card className="overflow-hidden xl:col-span-5">
          <SectionHeader title="This day last year" detail="Open-Meteo historical reanalysis at the same point" badge={<CalendarDays className="h-4 w-4 text-[#5f8f79]" />} />
          <div className="p-4">
            <div className="flex gap-2">
              <Input type="date" value={archiveDate} max={yesterdayDate()} onChange={(event) => setArchiveDate(event.target.value)} className="h-10" />
              <Button
                variant="default"
                size="sm"
                className="h-10 shrink-0"
                onClick={() => setArchivePath(`/city/archive?${pointQuery(point)}&date=${archiveDate}`)}
                disabled={archive.loading}
              >
                {archive.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Compare
              </Button>
            </div>

            {!archivePath ? (
              <div className="mt-5 rounded-2xl border border-dashed border-[#dbe5d6] bg-white/45 p-4 text-center">
                <CalendarDays className="mx-auto h-5 w-5 text-[#9fb0a3]" />
                <p className="mt-2 text-[11px] font-semibold text-[#223328]">Pick any past date</p>
                <p className="mt-1 text-[9px] leading-relaxed text-[#66766b]">Reanalysis can show how a day felt, but it is not a past station observation.</p>
              </div>
            ) : archive.error ? (
              <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3 text-[10px] text-amber-700">{archive.error}</p>
            ) : archive.data ? (
              <div className="mt-4">
                <div className="flex items-center justify-between rounded-2xl border border-white/80 bg-white/45 p-3">
                  <div className="flex items-center gap-2">
                    <WeatherGlyph code={archive.data.weatherCode} className="h-6 w-6 text-[#5f8f79]" />
                    <div>
                      <p className="text-[11px] font-semibold text-[#223328]">{weatherLabel(archive.data.weatherCode)}</p>
                      <p className="text-[9px] text-[#66766b]">{dateLabel(archive.data.date)}</p>
                    </div>
                  </div>
                  <p className="display text-[22px] font-bold text-[#142016]">{number(archive.data.temperatureMaxC, 0)}°<span className="text-[11px] font-normal text-[#66766b]"> / {number(archive.data.temperatureMinC, 0)}°</span></p>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Metric label="Rain" value={`${number(archive.data.precipitationSumMm, 1)} mm`} note="daily total" />
                  <Metric label="Wind max" value={`${number(archive.data.windSpeedMaxKmh, 0)} km/h`} note="daily max" />
                  <Metric label="Solar" value={`${number(archive.data.shortwaveRadiationSum, 1)} MJ/m²`} note="shortwave sum" />
                  <Metric
                    label="Vs today"
                    value={`${archive.data.temperatureMaxC !== null && current?.temperatureC !== null && current?.temperatureC !== undefined ? `${archive.data.temperatureMaxC - current.temperatureC > 0 ? '+' : ''}${number(archive.data.temperatureMaxC - current.temperatureC, 1)}°` : '—'}`}
                    note="max temp difference"
                  />
                </div>
                <a href={archive.data.source.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[9px] text-[#3f7d2a] underline">
                  {archive.data.source.label} <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
        <Card className="overflow-hidden xl:col-span-4">
          <SectionHeader title="Coast watch" detail="Nearest sea grid point from Open-Meteo Marine" badge={<Waves className="h-4 w-4 text-[#4f7f94]" />} />
          <div className="p-4">
            {marine.error ? (
              <p className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3 text-[10px] text-amber-700">{marine.error}</p>
            ) : (
              <>
                <div className="flex items-end justify-between gap-3 rounded-2xl border border-white/80 bg-white/45 p-3">
                  <div>
                    <DataLabel>Wave height</DataLabel>
                    <p className="display mt-1 text-[34px] font-bold leading-none text-[#142016]">{number(marineCurrent?.waveHeightM)}<span className="ml-1 text-[11px] font-normal text-[#66766b]">m</span></p>
                    <p className="mt-1 text-[9px] text-[#66766b]">Period {number(marineCurrent?.wavePeriodS)} s · swell {number(marineCurrent?.swellHeightM)} m</p>
                  </div>
                  <Badge tone={beach.tone === 'red' ? 'red' : beach.tone === 'amber' ? 'amber' : beach.tone === 'green' ? 'green' : 'neutral'} dot>{beach.label}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Metric label="Sea temp" value={`${number(marineCurrent?.seaSurfaceTemperatureC)}°C`} note="surface model" />
                  <Metric label="Current" value={`${number(marineCurrent?.currentVelocityKmh)} km/h`} note="ocean current" />
                </div>
                <p className="mt-2 text-[9px] leading-relaxed text-[#5f7065]">{beach.note}</p>
                <div className="mt-2">
                  <Chart
                    height={100}
                    empty={(marine.data?.hourly.length ?? 0) === 0}
                    option={{
                      grid: { left: 0, right: 0, top: 8, bottom: 0, containLabel: false },
                      tooltip: chartTooltip,
                      xAxis: { type: 'category', show: false, data: (marine.data?.hourly ?? []).map((hour) => hhmm(hour.time)) },
                      yAxis: { type: 'value', show: false },
                      series: [{ type: 'line', smooth: 0.4, symbol: 'none', data: (marine.data?.hourly ?? []).map((hour) => hour.waveHeightM), lineStyle: { color: '#4f7f94', width: 2 }, areaStyle: { color: 'rgba(79,127,148,0.14)' } }],
                    }}
                  />
                </div>
                <a href={marine.data?.source.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[9px] text-[#3f7d2a] underline">{marine.data?.source.label ?? 'Open-Meteo Marine'} <ExternalLink className="h-2.5 w-2.5" /></a>
              </>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden xl:col-span-4">
          <SectionHeader title="River watch" detail="Modelled discharge at the nearest global grid cell" badge={<Droplets className="h-4 w-4 text-[#4f7f94]" />} />
          <div className="p-4">
            {flood.error ? (
              <p className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3 text-[10px] text-amber-700">{flood.error}</p>
            ) : (
              <>
                <div className="flex items-end justify-between gap-3 rounded-2xl border border-white/80 bg-white/45 p-3">
                  <div>
                    <DataLabel>Discharge now</DataLabel>
                    <p className="display mt-1 text-[34px] font-bold leading-none text-[#142016]">{number(flood.data?.current.dischargeM3s)}<span className="ml-1 text-[11px] font-normal text-[#66766b]">m³/s</span></p>
                    <p className="mt-1 text-[9px] text-[#66766b]">{flood.data?.note ?? 'Indicative model value.'}</p>
                  </div>
                  <Badge tone={flood.data?.band === 'ELEVATED' ? 'red' : flood.data?.band === 'WATCH' ? 'amber' : 'neutral'}>{flood.data?.band ?? 'No data'}</Badge>
                </div>
                <div className="mt-2">
                  <Chart
                    height={110}
                    empty={(flood.data?.days.length ?? 0) === 0}
                    option={{
                      grid: { left: 0, right: 0, top: 8, bottom: 0, containLabel: false },
                      tooltip: chartTooltip,
                      xAxis: { type: 'category', show: false, data: (flood.data?.days ?? []).map((day) => shortDate(day.date)) },
                      yAxis: { type: 'value', show: false },
                      series: [{ type: 'line', smooth: 0.35, symbol: 'none', data: (flood.data?.days ?? []).map((day) => day.dischargeM3s), lineStyle: { color: '#2f8f84', width: 2 }, areaStyle: { color: 'rgba(47,143,132,0.12)' } }],
                    }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[9px] text-[#66766b]">
                  <span>7 days past · 14 days forecast</span>
                  <a href={flood.data?.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#3f7d2a] underline">Open-Meteo Flood <ExternalLink className="h-2.5 w-2.5" /></a>
                </div>
                <p className="mt-2 flex items-start gap-1.5 text-[9px] leading-relaxed text-[#7a8b7e]"><ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" /> Not an official flood warning. The model grid does not resolve Mumbai's drains or tidal flooding.</p>
              </>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden md:col-span-2 xl:col-span-4">
          <SectionHeader title="Compare localities" detail="CAMS model grid, not station sensors" badge={<MapPin className="h-4 w-4 text-[#5f8f79]" />} />
          <div className="p-4">
            {compare.loading && compareRows.length === 0 ? <LoadingBlock label="Comparing points" /> : null}
            {compare.error ? <p className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3 text-[10px] text-amber-700">{compare.error}</p> : null}
            <div className="grid gap-1.5">
              {PRESETS.map((preset) => {
                const row = compareRows.find((item) => Math.abs(item.lat - preset.lat) < 0.001 && Math.abs(item.lng - preset.lng) < 0.001);
                const active = samePoint(point, preset);
                return (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => selectPoint(preset)}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition ${active ? 'border-[#b3df7c] bg-[#effbe2]' : 'border-white/80 bg-white/45 hover:bg-white/75'}`}
                  >
                    <span className="min-w-0">
                      <span className="block text-[10px] font-semibold text-[#223328]">{preset.name}</span>
                      <span className="block text-[8px] text-[#66766b]">{row ? `${number(row.pm25)} µg/m³ PM2.5 · ${number(row.temperatureC, 0)}°C` : 'No modelled row'}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="display text-[13px] font-bold" style={{ color: row ? aqiColor(row.aqi.category) : '#728176' }}>{row?.aqi.aqi ?? '—'}</span>
                      <span className="h-2 w-2 rounded-full" style={{ background: row ? aqiColor(row.aqi.category) : '#cdd9c9' }} />
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[9px] leading-relaxed text-[#7a8b7e]">Nearby points often share a CAMS cell, so identical values are expected. This is not a station comparison.</p>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="overflow-hidden xl:col-span-7">
          <SectionHeader
            title="Nature nearby"
            detail="Parks, gardens and named water bodies within 4 km from OpenStreetMap"
            badge={<Trees className="h-4 w-4 text-[#4e9b3f]" />}
          />
          <div className="p-4">
            {!nearbyPath ? (
              <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-dashed border-[#dbe5d6] bg-white/45 p-4 sm:flex-row sm:items-center">
                <div>
                  <p className="text-[11px] font-semibold text-[#223328]">Find a greener corner</p>
                  <p className="mt-1 max-w-md text-[9px] leading-relaxed text-[#66766b]">Queries the community Overpass service on demand, then estimates a pedestrian route with Valhalla.</p>
                </div>
                <Button variant="lime" size="sm" onClick={() => setNearbyPath(`/city/nearby?${pointQuery(point)}`)}>
                  <Search className="h-3.5 w-3.5" /> Search nearby
                </Button>
              </div>
            ) : nearby.loading ? (
              <LoadingBlock label="Searching OpenStreetMap" />
            ) : nearby.error ? (
              <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.05] p-3">
                <p className="text-[10px] text-amber-700">{nearby.error}</p>
                <a href={`https://www.openstreetmap.org/#map=15/${point.lat}/${point.lng}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[9px] font-semibold text-[#3f7d2a] underline">Open the map instead <ExternalLink className="h-2.5 w-2.5" /></a>
              </div>
            ) : nearby.data && nearby.data.items.length > 0 ? (
              <>
                <div className="divide-y divide-dashed divide-[#e7ece3]">
                  {nearby.data.items.map((place) => {
                    const route = routes[place.id];
                    return (
                      <div key={place.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#edf4e9] text-[#4d7d40]">
                            {place.kind === 'water' ? <Droplets className="h-3.5 w-3.5" /> : <Leaf className="h-3.5 w-3.5" />}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[11px] font-semibold text-[#223328]">{place.name}</p>
                            <p className="text-[8px] text-[#66766b]">{place.kind.replace(/_/g, ' ')} · {number(place.distanceKm)} km away</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {route === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4e9b3f]" /> : null}
                          {route && route !== 'loading' && route !== 'error' ? (
                            <span className="rounded-full border border-[#cbe8a5] bg-[#eefbdc] px-2 py-1 text-[8px] font-semibold text-[#3f7d2a]">{route.minutes} min · {number(route.distanceKm)} km</span>
                          ) : null}
                          {route === 'error' ? <span className="text-[8px] text-amber-700">Route unavailable</span> : null}
                          <Button variant="outline" size="sm" className="h-7 px-2 text-[9px]" onClick={() => void loadRoute(place)}>
                            <Footprints className="h-3 w-3" /> Walk
                          </Button>
                          <a href={`https://www.openstreetmap.org/directions?route=${point.lat},${point.lng};${place.lat},${place.lng}`} target="_blank" rel="noreferrer" aria-label={`Open directions to ${place.name}`} className="flex h-7 w-7 items-center justify-center rounded-full border border-white/80 bg-white/60 text-[#5f7065] hover:text-[#142016]">
                            <Navigation className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-[#dbe5d6] pt-2">
                  <p className="text-[8px] text-[#7a8b7e]">{nearby.data.source} · community-mapped, not an official park inventory.</p>
                  <button type="button" onClick={() => setNearbyPath(`/city/nearby?${pointQuery(point)}&refresh=1`)} className="text-[8px] font-semibold text-[#3f7d2a] underline">Refresh</button>
                </div>
              </>
            ) : (
              <EmptyState title="No mapped green spaces returned" description="The community mirrors may be busy. Try again in a moment or open OpenStreetMap directly." action={<Button variant="outline" size="sm" onClick={() => setNearbyPath(`/city/nearby?${pointQuery(point)}&again=${Date.now()}`)}>Retry</Button>} />
            )}
          </div>
        </Card>

        <Card className="overflow-hidden xl:col-span-5">
          <SectionHeader
            title="Planet watch"
            detail="Open natural events and earthquakes in the India bounding box"
            badge={<span className="text-[9px] text-[#66766b]">{planetRows.length} shown</span>}
          />
          <div className="flex gap-1 border-b border-dashed border-[#dbe5d6] px-4 py-2">
            {([['events', 'Natural events', events.data?.events.length ?? 0], ['earthquakes', 'Earthquakes', events.data?.earthquakes.length ?? 0]] as const).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPlanetTab(key)}
                className={`rounded-full px-2.5 py-1 text-[9px] font-semibold transition ${planetTab === key ? 'bg-[#4e9b3f] text-white' : 'text-[#5f7065] hover:bg-white/70'}`}
              >
                {label} <span className={planetTab === key ? 'text-white/65' : 'text-[#8a9b8e]'}>{count}</span>
              </button>
            ))}
          </div>
          <div className="p-4">
            {events.loading && !events.data ? <LoadingBlock label="Checking the planet" /> : null}
            {events.error ? <p className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3 text-[10px] text-amber-700">{events.error}</p> : null}
            {!events.loading && planetRows.length === 0 ? (
              <EmptyState title={planetTab === 'events' ? 'No open events in the India box' : 'No M2.5+ earthquakes in the last week'} description="An empty result is an honest result. Both feeds are global and updated by their providers." />
            ) : (
              <div className="divide-y divide-dashed divide-[#e7ece3]">
                {planetRows.map((event) => (
                  <PlanetRow key={event.id} event={event} />
                ))}
              </div>
            )}
            <p className="mt-2 border-t border-dashed border-[#dbe5d6] pt-2 text-[8px] leading-relaxed text-[#7a8b7e]">
              NASA EONET · USGS. Events are not local hazard warnings. Distances are straight-line from the selected point.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="overflow-hidden xl:col-span-5">
          <SectionHeader title="Personal exposure" detail="A transparent dose estimate using current modelled PM2.5" badge={<Activity className="h-4 w-4 text-[#4e9b3f]" />} />
          <div className="p-4">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#66766b]">
                Activity
                <Select value={activity} onChange={(event) => setActivity(event.target.value as ActivityKind)} className="mt-1 h-9 text-[11px]">
                  <option value="rest">Resting</option>
                  <option value="walk">Walking</option>
                  <option value="cycle">Cycling</option>
                  <option value="run">Running</option>
                </Select>
              </label>
              <label className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#66766b]">
                Mask
                <Select value={mask} onChange={(event) => setMask(event.target.value as Mask)} className="mt-1 h-9 text-[11px]">
                  <option value="none">None</option>
                  <option value="cloth">Cloth</option>
                  <option value="surgical">Surgical</option>
                  <option value="n95">N95 / FFP2</option>
                </Select>
              </label>
            </div>
            <label className="mt-3 block text-[9px] font-semibold uppercase tracking-[0.1em] text-[#66766b]">
              Time outdoors · {duration} min
              <input type="range" min={15} max={180} step={15} value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#dce5d8] accent-[#4e9b3f]" />
            </label>
            <button
              type="button"
              onClick={() => setIndoor((value) => !value)}
              className={`mt-3 flex w-full items-center justify-between rounded-xl border px-3 py-2 text-[10px] font-semibold transition ${indoor ? 'border-[#b3df7c] bg-[#effbe2] text-[#3f7d2a]' : 'border-white/80 bg-white/45 text-[#5f7065]'}`}
            >
              <span>{indoor ? 'Typical indoor setting' : 'Outdoors'}</span>
              <span className={`flex h-4 w-7 items-center rounded-full p-0.5 transition ${indoor ? 'bg-[#4e9b3f]' : 'bg-[#cdd9c9]'}`}>
                <span className={`h-3 w-3 rounded-full bg-white transition ${indoor ? 'translate-x-3' : ''}`} />
              </span>
            </button>

            {exposure ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Metric label="Effective PM2.5" value={`${exposure.effectivePm25} µg/m³`} note={indoor ? 'indoor ratio assumed' : 'outdoor'} />
                <Metric label="Inhaled dose" value={`${exposure.inhaledMicrograms} µg`} note={`${exposure.ventilation} m³/h`} />
                <Metric label="WHO 24h guide" value={`${exposure.whoPercent}%`} note="if this were your daily avg" tone={exposure.whoPercent > 100 ? '#c94a50' : exposure.whoPercent > 50 ? '#b3860f' : '#2f8f66'} />
                <Metric label="Cigarette equivalence" value={`${exposure.cigarettes}`} note="rough public-health comparison" />
              </div>
            ) : (
              <p className="mt-4 text-[10px] text-[#66766b]">No current PM2.5 value is available for this point.</p>
            )}
            <p className="mt-3 flex items-start gap-1.5 text-[9px] leading-relaxed text-[#7a8b7e]">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Illustrative estimate only. It uses published inhalation rates and assumes N95 penetration of 5%. It is not a personal exposure measurement or medical advice.
            </p>
          </div>
        </Card>

        <Card className="overflow-hidden xl:col-span-7">
          <SectionHeader title="Open data behind this page" detail="All providers are free and keyless. Click an endpoint to copy it." badge={<Gauge className="h-4 w-4 text-[#5f8f79]" />} />
          <div className="divide-y divide-dashed divide-[#e7ece3]">
            {[
              ['Overview', '/city/overview', 'Open-Meteo forecast + CAMS air quality', 'https://open-meteo.com/en/docs'],
              ['Localities', '/city/places', 'OpenStreetMap Nominatim, Open-Meteo geocoding fallback', 'https://nominatim.org/'],
              ['Compare', '/city/compare', 'Open-Meteo multi-point weather and CAMS', 'https://open-meteo.com/en/docs/air-quality-api'],
              ['Coast', '/city/marine', 'Open-Meteo Marine API', 'https://open-meteo.com/en/docs/marine-weather-api'],
              ['River', '/city/flood', 'Open-Meteo Flood API', 'https://open-meteo.com/en/docs/flood-api'],
              ['Nature', '/city/nearby', 'OpenStreetMap Overpass API', 'https://wiki.openstreetmap.org/wiki/Overpass_API'],
              ['Walking route', '/city/route', 'Valhalla pedestrian router', 'https://valhalla.github.io/valhalla/'],
              ['Planet watch', '/city/events', 'NASA EONET + USGS earthquakes', 'https://eonet.gsfc.nasa.gov/'],
              ['This day last year', '/city/archive', 'Open-Meteo Historical Weather API', 'https://open-meteo.com/en/docs/historical-weather-api'],
            ].map(([label, endpoint, provider, docs]) => (
              <div key={endpoint} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-[#223328]">{label}</p>
                  <p className="mt-0.5 truncate text-[9px] text-[#66766b]">{provider}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <code className="rounded-full border border-white/80 bg-white/55 px-2 py-1 text-[8px] text-[#5f7065]">{endpoint}</code>
                  <button type="button" onClick={() => void copyEndpoint(endpoint)} aria-label={`Copy ${endpoint}`} className="flex h-7 w-7 items-center justify-center rounded-full border border-white/80 bg-white/60 text-[#5f7065] hover:text-[#142016]">
                    {copied === endpoint ? <Check className="h-3 w-3 text-[#3f7d2a]" /> : <Copy className="h-3 w-3" />}
                  </button>
                  <a href={docs} target="_blank" rel="noreferrer" aria-label={`${label} documentation`} className="flex h-7 w-7 items-center justify-center rounded-full border border-white/80 bg-white/60 text-[#5f7065] hover:text-[#142016]">
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-[#dbe5d6] px-4 py-3">
            <p className="max-w-lg text-[9px] leading-relaxed text-[#7a8b7e]">
              Open-Meteo data is CC BY 4.0. OpenStreetMap data is © OpenStreetMap contributors (ODbL). CAMS is a modelled
              product. None of these layers is a CPCB/MPCB station reading or an official AQI.
            </p>
            <a href="/data-sources" className="inline-flex items-center gap-1 text-[9px] font-semibold text-[#3f7d2a]">Source registry <ArrowUpRight className="h-3 w-3" /></a>
          </div>
        </Card>
      </div>

      <div className="rounded-2xl border border-[#eddeae] bg-[#fdf8e9]/70 p-4 text-[10px] leading-relaxed text-[#8a6710]">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong>Read the labels:</strong> weather is a forecast/observation product; CAMS air, marine and river values are
            models; OSM places are community-mapped; EONET and USGS are external hazard feeds; exposure and burn estimates are
            illustrative. Use the source registry for attribution and never cite these as official monitoring data.
          </p>
        </div>
      </div>
    </div>
  );
}

function aqiToneText(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'No data';
  if (value <= 50) return 'Good';
  if (value <= 100) return 'Satisfactory';
  if (value <= 200) return 'Moderate';
  if (value <= 300) return 'Poor';
  if (value <= 400) return 'Very Poor';
  return 'Severe';
}

function PlanetRow({ event }: { event: PlanetEvent }) {
  return (
    <a
      href={event.url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="flex items-start justify-between gap-3 py-2.5 transition hover:opacity-80"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-white/80 bg-white/60 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-[#5f7065]">{event.kind}</span>
          {event.magnitude !== null ? <span className="text-[8px] font-semibold text-[#c94a50]">M{event.magnitude}</span> : null}
        </div>
        <p className="mt-1 line-clamp-2 text-[10px] font-semibold leading-snug text-[#223328]">{event.title}</p>
        <p className="mt-0.5 text-[8px] text-[#66766b]">
          {event.distanceKm !== null ? `${number(event.distanceKm, 0)} km away · ` : ''}
          {event.date ? timeAgo(event.date) : 'date unavailable'} · {event.provider}
        </p>
      </div>
      <ArrowUpRight className="mt-1 h-3 w-3 shrink-0 text-[#a9b7ac]" />
    </a>
  );
}
