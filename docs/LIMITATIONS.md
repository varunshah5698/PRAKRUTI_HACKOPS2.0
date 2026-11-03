# Limitations

This deployment is a working demonstration, not an operational regulatory system.

## Data

- **No live CPCB or MPCB feed.** CPCB/MPCB are `NOT_CONFIGURED`. Demo station records are synthetic and labelled `SIMULATION DATA`. They are not CPCB readings.
- **No real Mumbai historical training extract.** LightGBM/quantile/deterioration/anomaly models are `NOT_TRAINED`.
- **No trained model metrics.** Do not infer accuracy from the persistence baseline.
- **Sparse demo network.** 10 air stations across a large city cannot establish area-wide concentration.
- **No interpolated pollution surface or risk polygon.** A point measurement is not an area measurement.
- **No verified ward mapping.** Localities are OSM/Nominatim reference points, not authoritative ward centroids.
- **Weather is live but context only.** It does not establish causation.
- **CAMS is modelled, not measured.** It is never a station reading or official AQI.
- **Demo water/industrial stations are synthetic.** Water risk uses reference criteria, not a verified ambient-water monitoring programme.
- **No waste monitoring stations.** Waste risk is report-evidence based.

## Predictions and AI

- Forecasts shown are `PERSISTENCE_BASELINE_V1`; the empirical band is not a calibrated prediction interval and has no validated skill.
- No deterioration probability is shown because no calibrated classifier exists.
- No SHAP values are shown because no trained model exists.
- River AI is configured in this workspace through the gitignored `.env.local`; without `RIVER_API_KEY` the AI Analyst returns a rule-based evidence digest instead. The committed templates never contain the key.
- The River AI adapter assumes an OpenAI-compatible chat-completions interface; this was not verified against a live key.
- No vision model is configured. Image assessment is `NOT_CONFIGURED`. A photograph cannot establish chemical composition, toxicity, concentration or responsibility.
- The AI can still make mistakes even when grounded; its output is decision support, not a determination.

## Regulatory and compliance

- Standards are seeded as `REFERENCE_ONLY`; applicability and current amendments must be confirmed against official documents.
- No official violation is declared automatically.
- Hourly values are never treated as valid 24h averages.
- Stack readings are not compared with effluent standards.
- Official determinations are only recorded by an authorised administrator and are auditable.
- The app is not legal advice.

## Integrations

- No email provider configured; notifications are `SIMULATED` records. `SENT` is not `DELIVERED`; delivery requires a provider webhook.
- No S3-compatible object storage adapter; evidence uses local private storage.
- No malware scanning (`NOT_CONFIGURED`).
- No OpenAQ/data.gov.in credentials; adapters exist but are disabled.
- No external map API key; OpenFreeMap public instance is used with attribution. Production should self-host or use a provider with an SLA.
- 3D building heights are OpenMapTiles render heights, not surveyed building data.

## Security / operations

- No MFA, CSRF token, field-level encryption, formal retention/deletion worker, RLS or WAF.
- SameSite=Lax cookie plus Origin checking are the CSRF mitigations.
- Local evidence storage security depends on host permissions.
- No penetration test, load test, accessibility audit or disaster recovery plan.
- Background jobs are in-process intervals, not a durable queue.
- No trained model server or model monitoring.
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
