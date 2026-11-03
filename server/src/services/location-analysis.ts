import { query } from '../db/pool.js';
import { getStationSeries, getStationSnapshots, getLatestWeather, type StationSnapshot, type StationValue } from './station-data.js';
import { getForecastsForStation } from './forecast-service.js';
import { compassLabel, computeSourceImpactAt, haversineMeters, type ScreenWind, type SourceContribution } from './source-impact.js';
import { isWithinMumbai } from './geo.js';

const CATEGORY_STATION_TYPE: Record<string, string | null> = {
  air: 'AIR_CAAQMS',
  water: 'WATER_SAMPLING',
  waste: null,
  industrial: 'INDUSTRIAL_STACK',
};

const STATION_TYPE_LABEL: Record<string, string> = {
  AIR_CAAQMS: 'air monitor',
  WATER_SAMPLING: 'water sampling point',
  INDUSTRIAL_STACK: 'stack monitor',
};

const POINT_ID = 'SELECTED-LOCATION';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const PLACE_CACHE_TTL_MS = 24 * 60 * 60_000;
const PLACE_ERROR_TTL_MS = 5 * 60_000;
const MAX_PLACE_CACHE = 300;

interface ReversePlace {
  name: string;
  displayName: string;
  road: string | null;
  source: string;
  fetchedAt: string;
}

interface NominatimResponse {
  name?: string;
  display_name?: string;
  address?: Record<string, string | undefined>;
}

const placeCache = new Map<string, { expires: number; value: ReversePlace | null }>();
let lastNominatimAt = 0;

export function shortPlaceName(address: Record<string, string | undefined>, fallback?: string): string {
  const candidates = [
    address.neighbourhood,
    address.suburb,
    address.quarter,
    address.village,
    address.town,
    address.city_district,
    address.city,
  ].filter((value): value is string => Boolean(value));
  const unique = [...new Set(candidates)];
  if (unique.length) return unique.slice(0, 2).join(', ');
  return fallback?.split(',')[0]?.trim() || '';
}

async function reverseGeocode(lat: number, lng: number): Promise<ReversePlace | null> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = placeCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  // Nominatim's usage policy asks for at most one request per second.
  const wait = Math.max(0, 1_100 - (Date.now() - lastNominatimAt));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNominatimAt = Date.now();

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('zoom', '16');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', 'en');

  let value: ReversePlace | null = null;
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Prakriti/1.0 (Mumbai environmental intelligence; OpenStreetMap place lookup)',
      },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) throw new Error(`Nominatim ${response.status}`);
    const data = (await response.json()) as NominatimResponse;
    const address = data.address ?? {};
    const name = shortPlaceName(address, data.display_name ?? data.name);
    if (name && data.display_name) {
      value = {
        name,
        displayName: data.display_name,
        road: address.road ?? null,
        source: 'OpenStreetMap Nominatim',
        fetchedAt: new Date().toISOString(),
      };
    }
  } catch {
    value = null;
  }

  if (placeCache.size >= MAX_PLACE_CACHE) {
    const oldest = [...placeCache.entries()].sort((a, b) => a[1].expires - b[1].expires)[0];
    if (oldest) placeCache.delete(oldest[0]);
  }
  placeCache.set(key, { expires: Date.now() + (value ? PLACE_CACHE_TTL_MS : PLACE_ERROR_TTL_MS), value });
  return value;
}

interface LocalityRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distance_m: number;
}

interface CamsRow {
  pollutant_code: string;
  value: number;
  observed_at: string;
  locality_id: string;
  locality_name: string;
}

interface ReportRow {
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

interface IncidentRow {
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

interface AlertRow {
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

export type RecommendationTone = 'urgent' | 'caution' | 'action' | 'info';

export interface LocationRecommendation {
  title: string;
  detail: string;
  tone: RecommendationTone;
}

export interface LocationStationSummary {
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
  values: Record<string, StationValue>;
}

export interface LocationWeather {
  temperatureC: number | null;
  relativeHumidity: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  precipitationMm: number | null;
  observedAt: string;
  sourceId: string;
}

export interface LocationCams {
  localityName: string;
  pm25: number | null;
  pm10: number | null;
  observedAt: string;
  note: string;
}

function summariseStation(station: StationSnapshot, lat: number, lng: number): LocationStationSummary {
  return {
    id: station.id,
    name: station.name,
    code: station.code,
    stationType: station.stationType,
    localityName: station.localityName,
    lat: station.lat,
    lng: station.lng,
    distanceM: Math.round(haversineMeters(lat, lng, station.lat, station.lng)),
    healthStatus: station.healthStatus,
    isSimulated: station.isSimulated,
    isStale: station.isStale,
    latestObservedAt: station.latestObservedAt,
    aqi: station.aqi?.aqi ?? null,
    aqiCategory: station.aqi?.category ?? 'NOT_APPLICABLE',
    dominantPollutant: station.aqi?.dominantPollutant ?? null,
    values: station.values,
  };
}

function stationPrimaryValue(station: LocationStationSummary): { code: string; value: number; unit: string } | null {
  const preferred =
    station.stationType === 'AIR_CAAQMS'
      ? ['pm25', 'pm10', 'no2']
      : station.stationType === 'WATER_SAMPLING'
        ? ['do', 'ph', 'turbidity']
        : ['stack_pm', 'stack_nox', 'stack_so2'];
  for (const code of preferred) {
    const reading = station.values[code];
    if (reading) return { code, value: reading.value, unit: reading.unit };
  }
  const first = Object.entries(station.values)[0];
  return first ? { code: first[0], value: first[1].value, unit: first[1].unit } : null;
}

function add(list: LocationRecommendation[], item: LocationRecommendation) {
  if (!list.some((existing) => existing.title === item.title)) list.push(item);
}

export function buildLocationRecommendations(context: {
  category: string;
  primary: LocationStationSummary | null;
  cams: LocationCams | null;
  weather: LocationWeather | null;
  sources: SourceContribution[];
  reports: ReportRow[];
  incidents: IncidentRow[];
  alerts: AlertRow[];
}): LocationRecommendation[] {
  const { category, primary, cams, weather, sources, reports, incidents, alerts } = context;
  const items: LocationRecommendation[] = [];
  const aqi = primary?.aqi ?? null;
  const categoryLabel = primary?.aqiCategory ?? 'INSUFFICIENT DATA';
  const distance = primary ? primary.distanceM : null;
  const distanceText = distance === null ? 'unknown distance' : distance < 1000 ? `${distance} m` : `${(distance / 1000).toFixed(1)} km`;

  if (category === 'air' || category === 'industrial') {
    if (category === 'air') {
      if (aqi === null) {
        add(items, {
          tone: 'info',
          title: 'No current air reading near this point',
          detail: primary
            ? `The nearest reference monitor is ${distanceText} away, but it has no usable recent reading. Treat this location as unassessed rather than clean.`
            : 'No reference air monitor is available near this point. Treat this location as unassessed rather than clean.',
        });
      } else if (categoryLabel === 'Good' || categoryLabel === 'Satisfactory') {
        add(items, {
          tone: 'info',
          title: `Air is currently ${categoryLabel.toLowerCase()} at the nearest monitor`,
          detail: `Indicative AQI ${aqi} · ${distanceText} away. Normal outdoor activity is reasonable, but pollution can vary street by street.`,
        });
      } else if (categoryLabel === 'Moderate') {
        add(items, {
          tone: 'caution',
          title: 'Sensitive groups should reduce prolonged outdoor exertion',
          detail: `Indicative AQI ${aqi} at the nearest monitor (${distanceText} away). Children, older adults and people with heart or lung conditions should take breaks and avoid busy roads at peak hours.`,
        });
      } else {
        add(items, {
          tone: 'urgent',
          title: 'Limit outdoor exposure near this point',
          detail: `Indicative AQI ${aqi} (${categoryLabel}) at the nearest monitor, ${distanceText} away. Keep windows closed during peak traffic, avoid strenuous outdoor activity, and use a well-fitted mask if you must be outside. Seek medical advice for breathing difficulty.`,
        });
      }
    }

    if (primary && primary.distanceM > 1500) {
      add(items, {
        tone: 'info',
        title: 'Nearest monitor is not at this exact spot',
        detail: `The closest reference monitor is ${distanceText} away. This screen does not interpolate a concentration for the selected coordinate.`,
      });
    }

    if (primary?.isSimulated) {
      add(items, {
        tone: 'caution',
        title: 'Monitor data is simulation-labelled',
        detail: 'The nearest monitor belongs to the demonstration network. Use this analysis as a product demonstration, not an official CPCB health advisory.',
      });
    }

    if (primary?.isStale) {
      add(items, {
        tone: 'caution',
        title: 'Latest monitor reading is stale',
        detail: 'The nearest monitor has not reported within six hours. Check official alerts before acting on this snapshot.',
      });
    }

    const downwind = sources.filter((source) => source.downwind && source.contributionPct >= 10).slice(0, 2);
    if (downwind.length) {
      add(items, {
        tone: 'caution',
        title: 'Possible industrial influence downwind of this point',
        detail: `${downwind.map((source) => `${source.sourceName} (~${source.contributionPct}% screening share, ${source.distanceKm} km)`).join('; ')}. This is a wind-and-distance screen, not measured source attribution. If you see smoke or smell chemicals, move upwind and report it.`,
      });
    }

    if (weather?.windSpeedKmh !== null && weather?.windSpeedKmh !== undefined && weather.windSpeedKmh < 8) {
      add(items, {
        tone: 'info',
        title: 'Light wind may slow dispersion',
        detail: `Wind is ${weather.windSpeedKmh} km/h from ${compassLabel(weather.windDirectionDeg ?? 0)}. Local traffic, dust and burning emissions may linger near their source.`,
      });
    }

    if (weather?.precipitationMm !== null && weather?.precipitationMm !== undefined && weather.precipitationMm > 0) {
      add(items, {
        tone: 'info',
        title: 'Rain may temporarily reduce dust',
        detail: `${weather.precipitationMm} mm recorded nearby. Rain can suppress dust, but it does not remove traffic or indoor exposure.`,
      });
    }

    if (reports.some((report) => report.category === 'air' && report.verification_state === 'VERIFIED')) {
      add(items, {
        tone: 'action',
        title: 'Verified air-quality report nearby',
        detail: 'A verified smoke, dust or burning report is within 3 km. Avoid the immediate area and add a new report if the condition continues.',
      });
    } else if (reports.some((report) => report.category === 'air')) {
      add(items, {
        tone: 'action',
        title: 'Unverified air report nearby',
        detail: 'A recent citizen report is within 3 km but has not been verified. Treat it as a lead, not a confirmed measurement.',
      });
    }

    add(items, {
      tone: 'action',
      title: 'Report what you see at this location',
      detail: 'Smoke, dust, chemical odour or burning can be reported with a geotagged photo. Citizen reports become evidence only after review.',
    });
  }

  if (category === 'water') {
    add(items, {
      tone: 'action',
      title: 'Avoid contact with creek or river water near this point',
      detail: 'Do not bathe, swim or fish where water is discoloured or foaming. Wash exposed skin with clean water and report the location.',
    });

    const water = primary?.stationType === 'WATER_SAMPLING' ? primary : null;
    const ph = water?.values.ph?.value ?? null;
    const dissolvedOxygen = water?.values.do?.value ?? null;
    if (ph !== null && (ph < 6.5 || ph > 8.5)) {
      add(items, {
        tone: 'caution',
        title: 'Nearest water sample is outside the reference pH range',
        detail: `pH ${ph} at ${distanceText} away. This is a screening reference range, not a regulatory determination.`,
      });
    }
    if (dissolvedOxygen !== null && dissolvedOxygen < 5) {
      add(items, {
        tone: 'caution',
        title: 'Low dissolved oxygen at the nearest water sample',
        detail: `Dissolved oxygen ${dissolvedOxygen} mg/L at ${distanceText} away. Low oxygen can stress aquatic life; avoid contact and report visible discharge.`,
      });
    }
    if (reports.some((report) => report.category === 'water')) {
      add(items, {
        tone: 'action',
        title: 'Water-quality report nearby',
        detail: 'A citizen report of discharge, foam or discolouration is within 3 km. Avoid the reported spot and add photographic evidence if it persists.',
      });
    }
  }

  if (category === 'waste') {
    add(items, {
      tone: 'action',
      title: 'Never burn waste near this location',
      detail: 'Open burning releases fine particles and toxic gases. Use authorised collection and report burning or dumping instead.',
    });
    if (reports.some((report) => report.category === 'waste' && report.verification_state === 'VERIFIED')) {
      add(items, {
        tone: 'caution',
        title: 'Verified waste issue nearby',
        detail: 'A verified dumping or burning report is within 3 km. Keep children and pets away and report any recurrence.',
      });
    } else if (reports.some((report) => report.category === 'waste')) {
      add(items, {
        tone: 'info',
        title: 'Recent waste report nearby',
        detail: 'A citizen report is within 3 km and may still be awaiting verification. Add a photo and landmark if you see the same issue.',
      });
    }
  }

  if (category === 'industrial') {
    add(items, {
      tone: 'action',
      title: 'Move upwind if you smell chemicals or see dark smoke',
      detail: 'Do not enter the plume. Report the time, landmark, wind direction and a photo from a safe distance.',
    });
    if (primary?.stationType === 'INDUSTRIAL_STACK') {
      const reading = stationPrimaryValue(primary);
      if (reading) {
        add(items, {
          tone: 'info',
          title: 'Nearest stack monitor is a screening record',
          detail: `${reading.code.replace(/_/g, ' ')} ${reading.value} ${reading.unit} at ${distanceText} away. No facility-specific legal threshold is applied.`,
        });
      }
    }
  }

  for (const alert of alerts.slice(0, 1)) {
    add(items, {
      tone: alert.level === 'CRITICAL' ? 'urgent' : 'caution',
      title: `${alert.level === 'CRITICAL' ? 'Critical' : 'Active'} alert for this area`,
      detail: `${alert.title}. Follow official guidance and check the alert record for the latest state.`,
    });
  }

  if (incidents.length) {
    add(items, {
      tone: 'info',
      title: 'An official incident is open nearby',
      detail: `The nearest incident is ${(incidents[0].distance_m / 1000).toFixed(1)} km away with status ${incidents[0].status.replace(/_/g, ' ').toLowerCase()}. Incident records are not health advice.`,
    });
  }

  if ((category === 'air' || category === 'industrial') && cams?.pm25 !== null && cams?.pm25 !== undefined) {
    add(items, {
      tone: 'info',
      title: 'Modelled regional PM2.5 is available as context',
      detail: `CAMS models ${cams.pm25} µg/m³ near ${cams.localityName}. Modelled values are not monitor measurements and are shown only as regional context.`,
    });
  }

  const priority: Record<RecommendationTone, number> = { urgent: 0, caution: 1, action: 2, info: 3 };
  return items.sort((a, b) => priority[a.tone] - priority[b.tone]).slice(0, 7);
}

export function confidenceFor(analysis: {
  primary: LocationStationSummary | null;
  cams: LocationCams | null;
  weather: LocationWeather | null;
  reports: ReportRow[];
}): { level: 'HIGH' | 'MEDIUM' | 'LOW'; score: number; reasons: string[] } {
  const { primary, cams, weather, reports } = analysis;
  let score = 0;
  const reasons: string[] = [];
  if (primary) {
    const distance = primary.distanceM;
    score += distance <= 1000 ? 35 : distance <= 2500 ? 25 : distance <= 5000 ? 15 : 5;
    score += primary.isStale ? 3 : 20;
    score += primary.isSimulated ? 8 : 20;
    score += Math.min(15, Object.keys(primary.values).length * 3);
    reasons.push(`Nearest ${STATION_TYPE_LABEL[primary.stationType] ?? 'monitor'} is ${distance < 1000 ? `${distance} m` : `${(distance / 1000).toFixed(1)} km`} away.`);
    reasons.push(primary.isStale ? 'The latest reading is older than six hours.' : 'The latest reading is fresh.');
    reasons.push(primary.isSimulated ? 'The nearest monitor is simulation-labelled.' : 'The nearest monitor is a source record.');
  } else {
    reasons.push('No reference monitor is available near this point.');
  }
  if (cams) {
    score += 10;
    reasons.push('CAMS modelled PM2.5 is available as regional context.');
  }
  if (weather) {
    score += 5;
    reasons.push('Nearby weather context is available.');
  }
  if (reports.length) {
    score += Math.min(10, reports.length * 2);
    reasons.push(`${reports.length} citizen report(s) within 3 km in the last 30 days.`);
  }
  // A distant monitor, and simulation-labelled evidence, cannot support high confidence for this point.
  const distanceCeiling = !primary
    ? 25
    : primary.distanceM <= 1500
      ? 100
      : primary.distanceM <= 3000
        ? 65
        : primary.distanceM <= 5000
          ? 40
          : 25;
  const ceiling = Math.min(primary?.isSimulated ? 55 : 100, distanceCeiling);
  const clamped = Math.max(0, Math.min(ceiling, Math.round(score)));
  return { level: clamped >= 70 ? 'HIGH' : clamped >= 45 ? 'MEDIUM' : 'LOW', score: clamped, reasons };
}

export async function getLocationAnalysis(input: { lat: number; lng: number; category: string }) {
  const { lat, lng } = input;
  const category = input.category in CATEGORY_STATION_TYPE ? input.category : 'air';
  const withinMumbai = isWithinMumbai(lat, lng);
  // Run the external place lookup alongside the database work so a slow
  // geocoder cannot serialise the whole analysis.
  const reversePromise = reverseGeocode(lat, lng);

  const localityRows = await query<LocalityRow>(
    `SELECT id, name, lat::float8, lng::float8,
            ST_Distance(location, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography)::float8 AS distance_m
     FROM localities
     ORDER BY location <-> ST_SetSRID(ST_MakePoint($2,$1),4326)::geography
     LIMIT 1`,
    [lat, lng],
  );
  const locality = localityRows[0] ?? null;

  const snapshots = await getStationSnapshots();
  const withDistance = snapshots
    .map((station) => ({ station, distance: haversineMeters(lat, lng, Number(station.lat), Number(station.lng)) }))
    .sort((a, b) => a.distance - b.distance);
  const wantedType = CATEGORY_STATION_TYPE[category];
  const preferred = wantedType ? withDistance.filter((row) => row.station.stationType === wantedType) : [];
  const air = withDistance.filter((row) => row.station.stationType === 'AIR_CAAQMS');
  // Prefer a fresh monitor with values, so a stale neighbour cannot hide usable evidence.
  const usable = (row: { station: StationSnapshot }) =>
    !row.station.isStale && Object.keys(row.station.values).length > 0;
  const primaryRow =
    preferred.find(usable) ??
    preferred[0] ??
    air.find(usable) ??
    air[0] ??
    withDistance.find(usable) ??
    withDistance[0] ??
    null;
  const primary = primaryRow ? summariseStation(primaryRow.station, lat, lng) : null;
  const nearbyStations = withDistance
    .filter((row) => row.station.id !== primaryRow?.station.id)
    .slice(0, 6)
    .map(({ station, distance }) => {
      const summary = summariseStation(station, lat, lng);
      const latest = stationPrimaryValue(summary);
      return {
        id: summary.id,
        name: summary.name,
        stationType: summary.stationType,
        localityName: summary.localityName,
        distanceM: Math.round(distance),
        latestValue: latest?.value ?? null,
        latestUnit: latest?.unit ?? null,
        latestParameter: latest?.code ?? null,
        aqi: summary.aqi,
        aqiCategory: summary.aqiCategory,
        isSimulated: summary.isSimulated,
        isStale: summary.isStale,
      };
    });

  const weatherRow = primary ? (await getLatestWeather(primary.id))[0] ?? null : null;

  const weather: LocationWeather | null = weatherRow
    ? {
        temperatureC: weatherRow.temperature_c === null ? null : Number(weatherRow.temperature_c),
        relativeHumidity: weatherRow.relative_humidity === null ? null : Number(weatherRow.relative_humidity),
        windSpeedKmh: weatherRow.wind_speed_kmh === null ? null : Number(weatherRow.wind_speed_kmh),
        windDirectionDeg: weatherRow.wind_direction_deg === null ? null : Number(weatherRow.wind_direction_deg),
        precipitationMm: weatherRow.precipitation_mm === null ? null : Number(weatherRow.precipitation_mm),
        observedAt: weatherRow.observed_at,
        sourceId: weatherRow.source_id,
      }
    : null;

  const camsRows = await query<CamsRow>(
    `SELECT DISTINCT ON (o.pollutant_code) o.pollutant_code, o.value::float8 AS value, o.observed_at,
            l.id AS locality_id, l.name AS locality_name
     FROM environmental_observations o
     JOIN localities l ON l.id = o.locality_id
     WHERE o.source_id='open-meteo-cams' AND o.pollutant_code IN ('pm25','pm10')
       AND o.observed_at > now() - interval '24 hours'
       AND ST_DWithin(o.location, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, 25000)
     ORDER BY o.pollutant_code, ST_Distance(o.location, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography) ASC,
              o.observed_at DESC`,
    [lat, lng],
  );
  const cams: LocationCams | null = camsRows.length
    ? {
        localityName: camsRows[0].locality_name,
        pm25: camsRows.find((row) => row.pollutant_code === 'pm25')?.value ?? null,
        pm10: camsRows.find((row) => row.pollutant_code === 'pm10')?.value ?? null,
        observedAt: camsRows[0].observed_at,
        note: 'CAMS via Open-Meteo is a regional model, not a station measurement.',
      }
    : null;

  let forecast: {
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
  } | null = null;
  if (primaryRow && primaryRow.station.stationType === 'AIR_CAAQMS') {
    const history = (await getStationSeries(primaryRow.station.id, 'pm25', 48)).map((row) => ({
      observedAt: row.observed_at,
      value: Number(row.value),
    }));
    const latest = Object.fromEntries(Object.entries(primaryRow.station.values).map(([code, reading]) => [code, reading.value]));
    const bundle = await getForecastsForStation({
      stationId: primaryRow.station.code,
      history,
      latest,
      weather: weather
        ? {
            temperature: weather.temperatureC,
            humidity: weather.relativeHumidity,
            windSpeed: weather.windSpeedKmh,
            windDirection: weather.windDirectionDeg,
            precipitation: weather.precipitationMm,
          }
        : null,
    });
    forecast = {
      method: bundle.source === 'ML' ? 'LIGHTGBM_TRAINED' : 'PERSISTENCE_BASELINE_V1',
      modelStatus: bundle.modelStatus,
      horizons: bundle.forecasts.map((item) => ({
        horizonHours: item.horizonHours,
        predictedValue: item.predictedValue,
        lowerBound: item.lowerBound,
        upperBound: item.upperBound,
        method: item.method,
        confidence: item.confidence,
        targetTime: item.targetTime,
      })),
      note:
        bundle.source === 'ML'
          ? 'Forecasts are from the registered LightGBM model. They are estimates, not confirmed future conditions.'
          : 'Forecasts are a labelled persistence baseline, not trained ML output, and are not confirmed future conditions.',
    };
  }

  const reports = await query<ReportRow>(
    `SELECT r.id, r.public_ref, r.category, r.incident_type, r.status, r.verification_state, r.submitted_at,
            r.is_simulated, l.name AS locality_name,
            ST_Distance(r.location, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography)::float8 AS distance_m
     FROM environmental_reports r LEFT JOIN localities l ON l.id = r.locality_id
     WHERE r.submitted_at > now() - interval '30 days'
       AND r.category = $3
       AND ST_DWithin(r.location, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, 3000)
     ORDER BY distance_m ASC
     LIMIT 6`,
    [lat, lng, category],
  );

  const incidents = await query<IncidentRow>(
    `SELECT i.id, i.public_ref, i.title, i.category, i.status, i.risk_level, i.detected_at, i.is_simulated,
            ST_Distance(i.location, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography)::float8 AS distance_m
     FROM environmental_incidents i
     WHERE i.detected_at > now() - interval '90 days'
       AND i.simulation_session_id IS NULL
       AND i.category = $3
       AND ST_DWithin(i.location, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, 5000)
     ORDER BY distance_m ASC
     LIMIT 4`,
    [lat, lng, category],
  );

  const alerts = await query<AlertRow>(
    `SELECT a.id, a.public_ref, a.category, a.level, a.state, a.trigger_type, a.title, a.triggered_at, a.is_simulated
     FROM environmental_alerts a
     WHERE a.state <> 'CLOSED'
       AND a.category = $3
       AND (($1::uuid IS NOT NULL AND a.locality_id = $1) OR ($2::uuid IS NOT NULL AND a.station_id = $2))
     ORDER BY CASE a.level WHEN 'CRITICAL' THEN 0 WHEN 'EARLY_WARNING' THEN 1 WHEN 'WATCH' THEN 2 ELSE 3 END,
              a.triggered_at DESC
     LIMIT 5`,
    [locality?.id ?? null, primary?.id ?? null, category],
  );

  let impact: {
    method: string;
    status: string;
    wind: ScreenWind & { fromLabel: string };
    impactLevel: string;
    sources: SourceContribution[];
    note: string;
    disclaimer: string;
  } | null = null;
  if (category === 'air' || category === 'industrial') {
    const screen = await computeSourceImpactAt(
      [
        {
          id: POINT_ID,
          name: 'Selected location',
          localityName: locality?.name ?? null,
          lat,
          lng,
          pm25: primary?.values.pm25?.value ?? cams?.pm25 ?? null,
        },
      ],
      new Date(),
    );
    const attribution = screen.stationAttributions[POINT_ID];
    impact = {
      method: screen.method,
      status: screen.status,
      wind: screen.wind,
      impactLevel: attribution?.impactLevel ?? 'NONE',
      sources: (attribution?.sources ?? []).filter((source) => source.contributionPct >= 5).slice(0, 4),
      note: screen.note,
      disclaimer: screen.disclaimer,
    };
  }

  const recommendations = buildLocationRecommendations({
    category,
    primary,
    cams,
    weather,
    sources: impact?.sources ?? [],
    reports,
    incidents,
    alerts,
  });
  const confidence = confidenceFor({ primary, cams, weather, reports });
  const reverse = await reversePromise;

  const limitations = [
    'Point screen only: no interpolated pollution surface is produced. The analysis describes nearby evidence and does not measure the selected coordinate.',
    'Citizen reports are not measurements until an authorised reviewer verifies them.',
    'Industrial source shares are a distance-and-wind screening estimate over a simulated catalogue, not measured source apportionment or a regulatory determination.',
  ];
  if (primary?.isSimulated) limitations.push('The nearest monitor is simulation-labelled and is not an official CPCB record.');
  if (primary?.isStale) limitations.push('The nearest monitor reading is older than six hours.');
  if (primary && primary.distanceM > 3000) limitations.push('The nearest monitor is more than 3 km away; street-level concentrations can differ substantially.');
  if (cams) limitations.push('CAMS values are modelled regional context, not monitor measurements.');
  if (weather) limitations.push('Weather is context, not evidence of causation.');
  if (reverse) limitations.push('The place label is reverse-geocoded from OpenStreetMap and is not an administrative boundary determination.');

  const referenceLabel = locality ? (locality.distance_m <= 750 ? locality.name : `Near ${locality.name}`) : 'Mumbai';

  return {
    generatedAt: new Date().toISOString(),
    category,
    withinMumbai,
    place: {
      label: reverse?.name ?? referenceLabel,
      reverse,
      locality: locality
        ? { id: locality.id, name: locality.name, lat: Number(locality.lat), lng: Number(locality.lng) }
        : null,
      distanceM: locality ? Math.round(locality.distance_m) : null,
      lat,
      lng,
      note: reverse
        ? 'Place name from OpenStreetMap Nominatim. The nearest reference locality is listed separately and is not a boundary polygon.'
        : locality
          ? 'Nearest reference locality. Locality points are OpenStreetMap reference points, not boundary polygons.'
          : 'No reference locality is available near this point.',
    },
    primary,
    nearbyStations,
    weather,
    cams,
    forecast,
    impact,
    reports,
    incidents,
    alerts,
    recommendations,
    confidence,
    limitations,
  };
}
