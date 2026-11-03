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
  LIVE_WEATHER_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(60),
  LIVE_AQI_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(300),
  LIVE_SIMULATION_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(60),
  ML_SERVICE_URL: z.string().default(''),
  ML_SERVICE_API_KEY: z.string().default(''),
  MAP_STYLE_URL: z.string().default('https://tiles.openfreemap.org/styles/liberty'),
  MAP_TILE_PROVIDER: z.string().default('OpenFreeMap'),
  EMAIL_PROVIDER: z.string().default('console'),
  EMAIL_API_KEY: z.string().default(''),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  EMAIL_FROM: z.string().default('प्रकृति <alerts@enviropulse.local>'),
  EMAIL_WEBHOOK_SECRET: z.string().default(''),
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

export const visionConfig = {
  baseURL: env.VISION_BASE_URL,
  model: env.VISION_MODEL,
  apiKey: env.VISION_API_KEY,
  configured: Boolean(env.VISION_BASE_URL && env.VISION_MODEL && env.VISION_API_KEY),
};

export const emailConfigured =
  env.EMAIL_PROVIDER === 'smtp' && Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);

export const appConfig = {
  timezone: env.APP_TIMEZONE,
  demoMode: env.DEMO_MODE,
  storageRoot: path.join(root, 'server', 'storage'),
};
