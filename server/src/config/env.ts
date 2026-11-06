import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),
  DATABASE_URL: z.string().default('postgresql://localhost:5432/enviropulse'),
  JWT_SECRET: z.string().min(16).default('local-dev-secret-change-me-please'),
  SESSION_SECRET: z.string().default('local-dev-session-secret'),
  RIVER_BASE_URL: z.string().default('https://api.river.ai/v1'),
  RIVER_MODEL: z.string().default('zai-org/GLM-5.3-Flash'),
  RIVER_API_KEY: z.string().default(''),
  VISION_BASE_URL: z.string().default(''),
  VISION_MODEL: z.string().default(''),
  VISION_FALLBACK_MODELS: z.string().default(''),
  VISION_FALLBACK_BASE_URL: z.string().default(''),
  VISION_FALLBACK_API_KEY: z.string().default(''),
  VISION_API_KEY: z.string().default(''),
  DATA_GOV_IN_API_KEY: z.string().default(''),
  DATA_GOV_IN_AIR_RESOURCE_ID: z.string().default(''),
  OPENAQ_API_KEY: z.string().default(''),
  OPEN_METEO_BASE_URL: z.string().default('https://api.open-meteo.com'),
  OPEN_METEO_AIR_QUALITY_BASE_URL: z.string().default('https://air-quality-api.open-meteo.com'),
  // Live polling cadence. Upstream models publish on their own clocks (Open-Meteo
  // current weather has a 900 s interval), so polling faster only detects the new
  // value sooner — it never invents readings.
  LIVE_ENABLED: z.string().default('true').transform((v) => v.toLowerCase() === 'true'),
  LIVE_WEATHER_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(900),
  LIVE_AQI_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(900),
  LIVE_SIMULATION_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(60),
  // CPCB/CAAQMS and OpenAQ republish on an hourly clock, so a 15-minute poll
  // detects a new value without hammering the provider.
  LIVE_AIR_QUALITY_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(900),
  OPS_ALERT_WEBHOOK_URL: z.string().default(''),
  ML_SERVICE_URL: z.string().default(''),
  ML_SERVICE_API_KEY: z.string().default(''),
  AI_EVIDENCE_CHAR_LIMIT: z.coerce.number().int().min(10_000).max(400_000).default(120_000),
  MAP_STYLE_URL: z.string().default('https://tiles.openfreemap.org/styles/liberty'),
  MAP_TILE_PROVIDER: z.string().default('OpenFreeMap'),
  EMAIL_PROVIDER: z.string().default('console'),
  EMAIL_API_KEY: z.string().default(''),
  BREVO_API_KEY: z.string().default(''),
  BREVO_API_BASE_URL: z.string().default('https://api.brevo.com/v3'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.string().default('').transform((v) => v.toLowerCase() === 'true'),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  EMAIL_FROM: z.string().default('प्रकृति <alerts@enviropulse.local>'),
  EMAIL_FROM_NAME: z.string().default(''),
  EMAIL_WEBHOOK_SECRET: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z.string().default(''),
  CITIZEN_MONITOR_ENABLED: z.string().default('true').transform((v) => v.toLowerCase() === 'true'),
  CITIZEN_MONITOR_INTERVAL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  CITIZEN_MONITOR_MIN_SEVERITY: z.enum(['NORMAL', 'MODERATE', 'HIGH', 'CRITICAL']).default('HIGH'),
  CITIZEN_MONITOR_COOLDOWN_MINUTES: z.coerce.number().int().min(60).max(1440).default(360),
  CITIZEN_MONITOR_MAX_RETRIES: z.coerce.number().int().min(1).max(20).default(5),
  NEWS_MONITOR_ENABLED: z.string().default('true').transform((v) => v.toLowerCase() === 'true'),
  NEWS_MONITOR_INTERVAL_SECONDS: z.coerce.number().int().min(120).max(3600).default(900),
  NEWS_MONITOR_COOLDOWN_MINUTES: z.coerce.number().int().min(60).max(2880).default(360),
  NEWS_MONITOR_MAX_ITEMS: z.coerce.number().int().min(1).max(10).default(3),
  E2E_TEST_ENABLED: z.string().default('false').transform((v) => v.toLowerCase() === 'true'),
  E2E_TEST_DOMAIN: z.string().default('fldubai.com'),
  STORAGE_DRIVER: z.string().default('local'),
  STORAGE_ENDPOINT: z.string().default(''),
  STORAGE_BUCKET: z.string().default(''),
  STORAGE_ACCESS_KEY: z.string().default(''),
  STORAGE_SECRET_KEY: z.string().default(''),
  DEMO_MODE: z.string().default('true').transform((v) => v.toLowerCase() === 'true'),
  DEMO_EMAIL_RECIPIENT: z.string().default(''),
});

export const env = EnvSchema.parse(process.env);

if (env.NODE_ENV === 'production' && env.JWT_SECRET.includes('local-dev')) {
  throw new Error('JWT_SECRET must be replaced with a strong production secret.');
}
if (env.NODE_ENV === 'production' && env.DEMO_MODE) {
  console.warn('[config] DEMO_MODE is enabled in production. Synthetic records remain labelled.');
}

export const riverConfig = {
  baseURL: env.RIVER_BASE_URL,
  model: env.RIVER_MODEL,
  apiKey: env.RIVER_API_KEY,
  configured: env.RIVER_API_KEY.length > 0,
};

// If no second provider is configured, reuse River (already required for the
// analyst) so a vision rate limit on the primary provider does not lose the
// assessment. Explicit VISION_FALLBACK_* values still win.
const fallbackBaseURL =
  env.VISION_FALLBACK_BASE_URL || (env.RIVER_API_KEY ? env.RIVER_BASE_URL : env.VISION_BASE_URL);
const fallbackApiKey =
  env.VISION_FALLBACK_API_KEY ||
  (fallbackBaseURL.includes('river.ai') ? env.RIVER_API_KEY : env.VISION_API_KEY);
const fallbackModels =
  env.VISION_FALLBACK_MODELS ||
  (fallbackBaseURL.includes('river.ai') ? env.RIVER_MODEL : '');

// A configured fallback alone is enough to assess images. This keeps vision
// working on Render when VISION_API_KEY is left blank but RIVER_API_KEY is set.
const primaryVisionConfigured = Boolean(env.VISION_BASE_URL && env.VISION_MODEL && env.VISION_API_KEY);
const fallbackVisionConfigured = Boolean(fallbackBaseURL && fallbackApiKey && fallbackModels);

export const visionConfig = {
  baseURL: env.VISION_BASE_URL,
  model: env.VISION_MODEL,
  apiKey: env.VISION_API_KEY,
  fallbackBaseURL,
  fallbackApiKey,
  fallbackModels,
  configured: primaryVisionConfigured || fallbackVisionConfigured,
};

// SMTP credentials are the switch: adding them enables real delivery even if
// EMAIL_PROVIDER was left at its default. Gmail is the exception to the host
// requirement because Nodemailer's `gmail` service selects the host itself.
// Without credentials the app stores notifications as SIMULATED and never
// pretends an email was sent.
const gmailTransport =
  env.EMAIL_PROVIDER === 'gmail' || env.SMTP_HOST.toLowerCase().endsWith('gmail.com');
const brevoTransport = env.EMAIL_PROVIDER.toLowerCase() === 'brevo';

export const emailConfigured = brevoTransport
  ? Boolean(env.BREVO_API_KEY && env.EMAIL_FROM.trim())
  : Boolean(env.SMTP_USER && env.SMTP_PASSWORD && (env.SMTP_HOST || gmailTransport));

export const emailProviderLabel = !emailConfigured
  ? 'NOT_CONFIGURED'
  : brevoTransport
    ? 'BREVO'
    : gmailTransport
      ? 'GMAIL'
      : 'SMTP';

export const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const googleRedirectUri =
  env.GOOGLE_REDIRECT_URI.trim() ||
  `${env.FRONTEND_URL.replace(/\/+$/, '')}/api/v1/auth/google/callback`;

if (env.NODE_ENV === 'production' && !emailConfigured) {
  console.error('[config] Email is NOT_CONFIGURED. Weather alerts will be recorded but never sent.');
}

export const appConfig = {
  timezone: env.APP_TIMEZONE,
  demoMode: env.DEMO_MODE,
  storageRoot: path.join(root, 'server', 'storage'),
};
