# ML Methodology

## Current deployment status

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
the Greater Mumbai boundary from 2025-11-01 to 2026-10-27, plus Open-Meteo ERA5
reanalysis weather. The extract has 198,720 station-hours (72% PM2.5 coverage,
100% weather coverage). Raw sub-hourly readings are aggregated to hourly means;
gaps are left as NaN and are not imputed. See
`ml/data/mumbai_air_quality_archive.meta.json` for station/sensor IDs, coverage,
QC rules, unit conversions and the CSV SHA-256.

The reference chronological split is 70/15/15 by global timestamp. The model card
and `ml/artifacts/metrics.json` record the exact metrics, per-station errors,
quantile coverage and classifier calibration for that extract. A model is marked
`REJECTED` when its +3h or +6h MAE does not beat persistence; the inference
service then returns `503` and the app keeps the baseline.

## What is shown instead

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

`ml/train.py` is the real training pipeline for a future trained deployment. It refuses to run without a verified CSV and at least 30 days of hourly rows.

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

- LightGBM regressors (`objective=regression_l1`)
- LightGBM quantile regressors
- LightGBM classifier with isotonic calibration on the validation partition
- MAE, RMSE, persistence-baseline MAE/RMSE
- quantile coverage vs 0.8 target
- precision, recall, PR-AUC, ROC-AUC, Brier score
- SHAP TreeExplainer on a test sample

If SHAP fails, the pipeline records a failure rather than inventing values.

### Baseline comparison

The test partition is also scored with persistence (`prediction = current PM2.5`). A complex model should beat this baseline; otherwise it should not be deployed.

## Inference service

`ml/serve.py` is the optional FastAPI inference service:

```bash
cd ml
pip install -r requirements-serve.txt
python train.py --input data/mumbai_air_quality.csv --output artifacts
uvicorn serve:app --host 0.0.0.0 --port 8000
```

It returns `503 MODEL_NOT_TRAINED` until artifacts and `model_card.json` exist. The Node adapter (`server/src/services/ml.ts`) calls `/health` and `/predict`; if the service is not configured, not trained or unreachable, the app falls back to `PERSISTENCE_BASELINE_V1` and says so.

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

- The reference extract covers one seasonal cycle. The chronological test window
  is later than training, so some calendar months are unseen during fitting; the
  model must rely on weather and lag features for those months.
- Evaluation is temporal, not spatial: the test set contains future rows from the
  same stations used in training. It does not measure skill at an unseen station.
- Weather is Open-Meteo ERA5 reanalysis, not a co-located station measurement.
- Station PM2.5 coverage varies (30-87%); missing pollutant inputs remain missing
  and are handled by LightGBM's native NaN handling, not by imputation.
- The classifier label is a fixed >60 µg/m³ threshold, not a relative change from
  the current value. Its calibration is only valid for the validation window.
- SHAP values are computed from the actual artifact but do not establish causality.
- The persistence baseline remains the fallback and is not a regulatory forecast.
- Training on demo/synthetic data is not acceptable for a real model unless the
  resulting model is itself labelled as a simulation model.
