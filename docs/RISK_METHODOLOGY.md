# Risk Methodology

The risk engine is category-specific. Air scoring is never applied to water, waste or industrial records. Risk (severity) and confidence (evidence quality) are stored separately.

Output contract:

```ts
interface EnvironmentalRiskAssessment {
  category: string;
  entityId: string;
  riskScore: number | null;
  riskLevel: string;
  confidenceScore: number | null;
  confidenceLevel: string;
  alertState: string;
  method: string;
  supportingEvidence: unknown[];
  missingInputs: string[];
  calculatedAt: string;
  rulesetVersion: string;
}
```

A critical alert imposes a minimum risk score of 75 so a critical condition is never presented with a low severity score.

## Air — `AIR_SCREEN_V1`

Inputs: latest PM2.5, PM10, NO2, SO2, CO, O3; PM2.5 history; station health; latest weather; persistence baseline.

Risk score:

```text
load          = clamp(max(pollutant / NAAQS_24h_threshold) / 1.5, 0, 1)
persistence   = fraction of last 6 hourly PM2.5 ≥ 0.8 × 60
forecastPressure = clamp((forecast3h − current) / max(1, current × 0.2), 0, 1)
risk = 100 × (0.60 × load + 0.25 × persistence + 0.15 × forecastPressure)
```

NAAQS screening thresholds used: PM2.5 60, PM10 100, NO2 80, SO2 80 (µg/m³), CO 2 mg/m³, O3 100 µg/m³. These are 24h/8h standards. Hourly values are compared only as an indicative screen; this is stated in every evidence record and is never an official exceedance.

Alert states:

- `CRITICAL`: three consecutive hourly PM2.5 values ≥ 60 µg/m³ **and** confidence ≥ 50.
- `WATCH`: max pollutant ratio ≥ 0.7.
- `EARLY_WARNING` (predictive pipeline): persistence baseline +3h ≥ 60 µg/m³ and persistence ≥ 0.5.
- `NORMAL` otherwise.
- Overall state: CRITICAL > EARLY_WARNING > WATCH > NORMAL.

Confidence:

```text
completeness = min(1, latestPollutants / 6) × 35
recency      = latest ≤2h ? 25 : ≤6h ? 15 : 5
history      = ≥6 points ? 20 : ≥3 ? 10 : 0
health       = ONLINE 20, DEGRADED 10, UNKNOWN 5, OFFLINE 0
confidence   = sum (0–100) − 10 per SUSPECT latest reading
```

If no recent readings exist, risk is `null` / `UNKNOWN` rather than a fabricated LOW score. SUSPECT readings cannot produce a CRITICAL or predictive warning.

## Water — `WATER_REFERENCE_V1`

Inputs: latest pH, dissolved oxygen, turbidity; verified/unverified reports in 7 days within 2 km.

```text
pH deviation = clamp(max(0, 6.5−pH)/1.5 + max(0, pH−8.5)/1.5, 0, 1)
DO deficit   = clamp(max(0, 5−DO)/5, 0, 1)
reportPressure = clamp((verified×0.5 + unverified×0.15)/2, 0, 1)
risk = 100 × (0.35×pH + 0.35×DO + 0.30×reports)
```

- Reference criteria: CPCB outdoor bathing pH 6.5–8.5 and DO ≥ 5 mg/L. Turbidity is informational only.
- `WATCH` if any pH/DO excursion or a verified report.
- `CRITICAL` only with severe pH (< 6.0 or > 9.0) **and** DO < 4 mg/L **and** confidence ≥ 50. A mild pH/DO excursion is not critical.
- Confidence: parameters present (40), recency (30/15/5), verified report evidence (30/10/0).
- If no parameters and no reports exist, risk is `null` / `UNKNOWN`.

## Waste — `WASTE_REPORT_EVIDENCE_V1`

Inputs: reports in the last 7 days within 2 km of a locality reference point; verification state; evidence count; open critical incidents.

```text
risk = min(100, verified×18 + unverified×5 + min(15, evidenceReports×3)
          + (repeatHotspot ? 15 : 0) + criticalIncidents×20)
```

- `CRITICAL` if at least 2 verified reports (repeat hotspot) or a critical incident.
- One unverified complaint never produces a critical state.
- Confidence: 20 + verified×20 + evidence×8 + 10 if any reports (cap 100).
- If no reports or incidents exist, risk is `null` / `UNKNOWN`.

## Industrial — `INDUSTRIAL_RELATIVE_V1`

Inputs: available stack readings, own recent baseline, verified reports in 7 days, open incidents.

```text
relativeChange = (latest − baseline) / baseline
anomalyPressure = clamp(relativeChange / 0.5, 0, 1) (max across parameters)
reportPressure = clamp((verified×0.5 + openIncidents×0.3)/2, 0, 1)
risk = 100 × (0.40×anomalyPressure + 0.40×reportPressure + 0.20×min(1, openIncidents/2))
```

- **No legal threshold is applied.** Facility-specific emission/effluent standards were not verified for the demo records.
- A nearby air-quality station cannot by itself establish that a specific facility caused pollution.
- `CRITICAL` requires ≥2 verified reports and anomaly pressure ≥0.5.
- `WATCH` if anomaly pressure ≥0.4 or any verified report.
- If no readings, reports or incidents exist, risk is `null` / `UNKNOWN`.

## Alert lifecycle

```text
NORMAL → WATCH → EARLY_WARNING → CRITICAL → RECOVERY
```

- Observed and predictive triggers are separate. Observed alerts use validated/screening observations; predictive alerts use the labelled baseline.
- Duplicate prevention: an open alert for the same entity/category/trigger within 6 hours is updated rather than duplicated; a same-level alert within 2 hours is suppressed.
- Recovery requires two consecutive NORMAL risk assessments and is written to history.
- Every transition is appended to `alert_history` with a reason and optional actor.
- Closing an alert requires an authority administrator and a reason.

## Confidence vs severity

A low-confidence critical-looking condition keeps its uncertainty visible. Missing inputs are recorded and displayed. A missing reading is never treated as normal.

## Known limits

- Air thresholds are 24h/8h standards compared with hourly demo values for screening only.
- Water uses outdoor-bathing reference criteria, not drinking-water or effluent standards.
- Waste is report-evidence based; no waste monitoring stations exist.
- Industrial risk is relative and report-led; no legal emission threshold is encoded.
- The demo network is sparse; no interpolated surface or locality-wide risk polygon is produced.
