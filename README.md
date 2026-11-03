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
| LightGBM / quantile / deterioration / anomaly models | **NOT TRAINED** — no verified Mumbai historical extract supplied |
| Forecasts shown | **PERSISTENCE_BASELINE_V1** — labelled, empirical band, not calibrated |
| River AI | **NOT_CONFIGURED** — empty `RIVER_API_KEY`; AI Analyst falls back to a rule-based evidence digest |
| Vision AI | **NOT_CONFIGURED** — the River text model is not assumed to inspect images |
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

Optional Docker database (PostGIS 16):

```bash
docker compose up -d
cp .env.docker.example .env.local
```

The compose service exposes port 5433 and creates the `enviropulse` database. Then run the schema and seed steps below.

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

`render.yaml` provisions one Node web service (API + built SPA) and a PostGIS-enabled Postgres database.

1. Push this repository to GitHub.
2. In Render: **New → Blueprint**, select the repository, and click **Apply**.
3. That is it. On boot the service applies `server/src/db/schema.sql`; if the database is empty and `DEMO_MODE` is on, the demo dataset is seeded in the background so the health check is not blocked.

Notes:

- The free web plan spins down when idle, so the first request after a pause is slow.
- If `JWT_SECRET` is not set, the server generates a temporary one so it can boot; sessions reset on restart. The blueprint generates a stable value.
- Evidence photographs are stored on the service's local disk and are lost on redeploy or restart (free plans have no persistent disk).
- Optional integrations (River AI, email, data.gov.in, OpenAQ) are added as environment variables in the Render dashboard; see `.env.example`.
- If you attach a custom domain, update `FRONTEND_URL` to `https://your-domain` so CORS and the same-origin check accept it.
- The database is private-network only (`ipAllowList: []`); use Render's dashboard shell to inspect it.

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

22 unit tests cover indicative AQI, the persistence baseline, anomaly edge cases, category-specific risk rules, confidence separation, and compliance comparability. See `docs/TESTING.md`.

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
