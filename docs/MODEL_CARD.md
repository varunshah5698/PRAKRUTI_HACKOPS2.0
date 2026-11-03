# Model Card

## Model family

प्रकृति PM2.5 forecasting family, version `lightgbm-202611030821-ed07b475`:

| Model | Version | Status | Purpose |
|---|---|---|---|
| LightGBM PM2.5 1h | v1-1h | **TRAINED (local)** | 1-hour PM2.5 regression |
| LightGBM PM2.5 3h | v1-3h | **TRAINED (local)** | 3-hour PM2.5 regression |
| LightGBM PM2.5 6h | v1-6h | **TRAINED (local)** | 6-hour PM2.5 regression |
| LightGBM quantile | v1 | **TRAINED (local)** | 10th/90th percentile intervals at 1/3/6h |
| 3h exceedance classifier | v1 | **TRAINED (local)** | Probability PM2.5 > 60 µg/m³ at +3h |
| Anomaly detector | v1 | **NOT_TRAINED** | `ZSCORE_V1` analytical check only |
| Persistence baseline | v1 | **BASELINE** | Labelled analytical fallback |

The joblib artifacts are gitignored. A clean checkout or the Render deployment
still reports `NOT_TRAINED`/`INCOMPLETE` and uses the persistence baseline until
the artifacts are force-added and the model is registered. “TRAINED (local)” does
not mean production-approved: technical review is recorded in
[`MODEL_REVIEW.md`](MODEL_REVIEW.md), but authority sign-off is pending.

## Intended use

- Decision support for environmental analysts and authorities.
- Visualising potential PM2.5 change at a monitoring station.
- Triggering a reviewable analytical early warning, never an automatic violation.
- Demonstrating the full workflow with real station measurements and labelled
  uncertainty.

## Out-of-scope use

- Enforcement, legal findings, health advice or emergency response.
- Claims about an area without monitoring coverage.
- Claims about a specific facility's responsibility.
- Treating a forecast as an observed condition or an official determination.
- Presenting the persistence baseline or a rejected model as trained ML output.

## Training data

Reference extract: `ml/data/mumbai_air_quality_archive.csv` (SHA-256
`ed07b475c1e4620acca6c8b59fc782fc064d60e8a954a78e57dc1e121255fb21`).

- Air quality: OpenAQ public S3 daily archive, raw CPCB station measurements from
  23 MPCB/BMC/IITM stations inside the Greater Mumbai boundary.
- Period: 2025-03-01 to 2026-10-27 (605 days), 333,960 station-hours. Modelled
  feature rows end at 2026-10-23 because the +6h target needs six future hours
  inside the extract.
- Coverage: PM2.5 74.5%, PM10 73.8%, NO2 74.0%, CO 69.6%, O3 67.0%, SO2 62.9%.
- Weather: co-located OpenAQ station measurements where available (mean coverage
  51% temperature, 52% humidity, 31% wind speed/direction) with Open-Meteo ERA5
  reanalysis filling the remaining hours. Precipitation is ERA5-only. Per-station
  measured fractions are in `stations[].weather` in the sidecar metadata.
- Raw sub-hourly readings were aggregated to hourly means. Gaps remain NaN and
  are not imputed. NO2/SO2/O3 were converted from ppb to µg/m³; CO was converted
  from the CPCB mg/m³ feed (OpenAQ labels the CO values ppb, but the values are
  ppm; a legacy co-located sensor cross-check is recorded in the sidecar).
- Weather QC includes physical bounds and a cross-station median check (a
  temperature sensor 6°C off the city median is treated as faulty and falls back
  to ERA5).
- Station/sensor IDs, per-parameter coverage, QC bounds and conversions are in
  `ml/data/mumbai_air_quality_archive.meta.json`.

The pipeline requires at least 30% hourly PM2.5 coverage and 2,000 rows per
station. The lowest included station is Bhandup West at 44.7% PM2.5 coverage; the
highest is Borivali East (IITM) at 88.8%.

## Evaluation

Strict chronological 70/15/15 split by global timestamp; no random shuffle.

| Partition | Period | Rows | Stations |
|---|---|---|---|
| Train | 2025-03-01 → 2026-04-27 | 176,997 | 23 |
| Validation | 2026-04-27 → 2026-07-26 | 34,601 | 23 |
| Test | 2026-07-26 → 2026-10-23 | 37,119 | 23 |

Test-set performance (models trained with early stopping on validation):

| Horizon | Model MAE | Persistence MAE | Model RMSE | Persistence RMSE | Skill vs persistence |
|---|---|---|---|---|---|
| 1h | **3.48** µg/m³ | 3.61 µg/m³ | 9.36 | 10.23 | **+3.6%** |
| 3h | **5.33** µg/m³ | 6.14 µg/m³ | 11.05 | 14.20 | **+13.2%** |
| 6h | **6.06** µg/m³ | 7.51 µg/m³ | 11.82 | 15.53 | **+19.4%** |

Quantile 10th/90th intervals (clamped at zero):

| Horizon | 80% coverage | Mean width | Model-crossing rate |
|---|---|---|---|
| 1h | 0.784 | 10.02 µg/m³ | 0.000 |
| 3h | 0.808 | 16.74 µg/m³ | 0.000 |
| 6h | 0.823 | 20.29 µg/m³ | 0.000 |

The 1h interval is slightly narrow (78.4% vs the 80% target); 3h and 6h are on
target. Coverage is measured once on the chronological test partition.

### Spatial holdout

The five geographically spread holdout stations are Colaba (south), Sion
(central), Borivali East MPCB (north), Deonar (east) and Chakala-Andheri East
(west). Models are retrained without those stations and scored on their test rows
(6,911 rows). This checks transfer to a station the model has never seen.

| Horizon | Model MAE | Persistence MAE | Skill |
|---|---|---|---|
| 1h | 3.12 | 3.23 | +3.4% |
| 3h | 4.73 | 5.52 | +14.4% |
| 6h | 5.46 | 6.95 | +21.4% |

Spatial skill is slightly better than the temporal holdout at 3h/6h, which
supports using the pooled model at the network's stations.

### Exceedance classifier

3h exceedance classifier (`target_3h > 60 µg/m³`, an exceedance indicator, not a
relative “deterioration” label):

- Isotonic calibration on 5-fold out-of-fold predictions from the training
  partition. The chronological validation window is not representative (1.9%
  positive vs 5.8% in the test window).
- Test ROC-AUC **0.973**, PR-AUC **0.741**, Brier **0.026**.
- At threshold 0.5: precision **0.748**, recall **0.594**.
- Positive rate: train 15.2%, validation 1.9%, test 5.8%.

Station-level 3h MAE ranges from 3.44 µg/m³ to 8.88 µg/m³ (median 4.80). All
per-station results are in `ml/artifacts/model_card.json`.

SHAP (`TreeExplainer`, top mean absolute contributions on a 200-row test sample):
current PM2.5, 24h rolling mean, 6h rolling mean, 2h lag, 6h lag, hour of day,
12h lag and 3h rolling mean. SHAP values explain model behaviour; they do not
establish causation.

## Limitations

- The extract spans 20 months: two monsoon seasons, one full winter and the start
  of a second winter. The public Mumbai station archive begins around March 2025,
  so a full second 12-month cycle is not available. The test window is later than
  training; some calendar months are unseen during fitting.
- The spatial holdout covers five stations, not every micro-environment.
- Weather is station-measured for roughly half of temperature/humidity and a third
  of wind observations; ERA5 reanalysis fills the rest, and precipitation is
  ERA5-only. The serving path uses Open-Meteo weather, so a train/serve source
  mismatch remains for reanalysis-filled hours.
- Missing pollutant inputs are not imputed; LightGBM handles them as NaN, which
  reduces reliability. The inference service also requires 25 consecutive hourly
  PM2.5 observations; a gap falls back to the persistence baseline.
- The classifier is a fixed-threshold exceedance model, not a relative change
  model. Its probabilities are calibrated for the training extract and should be
  re-reviewed after a distribution shift.
- The model was trained on pooled stations and does not use a station identifier;
  station-specific biases are only partly captured by the shared features.
- Authority review and sign-off are pending. See [`MODEL_REVIEW.md`](MODEL_REVIEW.md).

## Ethical and regulatory considerations

- Forecasts are uncertain and must show intervals and method.
- A prediction is not an observed condition or a confirmed regulatory violation.
- Station-level forecasts must not be painted across a locality as measured
  concentration.
- Missing data must not be silently treated as normal.
- Human authority must review before any official determination.
- Do not use for enforcement, emergency response, health advice or legal
  decisions.

## Reproduce and activate

```bash
cd ml
python fetch_real_data.py --source archive --start 2025-03-01 --end 2026-10-27 \
  --output data/mumbai_air_quality_archive.csv \
  --metadata data/mumbai_air_quality_archive.meta.json
python train.py --input data/mumbai_air_quality_archive.csv --output artifacts
cd ..
npm run ml:register
cd ml
uvicorn serve:app --host 0.0.0.0 --port 8000
```

Set `ML_SERVICE_URL=http://localhost:8000` in `.env.local` and restart the API.
The model is served only when all artifacts exist and
`deployment_recommendation` is not `REJECTED`; otherwise the app keeps the
labelled persistence baseline. Re-running the fetch is cheap because raw OpenAQ
pages, S3 daily files and Open-Meteo responses are cached under `ml/data/raw/`.

## Deployment checklist

| Item | Status |
|---|---|
| Verified data provenance and licence | ✅ OpenAQ/CPCB records; attribution in sidecar |
| Chronological split documented | ✅ 70/15/15 by global timestamp |
| Baseline comparison | ✅ 3h/6h beat persistence; 1h beats it narrowly |
| Spatial holdout | ✅ five unseen stations beat persistence at all horizons |
| Station-level metrics reviewed | ✅ ranges recorded |
| Quantile coverage measured | ✅ 0.78/0.81/0.82; 1h slightly narrow |
| Classifier calibration reviewed | ✅ 5-fold out-of-fold isotonic; Brier 0.026 |
| SHAP computed from the artifact | ✅ TreeExplainer |
| Artifact and feature pipeline versioned | ✅ SHA-256 and model version |
| Missing-feature handling | ✅ NaN-native; inference requires 25 consecutive hours |
| Model registered | ✅ `npm run ml:register` (local database) |
| UI shows trained identity/confidence | ⏳ API restart required |
| Technical review | ✅ [`MODEL_REVIEW.md`](MODEL_REVIEW.md) |
| Authority sign-off | ⏳ pending — only an authorised human can complete this |

## Contact / ownership

प्रकृति ML (demonstration). No production model owner has signed off this model.
