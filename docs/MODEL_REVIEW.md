# Model Review and Sign-off

Model: `lightgbm-202611030821-ed07b475`
Dataset SHA-256: `ed07b475c1e4620acca6c8b59fc782fc064d60e8a954a78e57dc1e121255fb21`
Review date: 2026-11-03

**Status: TECHNICAL_REVIEW_PASSED / AUTHORITY_SIGNOFF_PENDING**

This document separates the checks an engineering team can complete from the
authority decision that only an authorised human can make. No authority signature
is stored in this repository.

## Scope

Covered: PM2.5 1h/3h/6h regressors, 10th/90th quantile intervals, and the 3h >60
µg/m³ exceedance classifier.

Not covered: the `ZSCORE_V1` analytical anomaly check and the
`PERSISTENCE_BASELINE_V1` fallback. Neither is a trained model.

## Technical review (passed)

| Check | Evidence | Result |
|---|---|---|
| Data provenance | OpenAQ S3 archive, 23 CPCB/MPCB/BMC/IITM stations inside the Greater Mumbai boundary | PASS |
| Data period and size | 2025-03-01 → 2026-10-27, 333,960 station-hours, 74.5% PM2.5 coverage | PASS |
| Unit handling | NO2/SO2/O3 ppb→µg/m³; CO ppm→mg/m³ with legacy-sensor cross-check | PASS |
| Gap handling | Gaps remain NaN; no interpolation or invented values | PASS |
| Weather source | Co-located station measurements where available (51% temperature, 52% humidity, 31% wind); ERA5 fallback recorded per station | PASS with residual reanalysis |
| Split | Chronological 70/15/15 by global timestamp; no shuffle | PASS |
| Leakage check | Lags and rolling means only use current/past values; targets are future values; explicit feature allow-list | PASS |
| Baseline skill | 1h +3.6%, 3h +13.2%, 6h +19.4% MAE skill vs persistence | PASS |
| Spatial holdout | Five unseen stations: +3.4% / +14.4% / +21.4% skill at 1h/3h/6h | PASS |
| Quantile coverage | 0.784 / 0.808 / 0.823 vs 0.80 target; 1h slightly narrow | PASS with note |
| Classifier calibration | 5-fold out-of-fold isotonic; ROC-AUC 0.973, PR-AUC 0.741, Brier 0.026 | PASS |
| Explainability | SHAP TreeExplainer computed from the stored 3h artifact | PASS |
| Reproducibility | Fetch script, sidecar metadata, CSV SHA-256, model version and exact commands | PASS |
| Serving checks | `/health` and `/predict` tested with a 25-hour real history; model registry updated; Sion, Colaba and Powai real stations return `LIGHTGBM_TRAINED` from live/backfilled hourly observations; clean fallback on insufficient history | PASS |
| Automated tests | Server typecheck and 22 server unit tests pass | PASS |

Technical reviewer: automated engineering review recorded in this repository.
This is not an environmental authority approval.

## Residual risks and conditions

1. **Weather is not fully measured.** Roughly half of temperature/humidity and a
   third of wind observations are station-measured; the rest is Open-Meteo ERA5
   reanalysis. Precipitation is ERA5-only. The serving path uses Open-Meteo
   weather, so a source mismatch remains for reanalysis-filled hours.
2. **One full seasonal cycle plus a second monsoon.** The public Mumbai station
   archive begins around March 2025. A full second 12-month cycle is unavailable.
3. **Five-station spatial holdout.** The spatial check covers five stations, not
   every micro-environment.
4. **1h interval is slightly narrow.** Coverage is 0.784 against a 0.80 target.
5. **Exceedance, not deterioration.** The classifier estimates PM2.5 >60 µg/m³ at
   +3h; it is not a relative-change model.
6. **Runtime history requirement.** The service requires 25 consecutive hourly
   PM2.5 observations. Sparse live feeds fall back to the labelled baseline.

These are documented limitations, not unresolved implementation defects. The
model must not be described as authority-approved.

## Authority sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Technical model owner (engineering) | प्रकृति ML engineering | 2026-11-03 | PASSED |
| Environmental authority (MPCB/BMC/CPCB nominee) | — | — | **PENDING** |
| Data protection / security reviewer | — | — | **PENDING** |

The authority sign-off must confirm:

- the intended use is decision support, not enforcement, health advice or
  emergency response;
- the model card, limitations and fallback behaviour have been read;
- the deployment record names an accountable owner and a re-review date;
- any use in a public dashboard carries the “not an official determination” label.

## Deployment decision

The model may run locally for demonstration and analyst review. It must not be
used for enforcement, emergency response, health advice or legal decisions until
the authority sign-off is recorded. Re-run this review after any material change
to the data source, feature pipeline, model family or serving path.
