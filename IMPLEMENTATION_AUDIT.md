# Implementation Audit

Date: 3 November 2026

## Phase 0 — repository and environment

The working directory was empty. There was no existing repository, source code, package manifest, database schema, authentication system, design system, ML artifact or dataset to preserve.

The application was therefore built from scratch using the architecture in the brief.

### Environment findings

| Item | Finding |
|---|---|
| Node.js | v22.22.0 originally, upgraded by Homebrew reinstall to v22.23.4 during PostGIS installation; Node 22 is supported |
| PostgreSQL | PostgreSQL 16 was running on port 5432 |
| PostGIS | Not installed initially |
| Docker | Installed but the Colima daemon was not running |
| Python | 3.13.9 |
| Network | Available (npm registry, OpenFreeMap, Open-Meteo, Nominatim, Overpass) |
| Existing app | None |

### Environment changes made

- Installed Homebrew `postgis` 3.7.0. Homebrew installed it for PostgreSQL 18, while the running server was PostgreSQL 16.
- Started the installed PostgreSQL 18 server on port **5433** with data directory `/opt/homebrew/var/postgresql@18`. PostgreSQL 16 on 5432 was left running and untouched.
- Homebrew dependency upgrades broke Node 22's `simdjson` linkage; Node 22 was reinstalled and verified.
- `.env.local` points to `postgresql://varunnitinshah@localhost:5433/enviropulse`.

To use a different PostgreSQL/PostGIS instance, change `DATABASE_URL` and run `npm run db:setup && npm run db:seed`.

## Data-source verification

| Source | Finding | Decision |
|---|---|---|
| CPCB CAAQMS | No documented credentialled machine API configured; public pages are not a stable API | NOT_CONFIGURED; no invented station IDs or readings |
| MPCB | No configured endpoint | NOT_CONFIGURED |
| data.gov.in | Requires API key + verified resource ID; field schema cannot be guaranteed without access | Adapter implemented, disabled without credentials |
| OpenAQ | Requires API key; v3 location/latest endpoints | Adapter implemented, disabled without key |
| Open-Meteo weather | Free/no-key, documented current + hourly endpoints | LIVE adapter |
| CAMS via Open-Meteo | Free/no-key modelled PM2.5/PM10 | MODELLED context only, never station readings |
| OpenFreeMap | Public instance: free, no request limit, commercial use allowed, attribution required | Vector tiles for MapLibre; attribution included |
| OpenStreetMap | Boundary via Nominatim; ODbL | Greater Mumbai boundary (Mumbai City + Mumbai Suburban districts) stored locally |
| River AI | Key empty; provider format not verified against a live key | Server-side OpenAI-compatible adapter with NOT_CONFIGURED fallback |
| Vision | No separate vision provider configured | NOT_CONFIGURED; text model not assumed to support images |
| ML | 23-station OpenAQ Mumbai archive (2025-11-01 to 2026-10-23) | Trained locally; artifacts gitignored; anomaly model NOT_TRAINED |

## Implementation decisions

1. **PostgreSQL + PostGIS, raw SQL with typed helpers** — chosen over Prisma to use `geography`, GiST indexes and spatial queries explicitly. No ORM migration layer is present; schema is applied by `server/src/db/setup.ts`.
2. **Local private evidence storage** — no object-storage credentials. Files are stored with `0600` permissions and served through an authorised API route. S3 is documented as an extension point, not implemented.
3. **SSE instead of WebSockets** — sufficient for low-volume alert events and simpler to operate. The dashboard also polls every 60 seconds.
4. **MapLibre 6 + OpenFreeMap** — MapLibre 6 requires an explicit worker URL in Vite; configured with `setWorkerUrl()`.
5. **3D buildings** — OpenMapTiles `render_height` is used for visual extrusion. It is not surveyed building height and is labelled accordingly.
6. **No interpolated pollution surface** — the demo station network is sparse and synthetic. The map shows point markers and explicitly states that no area-wide surface is drawn.
7. **AI fallback** — without River AI, the API returns a rule-based evidence digest labelled `RULE_BASED`, never an LLM impersonation.
8. **Demo data isolation** — every synthetic observation/report/alert/incident is `is_simulated=true`. Simulation sessions add `simulation_session_id` and are excluded from operational lists.
9. **Regulatory standards** — seeded as `REFERENCE_ONLY`, with document/section/averaging/unit/applicability. Comparisons never declare a violation.
10. **Design** — Positivus-inspired public landing (paper/black/lime) and the dark command-centre dashboard palette from the brief. shadcn-style local components are used rather than the shadcn CLI.

## Deviations from the brief

- No Prisma; a typed `pg` layer is used instead (allowed: “another suitable typed database access layer”).
- No S3/object-storage implementation; local private storage with a documented extension point.
- LightGBM/quantile/classifier artifacts are trained locally from the OpenAQ archive; the anomaly detector remains `NOT_TRAINED`. Artifacts are gitignored, so a clean deployment falls back to the baseline.
- River AI adapter was verified against a locally supplied key (`zai-org/GLM-5.3-Flash`, chat-completions, reasoning_effort low). The key is only in the gitignored `.env.local`; `.env.example` remains empty and the rule-based fallback remains for missing keys.
- Vision AI was verified with River AI open-weight models `moonshotai/Kimi-K3` (fallback `zai-org/GLM-5.3-Flash`) on a test image. The key is only in `.env.local`; no test image or report was retained.
- No email provider credentials supplied. The SMTP transport was verified against a local sink; notifications remain SIMULATED until `SMTP_HOST`, `SMTP_USER` and `SMTP_PASSWORD` are configured.
- No ward-level analytics; ward geometries were not verified, so only locality reference points are used.
- No interpolated risk zones; the network is too sparse and demo data is synthetic.
- No public OSM tile server; OpenFreeMap is used with attribution.

## Portable deployment and optional integrations

- Added a multi-stage Dockerfile and full `docker-compose.yml` (PostGIS + API + built web). The stack was built and started successfully; `/api/health`, the landing page, login and dashboard were verified inside Docker. The compose file also exposes an optional `ml` profile.
- Added `ml/serve.py`, a FastAPI inference service that loads trained artifacts and returns quantile intervals, deterioration probability and SHAP only when the model is actually trained.
- Added `server/src/services/ml.ts` and `forecast-service.ts`; when `ML_SERVICE_URL` is configured and trained, the predictions page, station drawer and future map timeline use trained forecasts. Otherwise the labelled persistence baseline remains.
- Added `npm run ml:register` to register real model metrics from `ml/artifacts/model_card.json`.
- Added `npm run integrations:check` to verify database, data.gov.in, OpenAQ, River AI, vision configuration, SMTP and the ML service without printing secrets.
- Verified the pipeline mechanics on a temporary synthetic extract (deleted, never registered). A real 23-station OpenAQ Mumbai archive was then fetched, trained and registered; see `docs/MODEL_CARD.md` and `ml/artifacts/model_card.json`.

## Verification performed

- Database schema applied successfully with PostGIS.
- Seed created 26 localities, 15 stations, 4,566+ observations, 9 reports, 15 alerts, 4 incidents.
- Weather ingestion: 285 records; CAMS ingestion: 20 records.
- OpenAQ live ingestion verified: 12 Mumbai stations (MPCB/IITM operators), 91 sensor records, including stale stations marked DEGRADED. This is OpenAQ data, not a direct CPCB feed.
- API smoke tests: login, dashboard, current/past/future map timeline, station detail, predictions, compliance comparison, reports (including private evidence upload), alerts, incidents, notifications, simulations, AI fallback.
- `npm test`: 29 tests passing.
- `npm audit --omit=dev`: 0 vulnerabilities after upgrading MapLibre, ECharts, Nodemailer and Zod.
- Web production build succeeds.
- Playwright screenshots used for visual review of landing, dashboard, map, predictions, reports, alerts, incidents, compliance, simulation, sources, settings, station drawer and detail pages.

## Known audit gaps

See `docs/LIMITATIONS.md` for the full list. The most important are: no direct CPCB/MPCB API, no anomaly model, no email provider, no malware scanner, no object storage, no formal legal review, and no production load/security testing.
