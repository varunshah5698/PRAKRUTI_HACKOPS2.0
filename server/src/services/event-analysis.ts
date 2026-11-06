import { withTransaction, query } from '../db/pool.js';
import { badRequest, conflict } from '../middleware/errors.js';
import { env } from '../config/env.js';
import { addEvidence, appendTimeline, getEventOrThrow, type EventActor } from './event-intelligence.js';
import { probeWeather } from './citizen-weather.js';

type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';
type Stage = 'PAST' | 'PRESENT' | 'FUTURE';

interface Conclusion {
  statement: string;
  evidenceIds: string[];
  confidence: Confidence;
}

interface StoredAnalysis {
  id: string;
  event_id: string;
  stage: Stage;
  summary: string;
  conclusions: Conclusion[];
  confidence: number | null;
  methodology: string | null;
  model_name: string | null;
  model_version: string | null;
  limitations: string | null;
  generated_by: string;
  valid_from: string | null;
  valid_to: string | null;
  generated_at: string;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function freshness(value: string | null): 'LIVE' | 'STALE' | 'HISTORICAL' | 'UNKNOWN' {
  const time = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return 'UNKNOWN';
  const age = Date.now() - time;
  if (age <= 90 * 60_000) return 'LIVE';
  if (age <= 24 * 60 * 60_000) return 'STALE';
  return 'HISTORICAL';
}

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

async function fetchArchive(latitude: number, longitude: number, startDate: string, endDate: string) {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max');
  url.searchParams.set('timezone', 'UTC');
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Open-Meteo archive ${response.status}`);
  return (await response.json()) as {
    daily?: {
      time?: string[];
      weather_code?: Array<number | null>;
      temperature_2m_max?: Array<number | null>;
      temperature_2m_min?: Array<number | null>;
      precipitation_sum?: Array<number | null>;
      wind_speed_10m_max?: Array<number | null>;
    };
  };
}

async function fetchForecast(latitude: number, longitude: number) {
  const url = new URL(`${env.OPEN_METEO_BASE_URL}/v1/forecast`);
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('hourly', 'temperature_2m,precipitation,wind_speed_10m,weather_code');
  url.searchParams.set('forecast_days', '3');
  url.searchParams.set('timezone', 'UTC');
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Open-Meteo forecast ${response.status}`);
  return (await response.json()) as {
    hourly?: {
      time?: string[];
      temperature_2m?: Array<number | null>;
      precipitation?: Array<number | null>;
      wind_speed_10m?: Array<number | null>;
      weather_code?: Array<number | null>;
    };
  };
}

async function storeAnalysis(input: {
  eventId: string;
  stage: Stage;
  summary: string;
  conclusions: Conclusion[];
  confidence: number | null;
  methodology: string;
  modelName: string | null;
  limitations: string;
  validFrom: string | null;
  validTo: string | null;
  actor: EventActor;
  forecast?: {
    horizonHours: number;
    summary: string;
    variables: unknown;
    uncertainty: string;
    sourceId: string;
    modelName: string | null;
    evidenceId: string | null;
  };
}): Promise<StoredAnalysis> {
  const evidenceIds = [...new Set(input.conclusions.flatMap((item) => item.evidenceIds))];
  const analysis = await withTransaction(async (client) => {
    const inserted = await client.query<StoredAnalysis>(
      `INSERT INTO event_analysis
         (event_id, stage, summary, conclusions, confidence, methodology, model_name, limitations,
          generated_by, valid_from, valid_to)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz)
       RETURNING id, event_id, stage, summary, conclusions, confidence::float8 AS confidence, methodology,
         model_name, model_version, limitations, generated_by, valid_from, valid_to, generated_at`,
      [
        input.eventId,
        input.stage,
        input.summary,
        JSON.stringify(input.conclusions),
        input.confidence,
        input.methodology,
        input.modelName,
        input.limitations,
        input.actor.type === 'USER' ? 'USER' : 'SYSTEM',
        input.validFrom,
        input.validTo,
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('Could not store event analysis.');
    for (const evidenceId of evidenceIds) {
      await client.query(
        `INSERT INTO event_analysis_evidence (analysis_id, evidence_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [row.id, evidenceId],
      );
    }
    if (input.forecast) {
      await client.query(
        `INSERT INTO event_forecasts
           (event_id, analysis_id, evidence_id, horizon_hours, valid_from, valid_to, summary, variables,
            uncertainty, source_id, model_name)
         VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8::jsonb,$9,$10,$11)`,
        [
          input.eventId,
          row.id,
          input.forecast.evidenceId,
          input.forecast.horizonHours,
          input.validFrom,
          input.validTo,
          input.forecast.summary,
          JSON.stringify(input.forecast.variables),
          input.forecast.uncertainty,
          input.forecast.sourceId,
          input.forecast.modelName,
        ],
      );
    }
    return row;
  });
  await appendTimeline(input.eventId, input.actor, {
    entryType: 'VALIDATION',
    summary: `${input.stage} analysis generated`,
    detail: { analysisId: analysis.id, stage: input.stage },
    evidenceIds,
    dedupeKey: `analysis:${analysis.id}`,
  });
  return analysis;
}

async function pastAnalysis(eventId: string, actor: EventActor) {
  const event = await getEventOrThrow(eventId);
  if (event.primary_latitude === null || event.primary_longitude === null) {
    throw conflict('Event has no location; past analysis cannot be generated.');
  }
  const start = new Date(event.start_at ?? event.detected_at);
  const archiveEnd = new Date(start.getTime() - 86_400_000);
  const archiveStart = new Date(archiveEnd.getTime() - 6 * 86_400_000);
  const evidenceIds: string[] = [];
  const conclusions: Conclusion[] = [];
  const limitations: string[] = [
    'No drainage capacity, water-level, land-use or infrastructure dataset is connected; causation is not established.',
  ];
  let archiveSummary: string | null = null;

  try {
    const archive = await fetchArchive(event.primary_latitude, event.primary_longitude, day(archiveStart), day(archiveEnd));
    const evidence = await addEvidence(
      eventId,
      {
        evidenceType: 'HISTORICAL_DATASET',
        sourceId: 'open-meteo-archive',
        sourceName: 'Open-Meteo Historical Weather API',
        sourceUrl: 'https://open-meteo.com/en/docs/historical-weather-api',
        sourceRecordId: `archive:${eventId}:${day(archiveStart)}:${day(archiveEnd)}`,
        title: 'Preceding seven-day reanalysis',
        rawContent: archive.daily ?? {},
        observedAt: `${day(archiveStart)}T00:00:00Z`,
        latitude: event.primary_latitude,
        longitude: event.primary_longitude,
        verificationStatus: 'SOURCE_REPORTED',
        reliabilityClass: 'AGGREGATOR',
        freshnessStatus: 'HISTORICAL',
        metadata: { gridPoint: true, notStationObservation: true },
      },
      actor,
    );
    evidenceIds.push(String(evidence.evidence.id));
    const rain = (archive.daily?.precipitation_sum ?? []).reduce<number>((sum, value) => sum + (Number.isFinite(value) ? Number(value) : 0), 0);
    const maxTemp = Math.max(...(archive.daily?.temperature_2m_max ?? []).map((value) => Number(value)).filter(Number.isFinite));
    archiveSummary = `Reanalysis for the preceding seven days totals ${rain.toFixed(1)} mm rainfall; daily maximum temperature peaks at ${Number.isFinite(maxTemp) ? maxTemp.toFixed(1) : 'unavailable'} °C.`;
    conclusions.push({ statement: archiveSummary, evidenceIds: [String(evidence.evidence.id)], confidence: 'MEDIUM' });
  } catch (error) {
    limitations.push(`Historical reanalysis is unavailable: ${error instanceof Error ? error.message : 'provider failure'}.`);
  }

  const observations = await query<{
    id: string;
    source_id: string;
    observed_at: string;
    temperature_c: number | null;
    precipitation_mm: number | null;
    wind_speed_kmh: number | null;
  }>(
    `SELECT id::text, source_id, observed_at, temperature_c::float8 AS temperature_c,
            precipitation_mm::float8 AS precipitation_mm, wind_speed_kmh::float8 AS wind_speed_kmh
     FROM weather_observations
     WHERE location IS NOT NULL AND observed_at BETWEEN $1::timestamptz AND $2::timestamptz
       AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($4,$3),4326)::geography, 25000)
     ORDER BY observed_at DESC LIMIT 10`,
    [archiveStart.toISOString(), start.toISOString(), event.primary_latitude, event.primary_longitude],
  );
  for (const observation of observations) {
    const evidence = await addEvidence(
      eventId,
      {
        evidenceType: 'WEATHER_OBSERVATION',
        sourceId: observation.source_id,
        sourceName: observation.source_id,
        sourceRecordId: `weather-observation:${observation.id}`,
        sourceEntityType: 'WEATHER_OBSERVATION',
        sourceEntityId: observation.id,
        title: 'Historical station weather observation',
        rawContent: observation,
        observedAt: observation.observed_at,
        latitude: event.primary_latitude,
        longitude: event.primary_longitude,
        verificationStatus: 'SOURCE_REPORTED',
        reliabilityClass: 'PRIMARY_OBSERVATION',
        freshnessStatus: 'HISTORICAL',
      },
      actor,
    );
    evidenceIds.push(String(evidence.evidence.id));
  }
  if (observations.length > 0) {
    conclusions.push({
      statement: `${observations.length} nearby station weather observation(s) were recorded before the event.`,
      evidenceIds: evidenceIds.slice(archiveSummary ? 1 : 0),
      confidence: 'MEDIUM',
    });
  }

  const incidents = await query<{ id: string; title: string; category: string; risk_level: string; detected_at: string }>(
    `SELECT id::text, title, category, risk_level, detected_at
     FROM environmental_incidents
     WHERE location IS NOT NULL AND detected_at BETWEEN $1::timestamptz AND $2::timestamptz
       AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($4,$3),4326)::geography, 25000)
     ORDER BY detected_at DESC LIMIT 10`,
    [new Date(start.getTime() - 30 * 86_400_000).toISOString(), start.toISOString(), event.primary_latitude, event.primary_longitude],
  );
  if (incidents.length > 0) {
    const evidence = await addEvidence(
      eventId,
      {
        evidenceType: 'HISTORICAL_DATASET',
        sourceId: 'prakruti-incidents',
        sourceName: 'Prakruti incident records',
        sourceRecordId: `incidents:${eventId}`,
        title: 'Previous related incidents',
        rawContent: incidents,
        observedAt: incidents[0].detected_at,
        latitude: event.primary_latitude,
        longitude: event.primary_longitude,
        verificationStatus: 'SOURCE_REPORTED',
        reliabilityClass: 'AGGREGATOR',
        freshnessStatus: 'HISTORICAL',
      },
      actor,
    );
    evidenceIds.push(String(evidence.evidence.id));
    conclusions.push({
      statement: `${incidents.length} previous incident(s) were recorded within 25 km in the preceding 30 days.`,
      evidenceIds: [String(evidence.evidence.id)],
      confidence: 'MEDIUM',
    });
  }

  const reports = await query<{ id: string; category: string; incident_type: string; status: string; verification_state: string; occurred_at: string }>(
    `SELECT id::text, category, incident_type, status, verification_state, occurred_at
     FROM environmental_reports
     WHERE occurred_at BETWEEN $1::timestamptz AND $2::timestamptz
       AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($4,$3),4326)::geography, 25000)
     ORDER BY occurred_at DESC LIMIT 10`,
    [new Date(start.getTime() - 30 * 86_400_000).toISOString(), start.toISOString(), event.primary_latitude, event.primary_longitude],
  );
  if (reports.length > 0) {
    const evidence = await addEvidence(
      eventId,
      {
        evidenceType: 'CITIZEN_REPORT',
        sourceId: 'prakruti-reports',
        sourceName: 'Prakruti citizen reports',
        sourceRecordId: `reports:${eventId}`,
        title: 'Previous citizen reports',
        rawContent: reports,
        observedAt: reports[0].occurred_at,
        latitude: event.primary_latitude,
        longitude: event.primary_longitude,
        verificationStatus: 'CITIZEN_UNVERIFIED',
        reliabilityClass: 'CITIZEN',
        freshnessStatus: 'HISTORICAL',
      },
      actor,
    );
    evidenceIds.push(String(evidence.evidence.id));
    conclusions.push({
      statement: `${reports.length} citizen report(s) were recorded nearby in the preceding 30 days; they remain unverified.`,
      evidenceIds: [String(evidence.evidence.id)],
      confidence: 'LOW',
    });
  }

  if (evidenceIds.length > 0) {
    conclusions.push({
      statement: 'Cause is not conclusively established. Rainfall and antecedent conditions are possible contributing factors; drainage capacity, water levels, land use and infrastructure data are not available in this analysis.',
      evidenceIds,
      confidence: evidenceIds.length > 1 ? 'MEDIUM' : 'LOW',
    });
  } else {
    limitations.push('Insufficient evidence was available to state possible contributing factors.');
  }

  return storeAnalysis({
    eventId,
    stage: 'PAST',
    summary: archiveSummary
      ? `Historical context assembled from reanalysis, station observations and prior records. ${archiveSummary}`
      : 'Historical context is partial; the archive provider was unavailable.',
    conclusions,
    confidence: evidenceIds.length > 1 ? 0.65 : 0.3,
    methodology: 'Open-Meteo historical reanalysis, nearby station observations, previous incidents and citizen reports. Correlation is not presented as causation.',
    modelName: 'Open-Meteo Historical Weather API',
    limitations: limitations.join(' '),
    validFrom: archiveStart.toISOString(),
    validTo: start.toISOString(),
    actor,
  });
}

async function presentAnalysis(eventId: string, actor: EventActor) {
  const event = await getEventOrThrow(eventId);
  if (event.primary_latitude === null || event.primary_longitude === null) {
    throw conflict('Event has no location; present analysis cannot be generated.');
  }
  const conclusions: Conclusion[] = [];
  const evidenceIds: string[] = [];
  const limitations: string[] = [
    'No verified IMD/CWC/SACHET API is configured. Citizen reports are unverified. Population and infrastructure exposure are not included without verified datasets.',
  ];
  try {
    const current = await probeWeather(event.primary_latitude, event.primary_longitude);
    if (current.observedAt && current.temperatureC !== null) {
      const evidence = await addEvidence(
        eventId,
        {
          evidenceType: 'WEATHER_OBSERVATION',
          sourceId: current.sourceId ?? 'open-meteo-weather',
          sourceName: current.provider ?? 'Weather provider',
          sourceRecordId: `probe:${current.sourceId}:${current.observedAt}`,
          title: 'Current weather probe',
          rawContent: current,
          observedAt: current.observedAt,
          latitude: event.primary_latitude,
          longitude: event.primary_longitude,
          verificationStatus: 'SOURCE_REPORTED',
          reliabilityClass: 'PRIMARY_OBSERVATION',
          freshnessStatus: freshness(current.observedAt),
        },
        actor,
      );
      evidenceIds.push(String(evidence.evidence.id));
      conclusions.push({
        statement: `Latest ${current.provider ?? 'weather'} reading: ${current.temperatureC} °C, ${current.precipitationMm ?? '—'} mm precipitation, ${current.windSpeedKmh ?? '—'} km/h wind at ${current.observedAt}.`,
        evidenceIds: [String(evidence.evidence.id)],
        confidence: current.validation.valid ? 'HIGH' : 'LOW',
      });
    } else {
      limitations.push('No validated current weather reading is available.');
    }
  } catch (error) {
    limitations.push(`Current weather probe unavailable: ${error instanceof Error ? error.message : 'provider failure'}.`);
  }

  const reports = await query<{ id: string }>(
    `SELECT id::text FROM environmental_reports
     WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, 25000)
     ORDER BY occurred_at DESC LIMIT 20`,
    [event.primary_latitude, event.primary_longitude],
  );
  if (reports.length > 0) {
    const evidence = await addEvidence(
      eventId,
      {
        evidenceType: 'CITIZEN_REPORT',
        sourceId: 'prakruti-reports',
        sourceName: 'Prakruti citizen reports',
        sourceRecordId: `present-reports:${eventId}`,
        title: 'Citizen reports within 25 km',
        rawContent: { reportIds: reports.map((report) => report.id) },
        latitude: event.primary_latitude,
        longitude: event.primary_longitude,
        verificationStatus: 'CITIZEN_UNVERIFIED',
        reliabilityClass: 'CITIZEN',
        freshnessStatus: 'UNKNOWN',
      },
      actor,
    );
    evidenceIds.push(String(evidence.evidence.id));
    conclusions.push({
      statement: `${reports.length} citizen report(s) are recorded within 25 km; they remain unverified.`,
      evidenceIds: [String(evidence.evidence.id)],
      confidence: 'LOW',
    });
  }

  const official = await query<{ id: string }>(
    `SELECT id::text FROM event_evidence WHERE event_id=$1 AND evidence_type='OFFICIAL_WARNING' LIMIT 5`,
    [eventId],
  );
  if (official.length > 0) {
    conclusions.push({
      statement: `${official.length} contextual official/disaster warning evidence record(s) are attached. They are not represented as local Indian authority acknowledgement.`,
      evidenceIds: official.map((row) => row.id),
      confidence: 'MEDIUM',
    });
  } else {
    limitations.push('No official Indian warning evidence is attached; no IMD/CWC/SACHET feed is configured.');
  }

  return storeAnalysis({
    eventId,
    stage: 'PRESENT',
    summary: `Current situation for ${event.title}: ${event.status}, severity ${event.severity}.`,
    conclusions,
    confidence: evidenceIds.length > 0 ? 0.7 : 0.3,
    methodology: 'Latest validated weather probe, event state, nearby citizen reports and attached warning evidence. Freshness is explicit.',
    modelName: null,
    limitations: limitations.join(' '),
    validFrom: iso(event.detected_at),
    validTo: new Date().toISOString(),
    actor,
  });
}

async function futureAnalysis(eventId: string, actor: EventActor) {
  const event = await getEventOrThrow(eventId);
  if (event.primary_latitude === null || event.primary_longitude === null) {
    throw conflict('Event has no location; future analysis cannot be generated.');
  }
  let evidenceId: string | null = null;
  let forecastSummary = 'No forecast is available.';
  let variables: unknown = null;
  const conclusions: Conclusion[] = [];
  const limitations: string[] = [
    'Deterministic model forecast with inherent uncertainty; not an official IMD/CWC warning.',
    'Existing PM2.5 LightGBM is not used for non-air events or when artifacts are unavailable.',
  ];
  let modelName: string | null = 'Open-Meteo forecast';
  try {
    const forecast = await fetchForecast(event.primary_latitude, event.primary_longitude);
    const hourly = forecast.hourly ?? {};
    const times = hourly.time ?? [];
    const rain = (hourly.precipitation ?? []).slice(0, 72).map((value) => (Number.isFinite(value) ? Number(value) : 0));
    const wind = (hourly.wind_speed_10m ?? []).slice(0, 72).map((value) => (Number.isFinite(value) ? Number(value) : 0));
    const temp = (hourly.temperature_2m ?? []).slice(0, 72).map((value) => (Number.isFinite(value) ? Number(value) : 0));
    const maxRain = Math.max(...rain, 0);
    const maxWind = Math.max(...wind, 0);
    const maxTemp = Math.max(...temp, -Infinity);
    const validFrom = times[0] ?? new Date().toISOString();
    const validTo = times[Math.min(times.length - 1, 71)] ?? new Date(Date.now() + 72 * 60 * 60_000).toISOString();
    const evidence = await addEvidence(
      eventId,
      {
        evidenceType: 'MODEL_OUTPUT',
        sourceId: 'open-meteo-forecast',
        sourceName: 'Open-Meteo forecast',
        sourceUrl: 'https://open-meteo.com/en/docs',
        sourceRecordId: `forecast:${eventId}:${validFrom}`,
        title: 'Open-Meteo 72-hour forecast',
        rawContent: forecast,
        observedAt: validFrom,
        latitude: event.primary_latitude,
        longitude: event.primary_longitude,
        verificationStatus: 'MODEL_GENERATED',
        reliabilityClass: 'MODEL',
        freshnessStatus: 'LIVE',
        metadata: { forecastNotObserved: true },
      },
      actor,
    );
    evidenceId = String(evidence.evidence.id);
    forecastSummary = `Model forecast for the next 72 hours: maximum hourly precipitation ${maxRain.toFixed(1)} mm, maximum wind ${maxWind.toFixed(1)} km/h${Number.isFinite(maxTemp) ? `, maximum temperature ${maxTemp.toFixed(1)} °C` : ''}.`;
    variables = { maxRainMm: maxRain, maxWindKmh: maxWind, maxTemperatureC: Number.isFinite(maxTemp) ? maxTemp : null };
    conclusions.push({ statement: forecastSummary, evidenceIds: [evidenceId], confidence: 'MEDIUM' });
    if (maxRain >= 20 || maxWind >= 89 || maxTemp >= 44) {
      conclusions.push({
        statement: 'The forecast includes values near or above the existing alert thresholds; possible escalation should be monitored. This is a model forecast, not an official warning.',
        evidenceIds: [evidenceId],
        confidence: 'LOW',
      });
    } else {
      conclusions.push({
        statement: 'No forecast variable exceeds the current alert thresholds in this 72-hour window. Continue normal monitoring.',
        evidenceIds: [evidenceId],
        confidence: 'MEDIUM',
      });
    }
  } catch (error) {
    limitations.push(`Predictive analysis is unavailable: ${error instanceof Error ? error.message : 'forecast provider failure'}. No forecast was fabricated.`);
    modelName = null;
  }

  return storeAnalysis({
    eventId,
    stage: 'FUTURE',
    summary: forecastSummary,
    conclusions,
    confidence: evidenceId ? 0.55 : 0.2,
    methodology: 'Open-Meteo deterministic forecast. Threshold comparison is rule-based; no unvalidated ML model is used.',
    modelName,
    limitations: limitations.join(' '),
    validFrom: new Date().toISOString(),
    validTo: new Date(Date.now() + 72 * 60 * 60_000).toISOString(),
    actor,
    forecast: evidenceId
      ? {
          horizonHours: 72,
          summary: forecastSummary,
          variables,
          uncertainty: 'Model forecast; uncertainty is not a calibrated confidence interval.',
          sourceId: 'open-meteo-forecast',
          modelName,
          evidenceId,
        }
      : undefined,
  });
}

export async function analyzeEvent(eventId: string, actor: EventActor = { type: 'SYSTEM' }): Promise<{
  analyses: StoredAnalysis[];
  errors: Array<{ stage: Stage; message: string }>;
}> {
  const analyses: StoredAnalysis[] = [];
  const errors: Array<{ stage: Stage; message: string }> = [];
  for (const [stage, task] of [
    ['PAST', pastAnalysis],
    ['PRESENT', presentAnalysis],
    ['FUTURE', futureAnalysis],
  ] as const) {
    try {
      analyses.push(await task(eventId, actor));
    } catch (error) {
      errors.push({ stage, message: error instanceof Error ? error.message : 'analysis failed' });
    }
  }
  if (analyses.length === 0) throw badRequest('No event analysis could be generated.');
  return { analyses: await getAnalyses(eventId), errors };
}

export async function getAnalyses(eventId: string): Promise<Array<StoredAnalysis & { evidenceIds: string[] }>> {
  const rows = await query<StoredAnalysis>(
    `SELECT DISTINCT ON (stage) id, event_id, stage, summary, conclusions, confidence::float8 AS confidence,
            methodology, model_name, model_version, limitations, generated_by, valid_from, valid_to, generated_at
     FROM event_analysis WHERE event_id=$1
     ORDER BY stage, generated_at DESC`,
    [eventId],
  );
  return Promise.all(
    rows.map(async (row) => {
      const evidence = await query<{ evidence_id: string }>(
        'SELECT evidence_id FROM event_analysis_evidence WHERE analysis_id=$1 ORDER BY evidence_id',
        [row.id],
      );
      return { ...row, evidenceIds: evidence.map((item) => item.evidence_id) };
    }),
  );
}

export async function getForecasts(eventId: string): Promise<Record<string, unknown>[]> {
  return query<Record<string, unknown>>(
    `SELECT id, event_id, analysis_id, evidence_id, horizon_hours, valid_from, valid_to, summary,
            variables, uncertainty, source_id, model_name, generated_at
     FROM event_forecasts WHERE event_id=$1 ORDER BY generated_at DESC`,
    [eventId],
  );
}
