# ML Methodology

## Current deployment status

**No model is trained.** The application shows `NOT_TRAINED` for:

- LightGBM PM2.5 1h / 3h / 6h regressors
- quantile 10th/90th percentile models
- calibrated deterioration classifier
- anomaly detector

No verified Mumbai historical training extract has been supplied. The UI therefore does not display model accuracy, calibrated intervals, deterioration probability or SHAP values.

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
- deterioration at +3h: target PM2.5 > 60 µg/m³
- quantile 0.1 / 0.9 at each horizon (3h coverage reported)

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

## Inference contract (future)

A model-serving adapter must:

- load a versioned artifact,
- validate all required features and record missing inputs,
- return median, lower/upper quantile, horizon, model version and target time,
- register the model version in `model_registry` with evaluation metrics,
- keep `status=TRAINED` only after evaluation and review,
- never let the LLM alter the numeric output.

## Known limitations

- No Mumbai historical extract, no station-level evaluation, no seasonal validation.
- No real SHAP values, calibrated intervals or deterioration probabilities in this deployment.
- The persistence baseline has no validated skill and is not a regulatory forecast.
- Missing weather/pollutant inputs are not imputed with invented values; they are recorded as missing.
- Training on demo/synthetic data is not acceptable for a real model unless the resulting model is itself labelled as a simulation model.
