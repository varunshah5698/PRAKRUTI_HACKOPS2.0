# प्रकृति

Environmental intelligence, prediction and compliance workflows for Greater Mumbai.

This is a working demonstration application, not a static dashboard. It connects:

- an environmental command centre,
- an immersive Atmosphere lab with 3D dispersion columns, scenario forecasting and model transparency,
- an interactive 3D Mumbai map with timeline replay, real OpenStreetMap facility locations, a wind-alignment screen and CAMS modelled context,
- predictive intelligence with explicit model status,
- a grounded AI analyst,
- citizen reporting with private evidence,
- category-specific risk assessment,
- alerts and an audited incident workflow,
- regulatory references with averaging-aware comparisons,
- notification generation and delivery tracking,
- and a deterministic simulation engine isolated from real observations.

## Honest status

| Area | Status in this deployment |
|---|---|
| CPCB CAAQMS | **NOT CONNECTED** — no data.gov.in API key is configured. The official resource ID is pre-filled. |
| MPCB | **ARCHIVE SUBSET via OpenAQ** — 29 Mumbai stations (MPCB/IITM/BMC operators); 7 have readings from the last 24 hours; not a direct MPCB API |
| OpenAQ | **ARCHIVE IMPORTED, LIVE KEY NOT SET** — `OPENAQ_API_KEY` is empty, so no new OpenAQ polls run. Imported station readings are shown as real records with their last-observed age; no synthetic station stands in for them. |
| Demo monitoring stations | **SIMULATION DATA, EXCLUDED FROM THE MAP** — synthetic stations remain for seeded demo screens but the map queries only non-simulated stations. |
| Weather | **LIVE** — Open-Meteo at station coordinates |
| CAMS regional air quality | **MODELLED** — Copernicus CAMS via Open-Meteo, not a station measurement |
| LightGBM / quantile / exceedance models | **TRAINED LOCALLY** — 23-station OpenAQ Mumbai extract, 2025-03-01 to 2026-10-27; temporal and spatial-holdout metrics in `ml/artifacts/model_card.json`. Artifacts are gitignored, so a clean or Render deployment stays `NOT_TRAINED` until they are force-added. |
| Anomaly detector | **NOT TRAINED** — `ZSCORE_V1` analytical check only |
| Forecasts shown | **LIGHTGBM_TRAINED when `ML_SERVICE_URL` points at the local service**; otherwise the labelled `PERSISTENCE_BASELINE_V1` with an empirical, non-calibrated band |
| River AI | **CONFIGURED locally** — `RIVER_API_KEY` is set in the gitignored `.env.local`; adapter verified. Empty by default in `.env.example`. |
| Vision AI | **CONFIGURED locally** — Groq (`qwen/qwen3.8-27b`) with a River open-weight fallback; keys only in `.env.local`. |
| Email | **SMTP transport verified; no recipient configured** — adding `SMTP_USER` and `SMTP_PASSWORD` (with `EMAIL_PROVIDER=gmail` for Gmail) enables real delivery. Without them, records remain `SIMULATED` and nothing is sent. Critical alerts are broadcast to every active account. |
| Evidence storage | **LOCAL_PRIVATE** — authenticated access only |
| Map tiles | **OpenFreeMap** public instance (free, no API key, attribution required) |
| Live City open data | **LIVE / MODELLED, LABELLED** — Open-Meteo weather, CAMS air, marine, flood and archive layers; MET Norway weather fallback; OpenStreetMap Nominatim/Overpass; Valhalla walking routes; NASA EONET; USGS. Context only, never station evidence. |
| Industrial source screen | **REAL OSM LOCATIONS, SCREENING ONLY** — 13 named OpenStreetMap facilities. Corridors and monitor shares are a distance/wind screening estimate; OSM has no stack height or emission measurement for these features. Not a measured apportionment or regulatory finding. |
| Database | PostgreSQL 18 + PostGIS 3.7 |

No synthetic reading is presented as a CPCB reading. No forecast is presented as trained ML output. No automated finding is presented as an official regulatory determination.

## Stack

- **Web**: React 18, Vite, TypeScript, Tailwind CSS, shadcn-style local UI components, Framer Motion, Zustand, React Router, Apache ECharts, Lucide, MapLibre GL JS 6, OpenFreeMap, GeoJSON.
- **API**: Node.js 22, TypeScript, Express, `pg`, Zod, JWT cookie auth, Multer, Nodemailer adapter, SSE.
- **Database**: PostgreSQL + PostGIS (`geography(Point,4326)`), SQL schema, typed query helpers.
- **ML**: Python training pipeline in `ml/` using LightGBM, pandas, NumPy, scikit-learn, SHAP and Joblib. Trained locally on the 23-station OpenAQ Mumbai extract; serving through `ml/serve.py` (FastAPI) on `ML_SERVICE_URL`. Model artifacts are gitignored, so a clean deployment stays `NOT_TRAINED` until they are force-added.
- **Map data**: OpenStreetMap via OpenFreeMap/OpenMapTiles; Mumbai boundary from OSM via Nominatim (ODbL); 3D heights are OpenMapTiles render heights, not surveyed data.

## Quick start

### Prerequisites

- Node.js 22+
- PostgreSQL with PostGIS (PostgreSQL 18 + PostGIS 3.7 used here)
- npm

### 1. Configure

```bash
cp .env.example .env.local
```

Set `DATABASE_URL` and a local `JWT_SECRET`. The checked-in `.env.local` points to the local development database:

```env
DATABASE_URL=postgresql://varunnitinshah@localhost:5433/enviropulse
```

If your PostgreSQL runs on 5432 or uses a password, change this value. Never commit real credentials.

Optional full portable stack (PostGIS + API + built web, no local PostgreSQL needed):

```bash
docker compose up --build
```

Then open http://localhost:4000. The app container waits for PostGIS, applies the schema, seeds the demo dataset and starts the API. Set `JWT_SECRET` in your shell or a `.env` file before using it outside local development. The database is exposed on port 5433 for debugging.

If you only want the database:

```bash
docker compose up -d db
cp .env.docker.example .env.local
```

Then run the schema and seed steps below.

This workspace was set up with Homebrew PostgreSQL 18 + PostGIS on port 5433. If that server is not running after a reboot:

```bash
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /opt/homebrew/var/postgresql@18 -o "-p 5433" -l /tmp/enviropulse-pg18.log start
```

### 2. Database

```bash
npm install
npm run db:setup     # creates the database and schema
npm run db:seed      # deterministic demo dataset + live weather/CAMS ingest
```

`db:seed` refuses to run twice unless the database is reset:

```bash
npm run db:reset
npm run db:seed
```

### 3. Run

```bash
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000
- Health: http://localhost:4000/api/health

Production build:

```bash
npm run build
npm start
```

The API serves `web/dist` when present.

### Critical email alerts through Gmail

When an air-quality, water, waste or industrial assessment reaches **CRITICAL**, the alert engine creates a notification for **every active account** — not just users who opted into that category — and sends it through the configured transport. Users see the same record in **Notifications** with its delivery status.

`SENT` means the provider accepted the message. `DELIVERED` is only set by a provider webhook (`POST /api/notifications/webhook` with `x-webhook-secret`). If credentials are missing, the record stays `SIMULATED` and nothing is sent.

1. Enable 2-Step Verification on the Google account, then create an **App password** (Google Account → Security → App passwords → Mail).
2. In `.env.local`:

   ```bash
   EMAIL_PROVIDER=gmail
   SMTP_USER=your.name@gmail.com
   SMTP_PASSWORD=the-16-character-app-password
   EMAIL_FROM="प्रकृति Alerts <your.name@gmail.com>"   # optional; falls back to SMTP_USER
   DEMO_MODE=false
   ```

3. Restart the API, sign in as an authority role, and use **Notifications → Send test email** to verify the transport before relying on it.

Keep `DEMO_MODE=true` when demonstrating: every message is redirected to `DEMO_EMAIL_RECIPIENT` and the subject is prefixed with `[DEMO]`, so a public demo never mails real users. For a non-Gmail SMTP relay, leave `EMAIL_PROVIDER=smtp` and fill `SMTP_HOST`/`SMTP_PORT` instead.

## Deploy on Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/varunshah5698/PRAKRUTI_HACKOPS2.0)

`render.yaml` provisions the Node web service (API + built SPA), an optional ML inference web service, and a PostGIS-enabled Postgres database. The app is wired to the ML service automatically with a generated API key.

1. Push this repository to GitHub.
2. In Render: **New → Blueprint**, select the repository, and click **Apply**.
3. That is it. On boot the service applies `server/src/db/schema.sql`, retrying while Render's Postgres is still provisioning; if the database is empty and `DEMO_MODE` is on, the demo dataset is seeded in the background so the health check is not blocked.

Notes:

- `prakruti-ml` uses Render's Python runtime with `rootDir: ml` and `ml/requirements-serve.txt` (serving deps only; `shap` is optional at runtime). Render has no free Docker instances, so `ml/Dockerfile` is for local use only: `docker compose --profile ml up`.
- The free web plan spins down when idle, so the first request after a pause is slow.
- A free Postgres expires after 30 days of inactivity, and free plans have no persistent disk.
- The ML service starts as `NOT_TRAINED` until trained artifacts are committed and pushed. The app then shows the labelled persistence baseline; it does not invent forecasts. Trained artifacts are gitignored by default (`ml/artifacts/*.joblib`), so force-add them before expecting `TRAINED` output.
- If `JWT_SECRET` is not set, the server generates a temporary one so it can boot; sessions reset on restart. The blueprint generates a stable value.
- Evidence photographs are stored on the service's local disk and are lost on redeploy or restart (free plans have no persistent disk).
- Optional integrations (River AI, email, data.gov.in, OpenAQ) are added as environment variables in the Render dashboard; see `.env.example`.
- If you attach a custom domain, update `FRONTEND_URL` to `https://your-domain` so CORS and the same-origin check accept it.
- The database is private-network only (`ipAllowList: []`); use Render's dashboard shell to inspect it.

## Trained ML service

`ml/fetch_real_data.py` builds a traceable Mumbai extract from OpenAQ station
measurements and, where available, co-located station weather. The reference
extract covers 2025-03-01 to 2026-10-27, 23 stations and 333,960 station-hours.
Raw sub-hourly readings are aggregated to hourly means and gaps are not imputed.
Station weather covers 51% of temperature, 52% of humidity and 31% of wind
observations; Open-Meteo ERA5 reanalysis fills the remaining hours. Sources, QC
rules, unit conversions, per-station weather coverage and the CSV SHA-256 are in
`ml/data/mumbai_air_quality_archive.meta.json`.

```bash
cd ml
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python fetch_real_data.py --source archive --start 2025-11-01 --end 2026-10-27 \
  --output data/mumbai_air_quality_archive.csv \
  --metadata data/mumbai_air_quality_archive.meta.json
python train.py --input data/mumbai_air_quality_archive.csv --output artifacts
uvicorn serve:app --host 0.0.0.0 --port 8000
```

Chronological hold-out (Jul-Oct 2026) versus persistence:

| Horizon | Model MAE | Persistence MAE | Skill | 80% interval coverage |
|---|---|---|---|---|
| 1h | 3.48 µg/m³ | 3.61 µg/m³ | +3.6% | 0.784 |
| 3h | 5.33 µg/m³ | 6.14 µg/m³ | +13.2% | 0.808 |
| 6h | 6.06 µg/m³ | 7.51 µg/m³ | +19.4% | 0.823 |

A separate spatial holdout retrains without five geographically spread stations
(Colaba, Sion, Borivali East MPCB, Deonar and Andheri East) and scores those
unseen stations: skill is +3.4% / +14.4% / +21.4% at 1h / 3h / 6h. The 3h
>60 µg/m³ classifier has ROC-AUC 0.973, PR-AUC 0.741 and Brier 0.026. Full
metrics, per-station errors, SHAP values and limitations are in
`ml/artifacts/model_card.json` and `ml/artifacts/metrics.json`.

Register the model once per database, set `ML_SERVICE_URL=http://localhost:8000`
in `.env.local`, and restart the API. The app keeps the labelled persistence
baseline whenever the service is absent, incomplete or reports a rejected model.

Docker profile:

```bash
ML_SERVICE_URL=http://ml:8000 docker compose --profile ml up --build
```

## Live polling

The API runs a live polling service:

- Open-Meteo current weather every 60 seconds (upstream values change every 900 seconds; polling only shortens detection delay).
- CAMS modelled PM2.5/PM10 every 300 seconds.
- In demo mode, simulation-labelled station readings tick every 60 seconds for the seeded demo screens. The map excludes them; its station layer is real-only.
- The map shows real OpenAQ station records even when their last reading is stale, with an amber age ring and the last-observed timestamp. Add `OPENAQ_API_KEY` or `DATA_GOV_IN_API_KEY` to resume live CPCB/OpenAQ ingestion.
- Risk evaluation runs every 5 minutes.

Configure with `LIVE_ENABLED`, `LIVE_WEATHER_INTERVAL_SECONDS`, `LIVE_AQI_INTERVAL_SECONDS` and `LIVE_SIMULATION_INTERVAL_SECONDS`. Every row keeps `observed_at` (upstream validity) and `retrieved_at` (fetch time).

## Live CPCB via data.gov.in

The official CPCB real-time AQI resource ID is pre-filled (`3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69`). You still need a free data.gov.in API key:

1. Register at https://www.data.gov.in/ and create an API key.
2. Add `DATA_GOV_IN_API_KEY=...` to `.env.local`.
3. Restart the API.
4. Run `npm run integrations:check` to confirm Mumbai records are returned.
5. Sign in as an authority admin and use **Data sources → Run ingestion**, or wait for the scheduled job.

Ingested stations are stored with `DATA_GOV_IN:<station name>` internal codes and are shown as connected-source records, not demo records. The adapter validates Mumbai coordinates, units and timestamps; unsupported units are skipped rather than converted blindly.

## Integration checks

After adding credentials to `.env.local`, run:

```bash
npm run integrations:check
```

It checks the database, data.gov.in, OpenAQ, River AI, vision configuration, SMTP and the ML service without printing secrets. A missing key remains `NOT_CONFIGURED`; it never crashes the app.

## Citizen Portal, Google Sign-In and weather alerts

The citizen portal is at `/citizen/login`. It uses Google OpenID Connect, not a
client-side mock. `PUBLIC` is the application's citizen role; the portal labels
it "Citizen" and never accepts a role from the browser.

### Google OAuth

1. Create a Google Cloud OAuth 2.0 Web client.
2. Add the exact redirect URI, for example:
   `http://localhost:4100/api/v1/auth/google/callback`
3. Set:
   ```env
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=   # empty derives <FRONTEND_URL>/api/v1/auth/google/callback
   ```
4. Restart the API. `GET /api/v1/auth/google/start` returns 503-style
   configuration feedback when the credentials are absent; it never fakes a
   sign-in.

New Google accounts are created as `PUBLIC`, with `email_verified=true` and
`google_sub` from the verified ID token. Existing accounts are linked by
verified email; authority roles are never downgraded. First-time citizens are
sent to `/citizen/onboarding`; returning citizens go to `/citizen/dashboard`.

### Gmail delivery

The existing Nodemailer service is reused. Use a Google App Password:

```env
EMAIL_PROVIDER=gmail
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-16-character-app-password
DEMO_MODE=false
```

The recipient is always the authenticated citizen's verified email from
PostgreSQL. No endpoint accepts a recipient from the browser. Without SMTP
credentials, weather alerts are recorded as `FAILED` with
`Email provider NOT_CONFIGURED`; they are never marked `SENT` or `DELIVERED`.

### Background monitor

`CITIZEN_MONITOR_ENABLED=true` starts a server-side worker in the API process.
It reads opted-in citizens and saved coordinates from PostgreSQL, batches up to
50 locations per Open-Meteo request, falls back to MET Norway when Open-Meteo is
rate-limited, stores readings/events, and emails HIGH/CRITICAL events. It runs
whether or not a browser is open.

- `CITIZEN_MONITOR_INTERVAL_SECONDS` (default 300)
- `CITIZEN_MONITOR_MIN_SEVERITY` (default `HIGH`)
- `CITIZEN_MONITOR_COOLDOWN_MINUTES` (default 360)
- `CITIZEN_MONITOR_MAX_RETRIES` (default 5)

Deduplication uses `weather_events.event_key` (location + condition + severity +
cooldown bucket) and a unique `(weather_event_id, user_id)` index. A higher
severity creates a new event and therefore an escalation email. Failed sends
are retried with backoff up to the configured limit.

Weather conditions are threshold-based measurements, labelled with their
source. They are not official IMD/CWC warnings; no authoritative Indian warning
feed is configured. Flood alerts mean "extreme rainfall / flood risk", not an
official flood warning.

### Live news and critical-news alerts

The newsroom aggregates seven RSS sources: The Guardian (air pollution), The
Hindu (Mumbai and energy/environment), Mongabay India, Hindustan Times Mumbai,
The Indian Express, and BBC India. Local/general feeds are filtered to
environmental stories; the endpoint returns up to 30 recent items and refreshes
every five minutes.

`NEWS_MONITOR_ENABLED=true` starts a server-side critical-news worker. It
fetches the same feeds every 15 minutes and emails opted-in citizens when a
story matches a safety filter such as flood, cyclone, severe pollution, gas
leak, heatwave or a major fire. It stores the item id, suppresses duplicate
stories per user, limits each user to one news email per cooldown window, and
retries failed sends with the same Gmail transport. Citizens can turn critical
news emails on or off from the dashboard; enabling requires explicit consent.

News alerts are labelled as news, never as official measurements or regulatory
determinations.

**Deployment note:** on Render's free plan an idle web service is suspended, and
the in-process worker stops with it. Use an always-on instance (or a separate
scheduler) if alerts must run continuously.

## Demo accounts

Password for all seeded accounts: `Demo@1234`

| Role | Email |
|---|---|
| System administrator | `admin@enviropulse.local` |
| Authority administrator | `authority@enviropulse.local` |
| Environmental analyst | `analyst@enviropulse.local` |
| Field officer | `officer@enviropulse.local` |
| Public citizen | `citizen@enviropulse.local` |

Authority registration creates a `PENDING_APPROVAL` account with no authority permissions. A system administrator can approve it at `POST /api/v1/auth/admin/approve-authority`.

## Key routes

Public: `/`, `/about`, `/data-sources`, `/privacy`, `/terms`, `/report`, `/login`, `/register`, `/forgot-password`, `/reset-password`.

Application: `/dashboard`, `/city`, `/news`, `/atmosphere`, `/map`, `/map/stations/:id`, `/intelligence/predictions`, `/ai-analyst`, `/reports`, `/reports/:id`, `/alerts`, `/alerts/:id`, `/incidents`, `/incidents/:id`, `/compliance`, `/compliance/documents`, `/notifications`, `/simulation`, `/simulation/:id`, `/settings`, `/profile`.

## Tests

```bash
npm test
```

30 server unit tests cover indicative AQI, the persistence baseline, anomaly edge cases, category-specific risk rules, confidence separation, compliance comparability, AI evidence boundaries and data.gov.in CPCB record parsing. 19 web tests cover API error handling, retry behaviour, atmosphere formatting, weather condition/apparent-temperature helpers, Mumbai night detection and auth-store session behaviour. See `docs/TESTING.md`.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [IMPLEMENTATION_AUDIT.md](IMPLEMENTATION_AUDIT.md)
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)
- [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md)
- [docs/ML_METHODOLOGY.md](docs/ML_METHODOLOGY.md)
- [docs/MODEL_CARD.md](docs/MODEL_CARD.md)
- [docs/MODEL_REVIEW.md](docs/MODEL_REVIEW.md)
- [docs/RISK_METHODOLOGY.md](docs/RISK_METHODOLOGY.md)
- [docs/REGULATORY_SOURCES.md](docs/REGULATORY_SOURCES.md)
- [docs/SECURITY.md](docs/SECURITY.md)
- [docs/TESTING.md](docs/TESTING.md)
- [docs/SIMULATION_GUIDE.md](docs/SIMULATION_GUIDE.md)
- [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md)
- [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) — includes the `/city/*` open-data endpoints
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md)

## Attribution

Map data © OpenStreetMap contributors (ODbL 1.0). Tiles by OpenFreeMap, © OpenMapTiles. Weather by Open-Meteo (CC BY 4.0). CAMS data via Open-Meteo. CPCB/MPCB references are public regulatory documents; no live CPCB/MPCB feed is connected.

## Licence / use

Demonstration software. Do not use for enforcement, emergency response, health advice or legal decisions. See the in-app `/terms` and `/privacy` pages, and `docs/LIMITATIONS.md`.
