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
    id: 'met-no-weather',
    name: 'MET Norway location forecast',
    category: 'weather',
    provider: 'Norwegian Meteorological Institute',
    documentationUrl: 'https://api.met.no/weatherapi/locationforecast/2.0/documentation',
    attribution: 'Weather data from MET Norway (CC BY 4.0 / NLOD)',
    configured: true,
    notes: 'Keyless fallback for the Live City weather layer when Open-Meteo is rate-limited. UV and precipitation probability remain blank when MET Norway does not publish them.',
  },
  {
    id: 'open-meteo-marine',
    name: 'Open-Meteo marine conditions',
    category: 'coastal',
    provider: 'Open-Meteo',
    documentationUrl: 'https://open-meteo.com/en/docs/marine-weather-api',
    attribution: 'Marine data by Open-Meteo.com (CC BY 4.0)',
    configured: true,
    notes: 'Wave, swell and sea-surface temperature at the nearest sea grid point. Queried on demand by the Live City workspace; not a tide gauge or harbour observation.',
  },
  {
    id: 'open-meteo-flood',
    name: 'Open-Meteo river discharge',
    category: 'water',
    provider: 'Open-Meteo',
    documentationUrl: 'https://open-meteo.com/en/docs/flood-api',
    attribution: 'River discharge by Open-Meteo.com (CC BY 4.0)',
    configured: true,
    notes: 'Global modelled river discharge at the nearest grid cell. Queried on demand; not an official flood warning, tide gauge or municipal drain reading.',
  },
  {
    id: 'open-meteo-archive',
    name: 'Open-Meteo historical weather',
    category: 'weather',
    provider: 'Open-Meteo',
    documentationUrl: 'https://open-meteo.com/en/docs/historical-weather-api',
    attribution: 'Historical reanalysis by Open-Meteo.com (CC BY 4.0)',
    configured: true,
    notes: 'Past-day reanalysis used by the “this day last year” comparison. Grid-point data, not a past station observation.',
  },
  {
    id: 'open-meteo-geocoding',
    name: 'Open-Meteo geocoding',
    category: 'mapping',
    provider: 'Open-Meteo',
    documentationUrl: 'https://open-meteo.com/en/docs/geocoding-api',
    attribution: 'Geocoding by Open-Meteo.com',
    configured: true,
    notes: 'Fallback locality search for the Live City workspace. No API key.',
  },
  {
    id: 'osm-nominatim',
    name: 'OpenStreetMap Nominatim',
    category: 'mapping',
    provider: 'OpenStreetMap contributors',
    documentationUrl: 'https://nominatim.org/',
    attribution: 'Geocoding © OpenStreetMap contributors (ODbL)',
    configured: true,
    notes: 'Locality search restricted to the Mumbai viewbox. Requests are cached server-side and sent with an identifying user agent.',
  },
  {
    id: 'osm-overpass',
    name: 'OpenStreetMap Overpass API',
    category: 'mapping',
    provider: 'OpenStreetMap contributors',
    documentationUrl: 'https://wiki.openstreetmap.org/wiki/Overpass_API',
    attribution: '© OpenStreetMap contributors (ODbL)',
    configured: true,
    notes: 'Nearby parks, gardens and named water bodies within 4 km. Community-mapped, not an official park inventory.',
  },
  {
    id: 'osm-valhalla',
    name: 'Valhalla walking routes',
    category: 'mapping',
    provider: 'OpenStreetMap Deutschland',
    documentationUrl: 'https://valhalla.github.io/valhalla/',
    attribution: 'Routing by Valhalla / OpenStreetMap contributors (ODbL)',
    configured: true,
    notes: 'Pedestrian route estimates to nearby green spaces. The public demo router can rate-limit; the UI falls back to a straight-line distance link when it does.',
  },
  {
    id: 'nasa-eonet',
    name: 'NASA EONET natural events',
    category: 'hazards',
    provider: 'NASA Earth Observatory',
    documentationUrl: 'https://eonet.gsfc.nasa.gov/',
    attribution: 'NASA EONET',
    configured: true,
    notes: 'Open natural events inside the India bounding box for the last 30 days. Event positions are not Mumbai-specific hazards.',
  },
  {
    id: 'usgs-earthquakes',
    name: 'USGS earthquake feed',
    category: 'hazards',
    provider: 'United States Geological Survey',
    documentationUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php',
    attribution: 'USGS Earthquake Hazards Program',
    configured: true,
    notes: 'Magnitude 2.5+ events in the last week, filtered to the India bounding box. Often empty for Mumbai, which is an honest result.',
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
      'No verified Mumbai historical training extract has been supplied. Forecasting runs on a clearly labelled persistence baseline instead of claiming ML skill.',
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
