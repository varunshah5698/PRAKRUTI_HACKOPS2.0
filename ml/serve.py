"""LightGBM inference service for Mumbai EnviroPulse.

This service is optional. It returns 503 MODEL_NOT_TRAINED until the training
pipeline has produced artifacts from a verified historical extract. It never
invents forecasts.
"""
from __future__ import annotations

import hmac
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

ARTIFACT_DIR = Path(os.getenv("ML_ARTIFACT_DIR", Path(__file__).resolve().parent / "artifacts"))
HORIZONS = (1, 3, 6)
FEATURE_COLUMNS = ["pm25", "pm10", "no2", "so2", "co", "o3", "temperature", "humidity", "wind_speed", "wind_dir", "precipitation"]
API_KEY = os.environ.get("ML_SERVICE_API_KEY", "")

app = FastAPI(title="Mumbai EnviroPulse ML inference", version="1.0.0")
def require_api_key(authorization: str | None) -> None:
    if not API_KEY:
        return
    if not authorization or not hmac.compare_digest(authorization, f"Bearer {API_KEY}"):
        raise HTTPException(401, "UNAUTHORIZED")


class HistoryPoint(BaseModel):
    timestamp: str
    pm25: float
    pm10: float | None = None
    no2: float | None = None
    so2: float | None = None
    co: float | None = None
    o3: float | None = None


class WeatherInput(BaseModel):
    temperature: float | None = None
    humidity: float | None = None
    wind_speed: float | None = None
    wind_dir: float | None = None
    precipitation: float | None = None


class PredictRequest(BaseModel):
    station_id: str
    history: list[HistoryPoint] = Field(min_length=25)
    weather: WeatherInput = Field(default_factory=WeatherInput)
    latest: dict[str, float] = Field(default_factory=dict)


def artifact(name: str) -> dict[str, Any] | None:
    path = ARTIFACT_DIR / name
    if not path.exists():
        return None
    return joblib.load(path)


def known_station_ids() -> set[str]:
    card_path = ARTIFACT_DIR / "model_card.json"
    if not card_path.exists():
        return set()
    try:
        card = json.loads(card_path.read_text())
        return set(card.get("metrics", {}).get("pm25_1h", {}).get("per_station", {}).keys())
    except Exception:
        return set()


def model_manifest() -> dict[str, Any]:
    card_path = ARTIFACT_DIR / "model_card.json"
    if not card_path.exists():
        return {"status": "NOT_TRAINED", "artifacts": []}
    try:
        card = json.loads(card_path.read_text())
    except Exception:
        return {"status": "NOT_TRAINED", "artifacts": [], "error": "model_card.json is unreadable"}
    artifacts = sorted(path.name for path in ARTIFACT_DIR.glob("*.joblib"))
    required = [
        "pm25_1h.joblib",
        "pm25_3h.joblib",
        "pm25_6h.joblib",
        "pm25_quantile_1h_10.joblib",
        "pm25_quantile_1h_90.joblib",
        "pm25_quantile_3h_10.joblib",
        "pm25_quantile_3h_90.joblib",
        "pm25_quantile_6h_10.joblib",
        "pm25_quantile_6h_90.joblib",
        "deterioration_classifier.joblib",
    ]
    missing = [name for name in required if name not in artifacts]
    recommendation = card.get("deployment_recommendation", "APPROVED")
    status = "TRAINED" if not missing and recommendation != "REJECTED" else "INCOMPLETE"
    return {
        "status": status,
        "model_version": card.get("model_version", "trained-1"),
        "trained_at": card.get("trained_at"),
        "dataset_sha256": card.get("dataset_sha256"),
        "deployment_recommendation": recommendation,
        "metrics_available": bool(card.get("metrics")),
        "artifacts": artifacts,
        "missing_artifacts": missing,
        "caveat": "Metrics are only valid for the registered training extract.",
    }


def build_features(request: PredictRequest) -> pd.DataFrame:
    frame = pd.DataFrame([point.model_dump() for point in request.history])
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True).dt.floor("h")
    # The API returns raw station observations (often 15-minute or 1-minute).
    # Training used hourly means, so aggregate before computing lags.
    numeric = [column for column in frame.columns if column != "timestamp"]
    frame = frame.groupby("timestamp", as_index=False)[numeric].mean()
    frame = frame.sort_values("timestamp").tail(25).reset_index(drop=True)
    if len(frame) < 25:
        raise HTTPException(422, "At least 25 hourly PM2.5 observations are required (24 lags plus the current hour).")
    gaps = frame["timestamp"].diff().dropna()
    if not (gaps == pd.Timedelta(hours=1)).all():
        raise HTTPException(
            422,
            "PM2.5 history must contain 25 consecutive hourly observations; a gap would misalign the 1-24 hour lag features.",
        )
    for column in FEATURE_COLUMNS:
        if column not in frame.columns:
            frame[column] = np.nan
    frame = frame.ffill()
    # `latest` carries current pollutant readings. Never let it overwrite the
    # PM2.5 history that the lag features are computed from.
    for column, value in request.latest.items():
        if column in FEATURE_COLUMNS and column != "pm25":
            frame[column] = value
    pm = frame["pm25"]
    row: dict[str, Any] = {}
    for column in FEATURE_COLUMNS:
        row[column] = frame[column].iloc[-1]
    for lag in (1, 2, 3, 6, 12, 24):
        row[f"pm25_lag_{lag}"] = pm.iloc[-1 - lag]
    for window in (3, 6, 24):
        row[f"pm25_roll_mean_{window}"] = pm.iloc[-window:].mean()
    latest = frame["timestamp"].iloc[-1]
    row["hour"] = latest.hour
    row["day_of_week"] = latest.dayofweek
    row["month"] = latest.month
    weather = request.weather.model_dump()
    for key, value in weather.items():
        if value is not None:
            row[key] = value
    # Compute the circular wind features after applying current weather, so the
    # served row matches the training row. Missing direction stays NaN.
    wind_dir = row.get("wind_dir")
    if wind_dir is None or pd.isna(wind_dir):
        row["wind_dir_sin"] = np.nan
        row["wind_dir_cos"] = np.nan
    else:
        row["wind_dir_sin"] = math.sin(math.radians(float(wind_dir)))
        row["wind_dir_cos"] = math.cos(math.radians(float(wind_dir)))
    return pd.DataFrame([row])


@app.get("/health")
def health() -> dict[str, Any]:
    manifest = model_manifest()
    return {"service": "mumbai-enviropulse-ml", "status": manifest["status"], **manifest}


@app.post("/predict")
def predict(request: PredictRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_api_key(authorization)
    manifest = model_manifest()
    if manifest["status"] != "TRAINED":
        raise HTTPException(503, "MODEL_NOT_TRAINED: train and register a verified model first.")
    known = known_station_ids()
    if known and request.station_id not in known:
        raise HTTPException(
            422,
            "STATION_NOT_IN_TRAINING: this model was trained on OpenAQ station IDs only; use a connected-source station or the labelled baseline.",
        )
    features = build_features(request)
    forecasts: list[dict[str, Any]] = []
    for horizon in HORIZONS:
        bundle = artifact(f"pm25_{horizon}h.joblib")
        if not bundle:
            raise HTTPException(503, f"MODEL_ARTIFACT_MISSING: pm25_{horizon}h.joblib")
        model = bundle["model"]
        feature_names = bundle["features"]
        values = features.reindex(columns=feature_names)
        prediction = float(model.predict(values)[0])
        lower_bundle = artifact(f"pm25_quantile_{horizon}h_10.joblib")
        upper_bundle = artifact(f"pm25_quantile_{horizon}h_90.joblib")
        lower = float(lower_bundle["model"].predict(values.reindex(columns=lower_bundle["features"]))[0]) if lower_bundle else max(0.0, prediction - 10)
        upper = float(upper_bundle["model"].predict(values.reindex(columns=upper_bundle["features"]))[0]) if upper_bundle else prediction + 10
        forecasts.append({
            "horizon_hours": horizon,
            "predicted_value": round(max(0.0, prediction), 2),
            "lower_bound": round(max(0.0, min(lower, upper)), 2),
            "upper_bound": round(max(lower, upper), 2),
        })

    classifier = artifact("deterioration_classifier.joblib")
    deterioration_probability = None
    if classifier:
        probability = classifier["model"].predict_proba(features.reindex(columns=classifier["features"]))[0][1]
        deterioration_probability = round(float(probability), 4)

    shap_values: list[dict[str, Any]] = []
    shap_status = "UNAVAILABLE"
    try:
        import shap

        bundle = artifact("pm25_3h.joblib")
        if bundle:
            explainer = shap.TreeExplainer(bundle["model"])
            values = features.reindex(columns=bundle["features"])
            contributions = explainer.shap_values(values)[0]
            ranked = sorted(
                ({"feature": name, "contribution": float(value)} for name, value in zip(bundle["features"], contributions)),
                key=lambda item: abs(item["contribution"]),
                reverse=True,
            )
            shap_values = ranked[:10]
            shap_status = "COMPUTED"
    except Exception as error:
        shap_status = f"FAILED: {error}"

    return {
        "status": "COMPLETED",
        "station_id": request.station_id,
        "model_version": manifest.get("model_version"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "forecasts": forecasts,
        "deterioration_probability": deterioration_probability,
        "shap_status": shap_status,
        "shap": shap_values,
        "limitations": [
            "Forecasts are model estimates, not confirmed future conditions or official determinations.",
            "Metrics are only valid for the registered training extract.",
            "Missing weather inputs reduce reliability and are not replaced with invented values.",
        ],
    }
