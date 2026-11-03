# ML Methodology

## Current deployment status

In this workspace the artifacts are present, the model registry reports
`TRAINED`, and `ML_SERVICE_URL` points at the local FastAPI service. Live OpenAQ
stations with at least 25 consecutive hourly PM2.5 values return
`LIGHTGBM_TRAINED`; demo stations and stations outside the training set return
the labelled persistence baseline with an explicit reason.

Model artifacts are gitignored and are **not shipped by default**. If
`ml/artifacts/model_card.json`, the model files and a `model_registry` entry are
absent, the application shows `NOT_TRAINED` for:

- LightGBM PM2.5 1h / 3h / 6h regressors
- quantile 10th/90th percentile models
- calibrated deterioration classifier
- anomaly detector

The UI then uses the labelled persistence baseline and does not display model
accuracy, calibrated intervals, deterioration probability or SHAP values.

A real-data run is reproducible with `ml/fetch_real_data.py`. The reference run
uses the public OpenAQ S3 daily archive for 23 CPCB/MPCB/BMC/IITM stations inside
the Greater Mumbai boundary from 2025-03-01 to 2026-10-27. The extract has
333,960 station-hours (74.5% PM2.5 coverage). Raw sub-hourly readings are
aggregated to hourly means; gaps are left as NaN and are not imputed. Weather
uses co-located station measurements where available (51% temperature, 52%
humidity, 31% wind) and Open-Meteo ERA5 reanalysis for the remaining hours; the
measured fraction is recorded per station in
`ml/data/mumbai_air_quality_archive.meta.json`, along with station/sensor IDs, QC
rules, conversions and the CSV SHA-256.

The reference chronological split is 70/15/15 by global timestamp. The model card
and `ml/artifacts/metrics.json` record the exact metrics, per-station errors,
quantile coverage and classifier calibration for that extract. A separate spatial
holdout retrains without five stations and scores those unseen stations. A model
is marked `REJECTED` when its +3h or +6h MAE does not beat persistence; the
inference service then returns `503` and the app keeps the baseline.

## Fallback shown when the trained service is unavailable

`PERSISTENCE_BASELINE_V1` (server: `server/src/services/forecast.ts`):

1. Take the last 12 valid PM2.5 observations.
2. Compute the mean hourly change, damp it to ±2 µg/m³/h and multiply by 0.5.
3. Project `current + dampedTrend × horizon`.
4. Clamp at zero.
5. Build an empirical 80% band from the standard deviation of recent values, widened by `sqrt(horizon / 3) × 1.2816`, minimum ±2 µg/m³.
6. Label confidence `NOT_CALIBRATED` and state that it is not a validated forecast interval.

The baseline is an analytical method, not a trained ML model. It is used for:

- map timeline future markers (`+1h`, `+3h`, `+6h`)
- station detail forecasts
- predictive-intelligence page
- analytical early-warning criteria (3h forecast ≥ 60 µg/m³ and persistence ≥ 0.5)

It never creates a critical observed alert or an official violation.

## Anomaly check

`ZSCORE_V1` is an analytical check, not a trained anomaly detector:

- Requires at least 6 values.
- Compares the latest value with the mean and standard deviation of prior values.
- Flags `UNUSUAL` at |z| ≥ 2.5.
- Handles zero-variance baselines explicitly (a changed value is flagged; an unchanged value is normal).

## Training pipeline

`ml/train.py` is the real training pipeline. It refuses to run without a verified CSV and at least 30 days of hourly rows. `ml/fetch_real_data.py` builds the reference extract described above.

### Inputs

`station_id, timestamp, pm25, pm10, no2, so2, co, o3, temperature, humidity, wind_speed, wind_dir, precipitation`

### Features

- current pollutant values
- lags 1, 2, 3, 6, 12, 24 hours
- rolling means 3, 6, 24 hours
- hour, day of week, month
- wind direction sin/cos
- no future values are used as features

### Targets

- PM2.5 at +1h, +3h, +6h
- 3h exceedance indicator: target PM2.5 > 60 µg/m³ (the CPCB 24-hour standard
  used as a screening threshold; it is not a relative deterioration label)
- quantile 0.1 / 0.9 at each horizon (coverage reported for all horizons)

### Split

Chronological 70% train / 15% validation / 15% test by global timestamp. No random shuffle. This prevents temporally adjacent leakage.

### Models and evaluation

- LightGBM regressors (`objective=regression_l1`) with early stopping on the validation partition
- LightGBM quantile regressors with early stopping on the validation partition
- LightGBM classifier with isotonic calibration on 5-fold out-of-fold predictions
  from the training partition. The chronological validation window is not used
  for calibration because a single season can be unrepresentative (the reference
  validation window had 0.16% positives while the test window had 9.6%).
- MAE, RMSE, persistence-baseline MAE/RMSE
- quantile coverage vs 0.8 target
- precision, recall, PR-AUC, ROC-AUC, Brier score
- spatial holdout: retrain without five geographically spread stations and score
  the unseen stations' chronological test rows
- SHAP TreeExplainer on a test sample

If SHAP fails, the pipeline records a failure rather than inventing values.

### Baseline comparison

The test partition is also scored with persistence (`prediction = current PM2.5`). A complex model should beat this baseline; otherwise it should not be deployed.

### Reference run results

Reference extract: 2025-03-01 to 2026-10-27, 23 stations, SHA-256
`ed07b475c1e4620acca6c8b59fc782fc064d60e8a954a78e57dc1e121255fb21`.
Split: train 2025-03-01 → 2026-04-27 (176,997 rows), validation 2026-04-27 →
2026-07-26 (34,601 rows), test 2026-07-26 → 2026-10-23 (37,119 rows).

| Horizon | Model MAE | Persistence MAE | Skill | RMSE model/persistence | 80% coverage |
|---|---|---|---|---|---|
| 1h | 3.48 | 3.61 | +3.6% | 9.36 / 10.23 | 0.784 |
| 3h | 5.33 | 6.14 | +13.2% | 11.05 / 14.20 | 0.808 |
| 6h | 6.06 | 7.51 | +19.4% | 11.82 / 15.53 | 0.823 |

The 3h >60 µg/m³ classifier has ROC-AUC 0.973, PR-AUC 0.741, Brier 0.026 and
precision/recall 0.748/0.594 at threshold 0.5.

Spatial holdout: the model is retrained without Colaba, Sion, Borivali East
(MPCB), Deonar and Andheri East, then scored on those unseen stations during the
same test window (6,911 rows). It still beats persistence:

| Horizon | Model MAE | Persistence MAE | Skill |
|---|---|---|---|
| 1h | 3.12 | 3.23 | +3.4% |
| 3h | 4.73 | 5.52 | +14.4% |
| 6h | 5.46 | 6.95 | +21.4% |

Full per-station metrics and SHAP values are in `ml/artifacts/metrics.json`,
`model_card.json` and `shap_summary.json`.

## Inference service

`ml/serve.py` is the optional FastAPI inference service:

```bash
cd ml
pip install -r requirements-serve.txt
python fetch_real_data.py --source archive --start 2025-11-01 --end 2026-10-27 \
  --output data/mumbai_air_quality_archive.csv \
  --metadata data/mumbai_air_quality_archive.meta.json
python train.py --input data/mumbai_air_quality_archive.csv --output artifacts
uvicorn serve:app --host 0.0.0.0 --port 8000
```

It returns `503` with `NOT_TRAINED`/`INCOMPLETE` until every required artifact
and an approved `model_card.json` exist. The Node adapter
(`server/src/services/ml.ts`) calls `/health` and `/predict`; if the service is
not configured, incomplete, rejected or unreachable, the app falls back to
`PERSISTENCE_BASELINE_V1` and says so.

After training, register the model metrics:

```bash
npm run ml:register
```

Set `ML_SERVICE_URL=http://localhost:8000` in `.env.local` and restart the API. The predictions page, station drawer and future map timeline then use trained forecasts; SHAP and quantile intervals are shown only when the service returns them.

The adapter must:

- load a versioned artifact,
- validate required features and record missing inputs,
- return median, lower/upper quantile, horizon, model version and target time,
- register the model version in `model_registry` with evaluation metrics,
- keep `status=TRAINED` only after evaluation and review,
- never let the LLM alter the numeric output.

## Known limitations

- The reference extract spans 20 months: two monsoon seasons, one full winter and
  the start of a second winter. A full second 12-month cycle is not available from
  the public Mumbai station archive, which begins around March 2025. The test
  window is later than training, so some calendar months are unseen during fitting.
- The temporal test is complemented by a five-station spatial holdout, but five
  stations do not cover every micro-environment. Station-level errors still vary.
- Weather is station-measured where available (51% temperature, 52% humidity, 31%
  wind) and ERA5 reanalysis elsewhere; precipitation is ERA5-only. The serving
  path uses Open-Meteo weather, so a train/serve source mismatch remains for the
  reanalysis-filled hours.
- Station PM2.5 coverage varies (30-89%); missing pollutant inputs remain missing
  and are handled by LightGBM's native NaN handling, not by imputation.
- The classifier label is a fixed >60 µg/m³ threshold, not a relative change from
  the current value. Its calibration uses training-season out-of-fold predictions;
  the chronological validation window was an unusually clean monsoon slice.
- SHAP values are computed from the actual artifact but do not establish causality.
- The persistence baseline remains the fallback and is not a regulatory forecast.
- Authority review and sign-off are still pending; see `docs/MODEL_REVIEW.md`.
- Training on demo/synthetic data is not acceptable for a real model unless the
  resulting model is itself labelled as a simulation model.
