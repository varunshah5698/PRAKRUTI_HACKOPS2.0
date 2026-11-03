# Demo Guide

## Setup

```bash
npm install
cp .env.example .env.local   # set DATABASE_URL, JWT_SECRET
npm run db:setup
npm run db:seed
npm run dev
```

Open http://localhost:5173. API health: http://localhost:4000/api/health.

## Demo accounts

Password `Demo@1234` for all:

- `authority@enviropulse.local` — authority admin
- `analyst@enviropulse.local` — environmental analyst
- `officer@enviropulse.local` — field officer
- `admin@enviropulse.local` — system admin
- `citizen@enviropulse.local` — public citizen

## What is simulated vs real

- **Simulated:** 15 demo stations, all air/water/industrial observations, all seeded reports, alerts, incidents, notifications, risk assessments.
- **Live:** Open-Meteo weather observations/forecasts.
- **Modelled:** CAMS PM2.5/PM10 via Open-Meteo.
- **Configured when keys are set:** River AI and Gemini vision. **Not configured by default:** CPCB, MPCB, email provider, trained ML.
- **Real in the app:** the incident workflow, audit trail, report verification, compliance comparison logic, map boundary, source registry.

## Demo A — Live Mumbai air quality

1. Open `/dashboard`; note the demo banner and “CPCB not connected”.
2. KPI cards: active stations, locations under watch, predictive warnings, critical incidents.
3. Category cards: air is largest; water/waste/industrial show their own evidence basis.
4. Open `/map`; the map opens in a 3D central-Mumbai view. Use “Fit Mumbai” for the full boundary.
5. Click a station. In the drawer inspect values, AQI caveat, weather, nearby context, risk and confidence.
6. Open the Forecasts tab: +1/+3/+6h persistence baseline, empirical band, `NOT_TRAINED`.
7. Open the AI Analyses tab and request one of the three analyses.

## Demo B — Map timeline

1. On `/map`, use the slider or arrows: −24h → −6h → Current → +1h → +3h → +6h.
2. Past: archived observations matched within ±90 minutes.
3. Current: latest valid values; stale flags.
4. Future: hollow predicted markers with forecast metadata.
5. Non-air categories show `FORECAST UNAVAILABLE` for future.
6. Confirm no interpolated pollution surface is drawn (coverage note).

## Demo C — Predictive warning

1. Open `/intelligence/predictions`.
2. Select Chembur (or use the dropdown). Inspect current, forecast cards, band chart, progression.
3. Confirm `ML MODELS NOT TRAINED`, `INTERVALS NOT CALIBRATED`, `SHAP UNAVAILABLE`.
4. The warning decision card shows threshold, persistence, +3h baseline and `deterioration probability NOT AVAILABLE`.
5. Open `/alerts`, filter trigger = Predictive. The Chembur predictive alert is `EARLY_WARNING`, trigger PREDICTIVE, source baseline, `NOT_A_TRAINED_MODEL`.

## Demo D — Citizen report

1. Open `/report` (public, no login).
2. Choose Air pollution → Open burning.
3. Click the map to move the pin; select a locality; add a description; upload a JPEG/PNG/WebP (≤8 MB); consent; submit.
4. Note the reference, UNVERIFIED state, AI vision assessment (COMPLETED when a vision key is configured) and nearby evidence enrichment.
5. Sign in as authority; open `/reports`; open the new report.
6. View the private photograph, verify the report with a reason.
7. Link it to a matching incident (verified reports only).
8. Check the audit history.

## Demo E — Compliance investigation

1. Open `/incidents` → an incident.
2. Review the lifecycle, evidence, nearby readings, standards and audit.
3. Add an investigation note and a corrective action; update action status.
4. Move status through permitted transitions (reason required). Closing requires authority admin.
5. Open `/compliance`; select a station/parameter and compare.
6. For hourly PM2.5 vs 24h NAAQS, confirm `NOT_COMPARABLE_AVERAGING`.
7. As authority admin, record an official determination in the incident.
8. Confirm the determination and audit entry.

## Demo F — Environmental simulation

1. Sign in as authority. Open `/simulation`.
2. Select “Gradual PM2.5 increase”, a station, seed 42. Create session.
3. Play or step. Watch values, risk, confidence and alert transitions.
4. Preview the public/authority email.
5. Create a simulated incident.
6. Reset. Confirm the replay restarts and real observations are untouched.
7. Open `/alerts` and `/incidents`; simulation-session records are not in operational lists.

## Demo G — Four categories

1. Dashboard category cards: air (10 demo stations), water (3 sampling points), waste (no stations; reports), industrial (2 demo stack monitors).
2. Air risk uses pollutant load/persistence/forecast; water uses pH/DO/report evidence; waste uses report verification/repeat hotspot; industrial uses relative change/report evidence with no legal threshold.
3. Waste critical requires at least two verified reports or a critical incident; a single unverified complaint does not.
4. Confirm no category borrows air AQI scoring.

## Things not to claim in the demo

- Do not call the demo stations CPCB stations.
- Do not claim live CPCB/MPCB data.
- Do not claim trained LightGBM accuracy or calibrated intervals.
- Do not claim SHAP values.
- Do not claim the baseline is an official forecast.
- Do not claim an estimated pollution surface.
- Do not claim an image proves chemical pollution.
- Do not claim an automated alert is an official violation.
- Do not claim emails were delivered; they are SIMULATED unless a provider is configured.
