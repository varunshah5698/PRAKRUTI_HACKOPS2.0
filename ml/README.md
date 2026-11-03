# प्रकृति ML training pipeline

This directory contains the real training and evaluation code for the air-quality
forecasting models. Model artifacts are gitignored and are **not shipped by
default**. The application reports `NOT_TRAINED` and shows the labelled
`PERSISTENCE_BASELINE_V1` until `artifacts/model_card.json`, all model files and a
`model_registry` entry exist.

A reproducible real-data extract can be built from OpenAQ station measurements
and Open-Meteo weather. It does not invent missing observations: gaps stay NaN,
unit conversions and QC rules are written to a sidecar metadata file.

## Build a real Mumbai extract

OpenAQ v3 hourly API (rate-limited, paginated):

```bash
cd ml
python fetch_real_data.py --start 2025-03-01 --end 2026-10-27
python train.py --input data/mumbai_air_quality.csv --output artifacts
```

OpenAQ public S3 daily archive (faster; raw 15-minute values aggregated to hourly
means by this script):

```bash
cd ml
python fetch_real_data.py --source archive --start 2025-03-01 --end 2026-10-27 \
  --output data/mumbai_air_quality_archive.csv \
  --metadata data/mumbai_air_quality_archive.meta.json
python train.py --input data/mumbai_air_quality_archive.csv --output artifacts
```

What the fetcher does:

- selects active CPCB/MPCB/BMC/IITM stations inside the Greater Mumbai boundary;
- requires at least 30% hourly PM2.5 coverage and 2,000 rows per station;
- aggregates raw sub-hourly readings to hourly means, requiring at least half of
  the usual cadence;
- converts NO2/SO2/O3 from ppb to µg/m³ and CO from the CPCB mg/m³ feed (OpenAQ
  labels the CO values ppb, but the values are ppm; see the sidecar metadata);
- uses co-located OpenAQ station weather where available (51% temperature, 52%
  humidity, 31% wind coverage) and fills missing hours from the Open-Meteo ERA5
  archive; precipitation remains ERA5-only;
- writes `*.meta.json` with sources, station/sensor IDs, coverage, QC rules,
  conversions, per-station weather coverage and a SHA-256 of the CSV.

The 2025-03-01 to 2026-10-27 extract contains 23 stations and 333,960 station-hours
(74.5% PM2.5 coverage). Re-running is cheap because raw OpenAQ pages, S3 daily
files and Open-Meteo responses are cached under `data/raw/`.

The local reference artifacts (`lightgbm-202611030821-ed07b475`) score 3.48 / 5.33 /
6.06 µg/m³ MAE at 1 / 3 / 6h versus 3.61 / 6.14 / 7.51 for persistence; 80%
quantile coverage is 0.78 / 0.81 / 0.82. A separate spatial holdout on five unseen
stations beats persistence by 3.4% / 14.4% / 21.4%. See `docs/MODEL_CARD.md` for
the full evaluation and limitations.

## Expected input

A CSV with one row per station per timestamp:

```text
station_id,timestamp,pm25,pm10,no2,so2,co,o3,temperature,humidity,wind_speed,wind_dir,precipitation
```

Requirements:

- `timestamp` is ISO-8601 with a timezone.
- Units are fixed: PM2.5/PM10/NO2/SO2/O3 in µg/m³, CO in mg/m³, temperature °C,
  humidity %, wind speed km/h, wind direction degrees, precipitation mm.
- The extract must be traceable to an official source or a clearly labelled
  simulation dataset. Never train on synthetic demo data and present the result
  as a real Mumbai model.
- At least 30 days of hourly history per station is required for a basic run;
  longer is strongly preferred for 6-hour targets and seasonal evaluation.

## Run

```bash
cd ml
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python train.py --input data/mumbai_air_quality.csv --output artifacts
```

Outputs:

- `artifacts/pm25_1h.joblib`, `pm25_3h.joblib`, `pm25_6h.joblib`
- `artifacts/pm25_quantile_*.joblib`
- `artifacts/deterioration_classifier.joblib`
- `artifacts/metrics.json` (MAE, RMSE, persistence baseline, quantile coverage,
  classifier precision/recall/PR-AUC/ROC-AUC, calibration)
- `artifacts/shap_summary.json`
- `artifacts/model_card.json`

`serve.py` exposes the artifacts as a FastAPI inference service. It reports
`NOT_TRAINED`/`INCOMPLETE` and returns `503` until `artifacts/model_card.json`,
all required model files and an approved `deployment_recommendation` exist. A
model that does not beat persistence at +3h and +6h is marked `REJECTED`, so the
app keeps the labelled persistence baseline. It never invents trained output.

```bash
pip install -r requirements-serve.txt
uvicorn serve:app --host 0.0.0.0 --port 8000
```

Set `ML_SERVICE_URL=http://localhost:8000` in `.env.local`. If
`ML_SERVICE_API_KEY` is set on the service, `POST /predict` requires
`Authorization: Bearer <key>`; `/health` stays open for platform health checks.

The served model version still has to be recorded in `model_registry` with
`npm run ml:register` before the UI treats it as validated. Until then, the
service is wired but the UI must keep the honesty labels.

## Time-aware evaluation

The split is strictly chronological per global time boundary. No random
shuffling and no future values are used as features. Any change to the split
must be documented in `docs/ML_METHODOLOGY.md`.
