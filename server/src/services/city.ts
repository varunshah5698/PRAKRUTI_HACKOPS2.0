import { env } from '../config/env.js';
import { badRequest, unavailable } from '../middleware/errors.js';
import { calculateAqi, aqiCategory } from './aqi.js';

/**
 * On-demand open-data services for the Live City workspace. Every provider is
 * free and keyless: Open-Meteo (forecast, CAMS air, marine, flood, archive),
 * OpenStreetMap (Nominatim search, Overpass places, Valhalla walking routes),
 * NASA EONET natural events and the USGS earthquake feed.
 *
 * Nothing here writes to the evidence database. These are contextual layers,
 * never CPCB station readings, and every payload says so.
 */

export const MUMBAI_BOUNDS = {
  minLat: 18.85,
  maxLat: 19.35,
  minLng: 72.7,
  maxLng: 73.05,
};

const INDIA_BBOX = { minLat: 6, maxLat: 36, minLng: 68, maxLng: 98 };

function isWithinIndiaBbox(lat: number, lng: number): boolean {
  return lat >= INDIA_BBOX.minLat && lat <= INDIA_BBOX.maxLat && lng >= INDIA_BBOX.minLng && lng <= INDIA_BBOX.maxLng;
}

export interface CityPoint {
  lat: number;
  lng: number;
}

export interface AqiSummary {
  aqi: number | null;
  category: string;
  dominantPollutant: string | null;
}

interface CacheEntry {
  at: number;
  expires: number;
  data: unknown;
}

const cache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 300;

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit || hit.expires <= Date.now()) return null;
  return hit.data as T;
}

function cacheSet(key: string, data: unknown, ttlMs: number) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  const now = Date.now();
  cache.set(key, { at: now, expires: now + ttlMs, data });
}

/** Cache keyed by provider + request. Stale data is better than a blank card. */
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const fresh = cacheGet<T>(key);
  if (fresh) return fresh;
  try {
    const data = await load();
    cacheSet(key, data, ttlMs);
    return data;
  } catch (error) {
    const stale = cache.get(key);
    if (stale) return stale.data as T;
    throw error;
  }
}

async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        'user-agent': 'Prakriti/1.0 (Mumbai environmental intelligence; https://github.com/varunshah5698/PRAKRUTI_HACKOPS2.0)',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw unavailable('The open-data provider did not respond in time. Try again shortly.');
  }
  if (!response.ok) {
    const host = new URL(url).host;
    if (response.status === 429) {
      throw unavailable(`${host} is rate-limiting this deployment. Try again in a minute.`);
    }
    if (response.status >= 500) {
      throw unavailable(`${host} is temporarily unavailable (${response.status}). Try again shortly.`);
    }
    throw new Error(`${host} returned ${response.status}`);
  }
  return (await response.json()) as T;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function list(value: unknown): Array<number | null> {
  return Array.isArray(value) ? value.map(num) : [];
}

function timeList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function isWithinMumbaiBounds(lat: number, lng: number): boolean {
  return lat >= MUMBAI_BOUNDS.minLat && lat <= MUMBAI_BOUNDS.maxLat && lng >= MUMBAI_BOUNDS.minLng && lng <= MUMBAI_BOUNDS.maxLng;
}

export function haversineKm(a: CityPoint, b: CityPoint): number {
  const radius = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sa = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return round(2 * radius * Math.asin(Math.sqrt(sa)), 2);
}

export function assertMumbaiPoint(lat: number, lng: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isWithinMumbaiBounds(lat, lng)) {
    throw badRequest('Pick a point inside Greater Mumbai. The live-city layers cover Mumbai only.');
  }
}

function aqiFromValues(values: {
  pm25?: number | null;
  pm10?: number | null;
  no2?: number | null;
  so2?: number | null;
  co?: number | null;
  o3?: number | null;
}): AqiSummary {
  const result = calculateAqi({
    pm25: values.pm25 ?? null,
    pm10: values.pm10 ?? null,
    no2: values.no2 ?? null,
    so2: values.so2 ?? null,
    // CAMS returns CO in µg/m³; the CPCB breakpoint table is in mg/m³.
    co: values.co === null || values.co === undefined ? null : values.co / 1000,
    o3: values.o3 ?? null,
  });
  return { aqi: result.aqi, category: result.category, dominantPollutant: result.dominantPollutant };
}

interface WeatherPayload {
  latitude: number;
  longitude: number;
  timezone: string;
  current?: Record<string, unknown>;
  hourly?: Record<string, unknown>;
  daily?: Record<string, unknown>;
}

interface MetNoPayload {
  properties?: {
    meta?: { updated_at?: string };
    timeseries?: Array<{
      time: string;
      data: {
        instant?: { details?: Record<string, number> };
        next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
        next_6_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
      };
    }>;
  };
}

const MUMBAI_TZ_OFFSET_MS = 5.5 * 60 * 60_000;

/** Convert a UTC ISO instant to the local Mumbai wall-clock string used by Open-Meteo. */
function toMumbaiWall(iso: string): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return iso.slice(0, 16);
  return new Date(time + MUMBAI_TZ_OFFSET_MS).toISOString().slice(0, 16);
}

function symbolToWeatherCode(symbol?: string): number {
  if (!symbol) return 3;
  if (symbol.includes('thunder')) return 95;
  if (symbol.includes('clearsky')) return 0;
  if (symbol.includes('fair')) return 1;
  if (symbol.includes('partlycloudy')) return 2;
  if (symbol.includes('cloudy')) return 3;
  if (symbol.includes('fog')) return 45;
  if (symbol.includes('heavyrain')) return 65;
  if (symbol.includes('lightrain')) return 61;
  if (symbol.includes('rainshowers')) return symbol.includes('heavy') ? 82 : 63;
  if (symbol.includes('sleet')) return 66;
  if (symbol.includes('snow')) return 73;
  if (symbol.includes('rain')) return 63;
  return 3;
}

function apparentTemperature(celsius: number, humidity: number, windKmh: number): number {
  const vapourPressure = (Math.min(100, Math.max(0, humidity)) / 100) * 6.105 * Math.exp((17.27 * celsius) / (237.7 + celsius));
  return round(celsius + 0.33 * vapourPressure - 0.7 * (Math.max(0, windKmh) / 3.6) - 4, 1);
}

function sunTimes(date: string, lat: number, lng: number): { sunrise: string; sunset: string } {
  // Compact NOAA-style approximation. Mumbai has no daylight-saving offset, so
  // the IST correction is a fixed longitude shift from the 82.5°E meridian.
  const [year, month, day] = date.split('-').map(Number);
  const start = Date.UTC(year, month - 1, day);
  const dayOfYear = Math.floor((start - Date.UTC(year, 0, 0)) / 86_400_000);
  const declination = 23.44 * Math.sin((2 * Math.PI * (dayOfYear - 81)) / 365);
  const latitudeRad = (lat * Math.PI) / 180;
  const declinationRad = (declination * Math.PI) / 180;
  const cosHour = -Math.tan(latitudeRad) * Math.tan(declinationRad);
  const hourAngle = Math.acos(Math.max(-1, Math.min(1, cosHour))) * (180 / Math.PI);
  const solarNoonMinutes = 12 * 60 + (82.5 - lng) * 4;
  const sunriseMinutes = solarNoonMinutes - (hourAngle / 15) * 60;
  const sunsetMinutes = solarNoonMinutes + (hourAngle / 15) * 60;
  const asClock = (minutes: number) => {
    const safe = ((Math.round(minutes) % 1440) + 1440) % 1440;
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  };
  return { sunrise: `${date}T${asClock(sunriseMinutes)}`, sunset: `${date}T${asClock(sunsetMinutes)}` };
}

/**
 * Keyless fallback used only when the Open-Meteo forecast endpoint is
 * rate-limited. MET Norway is an open national weather service; its compact
 * forecast does not publish UV or probability, so those fields stay null
 * rather than being fabricated.
 */
async function fetchMetNoWeather(point: CityPoint): Promise<WeatherPayload> {
  const url = new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact');
  url.searchParams.set('lat', String(point.lat));
  url.searchParams.set('lon', String(point.lng));
  const payload = await fetchJson<MetNoPayload>(url.toString(), {}, 8_000);
  const series = payload.properties?.timeseries ?? [];
  if (series.length === 0) throw unavailable('MET Norway returned no forecast for this point.');

  const rows = series.slice(0, 120).map((entry) => {
    const details = entry.data.instant?.details ?? {};
    const symbol = entry.data.next_1_hours?.summary?.symbol_code ?? entry.data.next_6_hours?.summary?.symbol_code;
    const localTime = toMumbaiWall(entry.time);
    const hour = Number(localTime.slice(11, 13));
    const temperature = num(details.air_temperature);
    const humidity = num(details.relative_humidity);
    const wind = num(details.wind_speed);
    return {
      time: localTime,
      temperature,
      humidity,
      windKmh: wind === null ? null : round(wind * 3.6, 1),
      windDirection: num(details.wind_from_direction),
      pressure: num(details.air_pressure_at_sea_level),
      cloud: num(details.cloud_area_fraction),
      precipitation: num(entry.data.next_1_hours?.details?.precipitation_amount) ?? num(entry.data.next_6_hours?.details?.precipitation_amount),
      weatherCode: symbolToWeatherCode(symbol),
      isDay: symbol ? !symbol.endsWith('_night') : hour >= 6 && hour < 19,
      apparent: temperature === null ? null : apparentTemperature(temperature, humidity ?? 0, (wind ?? 0) * 3.6),
    };
  });

  const current = rows[0];
  const dailyMap = new Map<string, typeof rows>();
  for (const row of rows) {
    const date = row.time.slice(0, 10);
    const bucket = dailyMap.get(date) ?? [];
    bucket.push(row);
    dailyMap.set(date, bucket);
  }
  const dailyDates = [...dailyMap.keys()].slice(0, 7);
  const sun = Object.fromEntries(dailyDates.map((date) => [date, sunTimes(date, point.lat, point.lng)]));

  return {
    latitude: point.lat,
    longitude: point.lng,
    timezone: 'Asia/Kolkata',
    current: {
      time: current.time,
      temperature_2m: current.temperature,
      relative_humidity_2m: current.humidity,
      apparent_temperature: current.apparent,
      precipitation: current.precipitation,
      rain: current.precipitation,
      weather_code: current.weatherCode,
      cloud_cover: current.cloud,
      wind_speed_10m: current.windKmh,
      wind_direction_10m: current.windDirection,
      wind_gusts_10m: null,
      uv_index: null,
      is_day: current.isDay ? 1 : 0,
      surface_pressure: current.pressure,
    },
    hourly: {
      time: rows.map((row) => row.time),
      temperature_2m: rows.map((row) => row.temperature),
      relative_humidity_2m: rows.map((row) => row.humidity),
      apparent_temperature: rows.map((row) => row.apparent),
      precipitation_probability: rows.map(() => null),
      precipitation: rows.map((row) => row.precipitation),
      weather_code: rows.map((row) => row.weatherCode),
      cloud_cover: rows.map((row) => row.cloud),
      wind_speed_10m: rows.map((row) => row.windKmh),
      wind_direction_10m: rows.map((row) => row.windDirection),
      wind_gusts_10m: rows.map(() => null),
      uv_index: rows.map(() => null),
      is_day: rows.map((row) => (row.isDay ? 1 : 0)),
    },
    daily: {
      time: dailyDates,
      weather_code: dailyDates.map((date) => dailyMap.get(date)?.find((row) => row.time.includes('T12:'))?.weatherCode ?? dailyMap.get(date)?.[0]?.weatherCode ?? null),
      temperature_2m_max: dailyDates.map((date) => {
        const values = (dailyMap.get(date) ?? []).flatMap((row) => (row.temperature === null ? [] : [row.temperature]));
        return values.length ? Math.max(...values) : null;
      }),
      temperature_2m_min: dailyDates.map((date) => {
        const values = (dailyMap.get(date) ?? []).flatMap((row) => (row.temperature === null ? [] : [row.temperature]));
        return values.length ? Math.min(...values) : null;
      }),
      apparent_temperature_max: dailyDates.map(() => null),
      apparent_temperature_min: dailyDates.map(() => null),
      sunrise: dailyDates.map((date) => sun[date]?.sunrise ?? null),
      sunset: dailyDates.map((date) => sun[date]?.sunset ?? null),
      uv_index_max: dailyDates.map(() => null),
      precipitation_probability_max: dailyDates.map(() => null),
      precipitation_sum: dailyDates.map((date) => {
        const values = (dailyMap.get(date) ?? []).flatMap((row) => (row.precipitation === null ? [] : [row.precipitation]));
        return values.length ? round(values.reduce((sum, value) => sum + value, 0), 1) : null;
      }),
      wind_speed_10m_max: dailyDates.map((date) => {
        const values = (dailyMap.get(date) ?? []).flatMap((row) => (row.windKmh === null ? [] : [row.windKmh]));
        return values.length ? Math.max(...values) : null;
      }),
      wind_gusts_10m_max: dailyDates.map(() => null),
    },
  };
}

async function fetchWeather(point: CityPoint): Promise<{ payload: WeatherPayload; provider: 'open-meteo' | 'met-no' }> {
  try {
    return { payload: await fetchJson<WeatherPayload>(weatherUrl(point), {}, 8_000), provider: 'open-meteo' };
  } catch (error) {
    console.warn('[city] Open-Meteo forecast unavailable; trying MET Norway fallback.', error instanceof Error ? error.message : error);
    return { payload: await fetchMetNoWeather(point), provider: 'met-no' };
  }
}

interface AirPayload {
  latitude: number;
  longitude: number;
  current?: Record<string, unknown>;
  hourly?: Record<string, unknown>;
}

function weatherUrl(point: CityPoint): string {
  const url = new URL(`${env.OPEN_METEO_BASE_URL}/v1/forecast`);
  url.searchParams.set('latitude', String(point.lat));
  url.searchParams.set('longitude', String(point.lng));
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,is_day,surface_pressure',
  );
  url.searchParams.set(
    'hourly',
    'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,is_day',
  );
  url.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,uv_index_max,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max',
  );
  url.searchParams.set('timezone', 'Asia/Kolkata');
  url.searchParams.set('forecast_days', '7');
  return url.toString();
}

function airUrl(point: CityPoint): string {
  const url = new URL(`${env.OPEN_METEO_AIR_QUALITY_BASE_URL}/v1/air-quality`);
  url.searchParams.set('latitude', String(point.lat));
  url.searchParams.set('longitude', String(point.lng));
  url.searchParams.set(
    'current',
    'pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi,european_aqi,uv_index,dust,aerosol_optical_depth',
  );
  url.searchParams.set(
    'hourly',
    'pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi,european_aqi,uv_index,dust',
  );
  url.searchParams.set('past_days', '31');
  url.searchParams.set('forecast_days', '3');
  url.searchParams.set('timezone', 'Asia/Kolkata');
  return url.toString();
}

interface DayAggregate {
  pm25Values: number[];
  aqiValues: number[];
}

function aggregateAirByDate(hourly: Record<string, unknown> | undefined): Map<string, DayAggregate> {
  const out = new Map<string, DayAggregate>();
  if (!hourly) return out;
  const times = timeList(hourly.time);
  const pm25 = list(hourly.pm2_5);
  const pm10 = list(hourly.pm10);
  const no2 = list(hourly.nitrogen_dioxide);
  const so2 = list(hourly.sulphur_dioxide);
  const co = list(hourly.carbon_monoxide);
  const o3 = list(hourly.ozone);
  for (let index = 0; index < times.length; index += 1) {
    const time = times[index];
    if (!time) continue;
    const date = time.slice(0, 10);
    const bucket = out.get(date) ?? { pm25Values: [], aqiValues: [] };
    const pm25Value = pm25[index] ?? null;
    if (pm25Value !== null) bucket.pm25Values.push(pm25Value);
    const summary = aqiFromValues({
      pm25: pm25Value,
      pm10: pm10[index] ?? null,
      no2: no2[index] ?? null,
      so2: so2[index] ?? null,
      co: co[index] ?? null,
      o3: o3[index] ?? null,
    });
    if (summary.aqi !== null) bucket.aqiValues.push(summary.aqi);
    out.set(date, bucket);
  }
  return out;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 1);
}

export interface CityOverview {
  generatedAt: string;
  weatherProvider: 'open-meteo' | 'met-no';
  point: CityPoint & { timezone: string };
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
    aqi: AqiSummary;
  };
  hourly: Array<{
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
  }>;
  daily: Array<{
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
  }>;
  history: Array<{
    date: string;
    pm25Mean: number | null;
    aqiMean: number | null;
    aqiMax: number | null;
    category: string;
  }>;
  sources: Array<{ id: string; label: string; url: string; license: string; note: string }>;
}

export async function getCityOverview(lat: number, lng: number): Promise<CityOverview> {
  assertMumbaiPoint(lat, lng);
  const point = { lat: round(lat, 5), lng: round(lng, 5) };
  return cached(`city:overview:${point.lat}:${point.lng}`, 5 * 60_000, async () => {
    const [weatherResult, air] = await Promise.all([
      fetchWeather(point),
      fetchJson<AirPayload>(airUrl(point)).catch(() => null),
    ]);
    const weather = weatherResult.payload;
    const weatherCurrent = weather.current;
    if (!weatherCurrent?.time) throw unavailable('Open-Meteo returned no current weather for this point.');

    const airHourly = air?.hourly;
    // Weather and CAMS can sit on :00 or :30 clocks (the MET Norway fallback
    // uses :30). Merge on the hour key so a half-hour offset does not blank the
    // air series.
    const airByHour = new Map<string, number>();
    if (airHourly) {
      const times = timeList(airHourly.time);
      times.forEach((time, index) => airByHour.set(time.slice(0, 13), index));
    }
    const airDates = aggregateAirByDate(airHourly);
    const airTimes = airHourly ? timeList(airHourly.time) : [];
    const airPm25 = airHourly ? list(airHourly.pm2_5) : [];
    const airPm10 = airHourly ? list(airHourly.pm10) : [];
    const airNo2 = airHourly ? list(airHourly.nitrogen_dioxide) : [];
    const airSo2 = airHourly ? list(airHourly.sulphur_dioxide) : [];
    const airCo = airHourly ? list(airHourly.carbon_monoxide) : [];
    const airO3 = airHourly ? list(airHourly.ozone) : [];
    const airUsAqi = airHourly ? list(airHourly.us_aqi) : [];

    const hourlyTime = timeList(weather.hourly?.time);
    const hourlyTemp = list(weather.hourly?.temperature_2m);
    const hourlyApparent = list(weather.hourly?.apparent_temperature);
    const hourlyHumidity = list(weather.hourly?.relative_humidity_2m);
    const hourlyPrecipProbability = list(weather.hourly?.precipitation_probability);
    const hourlyPrecip = list(weather.hourly?.precipitation);
    const hourlyCode = list(weather.hourly?.weather_code);
    const hourlyCloud = list(weather.hourly?.cloud_cover);
    const hourlyWind = list(weather.hourly?.wind_speed_10m);
    const hourlyWindDirection = list(weather.hourly?.wind_direction_10m);
    const hourlyGusts = list(weather.hourly?.wind_gusts_10m);
    const hourlyUv = list(weather.hourly?.uv_index);
    const hourlyIsDay = weather.hourly?.is_day;

    const currentHourKey = `${String(weatherCurrent.time).slice(0, 13)}:00`;
    const start = Math.max(0, hourlyTime.findIndex((time) => time >= currentHourKey));
    const hourly = hourlyTime.slice(start, start + 72).map((time, offset) => {
      const index = start + offset;
      const airIndex = airByHour.get(time.slice(0, 13));
      const summary = aqiFromValues({
        pm25: airIndex === undefined ? null : airPm25[airIndex] ?? null,
        pm10: airIndex === undefined ? null : airPm10[airIndex] ?? null,
        no2: airIndex === undefined ? null : airNo2[airIndex] ?? null,
        so2: airIndex === undefined ? null : airSo2[airIndex] ?? null,
        co: airIndex === undefined ? null : airCo[airIndex] ?? null,
        o3: airIndex === undefined ? null : airO3[airIndex] ?? null,
      });
      return {
        time,
        temperatureC: hourlyTemp[index] ?? null,
        apparentTemperatureC: hourlyApparent[index] ?? null,
        relativeHumidity: hourlyHumidity[index] ?? null,
        precipitationProbability: hourlyPrecipProbability[index] ?? null,
        precipitationMm: hourlyPrecip[index] ?? null,
        weatherCode: hourlyCode[index] ?? null,
        cloudCover: hourlyCloud[index] ?? null,
        windSpeedKmh: hourlyWind[index] ?? null,
        windDirectionDeg: hourlyWindDirection[index] ?? null,
        windGustsKmh: hourlyGusts[index] ?? null,
        uvIndex: hourlyUv[index] ?? null,
        isDay: Array.isArray(hourlyIsDay) ? Boolean(hourlyIsDay[index]) : null,
        pm25: airIndex === undefined ? null : airPm25[airIndex] ?? null,
        pm10: airIndex === undefined ? null : airPm10[airIndex] ?? null,
        no2: airIndex === undefined ? null : airNo2[airIndex] ?? null,
        so2: airIndex === undefined ? null : airSo2[airIndex] ?? null,
        co: airIndex === undefined ? null : airCo[airIndex] ?? null,
        o3: airIndex === undefined ? null : airO3[airIndex] ?? null,
        usAqi: airIndex === undefined ? null : airUsAqi[airIndex] ?? null,
        aqi: summary.aqi,
        aqiCategory: summary.category,
        dominantPollutant: summary.dominantPollutant,
      };
    });

    const dailyTime = timeList(weather.daily?.time);
    const daily = dailyTime.map((date, index) => {
      const aggregate = airDates.get(date);
      return {
        date,
        weatherCode: list(weather.daily?.weather_code)[index] ?? null,
        temperatureMaxC: list(weather.daily?.temperature_2m_max)[index] ?? null,
        temperatureMinC: list(weather.daily?.temperature_2m_min)[index] ?? null,
        apparentMaxC: list(weather.daily?.apparent_temperature_max)[index] ?? null,
        apparentMinC: list(weather.daily?.apparent_temperature_min)[index] ?? null,
        sunrise: timeList(weather.daily?.sunrise)[index] ?? null,
        sunset: timeList(weather.daily?.sunset)[index] ?? null,
        uvIndexMax: list(weather.daily?.uv_index_max)[index] ?? null,
        precipitationProbabilityMax: list(weather.daily?.precipitation_probability_max)[index] ?? null,
        precipitationSumMm: list(weather.daily?.precipitation_sum)[index] ?? null,
        windSpeedMaxKmh: list(weather.daily?.wind_speed_10m_max)[index] ?? null,
        windGustsMaxKmh: list(weather.daily?.wind_gusts_10m_max)[index] ?? null,
        pm25Mean: mean(aggregate?.pm25Values ?? []),
        aqiMean: mean(aggregate?.aqiValues ?? []),
        aqiMax: aggregate?.aqiValues.length ? Math.max(...aggregate.aqiValues) : null,
      };
    });

    const today = String(weatherCurrent.time).slice(0, 10);
    const history = [...airDates.entries()]
      .filter(([date]) => date < today)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, aggregate]) => {
        const aqiMax = aggregate.aqiValues.length ? Math.max(...aggregate.aqiValues) : null;
        return {
          date,
          pm25Mean: mean(aggregate.pm25Values),
          aqiMean: mean(aggregate.aqiValues),
          aqiMax,
          category: aqiCategory(aqiMax),
        };
      });

    const airCurrent = air?.current ?? {};
    const currentAqi = aqiFromValues({
      pm25: num(airCurrent.pm2_5),
      pm10: num(airCurrent.pm10),
      no2: num(airCurrent.nitrogen_dioxide),
      so2: num(airCurrent.sulphur_dioxide),
      co: num(airCurrent.carbon_monoxide),
      o3: num(airCurrent.ozone),
    });

    return {
      generatedAt: new Date().toISOString(),
      weatherProvider: weatherResult.provider,
      point: { ...point, timezone: weather.timezone ?? 'Asia/Kolkata' },
      current: {
        time: weatherCurrent.time ? String(weatherCurrent.time) : null,
        temperatureC: num(weatherCurrent.temperature_2m),
        apparentTemperatureC: num(weatherCurrent.apparent_temperature),
        relativeHumidity: num(weatherCurrent.relative_humidity_2m),
        precipitationMm: num(weatherCurrent.precipitation),
        rainMm: num(weatherCurrent.rain),
        weatherCode: num(weatherCurrent.weather_code),
        cloudCover: num(weatherCurrent.cloud_cover),
        windSpeedKmh: num(weatherCurrent.wind_speed_10m),
        windDirectionDeg: num(weatherCurrent.wind_direction_10m),
        windGustsKmh: num(weatherCurrent.wind_gusts_10m),
        uvIndex: num(weatherCurrent.uv_index),
        pressureHpa: num(weatherCurrent.surface_pressure),
        isDay: typeof weatherCurrent.is_day === 'number' ? Boolean(weatherCurrent.is_day) : null,
      },
      air: {
        time: airCurrent.time ? String(airCurrent.time) : null,
        pm25: num(airCurrent.pm2_5),
        pm10: num(airCurrent.pm10),
        co: num(airCurrent.carbon_monoxide),
        no2: num(airCurrent.nitrogen_dioxide),
        so2: num(airCurrent.sulphur_dioxide),
        o3: num(airCurrent.ozone),
        usAqi: num(airCurrent.us_aqi),
        europeanAqi: num(airCurrent.european_aqi),
        dust: num(airCurrent.dust),
        aerosolOpticalDepth: num(airCurrent.aerosol_optical_depth),
        aqi: currentAqi,
      },
      hourly,
      daily,
      history,
      sources: [
        weatherResult.provider === 'met-no'
          ? {
              id: 'met-no-weather',
              label: 'MET Norway location forecast',
              url: 'https://api.met.no/',
              license: 'CC BY 4.0 / NLOD',
              note: 'Fallback used because the Open-Meteo forecast endpoint was unavailable. UV and probability stay blank when the provider does not publish them.',
            }
          : {
              id: 'open-meteo-weather',
              label: 'Open-Meteo forecast',
              url: 'https://open-meteo.com/en/docs',
              license: 'CC BY 4.0',
              note: 'Weather, UV and 7-day forecast. No API key.',
            },
        {
          id: 'open-meteo-cams',
          label: 'CAMS air quality via Open-Meteo',
          url: 'https://open-meteo.com/en/docs/air-quality-api',
          license: 'CAMS / CC BY 4.0',
          note: 'Modelled regional air quality, not a station measurement.',
        },
      ],
    };
  });
}

export interface PlaceResult {
  id: string;
  name: string;
  label: string;
  lat: number;
  lng: number;
  kind: string;
  provider: string;
}

interface NominatimResult {
  place_id: number;
  name?: string;
  display_name?: string;
  lat: string;
  lon: string;
  addresstype?: string;
  address?: Record<string, string>;
}

interface OpenMeteoPlace {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country_code?: string;
  admin1?: string;
  admin2?: string;
  feature_code?: string;
}

export async function searchPlaces(query: string): Promise<{ query: string; provider: string; results: PlaceResult[] }> {
  const clean = query.trim().slice(0, 80);
  if (clean.length < 2) return { query: clean, provider: 'none', results: [] };
  return cached(`city:places:${clean.toLowerCase()}`, 60 * 60_000, async () => {
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('q', clean);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('countrycodes', 'in');
      url.searchParams.set('viewbox', '72.70,19.40,73.05,18.85');
      url.searchParams.set('bounded', '1');
      url.searchParams.set('limit', '10');
      const rows = await fetchJson<NominatimResult[]>(url.toString(), {}, 12_000);
      const seen = new Set<string>();
      const results = rows
        .flatMap((row) => {
          const lat = Number(row.lat);
          const lng = Number(row.lon);
          if (!isWithinMumbaiBounds(lat, lng)) return [];
          const name = (row.name || row.display_name?.split(',')[0] || '').trim();
          if (!name) return [];
          const key = `${name}:${lat.toFixed(3)}:${lng.toFixed(3)}`;
          if (seen.has(key)) return [];
          seen.add(key);
          const label = [row.address?.suburb, row.address?.city_district, row.address?.city]
            .filter(Boolean)
            .filter((part, index, all) => all.indexOf(part) === index)
            .join(' · ');
          return [{ id: `osm-${row.place_id}`, name, label: label || 'Mumbai', lat: round(lat, 5), lng: round(lng, 5), kind: row.addresstype ?? 'place', provider: 'OpenStreetMap Nominatim' }];
        })
        .slice(0, 6);
      if (results.length > 0) return { query: clean, provider: 'OpenStreetMap Nominatim', results };
    } catch {
      // Fall through to the geocoder below.
    }

    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', clean);
    url.searchParams.set('count', '20');
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');
    const payload = await fetchJson<{ results?: OpenMeteoPlace[] }>(url.toString(), {}, 12_000);
    const seen = new Set<string>();
    const results = (payload.results ?? [])
      .filter((row) => row.country_code === 'IN' && isWithinMumbaiBounds(row.latitude, row.longitude))
      .flatMap((row) => {
        const key = `${row.name}:${row.latitude.toFixed(3)}:${row.longitude.toFixed(3)}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{
          id: `om-${row.id}`,
          name: row.name,
          label: [row.admin2, row.admin1].filter(Boolean).join(' · ') || 'India',
          lat: round(row.latitude, 5),
          lng: round(row.longitude, 5),
          kind: row.feature_code ?? 'place',
          provider: 'Open-Meteo geocoding',
        }];
      })
      .slice(0, 6);
    return { query: clean, provider: 'Open-Meteo geocoding', results };
  });
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
  aqi: AqiSummary;
}

export async function comparePoints(points: CityPoint[]): Promise<CityComparisonRow[]> {
  if (points.length === 0) return [];
  if (points.length > 6) throw badRequest('Compare at most six points at a time.');
  for (const point of points) assertMumbaiPoint(point.lat, point.lng);
  const key = `city:compare:${points.map((point) => `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`).join('|')}`;
  return cached(key, 10 * 60_000, async () => {
    const lat = points.map((point) => point.lat).join(',');
    const lng = points.map((point) => point.lng).join(',');
    const weatherUrl = new URL(`${env.OPEN_METEO_BASE_URL}/v1/forecast`);
    weatherUrl.searchParams.set('latitude', lat);
    weatherUrl.searchParams.set('longitude', lng);
    weatherUrl.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m');
    weatherUrl.searchParams.set('timezone', 'Asia/Kolkata');
    const airUrl = new URL(`${env.OPEN_METEO_AIR_QUALITY_BASE_URL}/v1/air-quality`);
    airUrl.searchParams.set('latitude', lat);
    airUrl.searchParams.set('longitude', lng);
    airUrl.searchParams.set('current', 'pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,ozone');
    airUrl.searchParams.set('timezone', 'Asia/Kolkata');
    const [weather, air] = await Promise.all([
      fetchJson<WeatherPayload | WeatherPayload[]>(weatherUrl.toString()),
      fetchJson<AirPayload | AirPayload[]>(airUrl.toString()),
    ]);
    const weatherRows = Array.isArray(weather) ? weather : [weather];
    const airRows = Array.isArray(air) ? air : [air];
    return points.map((point, index) => {
      const weatherCurrent = weatherRows[index]?.current ?? {};
      const airCurrent = airRows[index]?.current ?? {};
      return {
        lat: point.lat,
        lng: point.lng,
        temperatureC: num(weatherCurrent.temperature_2m),
        apparentTemperatureC: num(weatherCurrent.apparent_temperature),
        relativeHumidity: num(weatherCurrent.relative_humidity_2m),
        weatherCode: num(weatherCurrent.weather_code),
        windSpeedKmh: num(weatherCurrent.wind_speed_10m),
        pm25: num(airCurrent.pm2_5),
        pm10: num(airCurrent.pm10),
        aqi: aqiFromValues({
          pm25: num(airCurrent.pm2_5),
          pm10: num(airCurrent.pm10),
          no2: num(airCurrent.nitrogen_dioxide),
          so2: num(airCurrent.sulphur_dioxide),
          co: num(airCurrent.carbon_monoxide),
          o3: num(airCurrent.ozone),
        }),
      };
    });
  });
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

export async function getMarine(lat: number, lng: number): Promise<MarineConditions> {
  assertMumbaiPoint(lat, lng);
  return cached(`city:marine:${lat.toFixed(4)}:${lng.toFixed(4)}`, 30 * 60_000, async () => {
    const url = new URL('https://marine-api.open-meteo.com/v1/marine');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lng));
    url.searchParams.set('current', 'wave_height,wave_direction,wave_period,swell_wave_height,sea_surface_temperature,ocean_current_velocity');
    url.searchParams.set('hourly', 'wave_height,sea_surface_temperature');
    url.searchParams.set('timezone', 'Asia/Kolkata');
    url.searchParams.set('forecast_days', '3');
    const payload = await fetchJson<WeatherPayload>(url.toString(), {}, 10_000);
    const current = payload.current ?? {};
    const times = timeList(payload.hourly?.time);
    const waves = list(payload.hourly?.wave_height);
    const seaTemps = list(payload.hourly?.sea_surface_temperature);
    const nowKey = current.time ? String(current.time).slice(0, 13) : '';
    const start = Math.max(0, times.findIndex((time) => time.slice(0, 13) >= nowKey));
    return {
      generatedAt: new Date().toISOString(),
      current: {
        time: current.time ? String(current.time) : null,
        waveHeightM: num(current.wave_height),
        waveDirectionDeg: num(current.wave_direction),
        wavePeriodS: num(current.wave_period),
        swellHeightM: num(current.swell_wave_height),
        seaSurfaceTemperatureC: num(current.sea_surface_temperature),
        currentVelocityKmh: num(current.ocean_current_velocity),
      },
      hourly: times.slice(start, start + 24).map((time, offset) => ({
        time,
        waveHeightM: waves[start + offset] ?? null,
        seaSurfaceTemperatureC: seaTemps[start + offset] ?? null,
      })),
      source: {
        label: 'Open-Meteo Marine API',
        url: 'https://open-meteo.com/en/docs/marine-weather-api',
        note: 'Global wave model at the nearest sea grid point. Not a harbour or tide observation.',
      },
    };
  });
}

export interface FloodConditions {
  generatedAt: string;
  current: { date: string | null; dischargeM3s: number | null; meanM3s: number | null; maxM3s: number | null };
  days: Array<{ date: string; dischargeM3s: number | null; meanM3s: number | null; maxM3s: number | null }>;
  band: 'NO DATA' | 'TYPICAL' | 'WATCH' | 'ELEVATED';
  note: string;
  source: { label: string; url: string };
}

export function classifyDischarge(current: number | null, mean: number | null, max: number | null): FloodConditions['band'] {
  if (current === null || mean === null) return 'NO DATA';
  if (current > mean * 2 || (max !== null && current > max * 0.9)) return 'ELEVATED';
  if (current > mean * 1.25) return 'WATCH';
  return 'TYPICAL';
}

export async function getFlood(lat: number, lng: number): Promise<FloodConditions> {
  assertMumbaiPoint(lat, lng);
  return cached(`city:flood:${lat.toFixed(3)}:${lng.toFixed(3)}`, 60 * 60_000, async () => {
    const url = new URL('https://flood-api.open-meteo.com/v1/flood');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lng));
    url.searchParams.set('daily', 'river_discharge,river_discharge_mean,river_discharge_max');
    url.searchParams.set('past_days', '7');
    url.searchParams.set('forecast_days', '14');
    const payload = await fetchJson<WeatherPayload>(url.toString(), {}, 10_000);
    const dates = timeList(payload.daily?.time);
    const discharge = list(payload.daily?.river_discharge);
    const means = list(payload.daily?.river_discharge_mean);
    const maxima = list(payload.daily?.river_discharge_max);
    const days = dates.map((date, index) => ({
      date,
      dischargeM3s: discharge[index] ?? null,
      meanM3s: means[index] ?? null,
      maxM3s: maxima[index] ?? null,
    }));
    const today = new Date().toISOString().slice(0, 10);
    const current = days.find((day) => day.date === today) ?? days.find((day) => day.date >= today) ?? days.at(-1) ?? null;
    const max = current?.maxM3s ?? null;
    const band = classifyDischarge(current?.dischargeM3s ?? null, current?.meanM3s ?? null, max);
    return {
      generatedAt: new Date().toISOString(),
      current: {
        date: current?.date ?? null,
        dischargeM3s: current?.dischargeM3s ?? null,
        meanM3s: current?.meanM3s ?? null,
        maxM3s: max,
      },
      days,
      band,
      note: 'Indicative modelled river discharge at the nearest global grid cell. It is not an official flood warning, tide gauge or municipal drain reading.',
      source: { label: 'Open-Meteo Flood API', url: 'https://open-meteo.com/en/docs/flood-api' },
    };
  });
}

interface OverpassElement {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface NearbyPlace {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  distanceKm: number;
}

export async function getNearbyNature(lat: number, lng: number): Promise<{ items: NearbyPlace[]; source: string; note: string }> {
  assertMumbaiPoint(lat, lng);
  return cached(`city:nearby:${lat.toFixed(3)}:${lng.toFixed(3)}`, 30 * 60_000, async () => {
    // Nominatim is the dependable path: one bounded free-text search around the
    // point, sorted locally by distance. Overpass is richer but frequently at
    // capacity, so it is only a fallback when Nominatim returns nothing.
    const delta = 0.04;
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', 'park');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('countrycodes', 'in');
    url.searchParams.set('viewbox', `${(lng - delta).toFixed(4)},${(lat + delta).toFixed(4)},${(lng + delta).toFixed(4)},${(lat - delta).toFixed(4)}`);
    url.searchParams.set('bounded', '1');
    url.searchParams.set('limit', '25');
    let items: NearbyPlace[] = [];
    let source = 'OpenStreetMap Nominatim';
    try {
      const rows = await fetchJson<Array<NominatimResult & { type?: string }>>(url.toString(), {}, 12_000);
      const seen = new Set<string>();
      items = rows
        .flatMap((row) => {
          const name = (row.name || '').trim();
          const placeLat = Number(row.lat);
          const placeLng = Number(row.lon);
          if (!name || name.length < 3 || name.toLowerCase() === 'park' || !isWithinMumbaiBounds(placeLat, placeLng)) return [];
          const key = `${name.toLowerCase()}:${placeLat.toFixed(3)}:${placeLng.toFixed(3)}`;
          if (seen.has(key)) return [];
          seen.add(key);
          const rawType = (row.type ?? row.addresstype ?? 'park').replace(/_/g, ' ');
          const kind = /water|lake|river|pond/i.test(`${rawType} ${name}`) ? 'water' : /garden/i.test(`${rawType} ${name}`) ? 'garden' : 'park';
          return [{
            id: `osm-${row.place_id}`,
            name,
            kind,
            lat: round(placeLat, 5),
            lng: round(placeLng, 5),
            distanceKm: haversineKm({ lat, lng }, { lat: placeLat, lng: placeLng }),
          }];
        })
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 6);
    } catch {
      // Fall through to the Overpass fallback below.
    }

    if (items.length === 0) {
      const query = `[out:json][timeout:20];(
        node["leisure"~"^(park|garden|nature_reserve)$"](around:4000,${lat},${lng});
        way["leisure"~"^(park|garden|nature_reserve)$"](around:4000,${lat},${lng});
        way["natural"="water"]["name"](around:4000,${lat},${lng});
      );out center tags 60;`;
      const body = new URLSearchParams({ data: query }).toString();
      const hosts = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
      for (const host of hosts) {
        try {
          const payload = await fetchJson<{ elements: OverpassElement[] }>(
            host,
            { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body },
            10_000,
          );
          const seen = new Set<string>();
          items = (payload.elements ?? [])
            .flatMap((element) => {
              const name = element.tags?.name?.trim();
              const point = element.center ?? (element.lat !== undefined && element.lon !== undefined ? { lat: element.lat, lon: element.lon } : null);
              if (!name || !point) return [];
              const key = `${name}:${point.lat.toFixed(3)}:${point.lon.toFixed(3)}`;
              if (seen.has(key)) return [];
              seen.add(key);
              const kind = element.tags?.natural === 'water' ? 'water' : element.tags?.leisure ?? 'park';
              return [{
                id: `osm-${element.type}-${element.id}`,
                name,
                kind,
                lat: round(point.lat, 5),
                lng: round(point.lon, 5),
                distanceKm: haversineKm({ lat, lng }, { lat: point.lat, lng: point.lon }),
              }];
            })
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .slice(0, 6);
          if (items.length > 0) {
            source = 'OpenStreetMap Overpass API';
            break;
          }
        } catch {
          // Try the next mirror.
        }
      }
    }

    return {
      items,
      source,
      note: 'Parks, gardens and named green/water places mapped by OpenStreetMap contributors within roughly 4 km. This is not an official park inventory.',
    };
  });
}

export interface WalkRoute {
  distanceKm: number;
  minutes: number;
  mode: 'pedestrian';
  provider: string;
  note: string;
}

export async function getWalkRoute(from: CityPoint, to: CityPoint): Promise<WalkRoute> {
  assertMumbaiPoint(from.lat, from.lng);
  assertMumbaiPoint(to.lat, to.lng);
  return cached(`city:route:${from.lat.toFixed(4)}:${from.lng.toFixed(4)}:${to.lat.toFixed(4)}:${to.lng.toFixed(4)}`, 30 * 60_000, async () => {
    const payload = await fetchJson<{
      trip?: { summary?: { length?: number; time?: number } };
    }>(
      'https://valhalla1.openstreetmap.de/route',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          locations: [{ lat: from.lat, lon: from.lng }, { lat: to.lat, lon: to.lng }],
          costing: 'pedestrian',
          directions_options: { units: 'kilometers' },
        }),
      },
      20_000,
    );
    const summary = payload.trip?.summary;
    if (!summary || typeof summary.length !== 'number' || typeof summary.time !== 'number') {
      throw unavailable('The walking router returned no route for this pair of points.');
    }
    return {
      distanceKm: round(summary.length, 2),
      minutes: Math.max(1, Math.round(summary.time / 60)),
      mode: 'pedestrian',
      provider: 'Valhalla / OpenStreetMap',
      note: 'Pedestrian estimate from the public Valhalla router. Roads, access restrictions and construction can change the real walk.',
    };
  });
}

interface EonetEvent {
  id: string;
  title: string;
  link?: string;
  closed?: string | null;
  categories?: Array<{ title?: string }>;
  sources?: Array<{ url?: string }>;
  geometry?: Array<{ date?: string; type?: string; coordinates?: number[] }>;
}

interface UsgsFeature {
  id: string;
  properties: { mag?: number; place?: string; time?: number; url?: string; title?: string };
  geometry?: { coordinates?: number[] };
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

export async function getPlanetEvents(lat: number, lng: number): Promise<{ events: PlanetEvent[]; earthquakes: PlanetEvent[]; sources: Array<{ label: string; url: string }> }> {
  assertMumbaiPoint(lat, lng);
  return cached(`city:events:${lat.toFixed(3)}:${lng.toFixed(3)}`, 30 * 60_000, async () => {
    const [eonet, quakes] = await Promise.allSettled([
      fetchJson<{ events?: EonetEvent[] }>('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&bbox=68,6,98,36', {}, 15_000),
      fetchJson<{ features?: UsgsFeature[] }>('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson', {}, 15_000),
    ]);

    const events = eonet.status === 'fulfilled'
      ? (eonet.value.events ?? [])
          .flatMap((event) => {
            const geometry = event.geometry?.at(-1);
            const coordinates = geometry?.coordinates;
            if (!coordinates || coordinates.length < 2) return [];
            const [eventLng, eventLat] = coordinates;
            if (!isWithinIndiaBbox(eventLat, eventLng)) return [];
            return [{
              id: event.id,
              title: event.title,
              kind: event.categories?.[0]?.title ?? 'Natural event',
              date: geometry?.date ?? null,
              lat: eventLat,
              lng: eventLng,
              magnitude: null,
              url: event.sources?.[0]?.url ?? event.link ?? null,
              distanceKm: haversineKm({ lat, lng }, { lat: eventLat, lng: eventLng }),
              provider: 'NASA EONET',
            }];
          })
          .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
          .slice(0, 8)
      : [];

    const earthquakes = quakes.status === 'fulfilled'
      ? (quakes.value.features ?? [])
          .flatMap((feature) => {
            const coordinates = feature.geometry?.coordinates;
            if (!coordinates || coordinates.length < 2) return [];
            const [eventLng, eventLat] = coordinates;
            if (!isWithinIndiaBbox(eventLat, eventLng)) return [];
            return [{
              id: feature.id,
              title: feature.properties.title ?? feature.properties.place ?? 'Earthquake',
              kind: 'Earthquake',
              date: feature.properties.time ? new Date(feature.properties.time).toISOString() : null,
              lat: eventLat,
              lng: eventLng,
              magnitude: feature.properties.mag ?? null,
              url: feature.properties.url ?? null,
              distanceKm: haversineKm({ lat, lng }, { lat: eventLat, lng: eventLng }),
              provider: 'USGS',
            }];
          })
          .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
          .slice(0, 8)
      : [];

    return {
      events,
      earthquakes,
      sources: [
        { label: 'NASA EONET', url: 'https://eonet.gsfc.nasa.gov/' },
        { label: 'USGS earthquakes', url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php' },
      ],
    };
  });
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

export async function getArchiveDay(lat: number, lng: number, date: string): Promise<ArchiveDay> {
  assertMumbaiPoint(lat, lng);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('Provide the archive date as YYYY-MM-DD.');
  if (date >= new Date().toISOString().slice(0, 10)) throw badRequest('Archive dates must be in the past.');
  return cached(`city:archive:${lat.toFixed(3)}:${lng.toFixed(3)}:${date}`, 24 * 60 * 60_000, async () => {
    const url = new URL('https://archive-api.open-meteo.com/v1/archive');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lng));
    url.searchParams.set('start_date', date);
    url.searchParams.set('end_date', date);
    url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,shortwave_radiation_sum');
    url.searchParams.set('timezone', 'Asia/Kolkata');
    const payload = await fetchJson<WeatherPayload>(url.toString(), {}, 12_000);
    return {
      date,
      weatherCode: list(payload.daily?.weather_code)[0] ?? null,
      temperatureMaxC: list(payload.daily?.temperature_2m_max)[0] ?? null,
      temperatureMinC: list(payload.daily?.temperature_2m_min)[0] ?? null,
      precipitationSumMm: list(payload.daily?.precipitation_sum)[0] ?? null,
      windSpeedMaxKmh: list(payload.daily?.wind_speed_10m_max)[0] ?? null,
      shortwaveRadiationSum: list(payload.daily?.shortwave_radiation_sum)[0] ?? null,
      source: {
        label: 'Open-Meteo Historical Weather API',
        url: 'https://open-meteo.com/en/docs/historical-weather-api',
        note: 'Reanalysis data at the nearest grid point, not a past station observation.',
      },
    };
  });
}
