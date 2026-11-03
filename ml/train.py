"""Train and evaluate Mumbai PM2.5 forecasting models.

The script refuses to run without a verified historical extract. It does not
download data, invent stations or fabricate metrics.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
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
MIN_ROWS = 24 * 30


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
    return [
        column
        for column in frame.columns
        if column
        not in {"station_id", "timestamp", "target_1h", "target_3h", "target_6h", "deterioration_3h"}
        and not column.startswith("target_")
    ]


def regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "n": int(len(y_true)),
    }


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
            callbacks=[],
        )
        prediction = model.predict(test[features])
        persistence = test[TARGET].to_numpy()
        metrics[f"pm25_{horizon}h"] = {
            "model": regression_metrics(test[target].to_numpy(), prediction),
            "persistence_baseline": regression_metrics(test[target].to_numpy(), persistence),
            "horizon_hours": horizon,
        }
        joblib.dump({"model": model, "features": features, "horizon_hours": horizon}, output / f"pm25_{horizon}h.joblib")

        for quantile in (0.1, 0.9):
            qmodel = LGBMRegressor(
                objective="quantile",
                alpha=quantile,
                n_estimators=600,
                learning_rate=0.03,
                num_leaves=31,
                random_state=42 + int(quantile * 100),
            )
            qmodel.fit(train[features], train[target])
            joblib.dump(
                {"model": qmodel, "features": features, "horizon_hours": horizon, "quantile": quantile},
                output / f"pm25_quantile_{horizon}h_{int(quantile * 100)}.joblib",
            )
            if horizon == 3:
                qpred = qmodel.predict(test[features])
                if quantile == 0.1:
                    lower = qpred
                else:
                    coverage = float(np.mean((test[target].to_numpy() >= lower) & (test[target].to_numpy() <= qpred)))
                    metrics["pm25_3h_quantile_80"] = {
                        "coverage": coverage,
                        "target_coverage": 0.8,
                        "note": "Coverage measured on the chronological test partition.",
                    }
    return metrics


def train_classifier(train: pd.DataFrame, validation: pd.DataFrame, test: pd.DataFrame, features: list[str], output: Path) -> dict:
    base = LGBMClassifier(
        n_estimators=600,
        learning_rate=0.03,
        num_leaves=31,
        random_state=42,
        class_weight="balanced",
    )
    base.fit(train[features], train["deterioration_3h"])
    calibrated = CalibratedClassifierCV(base, method="isotonic", cv="prefit")
    calibrated.fit(validation[features], validation["deterioration_3h"])
    probabilities = calibrated.predict_proba(test[features])[:, 1]
    labels = test["deterioration_3h"].to_numpy()
    predictions = (probabilities >= 0.5).astype(int)
    metrics = {
        "precision": float(precision_score(labels, predictions, zero_division=0)),
        "recall": float(recall_score(labels, predictions, zero_division=0)),
        "pr_auc": float(average_precision_score(labels, probabilities)) if labels.sum() else None,
        "roc_auc": float(roc_auc_score(labels, probabilities)) if 0 < labels.sum() < len(labels) else None,
        "brier": float(brier_score_loss(labels, probabilities)),
        "positive_rate_test": float(labels.mean()),
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("data/mumbai_air_quality.csv"))
    parser.add_argument("--output", type=Path, default=Path("artifacts"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    frame = build_features(load_data(args.input))
    train, validation, test = time_split(frame)
    features = feature_list(frame)
    metrics = train_regressors(train, validation, test, features, args.output)
    metrics["deterioration_classifier_3h"] = train_classifier(train, validation, test, features, args.output)
    bundle = joblib.load(args.output / "pm25_3h.joblib")
    shap = shap_summary(bundle, test, args.output)

    model_card = {
        "model_version": f"lightgbm-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M')}",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "dataset": str(args.input),
        "rows": int(len(frame)),
        "stations": int(frame["station_id"].nunique()),
        "train_rows": int(len(train)),
        "validation_rows": int(len(validation)),
        "test_rows": int(len(test)),
        "split": "chronological 70/15/15 by global timestamp; no random shuffle",
        "features": features,
        "metrics": metrics,
        "shap": shap,
        "caveat": (
            "Metrics are only valid for the supplied extract. Do not copy them into the application "
            "unless the exact data version, feature pipeline and model artifact are registered and reproducible."
        ),
    }
    (args.output / "metrics.json").write_text(json.dumps(metrics, indent=2))
    (args.output / "model_card.json").write_text(json.dumps(model_card, indent=2))
    print(json.dumps(model_card, indent=2))


if __name__ == "__main__":
    main()
