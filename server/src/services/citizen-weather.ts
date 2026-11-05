import { env, emailConfigured } from '../config/env.js';
import { query, one } from '../db/pool.js';
import { deliverEmail, markNotificationStatus, recordNotificationEvent, renderWeatherAlertEmail } from './email.js';

export type WeatherSeverity = 'NORMAL' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export interface WeatherReadingInput {
  temperatureC: number | null;
  precipitationMm: number | null;
  windSpeedKmh: number | null;
  windGustKmh: number | null;
  weatherCode: number | null;
}

export interface WeatherCondition {
  condition: string;
  severity: Exclude<WeatherSeverity, 'NORMAL'>;
  measuredValue: number | null;
  unit: string | null;
}

export interface WeatherClassification {
  severity: WeatherSeverity;
  condition: string;
  measuredValue: number | null;
  unit: string | null;
  conditions: WeatherCondition[];
}

const RANK: Record<WeatherSeverity, number> = { NORMAL: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };

function condition(
  severity: Exclude<WeatherSeverity, 'NORMAL'>,
  name: string,
  measuredValue: number | null,
  unit: string | null,
): WeatherCondition {
  return { condition: name, severity, measuredValue, unit };
}

/**
 * Thresholds are deliberately conservative and based on measured values from
 * Open-Meteo. They are not official IMD warnings; the email names its source.
 */
export function classifyWeather(input: WeatherReadingInput): WeatherClassification {
  const conditions: WeatherCondition[] = [];
  const code = input.weatherCode;
  const rain = input.precipitationMm;
  const wind = Math.max(input.windGustKmh ?? 0, input.windSpeedKmh ?? 0);
  const temperature = input.temperatureC;

  if (code !== null && code >= 95) {
    conditions.push(
      code === 96 || code === 99
        ? condition('CRITICAL', 'Severe thunderstorm with hail', code, 'WMO code')
        : condition('HIGH', 'Thunderstorm', code, 'WMO code'),
    );
  }
  if (rain !== null && Number.isFinite(rain)) {
    if (rain >= 35.5) conditions.push(condition('CRITICAL', 'Extreme rainfall and flood risk', rain, 'mm'));
    else if (rain >= 15) conditions.push(condition('HIGH', 'Heavy rainfall', rain, 'mm'));
    else if (rain >= 7.5) conditions.push(condition('MODERATE', 'Moderate rainfall', rain, 'mm'));
  }
  if (Number.isFinite(wind) && wind > 0) {
    if (wind >= 117) conditions.push(condition('CRITICAL', 'Dangerous wind speeds', wind, 'km/h'));
    else if (wind >= 89) conditions.push(condition('HIGH', 'Dangerous wind speeds', wind, 'km/h'));
    else if (wind >= 62) conditions.push(condition('MODERATE', 'Strong winds', wind, 'km/h'));
  }
  if (temperature !== null && Number.isFinite(temperature)) {
    if (temperature >= 47) conditions.push(condition('CRITICAL', 'Extreme heat', temperature, '°C'));
    else if (temperature >= 44) conditions.push(condition('HIGH', 'Extreme heat', temperature, '°C'));
    else if (temperature >= 40) conditions.push(condition('MODERATE', 'Heat wave conditions', temperature, '°C'));
    if (temperature <= 0) conditions.push(condition('CRITICAL', 'Extreme cold', temperature, '°C'));
    else if (temperature <= 4) conditions.push(condition('HIGH', 'Cold wave conditions', temperature, '°C'));
    else if (temperature <= 8) conditions.push(condition('MODERATE', 'Cold conditions', temperature, '°C'));
  }

  const top = conditions.reduce<WeatherCondition | null>(
    (best, item) => (!best || RANK[item.severity] > RANK[best.severity] ? item : best),
    null,
  );
  if (!top) {
    return { severity: 'NORMAL', condition: 'Normal conditions', measuredValue: null, unit: null, conditions };
  }
  return { severity: top.severity, condition: top.condition, measuredValue: top.measuredValue, unit: top.unit, conditions };
}

export function locationKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

export function eventBucket(now: Date, cooldownMinutes: number): number {
  const windowMs = Math.max(cooldownMinutes, 60) * 60_000;
  return Math.floor(now.getTime() / windowMs);
}

export function eventKey(
  key: string,
  classification: WeatherClassification,
  now: Date,
  cooldownMinutes: number,
): string {
  const slug = classification.condition.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${key}|${slug}|${classification.severity}|${eventBucket(now, cooldownMinutes)}`;
}

interface WeatherGroup {
  key: string;
  latitude: number;
  longitude: number;
  locationLabel: string;
  citizens: Array<{ id: string; name: string; email: string; locationLabel: string }>;
}

interface CurrentWeather {
  observedAt: string;
  temperatureC: number | null;
  precipitationMm: number | null;
  windSpeedKmh: number | null;
  windGustKmh: number | null;
  weatherCode: number | null;
  sourceId: string;
  raw: Record<string, unknown>;
}

function isoUtc(value: unknown): string {
  const text = String(value);
  return text.endsWith('Z') ? text : `${text}Z`;
}

function symbolToWeatherCode(symbol: string): number {
  const text = symbol.toLowerCase();
  if (text.includes('thunder')) return 95;
  if (text.includes('heavyrain')) return 65;
  if (text.includes('lightrain')) return 61;
  if (text.includes('rain')) return 63;
  if (text.includes('drizzle')) return 51;
  if (text.includes('heavysnow')) return 75;
  if (text.includes('snow')) return 71;
  if (text.includes('fog')) return 45;
  if (text.includes('cloudy')) return 3;
  if (text.includes('fair')) return 1;
  return 0;
}

async function fetchMetNo(point: { latitude: number; longitude: number }): Promise<CurrentWeather | null> {
  const url = new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact');
  url.searchParams.set('lat', String(point.latitude));
  url.searchParams.set('lon', String(point.longitude));
  const response = await fetch(url, {
    headers: { 'User-Agent': 'PRAKRUTI/1.0 (citizen weather monitor; github.com/varunshah5698/PRAKRUTI_HACKOPS2.0)' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`MET Norway weather ${response.status}`);
  const payload = (await response.json()) as {
    properties?: {
      timeseries?: Array<{
        time: string;
        data?: {
          instant?: { details?: Record<string, number> };
          next_1_hours?: { details?: { precipitation_amount?: number }; summary?: { symbol_code?: string } };
          next_6_hours?: { details?: { precipitation_amount?: number }; summary?: { symbol_code?: string } };
        };
      }>;
    };
  };
  const entry = payload.properties?.timeseries?.[0];
  if (!entry?.time) return null;
  const details = entry.data?.instant?.details ?? {};
  const next = entry.data?.next_1_hours ?? entry.data?.next_6_hours;
  const windMs = details.wind_speed;
  const gustMs = details.wind_speed_of_gust;
  return {
    observedAt: isoUtc(entry.time),
    temperatureC: Number.isFinite(details.air_temperature) ? details.air_temperature : null,
    precipitationMm: Number.isFinite(next?.details?.precipitation_amount) ? next!.details!.precipitation_amount! : null,
    windSpeedKmh: Number.isFinite(windMs) ? windMs * 3.6 : null,
    windGustKmh: Number.isFinite(gustMs) ? gustMs * 3.6 : null,
    weatherCode: next?.summary?.symbol_code ? symbolToWeatherCode(next.summary.symbol_code) : null,
    sourceId: 'met-no-weather',
    raw: entry as unknown as Record<string, unknown>,
  };
}

async function fetchWeather(points: Array<{ latitude: number; longitude: number }>): Promise<Array<CurrentWeather | null>> {
  if (points.length === 0) return [];
  const url = new URL(`${env.OPEN_METEO_BASE_URL}/v1/forecast`);
  url.searchParams.set('latitude', points.map((p) => p.latitude).join(','));
  url.searchParams.set('longitude', points.map((p) => p.longitude).join(','));
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
  );
  url.searchParams.set('timezone', 'UTC');
  let results: Array<CurrentWeather | null>;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Open-Meteo weather ${response.status}`);
    const payload = await response.json();
    const rows: Array<{ current?: Record<string, number | string> }> = Array.isArray(payload) ? payload : [payload];
    results = points.map((_, index) => {
      const current = rows[index]?.current;
      if (!current?.time) return null;
      return {
        observedAt: isoUtc(current.time),
        temperatureC: typeof current.temperature_2m === 'number' ? current.temperature_2m : null,
        precipitationMm: typeof current.precipitation === 'number' ? current.precipitation : null,
        windSpeedKmh: typeof current.wind_speed_10m === 'number' ? current.wind_speed_10m : null,
        windGustKmh: typeof current.wind_gusts_10m === 'number' ? current.wind_gusts_10m : null,
        weatherCode: typeof current.weather_code === 'number' ? current.weather_code : null,
        sourceId: 'open-meteo-weather',
        raw: current,
      };
    });
  } catch (error) {
    console.warn('[citizen-weather] Open-Meteo unavailable; using MET Norway fallback.', error instanceof Error ? error.message : error);
    results = points.map(() => null);
  }
  return Promise.all(
    results.map(async (reading, index) =>
      reading ?? fetchMetNo(points[index]).catch((error) => {
        console.warn('[citizen-weather] MET Norway fallback failed.', error instanceof Error ? error.message : error);
        return null;
      }),
    ),
  );
}

function isFresh(observedAt: string): boolean {
  const time = Date.parse(observedAt);
  return Number.isFinite(time) && Date.now() - time <= 3 * 60 * 60_000;
}

async function storeReading(key: string, latitude: number, longitude: number, reading: CurrentWeather): Promise<void> {
  await query(
    `INSERT INTO citizen_weather_readings
       (location_key, latitude, longitude, observed_at, temperature_c, precipitation_mm, wind_speed_kmh,
        wind_gust_kmh, weather_code, source_id, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
     ON CONFLICT (location_key, observed_at, source_id) DO UPDATE SET
       retrieved_at=now(), temperature_c=EXCLUDED.temperature_c,
       precipitation_mm=EXCLUDED.precipitation_mm, wind_speed_kmh=EXCLUDED.wind_speed_kmh,
       wind_gust_kmh=EXCLUDED.wind_gust_kmh, weather_code=EXCLUDED.weather_code, raw=EXCLUDED.raw`,
    [
      key,
      latitude,
      longitude,
      reading.observedAt,
      reading.temperatureC,
      reading.precipitationMm,
      reading.windSpeedKmh,
      reading.windGustKmh,
      reading.weatherCode,
      reading.sourceId,
      JSON.stringify(reading.raw),
    ],
  );
}

async function upsertEvent(
  key: string,
  group: WeatherGroup,
  classification: WeatherClassification,
  observedAt: string,
  sourceId: string,
): Promise<string> {
  const now = new Date();
  const keyForEvent = eventKey(key, classification, now, env.CITIZEN_MONITOR_COOLDOWN_MINUTES);
  const row = await one<{ id: string }>(
    `INSERT INTO weather_events
       (event_key, location_key, location_label, latitude, longitude, condition, severity,
        measured_value, unit, starts_at, ends_at, source_id, is_simulated, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13::jsonb)
     ON CONFLICT (event_key) DO UPDATE SET
       last_seen_at=now(), measured_value=EXCLUDED.measured_value, raw=EXCLUDED.raw
     RETURNING id`,
    [
      keyForEvent,
      key,
      group.locationLabel,
      group.latitude,
      group.longitude,
      classification.condition,
      classification.severity,
      classification.measuredValue,
      classification.unit,
      observedAt,
      new Date(Date.parse(observedAt) + 3 * 60 * 60_000).toISOString(),
      sourceId,
      JSON.stringify({ conditions: classification.conditions }),
    ],
  );
  if (!row) throw new Error('Could not persist the weather event.');
  return row.id;
}

async function sendWeatherAlert(
  citizen: { id: string; name: string; email: string; locationLabel: string },
  eventId: string,
  group: WeatherGroup,
  classification: WeatherClassification,
  observedAt: string,
  sourceId: string,
): Promise<void> {
  const rendered = renderWeatherAlertEmail({
    name: citizen.name,
    locationLabel: citizen.locationLabel || group.locationLabel,
    condition: classification.condition,
    severity: classification.severity,
    measuredValue: classification.measuredValue,
    unit: classification.unit,
    detectedAt: observedAt,
    expectedDuration: null,
    source: sourceId === 'met-no-weather'
      ? 'MET Norway location forecast (measured/model data)'
      : 'Open-Meteo current weather (measured/model data)',
  });

  const inserted = await one<{ id: string }>(
    `INSERT INTO notifications
       (user_id, audience, channel, template, subject, body_html, status, is_simulated, weather_event_id)
     VALUES ($1,'PUBLIC','EMAIL','WEATHER_ALERT',$2,$3,'QUEUED',false,$4)
     ON CONFLICT (weather_event_id, user_id) WHERE weather_event_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [citizen.id, rendered.subject, rendered.html, eventId],
  );
  if (!inserted) return;

  if (!emailConfigured) {
    await markNotificationStatus(inserted.id, 'FAILED', { error: 'Email provider NOT_CONFIGURED.' });
    await recordNotificationEvent(inserted.id, 'WEATHER_EMAIL_FAILED', { reason: 'NOT_CONFIGURED' });
    console.error(`[citizen-weather] Email NOT_CONFIGURED; alert ${inserted.id} for ${citizen.email} not sent.`);
    return;
  }

  const delivery = await deliverEmail({
    notificationId: inserted.id,
    to: citizen.email,
    subject: rendered.subject,
    html: rendered.html,
    isSimulated: false,
  });
  await query(`UPDATE notifications SET attempt_count=attempt_count+1 WHERE id=$1`, [inserted.id]);
  await markNotificationStatus(inserted.id, delivery.status, {
    providerMessageId: delivery.messageId,
    error: delivery.error,
  });
  await recordNotificationEvent(inserted.id, delivery.event, {
    recipient: delivery.recipient,
    messageId: delivery.messageId,
  });
  if (delivery.status === 'FAILED') {
    await query(
      `UPDATE notifications SET next_retry_at = now() + ($2::int * interval '1 minute') WHERE id=$1`,
      [inserted.id, Math.min(60, 2 ** 1)],
    );
  }
}

async function processGroups(groups: WeatherGroup[], sendEmails: boolean): Promise<{ readings: number; events: number; emails: number }> {
  let readings = 0;
  let events = 0;
  let emails = 0;
  const minRank = RANK[env.CITIZEN_MONITOR_MIN_SEVERITY];
  for (let offset = 0; offset < groups.length; offset += 50) {
    const batch = groups.slice(offset, offset + 50);
    let weather: Array<CurrentWeather | null>;
    try {
      weather = await fetchWeather(batch);
    } catch (error) {
      console.error('[citizen-weather] weather fetch failed', error);
      continue;
    }
    for (let index = 0; index < batch.length; index += 1) {
      const group = batch[index];
      const reading = weather[index];
      if (!reading) continue;
      if (!isFresh(reading.observedAt)) {
        console.warn(`[citizen-weather] stale reading for ${group.key} at ${reading.observedAt}; skipped.`);
        continue;
      }
      await storeReading(group.key, group.latitude, group.longitude, reading);
      readings += 1;
      const classification = classifyWeather(reading);
      if (RANK[classification.severity] < minRank || classification.severity === 'NORMAL') continue;
      const eventId = await upsertEvent(group.key, group, classification, reading.observedAt, reading.sourceId);
      events += 1;
      if (!sendEmails) continue;
      for (const citizen of group.citizens) {
        const existing = await one<{ id: string }>(
          `SELECT id FROM notifications WHERE weather_event_id=$1 AND user_id=$2 LIMIT 1`,
          [eventId, citizen.id],
        );
        if (existing) continue;
        await sendWeatherAlert(citizen, eventId, group, classification, reading.observedAt, reading.sourceId);
        emails += 1;
      }
    }
  }
  return { readings, events, emails };
}

export async function monitorCitizenWeather(options: { sendEmails?: boolean } = {}): Promise<{
  locations: number;
  citizens: number;
  readings: number;
  events: number;
  emails: number;
}> {
  const rows = await query<{
    id: string;
    name: string;
    email: string;
    latitude: number;
    longitude: number;
    location_label: string;
  }>(
    `SELECT u.id, u.name, u.email, p.latitude::float8 AS latitude, p.longitude::float8 AS longitude,
            p.location_label
     FROM users u JOIN user_preferences p ON p.user_id=u.id
     WHERE u.role='PUBLIC' AND u.account_status='ACTIVE' AND u.email_verified=true
       AND u.onboarding_completed=true AND p.weather_notifications=true
       AND p.weather_consent_at IS NOT NULL
       AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL AND p.location_label IS NOT NULL
     ORDER BY p.latitude, p.longitude`,
  );
  const groups = new Map<string, WeatherGroup>();
  for (const row of rows) {
    const key = locationKey(row.latitude, row.longitude);
    const group = groups.get(key) ?? {
      key,
      latitude: Number(key.split(',')[0]),
      longitude: Number(key.split(',')[1]),
      locationLabel: row.location_label,
      citizens: [],
    };
    group.citizens.push({ id: row.id, name: row.name, email: row.email, locationLabel: row.location_label });
    groups.set(key, group);
  }
  const result = await processGroups([...groups.values()], options.sendEmails !== false);
  return { locations: groups.size, citizens: rows.length, ...result };
}

export async function refreshCitizenLocation(userId: string): Promise<{ updated: boolean; severity: WeatherSeverity | null }> {
  const row = await one<{
    id: string;
    name: string;
    email: string;
    latitude: number;
    longitude: number;
    location_label: string;
  }>(
    `SELECT u.id, u.name, u.email, p.latitude::float8 AS latitude, p.longitude::float8 AS longitude,
            p.location_label
     FROM users u JOIN user_preferences p ON p.user_id=u.id WHERE u.id=$1`,
    [userId],
  );
  if (!row || row.latitude === null || row.longitude === null || !row.location_label) {
    return { updated: false, severity: null };
  }
  const key = locationKey(row.latitude, row.longitude);
  const [reading] = await fetchWeather([{ latitude: row.latitude, longitude: row.longitude }]);
  if (!reading || !isFresh(reading.observedAt)) return { updated: false, severity: null };
  await storeReading(key, row.latitude, row.longitude, reading);
  const classification = classifyWeather(reading);
  if (classification.severity !== 'NORMAL') {
    const group: WeatherGroup = {
      key,
      latitude: row.latitude,
      longitude: row.longitude,
      locationLabel: row.location_label,
      citizens: [{ id: row.id, name: row.name, email: row.email, locationLabel: row.location_label }],
    };
    await upsertEvent(key, group, classification, reading.observedAt, reading.sourceId);
  }
  return { updated: true, severity: classification.severity };
}

export async function retryFailedWeatherEmails(): Promise<{ retried: number; sent: number }> {
  const rows = await query<{
    id: string;
    user_id: string;
    email: string;
    subject: string;
    body_html: string;
    attempt_count: number;
  }>(
    `SELECT n.id, n.user_id, u.email, n.subject, n.body_html, n.attempt_count
     FROM notifications n JOIN users u ON u.id=n.user_id
     WHERE n.template='WEATHER_ALERT' AND n.status='FAILED' AND n.next_retry_at IS NOT NULL
       AND n.next_retry_at <= now() AND n.attempt_count < $1
       AND u.account_status='ACTIVE' AND u.email_verified=true
     ORDER BY n.next_retry_at LIMIT 50`,
    [env.CITIZEN_MONITOR_MAX_RETRIES],
  );
  let sent = 0;
  for (const row of rows) {
    const delivery = await deliverEmail({
      notificationId: row.id,
      to: row.email,
      subject: row.subject,
      html: row.body_html,
      isSimulated: false,
    });
    const attempts = row.attempt_count + 1;
    await query(`UPDATE notifications SET attempt_count=$2 WHERE id=$1`, [row.id, attempts]);
    await markNotificationStatus(row.id, delivery.status, {
      providerMessageId: delivery.messageId,
      error: delivery.error,
    });
    await recordNotificationEvent(row.id, `RETRY_${delivery.event}`, { attempt: attempts, recipient: delivery.recipient });
    if (delivery.status === 'FAILED') {
      const delay = Math.min(60, 2 ** Math.min(attempts, 6));
      await query(`UPDATE notifications SET next_retry_at = now() + ($2::int * interval '1 minute') WHERE id=$1`, [
        row.id,
        delay,
      ]);
    } else {
      await query(`UPDATE notifications SET next_retry_at=NULL WHERE id=$1`, [row.id]);
      sent += 1;
    }
  }
  return { retried: rows.length, sent };
}

let monitorTimer: NodeJS.Timeout | null = null;
let monitorRunning = false;

async function runMonitor(): Promise<void> {
  if (monitorRunning) return;
  monitorRunning = true;
  try {
    const result = await monitorCitizenWeather();
    const retries = await retryFailedWeatherEmails();
    if (result.citizens > 0 || retries.retried > 0) {
      console.log(
        `[citizen-weather] locations=${result.locations} citizens=${result.citizens} readings=${result.readings} events=${result.events} emails=${result.emails} retries=${retries.retried}/${retries.sent}`,
      );
    }
  } catch (error) {
    console.error('[citizen-weather] cycle failed', error);
  } finally {
    monitorRunning = false;
  }
}

export function startCitizenWeatherScheduler(): void {
  if (!env.CITIZEN_MONITOR_ENABLED || monitorTimer) return;
  console.log(
    `[citizen-weather] monitor enabled · every ${env.CITIZEN_MONITOR_INTERVAL_SECONDS}s · min severity ${env.CITIZEN_MONITOR_MIN_SEVERITY}`,
  );
  monitorTimer = setInterval(() => void runMonitor(), env.CITIZEN_MONITOR_INTERVAL_SECONDS * 1000);
  monitorTimer.unref();
  setTimeout(() => void runMonitor(), 10_000).unref();
}

export function stopCitizenWeatherScheduler(): void {
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = null;
}
