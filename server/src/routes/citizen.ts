import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { query, one } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, notFound } from '../middleware/errors.js';
import { env } from '../config/env.js';
import { classifyWeather, locationKey, refreshCitizenLocation, type WeatherSeverity } from '../services/citizen-weather.js';
import { weatherIntegrity, weatherRecommendation } from '../services/weather-status.js';

export const citizenRouter = Router();

const citizenLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
const placesLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

const placeCache = new Map<string, { at: number; results: PlaceResult[] }>();
interface PlaceResult {
  id: string;
  name: string;
  label: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1: string | null;
  timezone: string | null;
}

citizenRouter.get('/places', placesLimiter, requireAuth, async (req, res, next) => {
  try {
    const q = z.string().trim().min(2).max(80).parse(req.query.q);
    const key = q.toLowerCase();
    const cached = placeCache.get(key);
    if (cached && Date.now() - cached.at < 60 * 60_000) {
      res.json({ query: q, results: cached.results, provider: 'Open-Meteo geocoding' });
      return;
    }
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', q);
    url.searchParams.set('count', '10');
    url.searchParams.set('language', 'en');
    url.searchParams.set('countryCode', 'IN');
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Geocoding failed (${response.status})`);
    const payload = (await response.json()) as {
      results?: Array<{
        id: number;
        name: string;
        latitude: number;
        longitude: number;
        country: string;
        admin1?: string;
        timezone?: string;
      }>;
    };
    const results = (payload.results ?? []).map((row) => ({
      id: `geo-${row.id}`,
      name: row.name,
      label: [row.admin1, row.country].filter(Boolean).join(', '),
      latitude: row.latitude,
      longitude: row.longitude,
      country: row.country,
      admin1: row.admin1 ?? null,
      timezone: row.timezone ?? null,
    }));
    placeCache.set(key, { at: Date.now(), results });
    if (placeCache.size > 500) placeCache.clear();
    res.json({ query: q, results, provider: 'Open-Meteo geocoding' });
  } catch (error) {
    next(error);
  }
});

citizenRouter.use(citizenLimiter, requireAuth, requireRole('PUBLIC'));

citizenRouter.get('/dashboard', async (req, res, next) => {
  try {
    const profile = await one<{
      id: string;
      name: string;
      email: string;
      email_verified: boolean;
      avatar_url: string | null;
      onboarding_completed: boolean;
      last_login_at: string | null;
      created_at: string;
      weather_notifications: boolean;
      news_notifications: boolean;
      latitude: number | null;
      longitude: number | null;
      location_label: string | null;
      weather_consent_at: string | null;
      news_consent_at: string | null;
    }>(
      `SELECT u.id, u.name, u.email, u.email_verified, u.avatar_url, u.onboarding_completed, u.last_login_at, u.created_at,
              COALESCE(p.weather_notifications,false) AS weather_notifications,
              COALESCE(p.news_notifications,true) AS news_notifications,
              p.latitude::float8 AS latitude, p.longitude::float8 AS longitude,
              p.location_label, p.weather_consent_at, p.news_consent_at
       FROM users u LEFT JOIN user_preferences p ON p.user_id=u.id
       WHERE u.id=$1`,
      [req.user!.id],
    );
    if (!profile) throw notFound('Citizen profile not found.');

    const key = profile.latitude !== null && profile.longitude !== null
      ? locationKey(profile.latitude, profile.longitude)
      : null;
    const reading = key
      ? await one<{
          observed_at: string;
          retrieved_at: string;
          latitude: number;
          longitude: number;
          temperature_c: number | null;
          relative_humidity: number | null;
          precipitation_mm: number | null;
          wind_speed_kmh: number | null;
          wind_gust_kmh: number | null;
          weather_code: number | null;
          source_id: string;
          is_simulated: boolean;
        }>(
          `SELECT observed_at, retrieved_at, latitude::float8 AS latitude, longitude::float8 AS longitude,
                  temperature_c::float8 AS temperature_c, relative_humidity::float8 AS relative_humidity,
                  precipitation_mm::float8 AS precipitation_mm,
                  wind_speed_kmh::float8 AS wind_speed_kmh, wind_gust_kmh::float8 AS wind_gust_kmh,
                  weather_code, source_id, is_simulated
           FROM citizen_weather_readings WHERE location_key=$1 ORDER BY observed_at DESC LIMIT 1`,
          [key],
        )
      : null;
    const events = key
      ? await query<{
          id: string;
          condition: string;
          severity: WeatherSeverity;
          measured_value: number | null;
          unit: string | null;
          starts_at: string;
          last_seen_at: string;
        }>(
          `SELECT id, condition, severity, measured_value::float8 AS measured_value, unit, starts_at, last_seen_at
           FROM weather_events WHERE location_key=$1 AND last_seen_at > now() - interval '24 hours'
           ORDER BY last_seen_at DESC LIMIT 5`,
          [key],
        )
      : [];
    const notifications = await query<{
      id: string;
      subject: string;
      status: string;
      sent_at: string | null;
      delivered_at: string | null;
      error: string | null;
      created_at: string;
    }>(
      `SELECT id, subject, status, sent_at, delivered_at, error, created_at
       FROM notifications WHERE user_id=$1 AND template IN ('WEATHER_ALERT','NEWS_ALERT')
       ORDER BY created_at DESC LIMIT 10`,
      [req.user!.id],
    );

    const classification = reading
      ? classifyWeather({
          temperatureC: reading.temperature_c,
          precipitationMm: reading.precipitation_mm,
          windSpeedKmh: reading.wind_speed_kmh,
          windGustKmh: reading.wind_gust_kmh,
          weatherCode: reading.weather_code,
        })
      : null;
    const integrity = reading
      ? weatherIntegrity({
          observedAt: reading.observed_at,
          fetchedAt: reading.retrieved_at,
          sourceId: reading.source_id,
          isSimulated: reading.is_simulated,
          demoMode: env.DEMO_MODE,
          latitude: reading.latitude,
          longitude: reading.longitude,
          temperatureC: reading.temperature_c,
          relativeHumidity: reading.relative_humidity,
          precipitationMm: reading.precipitation_mm,
          windSpeedKmh: reading.wind_speed_kmh,
          windGustKmh: reading.wind_gust_kmh,
        })
      : null;

    res.json({
      profile: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        emailVerified: profile.email_verified,
        avatarUrl: profile.avatar_url,
        onboardingCompleted: profile.onboarding_completed,
        lastLoginAt: profile.last_login_at,
        createdAt: profile.created_at,
        weatherNotifications: profile.weather_notifications,
        newsNotifications: profile.news_notifications,
        latitude: profile.latitude,
        longitude: profile.longitude,
        locationLabel: profile.location_label,
        weatherConsentAt: profile.weather_consent_at,
        newsConsentAt: profile.news_consent_at,
      },
      weather: reading && integrity
        ? {
            ...reading,
            status: integrity.status,
            provider: integrity.provider,
            data_source_type: integrity.dataSourceType,
            fetched_at: integrity.fetchedAt,
            observation_time: integrity.observationTime,
            forecast_time: integrity.forecastTime,
            is_live: integrity.isLive,
            freshness_status: integrity.freshnessStatus,
            validation_status: integrity.validationStatus,
            latitude: integrity.latitude,
            longitude: integrity.longitude,
            recommendation: weatherRecommendation(classification?.condition ?? ''),
            classification,
          }
        : {
            status: 'UNAVAILABLE' as const,
            provider: null,
            data_source_type: null,
            fetched_at: null,
            observation_time: null,
            forecast_time: null,
            is_live: false,
            freshness_status: 'UNAVAILABLE' as const,
            validation_status: 'INVALID' as const,
            latitude: profile.latitude,
            longitude: profile.longitude,
            recommendation: 'No verified live weather is available for your location. Follow local authority guidance.',
            classification: null,
            observed_at: null,
            temperature_c: null,
            relative_humidity: null,
            precipitation_mm: null,
            wind_speed_kmh: null,
            wind_gust_kmh: null,
            weather_code: null,
            source_id: null,
          },
      events,
      notifications,
    });
  } catch (error) {
    next(error);
  }
});

citizenRouter.put('/profile', async (req, res, next) => {
  try {
    const body = z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        localityId: z.string().uuid().nullable().optional(),
        locationLabel: z.string().trim().min(2).max(160),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        weatherNotifications: z.boolean(),
        newsNotifications: z.boolean().optional(),
        consent: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    const previous = await one<{
      latitude: number | null;
      longitude: number | null;
      location_label: string | null;
      weather_notifications: boolean;
      news_notifications: boolean;
      weather_consent_at: string | null;
      news_consent_at: string | null;
    }>(
      `SELECT latitude::float8 AS latitude, longitude::float8 AS longitude, location_label,
              COALESCE(weather_notifications,false) AS weather_notifications,
              COALESCE(news_notifications,true) AS news_notifications,
              weather_consent_at, news_consent_at
       FROM user_preferences WHERE user_id=$1`,
      [req.user!.id],
    );
    const nextNews = body.newsNotifications ?? previous?.news_notifications ?? true;
    const consentNeeded =
      (body.weatherNotifications && !previous?.weather_consent_at) ||
      (nextNews && !previous?.news_consent_at);
    if (consentNeeded && !body.consent) {
      throw badRequest('Explicit consent is required for weather or critical-news email alerts.');
    }
    if (body.weatherNotifications || nextNews) {
      const account = await one<{ email_verified: boolean }>('SELECT email_verified FROM users WHERE id=$1', [req.user!.id]);
      if (!account?.email_verified) {
        throw badRequest('A verified email address is required before enabling email alerts. Sign in with Google.');
      }
    }
    const changed =
      !previous ||
      previous.latitude === null ||
      previous.longitude === null ||
      Math.abs(previous.latitude - body.latitude) > 0.0001 ||
      Math.abs(previous.longitude - body.longitude) > 0.0001 ||
      previous.location_label !== body.locationLabel;

    await query(
      `INSERT INTO user_preferences
         (user_id, weather_notifications, news_notifications, latitude, longitude, location_label,
          weather_consent_at, news_consent_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (user_id) DO UPDATE SET
         weather_notifications=EXCLUDED.weather_notifications,
         news_notifications=EXCLUDED.news_notifications,
         latitude=EXCLUDED.latitude,
         longitude=EXCLUDED.longitude,
         location_label=EXCLUDED.location_label,
         weather_consent_at=CASE
           WHEN EXCLUDED.weather_notifications THEN COALESCE(EXCLUDED.weather_consent_at, user_preferences.weather_consent_at, now())
           ELSE user_preferences.weather_consent_at END,
         news_consent_at=CASE
           WHEN EXCLUDED.news_notifications THEN COALESCE(EXCLUDED.news_consent_at, user_preferences.news_consent_at, now())
           ELSE user_preferences.news_consent_at END,
         updated_at=now()`,
      [
        req.user!.id,
        body.weatherNotifications,
        nextNews,
        body.latitude,
        body.longitude,
        body.locationLabel,
        body.weatherNotifications && body.consent ? new Date().toISOString() : null,
        nextNews && body.consent ? new Date().toISOString() : null,
      ],
    );
    await query(
      `UPDATE users SET
         name=COALESCE($2,name),
         locality_id=COALESCE($3,locality_id),
         onboarding_completed=true,
         updated_at=now()
       WHERE id=$1`,
      [req.user!.id, body.name ?? null, body.localityId ?? null],
    );

    // A changed location must take effect without waiting for the next global
    // cycle. The worker reads preferences from PostgreSQL, never from a browser.
    if (changed) {
      void refreshCitizenLocation(req.user!.id).catch((error) => console.error('[citizen-weather-refresh]', error));
    }
    res.json({ message: 'Citizen location and notification preferences saved.', locationChanged: changed });
  } catch (error) {
    next(error);
  }
});

citizenRouter.post('/refresh', async (req, res, next) => {
  try {
    const result = await refreshCitizenLocation(req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

citizenRouter.get('/notifications', async (req, res, next) => {
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT id, subject, status, sent_at, delivered_at, error, weather_event_id, created_at
       FROM notifications WHERE user_id=$1 AND template IN ('WEATHER_ALERT','NEWS_ALERT')
       ORDER BY created_at DESC LIMIT 50`,
      [req.user!.id],
    );
    res.json({ notifications: rows });
  } catch (error) {
    next(error);
  }
});
