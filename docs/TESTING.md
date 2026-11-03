# Testing

## Automated tests

```bash
npm test
```

The test suite uses Vitest and currently has **29 passing tests** across six files (four server, two web):

| File | Coverage |
|---|---|
| `server/src/services/aqi.test.ts` | CPCB sub-index breakpoints, dominant pollutant, insufficient data, categories |
| `server/src/services/forecast.test.ts` | Persistence baseline determinism, insufficient history, widening interval, zero-variance anomaly edge case |
| `server/src/services/risk-engine.test.ts` | Air critical after persistence, no critical from a single spike, confidence separation/missing inputs, water mild vs severe, waste unverified vs repeat hotspot, industrial no legal threshold |
| `server/src/services/compliance.test.ts` | Averaging mismatch, unit mismatch, stack vs effluent, comparable water reference |
| `web/src/lib/api.test.ts` | API error envelope, credential handling, JSON/form request paths |
| `web/src/store/auth.test.ts` | Session bootstrap, login state, logout cleanup |

Run type checks and build:

```bash
npm run typecheck
npm run build
```

## Manual API smoke tests

The following were exercised during implementation:

- `POST /auth/login` with seeded authority and citizen.
- `GET /dashboard/summary` (KPIs, categories, charts, sources).
- `GET /map/timeline` for past, current and future timestamps; forecast metadata present.
- `GET /map/stations/:id`, observations and forecasts.
- `GET /predictions` and `/predictions/:stationId` (model status and trained forecasts when the ML service is running; labelled baseline otherwise).
- `POST /ai/analyse` (rule-based fallback, labelled sections).
- `POST /reports` with a private image; `GET /reports/:id`; `GET /evidence/:id`; verify; link to incident.
- `GET /alerts`, `/alerts/:id`; close permission check.
- `GET /incidents`, `/incidents/:id`; notes/actions/assignment/determination endpoints exist.
- `GET /compliance/compare` → `NOT_COMPARABLE_AVERAGING` for hourly PM2.5 vs 24h NAAQS.
- `GET /notifications`, preferences update, acknowledge, preview.
- Incident status change generated an `AUTHORITY_INCIDENT_UPDATE` notification record (SIMULATED).
- `POST /simulations` → step → email preview → simulated incident.
- `GET /sources/status`, `/sources/jobs`.
- `npm audit --omit=dev` → 0 vulnerabilities.
- Docker Compose built and ran the full stack; `/api/health`, landing page, login and dashboard verified.
- ML pipeline and FastAPI service trained/tested on a temporary synthetic extract to verify mechanics; artifacts deleted and not registered.
- `npm run integrations:check` reports NOT_CONFIGURED for missing credentials without crashing.

## Manual acceptance checklist (DEMO A–G)

### A — Live Mumbai air quality

1. Open `/dashboard` and confirm the demo banner and source status.
2. Confirm stations are labelled SIMULATION DATA and CPCB is NOT_CONFIGURED.
3. Open `/map`, select a station, inspect the drawer.
4. Check values, timestamps, weather, 48h series, forecasts, missing inputs and data quality.
5. Confirm any trained-ML/SHAP claim matches the running ML service and `model_registry`; otherwise confirm the baseline label.

### B — Map timeline

1. Use the slider: −24h, −12h, Current, +1h, +3h, +6h.
2. Confirm past mode uses archived observations, current uses latest valid, future uses PERSISTENCE_BASELINE_V1.
3. Confirm future markers are hollow and labelled forecast.
4. Confirm non-air future shows FORECAST UNAVAILABLE.
5. Confirm no interpolated pollution surface is drawn.

### C — Predictive warning

1. Open `/intelligence/predictions`.
2. Inspect current, +1/+3/+6, intervals, model registry and warning criteria.
3. With the ML service running and a connected OpenAQ station selected, confirm the model version, quantile intervals, SHAP and deterioration probability. With no service or insufficient hourly history, confirm the labelled `PERSISTENCE_BASELINE_V1` / `NOT_CALIBRATED` fallback.
4. Open the Chembur predictive alert and confirm trigger type PREDICTIVE and model status.

### D — Citizen report

1. Open `/report`, choose a category, place a pin on the interactive Mumbai map, upload a photo, consent and submit.
2. Confirm the reference, UNVERIFIED state and the AI vision status (COMPLETED when a vision key is configured, otherwise NOT_CONFIGURED).
3. Sign in as authority, open `/reports/:id`, view the private image, verify.
4. Link the verified report to a matching incident.
5. Confirm audit entries.

### E — Compliance investigation

1. Open an incident; review readings, reports, alerts and standards.
2. Use `/compliance` compare with an hourly PM2.5 observation; confirm NOT COMPARABLE.
3. Add an investigation note and corrective action.
4. Move through permitted statuses; close only as authority admin.
5. Record an official determination (authority admin) and confirm audit.

### F — Simulation

1. Open `/simulation` as an authority user.
2. Choose a scenario, station and seed; create session.
3. Play/step through; observe values, risk, confidence, alert transitions.
4. Preview public/authority emails; create a simulated incident.
5. Reset; confirm real observations unchanged and simulation records retained.
6. Confirm simulation alerts/incidents are absent from `/alerts` and `/incidents` operational lists.

### G — Four categories

1. Dashboard category cards show air (10 demo stations), water (3 sampling points), waste (no stations; report evidence), industrial (2 demo stack monitors).
2. Risk methods differ by category.
3. Confirm water/waste/industrial never use air AQI scoring.
4. Confirm waste critical requires verified reports, not one unverified complaint.

## Not automated

- Browser E2E tests are not committed. Playwright was used locally for visual review during implementation.
- No live CPCB/MPCB or object-storage integration tests. SMTP transport was verified against a local sink; no external provider delivery without credentials. River AI and vision were verified manually against live keys.
- No load, fuzz, penetration or accessibility audit.
- No tests against real Mumbai historical data because none was supplied.
