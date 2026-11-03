# प्रकृति ML training pipeline

This directory contains the real training and evaluation code for the air-quality
forecasting models. **No model is trained in the delivered application** because no
verified Mumbai historical training extract was supplied.

The application therefore reports:

- `NOT_TRAINED` for LightGBM 1h/3h/6h, quantile, deterioration and anomaly models.
- A clearly labelled persistence baseline (`PERSISTENCE_BASELINE_V1`) for the
  forecast page and map timeline.

Do not claim the models are trained, calibrated or accurate until this pipeline
has been run on a verified historical extract and the evaluation results have
been reviewed.

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
`NOT_TRAINED` and returns `503` until `artifacts/model_card.json` and the model
files exist. The API keeps showing the labelled persistence baseline in that
case; it never invents trained output.

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
