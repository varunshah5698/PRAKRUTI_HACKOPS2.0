"""Train and evaluate Mumbai PM2.5 forecasting models.

The script refuses to run without a verified historical extract. It does not
download data, invent stations or fabricate metrics.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier, LGBMRegressor
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    recall_score,
    roc_auc_score,
)

HORIZONS = (1, 3, 6)
TARGET = "pm25"
FEATURE_COLUMNS = [
    "pm25",
    "pm10",
    "no2",
    "so2",
    "co",
    "o3",
    "temperature",
    "humidity",
    "wind_speed",
    "wind_dir",
    "precipitation",
]
DERIVED_FEATURES = [
    *(f"pm25_lag_{lag}" for lag in (1, 2, 3, 6, 12, 24)),
    *(f"pm25_roll_mean_{window}" for window in (3, 6, 24)),
    "hour",
    "day_of_week",
    "month",
    "wind_dir_sin",
    "wind_dir_cos",
]
MODEL_FEATURES = [*FEATURE_COLUMNS, *DERIVED_FEATURES]
MIN_ROWS = 24 * 30
# Geographically spread stations used only for the spatial holdout: south,
# central, north, east and west Mumbai. They are still used in the main temporal
# evaluation; this is an additional unseen-station check.
SPATIAL_HOLDOUT = {
    "OPENAQ-6927",   # Colaba (south)
    "OPENAQ-6967",   # Sion (central)
    "OPENAQ-6965",   # Borivali East MPCB (north)
    "OPENAQ-3409329",  # Deonar (east)
    "OPENAQ-12024",  # Chakala-Andheri East (west)
}


def load_data(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise SystemExit(
            f"Training extract not found: {path}. No model was trained. "
            "Supply a verified historical CSV; do not substitute synthetic data without labelling it."
        )
    frame = pd.read_csv(path)
    required = {"station_id", "timestamp", *FEATURE_COLUMNS}
    missing = required - set(frame.columns)
    if missing:
        raise SystemExit(f"Training extract is missing required columns: {sorted(missing)}")
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True)
    frame = frame.sort_values(["station_id", "timestamp"]).drop_duplicates(["station_id", "timestamp"])
    # Current PM2.5 is needed for the persistence baseline and the lag features.
    frame = frame.dropna(subset=[TARGET])
    if len(frame) < MIN_ROWS:
        raise SystemExit(
            f"Only {len(frame)} rows available; at least {MIN_ROWS} hourly rows are required. "
            "Keep the model NOT_TRAINED rather than producing an indefensible forecast."
        )
    return frame


def build_features(frame: pd.DataFrame) -> pd.DataFrame:
    grouped = frame.groupby("station_id", group_keys=False)
    out = frame.copy()
    for lag in (1, 2, 3, 6, 12, 24):
        out[f"pm25_lag_{lag}"] = grouped[TARGET].shift(lag)
    for window in (3, 6, 24):
        out[f"pm25_roll_mean_{window}"] = grouped[TARGET].transform(
            lambda series: series.rolling(window, min_periods=max(2, window // 2)).mean()
        )
    out["hour"] = out["timestamp"].dt.hour
    out["day_of_week"] = out["timestamp"].dt.dayofweek
    out["month"] = out["timestamp"].dt.month
    out["wind_dir_sin"] = np.sin(np.deg2rad(out["wind_dir"]))
    out["wind_dir_cos"] = np.cos(np.deg2rad(out["wind_dir"]))
    for horizon in HORIZONS:
        out[f"target_{horizon}h"] = grouped[TARGET].shift(-horizon)
    out["deterioration_3h"] = (out["target_3h"] > 60).astype(int)
    return out.dropna(subset=[f"target_{horizon}h" for horizon in HORIZONS])


def time_split(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    times = np.sort(frame["timestamp"].unique())
    if len(times) < 30:
        raise SystemExit("Not enough distinct timestamps for a chronological split.")
    train_end = times[int(len(times) * 0.70)]
    validation_end = times[int(len(times) * 0.85)]
    train = frame[frame["timestamp"] < train_end]
    validation = frame[(frame["timestamp"] >= train_end) & (frame["timestamp"] < validation_end)]
    test = frame[frame["timestamp"] >= validation_end]
    if min(len(train), len(validation), len(test)) == 0:
        raise SystemExit("Chronological split produced an empty partition.")
    return train, validation, test


def feature_list(frame: pd.DataFrame) -> list[str]:
    # Explicit allow-list: an unexpected CSV column must not become a feature by
    # accident (that is how leakage and string-dtype failures reach production).
    return [column for column in MODEL_FEATURES if column in frame.columns]


def regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "n": int(len(y_true)),
    }


def skill_score(model_mae: float, baseline_mae: float) -> float | None:
    if baseline_mae <= 0:
        return None
    return float(1.0 - model_mae / baseline_mae)


def train_regressors(train: pd.DataFrame, validation: pd.DataFrame, test: pd.DataFrame, features: list[str], output: Path) -> dict:
    metrics: dict[str, object] = {}
    for horizon in HORIZONS:
        target = f"target_{horizon}h"
        model = LGBMRegressor(
            objective="regression_l1",
            n_estimators=800,
            learning_rate=0.03,
            num_leaves=31,
            subsample=0.9,
            colsample_bytree=0.9,
            random_state=42,
        )
        model.fit(
            train[features],
            train[target],
            eval_set=[(validation[features], validation[target])],
            eval_metric="mae",
            callbacks=[lgb.early_stopping(50, verbose=False)],
        )
        # The inference service clamps at zero, so evaluation must clamp too.
        prediction = np.maximum(0.0, model.predict(test[features]))
        truth = test[target].to_numpy()
        persistence = test[TARGET].to_numpy()
        model_metrics = regression_metrics(truth, prediction)
        baseline_metrics = regression_metrics(truth, persistence)
        per_station = {}
        for station_id, group in test.groupby("station_id"):
            station_prediction = np.maximum(0.0, model.predict(group[features]))
            per_station[str(station_id)] = regression_metrics(group[target].to_numpy(), station_prediction)
        metrics[f"pm25_{horizon}h"] = {
            "model": model_metrics,
            "persistence_baseline": baseline_metrics,
            "skill_vs_persistence": skill_score(model_metrics["mae"], baseline_metrics["mae"]),
            "per_station": per_station,
            "horizon_hours": horizon,
            "best_iteration": int(model.best_iteration_ or model.n_estimators),
        }
        joblib.dump({"model": model, "features": features, "horizon_hours": horizon}, output / f"pm25_{horizon}h.joblib")

        quantile_predictions: dict[float, np.ndarray] = {}
        for quantile in (0.1, 0.9):
            qmodel = LGBMRegressor(
                objective="quantile",
                alpha=quantile,
                n_estimators=600,
                learning_rate=0.03,
                num_leaves=31,
                random_state=42 + int(quantile * 100),
            )
            qmodel.fit(
                train[features],
                train[target],
                eval_set=[(validation[features], validation[target])],
                eval_metric="quantile",
                callbacks=[lgb.early_stopping(50, verbose=False)],
            )
            joblib.dump(
                {"model": qmodel, "features": features, "horizon_hours": horizon, "quantile": quantile},
                output / f"pm25_quantile_{horizon}h_{int(quantile * 100)}.joblib",
            )
            quantile_predictions[quantile] = np.maximum(0.0, qmodel.predict(test[features]))
        lower = np.minimum(quantile_predictions[0.1], quantile_predictions[0.9])
        upper = np.maximum(quantile_predictions[0.1], quantile_predictions[0.9])
        metrics[f"pm25_{horizon}h_quantile_80"] = {
            "coverage": float(np.mean((truth >= lower) & (truth <= upper))),
            "target_coverage": 0.8,
            "mean_width": float(np.mean(upper - lower)),
            "crossing_rate": float(np.mean(quantile_predictions[0.1] > quantile_predictions[0.9])),
            "note": "Coverage measured on the chronological test partition; bounds clamped at zero.",
        }
    return metrics


def train_classifier(train: pd.DataFrame, validation: pd.DataFrame, test: pd.DataFrame, features: list[str], output: Path) -> dict:
    if train["deterioration_3h"].nunique() < 2:
        raise SystemExit("The training partition contains only one exceedance class; the classifier cannot be trained.")
    # Calibrate on out-of-fold predictions from the whole training season. The
    # chronological validation window can be an unusually clean monsoon slice
    # (here: 0.16% positives vs 9.6% in the test window), and isotonic
    # calibration on it would systematically understate risk. Five-fold
    # out-of-fold calibration sees both the winter high-pollution regime and
    # the monsoon low-pollution regime.
    base = LGBMClassifier(
        n_estimators=600,
        learning_rate=0.03,
        num_leaves=31,
        random_state=42,
        class_weight="balanced",
    )
    calibrated = CalibratedClassifierCV(base, method="isotonic", cv=5)
    calibrated.fit(train[features], train["deterioration_3h"])
    probabilities = calibrated.predict_proba(test[features])[:, 1]
    labels = test["deterioration_3h"].to_numpy()
    predictions = (probabilities >= 0.5).astype(int)
    metrics = {
        "label": "target_3h > 60 ug/m3 (CPCB 24-hour PM2.5 standard used as an hourly exceedance indicator)",
        "precision": float(precision_score(labels, predictions, zero_division=0)),
        "recall": float(recall_score(labels, predictions, zero_division=0)),
        "pr_auc": float(average_precision_score(labels, probabilities)) if labels.sum() else None,
        "roc_auc": float(roc_auc_score(labels, probabilities)) if 0 < labels.sum() < len(labels) else None,
        "brier": float(brier_score_loss(labels, probabilities)),
        "positive_rate_train": float(train["deterioration_3h"].mean()),
        "positive_rate_validation": float(validation["deterioration_3h"].mean()),
        "positive_rate_test": float(labels.mean()),
        "calibration": "isotonic, 5-fold out-of-fold predictions on the training partition",
        "cv_folds": 5,
        "n": int(len(labels)),
    }
    joblib.dump({"model": calibrated, "features": features, "threshold": 0.5}, output / "deterioration_classifier.joblib")
    return metrics


def shap_summary(model_bundle: dict, sample: pd.DataFrame, output: Path) -> dict:
    try:
        import shap

        model = model_bundle["model"]
        features = model_bundle["features"]
        explainer = shap.TreeExplainer(model)
        values = explainer.shap_values(sample[features].head(200))
        importance = np.abs(values).mean(axis=0)
        ranked = sorted(
            ({"feature": feature, "mean_abs_shap": float(value)} for feature, value in zip(features, importance)),
            key=lambda item: item["mean_abs_shap"],
            reverse=True,
        )
        summary = {"method": "TreeExplainer", "sample_rows": int(min(200, len(sample))), "features": ranked[:20]}
        (output / "shap_summary.json").write_text(json.dumps(summary, indent=2))
        return summary
    except Exception as error:  # SHAP must not be faked if it fails.
        return {"status": "FAILED", "error": str(error)}


def spatial_holdout(train: pd.DataFrame, validation: pd.DataFrame, test: pd.DataFrame, features: list[str]) -> dict:
    """Train on all but a few stations and score the unseen stations.

    The main split is temporal. This additional check answers a different
    question: does the pooled model transfer to a station it has never seen?
    It is not used to select hyperparameters.
    """
    stations = sorted(train["station_id"].unique())
    holdout = {station for station in SPATIAL_HOLDOUT if station in stations}
    if len(holdout) < 3:
        holdout = set(stations[::5])
    if len(holdout) < 3 or len(stations) - len(holdout) < 3:
        return {"status": "SKIPPED", "reason": "Not enough stations for a spatial holdout."}
    train_part = train[~train["station_id"].isin(holdout)]
    validation_part = validation[~validation["station_id"].isin(holdout)]
    test_part = test[test["station_id"].isin(holdout)]
    if validation_part.empty or test_part.empty:
        return {"status": "SKIPPED", "reason": "Spatial holdout partition is empty."}
    metrics: dict[str, object] = {}
    for horizon in HORIZONS:
        target = f"target_{horizon}h"
        model = LGBMRegressor(
            objective="regression_l1",
            n_estimators=800,
            learning_rate=0.03,
            num_leaves=31,
            subsample=0.9,
            colsample_bytree=0.9,
            random_state=42,
        )
        model.fit(
            train_part[features],
            train_part[target],
            eval_set=[(validation_part[features], validation_part[target])],
            eval_metric="mae",
            callbacks=[lgb.early_stopping(50, verbose=False)],
        )
        prediction = np.maximum(0.0, model.predict(test_part[features]))
        truth = test_part[target].to_numpy()
        persistence = test_part[TARGET].to_numpy()
        model_metrics = regression_metrics(truth, prediction)
        baseline_metrics = regression_metrics(truth, persistence)
        metrics[f"pm25_{horizon}h"] = {
            "model": model_metrics,
            "persistence_baseline": baseline_metrics,
            "skill_vs_persistence": skill_score(model_metrics["mae"], baseline_metrics["mae"]),
            "horizon_hours": horizon,
            "best_iteration": int(model.best_iteration_ or model.n_estimators),
        }
    return {
        "status": "COMPLETED",
        "holdout_stations": sorted(holdout),
        "train_stations": int(len(stations) - len(holdout)),
        "test_rows": int(len(test_part)),
        "metrics": metrics,
        "note": (
            "Models were retrained without the holdout stations and scored on the "
            "holdout stations' chronological test rows. This checks spatial transfer, "
            "not the deployed model's temporal holdout."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("data/mumbai_air_quality.csv"))
    parser.add_argument("--output", type=Path, default=Path("artifacts"))
    parser.add_argument("--metadata", type=Path, default=None, help="Sidecar metadata JSON written by fetch_real_data.py.")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    raw = load_data(args.input)
    frame = build_features(raw)
    train, validation, test = time_split(frame)
    features = feature_list(frame)
    metrics = train_regressors(train, validation, test, features, args.output)
    metrics["deterioration_classifier_3h"] = train_classifier(train, validation, test, features, args.output)
    bundle = joblib.load(args.output / "pm25_3h.joblib")
    shap = shap_summary(bundle, test, args.output)
    spatial = spatial_holdout(train, validation, test, features)

    metadata_path = args.metadata or args.input.with_suffix(".meta.json")
    metadata = None
    if metadata_path.exists():
        metadata = json.loads(metadata_path.read_text())

    digest = hashlib.sha256(args.input.read_bytes()).hexdigest()
    horizons_beating_persistence = [
        horizon
        for horizon in HORIZONS
        if (metrics[f"pm25_{horizon}h"]["skill_vs_persistence"] or 0) > 0
    ]
    approved = 3 in horizons_beating_persistence and 6 in horizons_beating_persistence
    generated_at = datetime.now(timezone.utc)

    def split_summary(partition: pd.DataFrame) -> dict:
        return {
            "rows": int(len(partition)),
            "stations": int(partition["station_id"].nunique()),
            "start": partition["timestamp"].min().isoformat(),
            "end": partition["timestamp"].max().isoformat(),
        }

    model_card = {
        "model_version": f"lightgbm-{generated_at.strftime('%Y%m%d%H%M')}-{digest[:8]}",
        "trained_at": generated_at.isoformat(),
        "dataset": str(args.input),
        "dataset_sha256": digest,
        "dataset_metadata": str(metadata_path) if metadata_path.exists() else None,
        "rows_raw": int(len(raw)),
        "rows": int(len(frame)),
        "stations": int(frame["station_id"].nunique()),
        "date_range": {
            "start": frame["timestamp"].min().isoformat(),
            "end": frame["timestamp"].max().isoformat(),
        },
        "rows_per_station": {str(key): int(value) for key, value in raw.groupby("station_id").size().items()},
        "missing_fraction_raw": {
            column: round(float(raw[column].isna().mean()), 4) for column in FEATURE_COLUMNS
        },
        "train_rows": int(len(train)),
        "validation_rows": int(len(validation)),
        "test_rows": int(len(test)),
        "split": {
            "method": "chronological 70/15/15 by global timestamp; no random shuffle",
            "train": split_summary(train),
            "validation": split_summary(validation),
            "test": split_summary(test),
        },
        "features": features,
        "targets": {
            "regression": [f"pm25 at +{horizon}h" for horizon in HORIZONS],
            "classifier": metrics["deterioration_classifier_3h"]["label"],
        },
        "metrics": metrics,
        "spatial_holdout": spatial,
        "skill_vs_persistence": {
            f"{horizon}h": metrics[f"pm25_{horizon}h"]["skill_vs_persistence"] for horizon in HORIZONS
        },
        "horizons_beating_persistence": horizons_beating_persistence,
        "deployment_recommendation": "APPROVED" if approved else "REJECTED",
        "deployment_reason": (
            "The 3h and 6h regressors beat persistence on the chronological test partition."
            if approved
            else "At least one of the 3h/6h regressors does not beat persistence on the chronological test partition."
        ),
        "data_sources": metadata.get("sources") if metadata else None,
        "data_qc": metadata.get("qc") if metadata else None,
        "unit_conversions": metadata.get("unit_conversions") if metadata else None,
        "shap": shap,
        "caveat": (
            "Metrics are chronological hold-out estimates for this exact extract (SHA-256 above), not a "
            "guarantee of future skill. Air-quality data are OpenAQ S3 archive station records "
            "(CPCB/MPCB/BMC/IITM). Weather uses co-located station measurements where available and "
            "Open-Meteo ERA5 reanalysis for missing hours; per-station measured fractions are in the "
            "sidecar metadata. A separate spatial holdout retrains without five stations and scores those "
            "unseen stations. Missing observations were not imputed. The classifier label is target_3h > "
            "60 ug/m3, an exceedance indicator, not a relative deterioration label."
        ),
    }
    (args.output / "metrics.json").write_text(json.dumps(metrics, indent=2))
    (args.output / "model_card.json").write_text(json.dumps(model_card, indent=2))
    print(json.dumps(model_card, indent=2))


if __name__ == "__main__":
    main()
