import { env, riverConfig, visionConfig, emailConfigured } from './env.js';

export type SourceStatus = 'CONNECTED' | 'NOT_CONFIGURED' | 'FAILED' | 'STALE';

export interface DataSource {
  id: string;
  name: string;
  category: string;
  provider: string;
  status: SourceStatus;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  attribution?: string;
  documentationUrl?: string;
  recordCount?: number;
  errorMessage?: string;
  notes?: string;
}

/**
 * Declarative registry. Runtime status lives in the data_sources table; this
 * catalogue explains what each connector is and how it is configured.
 */
export const DATA_SOURCE_CATALOGUE = [
  {
    id: 'cpcb-caaqms',
    name: 'CPCB CAAQMS (Mumbai)',
    category: 'air',
    provider: 'Central Pollution Control Board',
    documentationUrl: 'https://www.data.gov.in/datasets_webservices/datasets/3630781',
    attribution: 'CPCB / MPCB official monitoring networks via data.gov.in',
    configured: Boolean(env.DATA_GOV_IN_API_KEY && env.DATA_GOV_IN_AIR_RESOURCE_ID),
    notes:
      env.DATA_GOV_IN_API_KEY && env.DATA_GOV_IN_AIR_RESOURCE_ID
        ? 'Official CPCB real-time AQI is ingested through the data.gov.in resource. Only stations inside Greater Mumbai are stored. Values are station readings, not an official CPCB AQI.'
        : 'Set DATA_GOV_IN_API_KEY (free from data.gov.in) to enable the official CPCB real-time AQI feed. Demo station records remain labelled SIMULATION DATA and are never presented as CPCB readings.',
  },
  {
    id: 'mpcb',
    name: 'MPCB monitoring publications',
    category: 'air,water,waste,industrial',
    provider: 'Maharashtra Pollution Control Board',
    documentationUrl: 'https://mpcb.gov.in/',
    attribution: 'Maharashtra Pollution Control Board',
    configured: false,
    notes: 'MPCB connector is a documented adapter stub. No verified live endpoint or credentials are configured.',
  },
  {
    id: 'data-gov-in-air',
    name: 'data.gov.in air-quality resources',
    category: 'air',
    provider: 'Government of India Open Data Platform',
    documentationUrl: 'https://data.gov.in/',
    attribution: 'Government of India Open Data Platform',
    configured: Boolean(env.DATA_GOV_IN_API_KEY && env.DATA_GOV_IN_AIR_RESOURCE_ID),
    notes: 'Requires DATA_GOV_IN_API_KEY and a verified resource ID. Not configured by default.',
  },
  {
    id: 'openaq',
    name: 'OpenAQ',
    category: 'air',
    provider: 'OpenAQ',
    documentationUrl: 'https://docs.openaq.org/',
    attribution: 'OpenAQ and contributing monitoring networks',
    configured: Boolean(env.OPENAQ_API_KEY),
    notes: 'Requires an OpenAQ API key. Not configured by default.',
  },
  {
    id: 'open-meteo-weather',
    name: 'Open-Meteo weather',
    category: 'weather',
    provider: 'Open-Meteo',
    documentationUrl: 'https://open-meteo.com/en/docs',
    attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
    configured: true,
    notes: 'Live observations and forecasts at Mumbai station coordinates. No API key required.',
  },
  {
    id: 'open-meteo-cams',
    name: 'CAMS regional air quality (via Open-Meteo)',
    category: 'air',
    provider: 'Copernicus CAMS / Open-Meteo',
    documentationUrl: 'https://open-meteo.com/en/docs/air-quality-api',
    attribution: 'CAMS European/global atmospheric model via Open-Meteo; modelled data, not a station measurement',
    configured: true,
    notes:
      'Modelled regional PM2.5/PM10 used only as labelled context. Never displayed as a CPCB station reading or official AQI.',
  },
  {
    id: 'demo-network',
    name: 'प्रकृति demo network',
    category: 'air,water',
    provider: 'प्रकृति (synthetic)',
    documentationUrl: '/about',
    attribution: 'Deterministic synthetic data for demonstration',
    configured: true,
    notes: 'Every record is marked is_simulated=true and displayed as SIMULATION DATA.',
  },
  {
    id: 'river-ai',
    name: 'River AI language model',
    category: 'ai',
    provider: 'River AI',
    documentationUrl: 'https://api.river.ai/v1',
    attribution: 'River AI · zai-org/GLM-5.3-Flash',
    configured: riverConfig.configured,
    notes: riverConfig.configured
      ? 'Server-side adapter configured. Responses are grounded in retrieved application evidence.'
      : 'RIVER_API_KEY is empty. The AI Analyst uses a labelled rule-based evidence digest instead of an LLM.',
  },
  {
    id: 'vision-ai',
    name: 'AI image assessment',
    category: 'ai',
    provider: 'Separate vision provider',
    documentationUrl: '',
    attribution: '',
    configured: visionConfig.configured,
    notes:
      'Uses a separately configured vision model. River open-weight models and any OpenAI-compatible endpoint are supported. Without one, image analysis is NOT CONFIGURED.',
  },
  {
    id: 'ml-service',
    name: 'LightGBM forecasting service',
    category: 'ml',
    provider: 'Local Python model service',
    documentationUrl: '/docs/ML_METHODOLOGY.md',
    attribution: 'प्रकृति ML',
    configured: false,
    notes:
      'No verified Mumbai historical training extract has been supplied. Models are NOT TRAINED. The app exposes a clearly labelled persistence baseline instead of claiming ML forecasts.',
  },
  {
    id: 'email',
    name: 'Email notification delivery',
    category: 'notifications',
    provider: env.EMAIL_PROVIDER === 'console' ? 'Simulation log' : 'SMTP / API provider',
    documentationUrl: '',
    attribution: '',
    configured: emailConfigured,
    notes: emailConfigured
      ? 'Delivery provider configured. DELIVERED is only recorded from provider webhooks; accepted API calls are marked SENT.'
      : 'No email provider configured. Notifications are generated as clearly labelled simulation records and are not sent.',
  },
  {
    id: 'evidence-storage',
    name: 'Evidence storage',
    category: 'storage',
    provider: env.STORAGE_DRIVER === 'local' ? 'Local private storage' : 'S3-compatible object storage',
    documentationUrl: '',
    attribution: '',
    configured: env.STORAGE_DRIVER === 'local' || Boolean(env.STORAGE_ENDPOINT && env.STORAGE_BUCKET),
    notes: 'Citizen evidence is private by default and served only through an authorised API route.',
  },
  {
    id: 'openfreemap',
    name: 'OpenFreeMap vector tiles',
    category: 'mapping',
    provider: 'OpenFreeMap / OpenMapTiles',
    documentationUrl: 'https://openfreemap.org/',
    attribution: 'OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors (ODbL)',
    configured: true,
    notes:
      'Public instance is free with no request limit and commercial use is allowed; attribution is required. 3D building heights are render heights for visual context, not surveyed data.',
  },
] as const;

export type DataSourceId = (typeof DATA_SOURCE_CATALOGUE)[number]['id'];

export const sourceById = (id: string) => DATA_SOURCE_CATALOGUE.find((s) => s.id === id);
