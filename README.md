# प्रकृति

Environmental intelligence, prediction and compliance workflows for Greater Mumbai.

This is a working demonstration application, not a static dashboard. It connects:

- an environmental command centre,
- an interactive 3D Mumbai map with timeline replay,
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
| CPCB CAAQMS | **NOT CONNECTED** — no credentialled, documented machine endpoint is configured |
| MPCB | **NOT CONNECTED** |
| Demo monitoring stations | **SIMULATION DATA** — 15 synthetic stations, every record `is_simulated=true` |
| Weather | **LIVE** — Open-Meteo at station coordinates |
| CAMS regional air quality | **MODELLED** — Copernicus CAMS via Open-Meteo, not a station measurement |
| OpenAQ (MPCB/BMC/IITM stations) | **LIVE** — real station records via OpenAQ v3, filtered to the Mumbai boundary; requires `OPENAQ_API_KEY` |
| LightGBM / quantile / deterioration / anomaly models | **NOT TRAINED** — no verified Mumbai historical extract supplied |
| Forecasts shown | **PERSISTENCE_BASELINE_V1** — labelled, empirical band, not calibrated |
| River AI | **CONFIGURED locally** — `RIVER_API_KEY` is set in the gitignored `.env.local`; adapter verified. Empty by default in `.env.example`. |
| Vision AI | **CONFIGURED locally** — Google Gemini (`gemini-3.5-flash`, fallback `gemini-3.1-flash-lite`); key only in `.env.local`. The River text model is still not assumed to inspect images. |
| Email | **SIMULATED** — no provider configured; records are stored, not sent |
| Evidence storage | **LOCAL_PRIVATE** — authenticated access only |
| Map tiles | **OpenFreeMap** public instance (free, no API key, attribution required) |
| Database | PostgreSQL 18 + PostGIS 3.7 |

No synthetic reading is presented as a CPCB reading. No forecast is presented as trained ML output. No automated finding is presented as an official regulatory determination.

## Stack

- **Web**: React 18, Vite, TypeScript, Tailwind CSS, shadcn-style local UI components, Framer Motion, Zustand, React Router, Apache ECharts, Lucide, MapLibre GL JS 6, OpenFreeMap, GeoJSON.
- **API**: Node.js 22, TypeScript, Express, `pg`, Zod, JWT cookie auth, Multer, Nodemailer adapter, SSE.
- **Database**: PostgreSQL + PostGIS (`geography(Point,4326)`), SQL schema, typed query helpers.
- **ML**: Python training pipeline in `ml/` using LightGBM, pandas, NumPy, scikit-learn, SHAP and Joblib. Not trained in this deployment.
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

## Optional trained ML service

The training pipeline is in `ml/train.py`. It refuses to run without a verified historical CSV. When the CSV is in place:

```bash
cd ml
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-serve.txt
python train.py --input data/mumbai_air_quality.csv --output artifacts
uvicorn serve:app --host 0.0.0.0 --port 8000
```

Then set `ML_SERVICE_URL=http://localhost:8000` in `.env.local`, register the model metrics:

```bash
npm run ml:register
```

Restart the API. The predictions page and station drawer will show trained LightGBM forecasts, quantile intervals, deterioration probability and SHAP only when the model service returns them. Without this, the app keeps the labelled persistence baseline.

Docker profile:

```bash
ML_SERVICE_URL=http://ml:8000 docker compose --profile ml up --build
```

## Live polling

The API runs a live polling service:

- Open-Meteo current weather every 60 seconds (upstream values change every 900 seconds; polling only shortens detection delay).
- CAMS modelled PM2.5/PM10 every 300 seconds.
- In demo mode, simulation-labelled station readings tick every 60 seconds so the demo behaves like a live network.
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

Application: `/dashboard`, `/map`, `/map/stations/:id`, `/intelligence/predictions`, `/ai-analyst`, `/reports`, `/reports/:id`, `/alerts`, `/alerts/:id`, `/incidents`, `/incidents/:id`, `/compliance`, `/compliance/documents`, `/notifications`, `/simulation`, `/simulation/:id`, `/settings`, `/profile`.

## Tests

```bash
npm test
```

22 server unit tests cover indicative AQI, the persistence baseline, anomaly edge cases, category-specific risk rules, confidence separation, and compliance comparability. 3 web tests cover API retry through a dev-proxy restart. See `docs/TESTING.md`.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [IMPLEMENTATION_AUDIT.md](IMPLEMENTATION_AUDIT.md)
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)
- [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md)
- [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md)
- [docs/ML_METHODOLOGY.md](docs/ML_METHODOLOGY.md)
- [docs/MODEL_CARD.md](docs/MODEL_CARD.md)
- [docs/RISK_METHODOLOGY.md](docs/RISK_METHODOLOGY.md)
- [docs/REGULATORY_SOURCES.md](docs/REGULATORY_SOURCES.md)
- [docs/SECURITY.md](docs/SECURITY.md)
- [docs/TESTING.md](docs/TESTING.md)
- [docs/SIMULATION_GUIDE.md](docs/SIMULATION_GUIDE.md)
- [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md)
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md)

## Attribution

Map data © OpenStreetMap contributors (ODbL 1.0). Tiles by OpenFreeMap, © OpenMapTiles. Weather by Open-Meteo (CC BY 4.0). CAMS data via Open-Meteo. CPCB/MPCB references are public regulatory documents; no live CPCB/MPCB feed is connected.

## Licence / use

Demonstration software. Do not use for enforcement, emergency response, health advice or legal decisions. See the in-app `/terms` and `/privacy` pages, and `docs/LIMITATIONS.md`.
