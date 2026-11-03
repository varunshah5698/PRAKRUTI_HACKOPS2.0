# Model Card

## Model family

प्रकृति PM2.5 forecasting family (planned):

| Model | Version | Status | Purpose |
|---|---|---|---|
| LightGBM PM2.5 1h | v1-1h | **NOT_TRAINED** | 1-hour PM2.5 regression |
| LightGBM PM2.5 3h | v1-3h | **NOT_TRAINED** | 3-hour PM2.5 regression |
| LightGBM PM2.5 6h | v1-6h | **NOT_TRAINED** | 6-hour PM2.5 regression |
| LightGBM quantile | v1 | **NOT_TRAINED** | 10th/90th percentile intervals |
| Deterioration classifier | v1 | **NOT_TRAINED** | Probability PM2.5 > 60 µg/m³ at +3h |
| Anomaly detector | v1 | **NOT_TRAINED** | Unusual pattern detection |
| Persistence baseline | v1 | **BASELINE** | Labelled analytical fallback |

## Intended use

- Decision support for environmental analysts and authorities.
- Visualising potential PM2.5 change at a monitoring station.
- Triggering a reviewable analytical early warning, never an automatic violation.
- Demonstrating the full workflow with clearly labelled simulation data.

## Out-of-scope use

- Enforcement, legal findings, health advice or emergency response.
- Claims about an area without monitoring coverage.
- Claims about a specific facility's responsibility.
- Any use of the demo/synthetic dataset as evidence of real Mumbai conditions.
- Presenting persistence baseline output as trained ML accuracy.

## Training data

None supplied. The pipeline expects a verified Mumbai historical extract with station ID, timestamp, pollutant, weather and quality fields. Minimum 30 days hourly per station; longer for 6h and seasonal evaluation. No model has been trained in this deployment.

## Evaluation

No metrics exist. Do not display MAE/RMSE/coverage/PR-AUC/ROC-AUC/calibration for this deployment. The model registry has `metrics = NULL` for untrained models.

## Ethical and regulatory considerations

- Forecasts are uncertain and must show intervals and method.
- A prediction is not an observed condition or a confirmed regulatory violation.
- Station-level forecasts must not be painted across a locality as measured concentration.
- Missing data must not be silently treated as normal.
- Model outputs must be explainable (SHAP) only when computed by the actual trained model.
- Human authority must review before any official determination.

## Deployment checklist (before switching status to TRAINED)

1. Verified data provenance and licence.
2. Chronological train/validation/test split documented.
3. Baseline comparison completed; model improves on persistence.
4. Station-level metrics reviewed.
5. Quantile coverage measured (target 80%).
6. Classifier calibration reviewed (Brier, reliability).
7. SHAP computed from the actual artifact.
8. Model artifact and feature pipeline versioned.
9. Inference adapter validated for missing features.
10. Model registered with version, training date, metrics and limitations.
11. UI updated to show trained model identity and confidence.
12. Human review and sign-off completed.

## Contact / ownership

प्रकृति ML (demonstration). No production model owner is assigned because no model is trained.
