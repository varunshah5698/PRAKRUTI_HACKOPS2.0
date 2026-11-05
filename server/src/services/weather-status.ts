export type WeatherStatus = 'LIVE' | 'STALE' | 'UNAVAILABLE' | 'DEMO';
export type WeatherValidation = 'VALID' | 'INVALID';

export interface WeatherSourceMeta {
  provider: string;
  dataSourceType: 'CURRENT_CONDITIONS' | 'HOURLY_FORECAST' | 'SIMULATED' | 'UNKNOWN';
}

const SOURCES: Record<string, WeatherSourceMeta> = {
  'open-meteo-weather': { provider: 'Open-Meteo', dataSourceType: 'CURRENT_CONDITIONS' },
  'met-no-weather': { provider: 'MET Norway', dataSourceType: 'HOURLY_FORECAST' },
  'demo-network': { provider: 'Demo network', dataSourceType: 'SIMULATED' },
};

const LIVE_WINDOW_MS: Record<string, number> = {
  'open-meteo-weather': 90 * 60_000,
  'met-no-weather': 3 * 60 * 60_000,
  'demo-network': 30 * 60_000,
};

export function weatherRecommendation(condition: string): string {
  const text = condition.toLowerCase();
  if (text.includes('rain') || text.includes('flood')) {
    return 'Avoid low-lying roads and underpasses. Do not walk or drive through standing water. Move valuables above expected water level and follow local authority instructions.';
  }
  if (text.includes('thunder')) {
    return 'Stay indoors, away from windows and open ground. Unplug sensitive electronics. Avoid sheltering under isolated trees.';
  }
  if (text.includes('wind')) {
    return 'Secure loose outdoor objects. Stay away from trees, scaffolding and hoardings. Avoid two-wheeler travel in exposed areas.';
  }
  if (text.includes('heat')) {
    return 'Drink water frequently, avoid outdoor exertion between 12:00 and 16:00, and check on elderly neighbours. Never leave children or pets in a parked vehicle.';
  }
  if (text.includes('cold')) {
    return 'Wear warm layers, limit exposure outdoors and check on elderly or homeless neighbours.';
  }
  return 'Follow local authority guidance and avoid unnecessary exposure outdoors.';
}

export interface WeatherIntegrityInput {
  observedAt: string | null | undefined;
  fetchedAt: string | null | undefined;
  sourceId: string | null | undefined;
  isSimulated: boolean;
  demoMode: boolean;
  latitude: number | null;
  longitude: number | null;
  temperatureC: number | null;
  relativeHumidity?: number | null;
  precipitationMm: number | null;
  windSpeedKmh: number | null;
  windGustKmh?: number | null;
}

export interface WeatherIntegrity {
  status: WeatherStatus;
  provider: string | null;
  dataSourceType: WeatherSourceMeta['dataSourceType'] | null;
  fetchedAt: string | null;
  observationTime: string | null;
  forecastTime: string | null;
  isLive: boolean;
  freshnessStatus: WeatherStatus;
  validationStatus: WeatherValidation;
  latitude: number | null;
  longitude: number | null;
  errors: string[];
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function iso(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function validateWeatherReading(input: WeatherIntegrityInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input.sourceId || !SOURCES[input.sourceId]) errors.push('Unknown weather source.');
  if (!iso(input.observedAt)) errors.push('Missing or invalid observation timestamp.');
  if (!finite(input.latitude) || input.latitude < -90 || input.latitude > 90) errors.push('Invalid latitude.');
  if (!finite(input.longitude) || input.longitude < -180 || input.longitude > 180) errors.push('Invalid longitude.');
  if (input.temperatureC !== null && (!finite(input.temperatureC) || input.temperatureC < -60 || input.temperatureC > 60)) {
    errors.push('Temperature outside the accepted range.');
  }
  if (input.relativeHumidity !== null && input.relativeHumidity !== undefined && (!finite(input.relativeHumidity) || input.relativeHumidity < 0 || input.relativeHumidity > 100)) {
    errors.push('Relative humidity outside 0–100%.');
  }
  if (input.precipitationMm !== null && (!finite(input.precipitationMm) || input.precipitationMm < 0)) {
    errors.push('Precipitation must be a non-negative number.');
  }
  if (input.windSpeedKmh !== null && (!finite(input.windSpeedKmh) || input.windSpeedKmh < 0 || input.windSpeedKmh > 500)) {
    errors.push('Wind speed outside the accepted range.');
  }
  if (input.windGustKmh !== null && input.windGustKmh !== undefined && (!finite(input.windGustKmh) || input.windGustKmh < 0 || input.windGustKmh > 500)) {
    errors.push('Wind gust outside the accepted range.');
  }
  if ([input.temperatureC, input.precipitationMm, input.windSpeedKmh].every((value) => value === null)) {
    errors.push('No usable weather measurement.');
  }
  const observed = iso(input.observedAt);
  if (observed && Date.parse(observed) > Date.now() + 2 * 60 * 60_000) {
    errors.push('Observation timestamp is implausibly far in the future.');
  }
  return { valid: errors.length === 0, errors };
}

export function weatherIntegrity(input: WeatherIntegrityInput): WeatherIntegrity {
  const source = input.sourceId ? SOURCES[input.sourceId] : null;
  const observationTime = iso(input.observedAt);
  const validation = validateWeatherReading(input);
  const validationStatus: WeatherValidation = validation.valid ? 'VALID' : 'INVALID';
  const base = {
    provider: source?.provider ?? null,
    dataSourceType: source?.dataSourceType ?? null,
    fetchedAt: iso(input.fetchedAt) ?? observationTime,
    observationTime,
    forecastTime: source?.dataSourceType === 'HOURLY_FORECAST' ? observationTime : null,
    latitude: input.latitude,
    longitude: input.longitude,
    validationStatus,
    errors: validation.errors,
  };

  if (input.isSimulated) {
    return {
      ...base,
      status: input.demoMode ? 'DEMO' : 'UNAVAILABLE',
      isLive: false,
      freshnessStatus: input.demoMode ? 'DEMO' : 'UNAVAILABLE',
    };
  }
  if (!validation.valid) {
    return { ...base, status: 'UNAVAILABLE', isLive: false, freshnessStatus: 'UNAVAILABLE' };
  }
  const age = Date.now() - Date.parse(observationTime!);
  const liveWindow = LIVE_WINDOW_MS[input.sourceId!] ?? 90 * 60_000;
  const freshness: WeatherStatus = age <= liveWindow ? 'LIVE' : age <= 24 * 60 * 60_000 ? 'STALE' : 'UNAVAILABLE';
  return {
    ...base,
    status: freshness,
    isLive: freshness === 'LIVE',
    freshnessStatus: freshness,
  };
}
