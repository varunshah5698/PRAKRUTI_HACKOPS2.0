# Architecture

## High-level flow

```text
Public web / authority web (React + Vite)
        │  cookie-authenticated REST + SSE
        ▼
Express API (Node.js + TypeScript)
        │
        ├── Auth / role checks (JWT httpOnly cookie, DB-refreshed role/status)
        ├── Source adapters (Open-Meteo, CAMS, data.gov.in, OpenAQ, demo network)
        ├── Ingestion jobs + source health
        ├── Geospatial service (PostGIS + boundary validation)
        ├── AQI / baseline forecast / anomaly analytical services
        ├── Category-specific risk engine
        ├── Alert lifecycle + notifications
        ├── Reports + private evidence storage + EXIF review
        ├── Incidents + compliance + audit
        ├── AI analyst (River AI adapter or rule-based evidence digest)
        └── Simulation / replay engine (isolated records)
        │
        ▼
PostgreSQL 18 + PostGIS 3.7
```

## Web application

- `web/src/pages/public` — landing, auth, public report, public information.
- `web/src/pages/app` — command centre, map, predictions, AI analyst, reports, alerts, incidents, compliance, notifications, simulation, sources, settings.
- `web/src/components` — design system, charts, map, shell, status components.
- `web/src/store/auth.ts` — Zustand auth state.
- `web/src/lib/api.ts` — fetch wrapper with `credentials: include`.
- MapLibre 6 requires a Vite worker URL; this is configured once in `MumbaiMap.tsx` with `setWorkerUrl()` and `?worker&url`.

The public landing page uses a light Positivus-inspired editorial system (paper background, black type, lime accent). The authenticated application uses the dark command-centre palette from the brief.

## API

- Versioned under `/api/v1`.
- JWT stored in an HTTP-only, SameSite=Lax cookie. The API refreshes role and account status from the database on every authenticated request.
- Server-side role checks are the security boundary; UI visibility is only convenience.
- Zod validates request bodies and query parameters.
- Consistent error envelope: `{ "error": { "code", "message", "details" } }`.
- Rate limits: global 400/min, auth 40/15 min, report submission 12/hour, AI 20/min.
- Origin check for unsafe methods (server-to-server webhook exempt).
- SSE at `/api/v1/events` for alert/source events (heartbeat every 25s).

## Database access

The project uses `pg` with a typed query helper rather than Prisma. This keeps PostGIS `geography` columns and spatial SQL explicit. The schema is in `server/src/db/schema.sql`.

Core geospatial choices:

- `geography(Point,4326)` for stations, reports, incidents, observations and weather.
- GiST indexes on location columns.
- `ST_DWithin` for nearby reports/stations and notification radius.
- `ST_Distance` for contextual distances.
- Mumbai boundary validation is also performed in Node using a locally stored OSM boundary polygon; a report outside Greater Mumbai is rejected.

## Ingestion and source health

- Open-Meteo weather is fetched for every demo station, current + 18-hour hourly forecast.
- CAMS PM2.5/PM10 is fetched for localities with air stations and stored as `MODELLED`, with `station_id = NULL`.
- `data.gov.in` and OpenAQ adapters exist and only run when credentials/resource IDs are configured. No endpoint is invented.
- CPCB and MPCB are deliberately `NOT_CONFIGURED`.
- Source status is `CONNECTED` only after a recent successful ingestion; weather becomes `STALE` after 3h and CAMS after 6h.
- Every ingestion attempt is recorded in `ingestion_jobs`.

## Risk and alerts

- Category-specific rules; air is not applied to water/waste/industrial records.
- Risk score and confidence score are separate. A critical alert imposes a minimum risk score of 75 so severity is not displayed as low.
- Observed and predictive pipelines are separate. Predictive alerts use the labelled persistence baseline and are marked as analytical, not ML.
- Alert persistence checks use recent hourly history; duplicate prevention uses an open-alert window and a 2-hour cooldown; recovery requires two consecutive NORMAL assessments.
- Every alert transition is written to `alert_history`.
- Notification generation is deduplicated per user/alert/template in a 24-hour window.

## Evidence and privacy

- Multer memory upload, 8 MB limit, JPEG/PNG/WebP signature validation.
- Private local storage with `0600` files; served only through an authenticated evidence route.
- EXIF GPS is compared with the claimed location and recorded as MATCH / MISMATCH / NO_GPS. Client metadata is not trusted.
- Malware scanning is explicitly `NOT_CONFIGURED`.
- Citizen contact details are excluded from public map/alert responses.

## AI

Three analysis modes (observation, predictive, compliance) share a grounded evidence bundle. If `RIVER_API_KEY` is present, a server-side OpenAI-compatible chat-completions call is made. Otherwise the server returns a clearly labelled rule-based evidence digest. The prompt instructs the model to treat evidence as untrusted data, avoid invented readings/standards, distinguish observed/predicted/reported/estimated, and never declare a violation. The LLM cannot create or override forecasts.

Regulatory retrieval is lexical (category/parameter/section matching) over the seeded reference documents. It is retrieval-augmented generation, not a vector database. Citations are exact document title + section refs.

## Simulation

Simulation sessions generate deterministic step events using a seeded RNG. Risk assessments are persisted with `is_simulated=true` and a simulation session id under `simulation_station` entities, so they do not pollute station risk history. Alerts use the simulation session as entity id. Simulation alerts, notifications and incidents are excluded from operational lists and shown in the simulation session page. Reset only changes the replay position; it never deletes real observations.

## Background jobs

In-process intervals (suitable for a demo, not a production cluster):

- Weather ingestion every 30 minutes.
- CAMS ingestion every 60 minutes.
- Risk evaluation every 15 minutes.

For production, move these to a durable job queue with idempotency keys and distributed locks.

## Production hardening not included

- Object storage (S3-compatible) adapter is a documented extension point; local private storage is used.
- No external malware scanning service.
- No MFA, CSRF token, formal retention/deletion worker, load testing or disaster-recovery plan.
- No trained ML artifact or model server is deployed.
