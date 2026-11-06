import { AQI_COLORS } from './format';

export interface CityHour {
  time: string;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  relativeHumidity: number | null;
  precipitationProbability: number | null;
  precipitationMm: number | null;
  weatherCode: number | null;
  cloudCover: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  windGustsKmh: number | null;
  uvIndex: number | null;
  isDay: boolean | null;
  pm25: number | null;
  pm10: number | null;
  no2: number | null;
  so2: number | null;
  co: number | null;
  o3: number | null;
  usAqi: number | null;
  aqi: number | null;
  aqiCategory: string;
  dominantPollutant: string | null;
}

export interface CityDay {
  date: string;
  weatherCode: number | null;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  apparentMaxC: number | null;
  apparentMinC: number | null;
  sunrise: string | null;
  sunset: string | null;
  uvIndexMax: number | null;
  precipitationProbabilityMax: number | null;
  precipitationSumMm: number | null;
  windSpeedMaxKmh: number | null;
  windGustsMaxKmh: number | null;
  pm25Mean: number | null;
  aqiMean: number | null;
  aqiMax: number | null;
}

export interface CityHistoryDay {
  date: string;
  pm25Mean: number | null;
  aqiMean: number | null;
  aqiMax: number | null;
  category: string;
}

export interface CityOverview {
  generatedAt: string;
  weatherProvider: 'open-meteo' | 'met-no';
  point: { lat: number; lng: number; timezone: string };
  current: {
    time: string | null;
    temperatureC: number | null;
    apparentTemperatureC: number | null;
    relativeHumidity: number | null;
    precipitationMm: number | null;
    rainMm: number | null;
    weatherCode: number | null;
    cloudCover: number | null;
    windSpeedKmh: number | null;
    windDirectionDeg: number | null;
    windGustsKmh: number | null;
    uvIndex: number | null;
    pressureHpa: number | null;
    isDay: boolean | null;
  };
  previous: {
    time: string;
    temperatureC: number | null;
    relativeHumidity: number | null;
    windSpeedKmh: number | null;
    precipitationMm: number | null;
    pm25: number | null;
    aqi: number | null;
  } | null;
  air: {
    time: string | null;
    pm25: number | null;
    pm10: number | null;
    co: number | null;
    no2: number | null;
    so2: number | null;
    o3: number | null;
    usAqi: number | null;
    europeanAqi: number | null;
    dust: number | null;
    aerosolOpticalDepth: number | null;
    aqi: { aqi: number | null; category: string; dominantPollutant: string | null };
  };
  hourly: CityHour[];
  daily: CityDay[];
  history: CityHistoryDay[];
  sources: Array<{ id: string; label: string; url: string; license: string; note: string }>;
}

export interface CityPlace {
  id: string;
  name: string;
  label: string;
  lat: number;
  lng: number;
  kind: string;
  provider: string;
}

export interface CityComparisonRow {
  lat: number;
  lng: number;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  relativeHumidity: number | null;
  weatherCode: number | null;
  windSpeedKmh: number | null;
  pm25: number | null;
  pm10: number | null;
  aqi: { aqi: number | null; category: string; dominantPollutant: string | null };
}

export interface MarineConditions {
  generatedAt: string;
  current: {
    time: string | null;
    waveHeightM: number | null;
    waveDirectionDeg: number | null;
    wavePeriodS: number | null;
    swellHeightM: number | null;
    seaSurfaceTemperatureC: number | null;
    currentVelocityKmh: number | null;
  };
  hourly: Array<{ time: string; waveHeightM: number | null; seaSurfaceTemperatureC: number | null }>;
  source: { label: string; url: string; note: string };
}

export interface FloodConditions {
  generatedAt: string;
  current: { date: string | null; dischargeM3s: number | null; meanM3s: number | null; maxM3s: number | null };
  days: Array<{ date: string; dischargeM3s: number | null; meanM3s: number | null; maxM3s: number | null }>;
  band: string;
  note: string;
  source: { label: string; url: string };
}

export interface NearbyPlace {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  distanceKm: number;
}

export interface PlanetEvent {
  id: string;
  title: string;
  kind: string;
  date: string | null;
  lat: number | null;
  lng: number | null;
  magnitude: number | null;
  url: string | null;
  distanceKm: number | null;
  provider: string;
}

export interface PlanetEvents {
  events: PlanetEvent[];
  earthquakes: PlanetEvent[];
  sources: Array<{ label: string; url: string }>;
}

export interface WalkRoute {
  distanceKm: number;
  minutes: number;
  mode: string;
  provider: string;
  note: string;
}

export interface ArchiveDay {
  date: string;
  weatherCode: number | null;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  precipitationSumMm: number | null;
  windSpeedMaxKmh: number | null;
  shortwaveRadiationSum: number | null;
  source: { label: string; url: string; note: string };
}

export type WeatherMood = 'clear' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';

const WMO_LABELS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Heavy freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Violent showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Severe thunderstorm with hail',
};

export function weatherLabel(code: number | null | undefined): string {
  if (code === null || code === undefined) return 'Weather unavailable';
  return WMO_LABELS[code] ?? 'Mixed conditions';
}

export function weatherMood(code: number | null | undefined): WeatherMood {
  if (code === null || code === undefined) return 'cloud';
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloud';
}

/** WMO local times arrive as "YYYY-MM-DDTHH:MM" without an offset. */
export function hhmm(value?: string | null): string {
  if (!value) return '—';
  const match = value.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : '—';
}

export function dateLabel(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
}

export function shortDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function aqiColor(category?: string | null): string {
  return AQI_COLORS[category ?? 'INSUFFICIENT DATA'] ?? '#728176';
}

export function pm25Category(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'INSUFFICIENT DATA';
  if (value <= 30) return 'Good';
  if (value <= 60) return 'Satisfactory';
  if (value <= 90) return 'Moderate';
  if (value <= 120) return 'Poor';
  if (value <= 250) return 'Very Poor';
  return 'Severe';
}

export function aqiTone(aqi: number | null | undefined): string {
  if (aqi === null || aqi === undefined) return 'No data';
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Satisfactory';
  if (aqi <= 200) return 'Moderate';
  if (aqi <= 300) return 'Poor';
  if (aqi <= 400) return 'Very Poor';
  return 'Severe';
}

export function uvBand(uv: number | null | undefined): { label: string; color: string } {
  if (uv === null || uv === undefined) return { label: 'No data', color: '#728176' };
  if (uv < 3) return { label: 'Low', color: '#2f8f66' };
  if (uv < 6) return { label: 'Moderate', color: '#b3860f' };
  if (uv < 8) return { label: 'High', color: '#cf7227' };
  if (uv < 11) return { label: 'Very high', color: '#c94a50' };
  return { label: 'Extreme', color: '#8f2f3a' };
}

const SKIN_FACTORS = [1, 1.5, 2, 3, 4.5, 6];

/** Rough time-to-burn estimate at the current UV index; not medical advice. */
export function burnMinutes(uv: number | null | undefined, skinType = 2): number | null {
  if (uv === null || uv === undefined || uv < 0.5) return null;
  const factor = SKIN_FACTORS[Math.max(0, Math.min(SKIN_FACTORS.length - 1, skinType - 1))];
  return Math.max(5, Math.round((200 * factor) / uv));
}

export function sunProgress(now: string | null | undefined, sunrise: string | null | undefined, sunset: string | null | undefined): number | null {
  const nowMatch = now?.match(/T(\d{2}):(\d{2})/);
  const riseMatch = sunrise?.match(/T(\d{2}):(\d{2})/);
  const setMatch = sunset?.match(/T(\d{2}):(\d{2})/);
  if (!nowMatch || !riseMatch || !setMatch) return null;
  const toMinutes = (match: RegExpMatchArray) => Number(match[1]) * 60 + Number(match[2]);
  const nowMinutes = toMinutes(nowMatch);
  const rise = toMinutes(riseMatch);
  const set = toMinutes(setMatch);
  if (set <= rise) return null;
  return Math.max(0, Math.min(1, (nowMinutes - rise) / (set - rise)));
}

export function beachBand(waveHeight: number | null | undefined, windSpeed: number | null | undefined): { label: string; tone: 'green' | 'amber' | 'red' | 'neutral'; note: string } {
  if (waveHeight === null || waveHeight === undefined) return { label: 'No data', tone: 'neutral', note: 'Marine model did not return a value.' };
  if (waveHeight >= 2 || (windSpeed ?? 0) >= 40) return { label: 'Rough', tone: 'red', note: 'Model shows high waves or strong wind. Avoid water activities.' };
  if (waveHeight >= 1 || (windSpeed ?? 0) >= 25) return { label: 'Choppy', tone: 'amber', note: 'Small craft and weak swimmers should take care.' };
  return { label: 'Calm', tone: 'green', note: 'Low modelled waves. Still check local flags and tide before entering water.' };
}

export function bestWindow(hours: CityHour[]): { start: string; end: string; aqi: number | null; rain: number | null; uv: number | null } | null {
  const candidates = hours.slice(0, 24);
  let best: { index: number; score: number } | null = null;
  for (let index = 0; index < candidates.length - 1; index += 1) {
    const pair = [candidates[index], candidates[index + 1]];
    if (pair.some((hour) => hour.aqi === null)) continue;
    const aqi = pair.reduce((sum, hour) => sum + (hour.aqi ?? 0), 0) / 2;
    const rain = pair.reduce((sum, hour) => sum + (hour.precipitationProbability ?? 0), 0) / 2;
    const uv = pair.reduce((sum, hour) => sum + (hour.uvIndex ?? 0), 0) / 2;
    const score = aqi + rain * 2.2 + uv * 6;
    if (!best || score < best.score) best = { index, score };
  }
  if (!best) return null;
  const start = candidates[best.index];
  const end = candidates[best.index + 1];
  return {
    start: start.time,
    end: end.time,
    aqi: start.aqi,
    rain: start.precipitationProbability,
    uv: start.uvIndex,
  };
}

export type Activity = 'rest' | 'walk' | 'cycle' | 'run';
export type Mask = 'none' | 'cloth' | 'surgical' | 'n95';

const VENTILATION: Record<Activity, number> = { rest: 0.5, walk: 1.5, cycle: 2.5, run: 4 };
const MASK_PENETRATION: Record<Mask, number> = { none: 1, cloth: 0.8, surgical: 0.5, n95: 0.05 };

export interface ExposureResult {
  effectivePm25: number;
  inhaledMicrograms: number;
  whoPercent: number;
  cigarettes: number;
  ventilation: number;
}

/**
 * A transparent dose estimate. It uses inhalation rates from public-health
 * literature and assumes a typical indoor ratio; it is an illustration, not a
 * personal exposure measurement.
 */
export function exposureEstimate(
  pm25: number | null | undefined,
  activity: Activity,
  minutes: number,
  mask: Mask,
  indoor: boolean,
): ExposureResult | null {
  if (pm25 === null || pm25 === undefined || !Number.isFinite(pm25)) return null;
  const ventilation = VENTILATION[activity];
  const effectivePm25 = pm25 * MASK_PENETRATION[mask] * (indoor ? 0.65 : 1);
  const inhaledMicrograms = effectivePm25 * ventilation * (Math.max(0, minutes) / 60);
  return {
    effectivePm25: Math.round(effectivePm25 * 10) / 10,
    inhaledMicrograms: Math.round(inhaledMicrograms),
    whoPercent: Math.round((effectivePm25 / 15) * 100),
    cigarettes: Math.round((effectivePm25 / 22) * 10) / 10,
    ventilation,
  };
}

/** Deterministic 2-hour window used by the headline health card. */
export function healthHeadline(overview: CityOverview): { title: string; detail: string; tone: 'green' | 'amber' | 'red' } {
  const aqi = overview.air.aqi.aqi;
  const uv = overview.current.uvIndex ?? 0;
  const temp = overview.current.temperatureC ?? 0;
  if (aqi !== null && aqi > 300) {
    return { title: 'Keep outdoor time short', detail: 'Modelled air quality is very poor. Use an N95 outdoors and keep windows closed.', tone: 'red' };
  }
  if (aqi !== null && aqi > 200) {
    return { title: 'Sensitive groups should stay in', detail: 'Modelled AQI is poor. Avoid prolonged exertion outdoors and check the best window below.', tone: 'red' };
  }
  if (aqi !== null && aqi > 100) {
    return { title: 'Plan around the cleaner hours', detail: 'Modelled air quality is moderate. Sensitive groups should shorten outdoor exercise.', tone: 'amber' };
  }
  if (temp >= 35) {
    return { title: 'Heat is the bigger signal', detail: 'Air quality is relatively settled but it is very hot. Hydrate and avoid the midday sun.', tone: 'amber' };
  }
  if (uv >= 8) {
    return { title: 'UV is very high', detail: 'Use sunscreen, a hat and shade. The air is relatively settled, but the sun is strong.', tone: 'amber' };
  }
  return { title: 'A reasonable window to be outside', detail: 'Modelled air quality and UV are not showing a strong warning right now.', tone: 'green' };
}
