# Simulation & Replay Guide

## Purpose

The simulation engine demonstrates the full product workflow without altering real environmental observations. It is deterministic: the same scenario + station + seed produces the same step values.

## Isolation guarantees

Every simulation record carries:

```ts
isSimulated: true
simulationSessionId: string
```

Implementation details:

- `simulation_sessions` and `simulation_events` store the scenario and revealed steps.
- Risk assessments are persisted under entity type `simulation_station` with the session UUID, not the real station entity.
- Simulated alerts use the session UUID as entity id, so they do not collide with real station alerts.
- Simulated alerts, notifications and incidents are excluded from `/alerts`, `/incidents` and `/notifications` operational lists.
- Reset rewinds to step 0 and rebuilds derived simulated alerts for that position. It never deletes real observations or simulated incidents.
- Email previews are previews. Replay-generated notifications are `SIMULATED`; no real mailing list is used.

## Scenarios

| ID | Category | Steps | Demonstrates |
|---|---|---|---|
| `gradual_pm25` | air | 24 | Progressive PM2.5 rise, baseline, early warning, critical screening, recovery |
| `sudden_spike` | air | 14 | Abrupt spike, anomaly, critical observed screening, email preview, incident |
| `persistent_deterioration` | air | 20 | Persistence, nearby context, risk progression, investigation |
| `sensor_malfunction` | air | 12 | Implausible values, SUSPECT quality, confidence reduction, alert suppression, maintenance recommendation |
| `neighbouring_station_changes` | air | 16 | Divergent neighbour, spatial uncertainty, no fabricated zone |
| `construction_dust` | air | 16 | PM10-led dust episode, control inspection, no named source |
| `festival_firecracker` | air | 14 | PM2.5 + SO2 burst, sensitive-group advice, neutral enforcement language |
| `water_discharge` | water | 14 | pH/DO deterioration, reference criteria, report evidence, investigation |
| `monsoon_drain_overflow` | water | 12 | Overflow, turbidity/DO deterioration, contact advice, outfall inspection |
| `waste_report` | waste | 10 | Unverified → verified reports, repeat hotspot, risk escalation |
| `industrial_emission` | industrial | 16 | Relative stack anomaly, no legal threshold, investigation |

Air pollution remains the deepest predictive simulation. Water, waste and industrial use their own risk methods.

## Recommendations and reasons

Every revealed step carries a set of audience-specific recommendations
(`PUBLIC`, `AUTHORITY`, `FIELD`) with a priority, a concrete action, and a
`reason` that explains the rule and the readings behind it. Evidence chips name
the exact value, alert state and confidence used. The session page lets the
viewer filter by audience and inspect the recommendation at any revealed step.

Recommendations are guidance for the replay, not an official determination.
Critical air advice is paired with monitor-verification and source-inspection
steps; sensor-fault steps explicitly recommend maintenance and suppress public
alarm; waste advice separates reports from measured violations; and industrial
advice never applies a legal emission threshold.

## Legacy sessions and backfill

Sessions created before the recommendation layer are enriched in place without
changing their readings, risk scores, alerts or timestamps. The server applies a
targeted, idempotent simulation-schema migration at startup and backfills old
sessions asynchronously; opening an old session also triggers an on-demand
backfill. A bulk offline run is available with `npm run simulations:backfill`.
Each session stores `recommendations_version` so a completed backfill is not
repeated.

## Meteorology and outlook

Each step also records a `conditions` block (temperature, humidity, wind,
precipitation, dispersion class and its source) and, for air scenarios, a
3-hour `outlook` from the labelled persistence baseline. Conditions use the
latest station weather observation when one exists and otherwise a deterministic
replay atmosphere. The outlook is never presented as trained ML output.

## Scenario phases

Scenario metadata includes `phases` (baseline, build-up, peak, recovery or
fault) and a synthetic `preview` series used only to draw the scenario shape on
the selection page. Wind collapses during spike and build-up phases, which makes
the dispersion context visible rather than decorative.

## Controls

- Scenario selection and category filter
- Station/locality context
- Deterministic seed
- Play / Pause, speed and keyboard controls
- Step
- Reset
- Email preview (public and authority)
- Create simulated incident
- Step explorer and phase-bar scrubber (move the replay position; simulated alerts are rebuilt for the selected step)
- Event history and current risk/confidence

## API

```text
GET  /api/v1/simulations/scenarios
GET  /api/v1/simulations
POST /api/v1/simulations                  { scenario, stationId?, seed? }
GET  /api/v1/simulations/:id
POST /api/v1/simulations/:id/play
POST /api/v1/simulations/:id/pause
POST /api/v1/simulations/:id/step
POST /api/v1/simulations/:id/seek                  { step }
POST /api/v1/simulations/:id/reset
POST /api/v1/simulations/:id/email-preview
POST /api/v1/simulations/:id/incident
```

Creation/control requires an authority role. Viewing a session is available to authenticated users who own it (authority sees all).

## Determinism

`mulberry32(seed)` drives noise. All steps are generated once and persisted, so
replaying a session is exact. A new session snapshots the latest station weather
observation (when one exists) before generation, so creating the same
scenario + station + seed later can shift the meteorology and values slightly.
Changing the seed changes the noise but not the scenario shape. When no weather
observation exists, a deterministic synthetic replay atmosphere is used.

## Sensor malfunction

The scenario produces values such as 999, 0 and −5 with `SUSPECT` quality. The event sets `suppressAlert=true`; the step endpoint does not create an alert. The UI shows “Alert suppressed due to data quality” and the risk engine records missing inputs. This must never be read as environmental deterioration.

## Email previews

If no simulated alert exists yet, the preview endpoint returns `409 NO_SIMULATED_ALERT`. Advance the replay until an alert transition. Previews render the real notification templates but do not send email.

## Incident creation

The endpoint uses the real incident service to create a record with `is_simulated=true` and `simulation_session_id`. It is accessible from the simulation page but excluded from operational incident lists. No official determination is made.
