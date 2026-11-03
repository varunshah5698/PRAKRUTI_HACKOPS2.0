# Data Sources

Source status is shown in the application at `/data-sources` and via `GET /api/v1/sources/status`. The database table is `data_sources`; every ingestion attempt is recorded in `ingestion_jobs`.

## Current status

| ID | Source | Status | Records | Notes |
|---|---|---|---|---|
| `cpcb-caaqms` | CPCB CAAQMS (Mumbai) | NOT_CONFIGURED | 0 | No documented credentialled machine API is configured. Demo stations are not CPCB stations. |
| `mpcb` | MPCB monitoring publications | LIVE SUBSET via OpenAQ | 12 stations | No direct MPCB API is configured. OpenAQ supplies MPCB/IITM-operated Mumbai stations with upstream timestamps. |
| `data-gov-in-air` | data.gov.in air-quality resource | NOT_CONFIGURED | 0 | Requires `DATA_GOV_IN_API_KEY`. Verified resource ID `3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69` is pre-filled. |
| `openaq` | OpenAQ | CONNECTED locally | 12 Mumbai stations (7 current) | `OPENAQ_API_KEY` configured in `.env.local`; v3 locations + latest, hourly PM2.5 backfill, Mumbai-coordinate filter. Includes MPCB/IITM stations; source is OpenAQ. |
| `open-meteo-weather` | Open-Meteo weather | CONNECTED | 285 (seed) | Live observations + 18h forecasts at demo station coordinates. |
| `open-meteo-cams` | CAMS regional air quality | CONNECTED | 20 (seed) | Modelled PM2.5/PM10, not a station measurement. |
| `demo-network` | प्रकृति demo network | CONNECTED | 4,566 (seed) | All records `is_simulated=true`. |
| `river-ai` | River AI | CONNECTED locally | — | `RIVER_API_KEY` is set in the gitignored `.env.local`; adapter verified against `zai-org/GLM-5.3-Flash`. Empty by default in `.env.example`; rule-based fallback remains if absent. |
| `vision-ai` | AI image assessment | CONNECTED locally | — | Open-weight models over an OpenAI-compatible endpoint: Groq `qwen/qwen3.8-27b` locally; River `moonshotai/Kimi-K3` with `zai-org/GLM-5.3-Flash` fallback verified. Key is only in the gitignored `.env.local`; `.env.example` leaves the key empty. |
| `ml-service` | LightGBM forecasting service | CONNECTED locally | — | Trained on the 23-station OpenAQ Mumbai archive; FastAPI service on `ML_SERVICE_URL`. Artifacts are gitignored, so a clean deployment falls back to the labelled persistence baseline. |
| `email` | Email delivery | NOT_CONFIGURED (transport verified) | — | Nodemailer SMTP path verified against a local sink. Add `SMTP_HOST`, `SMTP_USER` and `SMTP_PASSWORD` for real delivery; otherwise notifications stay `SIMULATED`. |
| `evidence-storage` | Evidence storage | CONNECTED | — | Local private storage. |
| `openfreemap` | OpenFreeMap vector tiles | CONNECTED | — | Attribution required. |

## CPCB and MPCB

The brief requires official CPCB/MPCB data where available. This deployment does **not** have a documented, credentialled CPCB/MPCB machine endpoint. It therefore:

- does not invent CPCB station IDs,
- does not label demo stations as CPCB stations,
- does not claim CPCB connectivity,
- shows `NOT_CONFIGURED` in the source registry and dashboard.

The `data.gov.in` and OpenAQ adapters are implemented and will run only when configured. They normalise records into the same observation table with source identifiers and timestamps.

### Configuring data.gov.in

1. Create a free data.gov.in account and API key.
2. Add `DATA_GOV_IN_API_KEY` to `.env.local`. The verified CPCB real-time AQI resource ID `3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69` is pre-filled; confirm it is still current on data.gov.in.
3. Restart the API and run `npm run integrations:check`.
4. Open `/data-sources` and trigger ingestion, or wait for the scheduled job.
5. Verify Mumbai station names, coordinates, source timestamps and units before trusting a record.

The commonly referenced CPCB real-time AQI resource must be verified for current availability and field schema; the adapter does not assume an unverified resource ID.

### data.gov.in adapter expectations

The adapter uses the commonly published CPCB city air-quality resource fields: `station`, `pollutant_id`, `pollutant_avg`, `pollutant_unit`, `last_update`, `latitude`, `longitude`. It validates:

- coordinates inside the Greater Mumbai boundary,
- pollutant mapping,
- numeric value,
- unit presence,
- timestamp validity.

The internal station code is `DATA_GOV_IN:<station name>` and metadata records the source station name. It does not claim an official CPCB station ID.

### OpenAQ adapter

Uses OpenAQ v3 `locations` with a Mumbai coordinate/radius and `locations/:id/latest`. Only coordinates inside Mumbai are stored. Internal station code is `OPENAQ-<location id>` (OpenAQ's identifier, not CPCB's).

The live pull currently returns 12 Mumbai stations, including MPCB and IITM-operated stations. Some stations are stale (2021–2022); they are marked `DEGRADED`, their old timestamps are preserved, and they are excluded from current dashboard, map and public counts once their latest observation is older than 6 hours. The API exposes the excluded count so the UI can say how many were hidden. They are never presented as current CPCB readings. Source attribution is OpenAQ and the upstream operator shown in the station name.

For trained forecasts, the adapter also backfills the OpenAQ hourly PM2.5 series for each live station when fewer than 25 hourly values exist. The model therefore uses the current sensor's hourly data, not the legacy duplicate sensor.

## Open-Meteo weather

- Endpoint: `OPEN_METEO_BASE_URL` (`https://api.open-meteo.com`).
- Current: temperature, relative humidity, precipitation, wind speed, wind direction, surface pressure.
- Forecast: hourly for 18 hours.
- Licence/attribution: Weather data by Open-Meteo.com (CC BY 4.0).
- Weather is context, not evidence of causation.

## CAMS regional air quality

- Endpoint: `OPEN_METEO_AIR_QUALITY_BASE_URL` (`https://air-quality-api.open-meteo.com`).
- Current modelled PM2.5 and PM10 at locality coordinates.
- Stored with `station_id = NULL`, `quality_state = 'MODELLED'`, source `open-meteo-cams`.
- Never used as a station reading, official AQI or CPCB record.

## Demo network

- 15 synthetic stations: 10 air, 3 water sampling, 2 industrial stack.
- Station codes `DEMO-AIR-01..10`, `DEMO-WATER-01..03`, `DEMO-IND-01..02`.
- Provider: “प्रकृति demo network (synthetic)”.
- Every station, observation, report, alert and incident is marked simulation.
- Deterministic seeded observations; no fabricated photographs.
- Names like “Colaba demo air monitor” deliberately avoid official CPCB station identity.

## Mapping

- **OpenFreeMap** public vector tile instance: free, no request limit, commercial use allowed; attribution required. Terms checked at https://openfreemap.org/ and https://openfreemap.org/tos/.
- **OpenStreetMap** data © OpenStreetMap contributors, ODbL 1.0.
- **Boundary**: OSM relations 7964375 (Mumbai Suburban District) and 7964376 (Mumbai City District), retrieved via Nominatim on 3 November 2026. Greater Mumbai is represented as the union of these two district polygons.
- **Localities**: 26 reference points geocoded via Nominatim with a 1.2s request interval. These are locality reference points, not authoritative ward centroids.
- **3D buildings**: OpenMapTiles `render_height` / `render_min_height`, a rendering value, not surveyed height.
- No public OSM tile server is used for production traffic.

## River AI

- Base URL `https://api.river.ai/v1`, model `zai-org/GLM-5.3-Flash`.
- Server-side adapter only; the key never reaches the browser.
- The adapter assumes an OpenAI-compatible `/chat/completions` interface. This has not been verified against a live key in this deployment. If the provider's API differs, adapt `server/src/services/ai/analyst.ts`.
- Without a key: `NOT_CONFIGURED`, rule-based evidence digest.

## Vision AI

- Separate `VISION_BASE_URL`, `VISION_MODEL`, `VISION_API_KEY` and optional `VISION_FALLBACK_MODELS`.
- Set `VISION_FALLBACK_BASE_URL` to run fallback models on a second provider; a River-hosted fallback reuses `RIVER_API_KEY`, other providers need `VISION_FALLBACK_API_KEY`. Without a fallback base URL, fallbacks reuse the primary endpoint.
- This workspace uses Groq `qwen/qwen3.8-27b` at `https://api.groq.com/openai/v1`, then River `moonshotai/Kimi-K3` and `zai-org/GLM-5.3-Flash` when the Groq rate limit is hit; keys are only in `.env.local`.
- Any OpenAI-compatible vision endpoint works. Google Gemini remains supported through its native `generateContent` path.
- Without configuration, image analysis is `NOT_CONFIGURED`; the report still stores the private image and metadata.
- The adapter returns only visible-feature descriptions and limitations. It cannot establish chemical composition, toxicity, concentration or legal responsibility.

## Email

- With no SMTP credentials, notifications are stored as `SIMULATED` and nothing is sent.
- Setting `SMTP_HOST`, `SMTP_USER` and `SMTP_PASSWORD` enables Nodemailer delivery; `EMAIL_PROVIDER` is informational once credentials exist.
- `DEMO_MODE=true` restricts delivery to `DEMO_EMAIL_RECIPIENT`; if empty, no email is sent.
- `SENT` means the provider accepted the message. `DELIVERED` is only recorded through `POST /api/v1/notifications/webhook` with `EMAIL_WEBHOOK_SECRET`.

## Evidence storage

- Default: local private directory `server/storage/evidence`, mode `0600`.
- Served only via authenticated `/api/v1/evidence/:id`.
- S3-compatible storage is a documented extension point (`STORAGE_DRIVER`, endpoint/bucket/key variables); no adapter is implemented.
