# Limitations

This deployment is a working demonstration, not an operational regulatory system.

## Data

- **No direct live CPCB or MPCB API feed.** CPCB remains `NOT_CONFIGURED` until a data.gov.in API key is added. OpenAQ is connected and supplies 12 Mumbai stations in total (MPCB/IITM operators); 7 are current and 5 are stale. Stale stations are excluded from current counts and the current map after 6 hours. Those records are labelled as OpenAQ and preserve upstream timestamps. Demo station records remain synthetic and labelled `SIMULATION DATA`.
- **Training data is an OpenAQ archive, not a direct CPCB feed.** LightGBM 1/3/6h, quantile and deterioration models are trained locally on 23 MPCB/BMC/IITM stations (2025-11-01 to 2026-10-23, 143,059 feature rows). The anomaly detector remains `NOT_TRAINED`.
- **Model metrics are extract-specific.** They apply only to the registered CSV SHA-256 and are not a guarantee for other periods, stations or live conditions.
- **Sparse demo network.** 10 air stations across a large city cannot establish area-wide concentration.
- **No interpolated pollution surface or risk polygon.** A point measurement is not an area measurement.
- **No verified ward mapping.** Localities are OSM/Nominatim reference points, not authoritative ward centroids.
- **Weather is live but context only.** It does not establish causation.
- **CAMS is modelled, not measured.** It is never a station reading or official AQI.
- **Demo water/industrial stations are synthetic.** Water risk uses reference criteria, not a verified ambient-water monitoring programme.
- **No waste monitoring stations.** Waste risk is report-evidence based.

## Predictions and AI

- Forecasts use the trained LightGBM model only when the ML service is running and the station has 25 consecutive hourly PM2.5 values in the model's OpenAQ station set. Otherwise the labelled `PERSISTENCE_BASELINE_V1` is shown; its empirical band is not a calibrated prediction interval.
- The deterioration probability comes from the trained classifier and is only shown for those same stations. Demo stations and stations outside the training set never get a model probability.
- SHAP values are computed by the served model. The baseline fallback shows no SHAP.
- River AI is configured in this workspace through the gitignored `.env.local`; without `RIVER_API_KEY` the AI Analyst returns a rule-based evidence digest instead. The committed templates never contain the key.
- The River AI adapter uses an OpenAI-compatible chat-completions interface; this is verified against a live `zai-org/GLM-5.3-Flash` key in this workspace. Provider behaviour may differ for other deployments.
- Vision AI is configured in this workspace through the gitignored `.env.local` (open-weight models). Without credentials it remains `NOT_CONFIGURED`. A photograph still cannot establish chemical composition, toxicity, concentration or responsibility.
- The AI can still make mistakes even when grounded; its output is decision support, not a determination.

## Regulatory and compliance

- Standards are seeded as `REFERENCE_ONLY`; applicability and current amendments must be confirmed against official documents.
- No official violation is declared automatically.
- Hourly values are never treated as valid 24h averages.
- Stack readings are not compared with effluent standards.
- Official determinations are only recorded by an authorised administrator and are auditable.
- The app is not legal advice.

## Integrations

- No email provider credentials were supplied. The Nodemailer SMTP path was verified against a local sink, but real delivery requires `SMTP_HOST`, `SMTP_USER` and `SMTP_PASSWORD`. Until then notifications are `SIMULATED` records. `SENT` is not `DELIVERED`; delivery requires a provider webhook.
- No S3-compatible object storage adapter; evidence uses local private storage.
- No malware scanning (`NOT_CONFIGURED`).
- OpenAQ is configured via environment; data.gov.in has no credentials, so its adapter remains disabled.
- No external map API key; OpenFreeMap public instance is used with attribution. Production should self-host or use a provider with an SLA.
- 3D building heights are OpenMapTiles render heights, not surveyed building data.

## Security / operations

- No MFA, CSRF token, field-level encryption, formal retention/deletion worker, RLS or WAF.
- SameSite=Lax cookie plus Origin checking are the CSRF mitigations.
- Local evidence storage security depends on host permissions.
- No penetration test, load test, accessibility audit or disaster recovery plan.
- Background jobs are in-process intervals, not a durable queue.
- The ML service runs locally as a single process with no managed monitoring, drift detection or automatic retraining.
- No SMS/push notifications.
- No mobile native app.

## Geographic scope

- Primary map is Greater Mumbai (Mumbai City + Mumbai Suburban districts). Nearby Thane/Navi Mumbai areas may be visible faintly outside the mask but contain no primary monitoring data and are not part of the operating scope.
- Boundary derived from OSM via Nominatim; it is not a legal cadastral boundary.
- No expansion to Thane, Navi Mumbai or Pune in the primary monitoring map.

## Demonstration integrity

- All synthetic records are labelled. Do not remove labels.
- Simulation is isolated; reset never deletes real observations.
- Demo mode restricts email to a configured demonstration recipient.
- Do not use this deployment for enforcement, emergency response, health advice or legal decisions.
