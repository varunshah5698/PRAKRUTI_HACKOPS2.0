# Model Card

## Model family

प्रकृति PM2.5 forecasting family, version `lightgbm-202611030753-34f9567a`:

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
not mean production-approved: human review and sign-off are still pending.

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
`34f9567adec60889934e836727d946eb1c93ab005e6dcf780a73066741bc7e92`).

- Air quality: OpenAQ public S3 daily archive, raw CPCB station measurements from
  23 MPCB/BMC/IITM stations inside the Greater Mumbai boundary.
- Period: 2025-11-01 to 2026-10-27 (360 days), 198,720 station-hours. Modelled
  feature rows end at 2026-10-23 because the +6h target needs six future hours
  inside the extract.
- Coverage: PM2.5 72%, PM10 71%, NO2 71%, CO 67%, O3 64%, SO2 62%; weather 100%.
- Weather: Open-Meteo ERA5 archive reanalysis at station coordinates. This is a
  model/reanalysis product, **not a co-located station measurement**.
- Raw sub-hourly readings were aggregated to hourly means. Gaps remain NaN and
  are not imputed. NO2/SO2/O3 were converted from ppb to µg/m³; CO was converted
  from the CPCB mg/m³ feed (OpenAQ labels the CO values ppb, but the values are
  ppm; a legacy co-located sensor cross-check is recorded in the sidecar).
- Station/sensor IDs, per-parameter coverage, QC bounds and conversions are in
  `ml/data/mumbai_air_quality_archive.meta.json`.

The pipeline requires at least 30% hourly PM2.5 coverage and 2,000 rows per
station. The lowest included station is Powai at 61% PM2.5 coverage; the highest
is Borivali East (IITM) at 87%.

## Evaluation

Strict chronological 70/15/15 split by global timestamp; no random shuffle.

| Partition | Period | Rows | Stations |
|---|---|---|---|
| Train | 2025-11-01 → 2026-07-12 | 100,003 | 23 |
| Validation | 2026-07-12 → 2026-09-02 | 20,641 | 22 |
| Test | 2026-09-02 → 2026-10-23 | 22,415 | 23 |

Test-set performance (models trained with early stopping on validation):

| Horizon | Model MAE | Persistence MAE | Model RMSE | Persistence RMSE | Skill vs persistence |
|---|---|---|---|---|---|
| 1h | **3.74** µg/m³ | 3.88 µg/m³ | 8.57 | 8.92 | **+3.6%** |
| 3h | **6.05** µg/m³ | 6.92 µg/m³ | 11.44 | 14.35 | **+12.5%** |
| 6h | **7.06** µg/m³ | 8.73 µg/m³ | 12.47 | 16.22 | **+19.2%** |

Quantile 10th/90th intervals (clamped at zero):

| Horizon | 80% coverage | Mean width | Model-crossing rate |
|---|---|---|---|
| 1h | 0.821 | 14.8 µg/m³ | 0.000 |
| 3h | 0.822 | 19.9 µg/m³ | 0.000 |
| 6h | 0.820 | 23.8 µg/m³ | 0.000 |

3h exceedance classifier (`target_3h > 60 µg/m³`, an exceedance indicator, not
a relative “deterioration” label):

- Isotonic calibration on 5-fold out-of-fold predictions from the training
  partition. The chronological validation window was 0.16% positive (monsoon)
  and is not representative of the 9.6% positive test window.
- Test ROC-AUC **0.959**, PR-AUC **0.745**, Brier **0.042**.
- At threshold 0.5: precision **0.758**, recall **0.588**.
- Positive rate: train 18.3%, validation 0.2%, test 9.6%.

Station-level 3h MAE ranges from 3.78 µg/m³ to 13.38 µg/m³ (median 5.47). The
worst station in the test window is Powai (OPENAQ-6956) with only 370 test rows;
low coverage and short test windows make station-level errors less stable. All
per-station results are in `ml/artifacts/model_card.json`.

SHAP (`TreeExplainer`, top mean absolute contributions on a 200-row test sample):
current PM2.5, 24h rolling mean, 3h rolling mean, hour of day, 3h lag, PM10,
NO2 and temperature. SHAP values explain model behaviour; they do not establish
causation.

## Limitations

- One seasonal cycle only. The test window is later than training, so some
  calendar months are unseen during fitting; the model relies on weather and lag
  features for those months.
- Temporal, not spatial, evaluation: the test set contains future rows from the
  same stations used in training. It does not prove skill at an unseen station.
- Weather is reanalysis, not a co-located measurement.
- Missing pollutant inputs are not imputed; LightGBM handles them as NaN, which
  reduces reliability. The inference service also requires 25 consecutive hourly
  PM2.5 observations; a gap falls back to the persistence baseline.
- The classifier is a fixed-threshold exceedance model, not a relative change
  model. Its probabilities are calibrated for the distribution of the training
  extract and should be re-reviewed after a distribution shift.
- The model was trained on pooled stations and does not use a station identifier;
  station-specific biases are only partly captured by the shared features.
- The model has not been reviewed or signed off by an authority.

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
python fetch_real_data.py --source archive --start 2025-11-01 --end 2026-10-27 \
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
pages and S3 daily files are cached under `ml/data/raw/`.

## Deployment checklist

| Item | Status |
|---|---|
| Verified data provenance and licence | ✅ OpenAQ/CPCB records; attribution in sidecar |
| Chronological split documented | ✅ 70/15/15 by global timestamp |
| Baseline comparison | ✅ 3h/6h beat persistence; 1h beats it narrowly |
| Station-level metrics reviewed | ✅ ranges and worst stations recorded |
| Quantile coverage measured | ✅ 0.82 at every horizon |
| Classifier calibration reviewed | ✅ 5-fold out-of-fold isotonic; Brier 0.042 |
| SHAP computed from the artifact | ✅ TreeExplainer |
| Artifact and feature pipeline versioned | ✅ SHA-256 and model version |
| Missing-feature handling | ✅ NaN-native; inference requires 25 consecutive hours |
| Model registered | ✅ `npm run ml:register` (local database) |
| UI shows trained identity/confidence | ⏳ API restart required |
| Human review and sign-off | ⏳ pending |

## Contact / ownership

प्रकृति ML (demonstration). No production model owner has signed off this model.
