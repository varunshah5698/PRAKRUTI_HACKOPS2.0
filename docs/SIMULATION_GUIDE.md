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
- Reset changes `current_step` and status only. It never deletes real observations.
- Email previews are previews. Replay-generated notifications are `SIMULATED`; no real mailing list is used.

## Scenarios

| ID | Category | Steps | Demonstrates |
|---|---|---|---|
| `gradual_pm25` | air | 24 | Progressive PM2.5 rise, baseline, early warning, critical screening, recovery |
| `sudden_spike` | air | 14 | Abrupt spike, anomaly, critical observed screening, email preview, incident |
| `persistent_deterioration` | air | 20 | Persistence, nearby context, risk progression, investigation |
| `sensor_malfunction` | air | 12 | Implausible values, SUSPECT quality, confidence reduction, alert suppression, maintenance recommendation |
| `neighbouring_station_changes` | air | 16 | Divergent neighbour, spatial uncertainty, no fabricated zone |
| `water_discharge` | water | 14 | pH/DO deterioration, reference criteria, report evidence, investigation |
| `waste_report` | waste | 10 | Unverified → verified reports, repeat hotspot, risk escalation |
| `industrial_emission` | industrial | 16 | Relative stack anomaly, no legal threshold, investigation |

Air pollution remains the deepest predictive simulation. Water, waste and industrial use their own risk methods.

## Controls

- Scenario selection
- Station/locality context
- Deterministic seed
- Play / Pause
- Step
- Reset
- Email preview (public and authority)
- Create simulated incident
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
POST /api/v1/simulations/:id/reset
POST /api/v1/simulations/:id/email-preview
POST /api/v1/simulations/:id/incident
```

Creation/control requires an authority role. Viewing a session is available to authenticated users who own it (authority sees all).

## Determinism

`mulberry32(seed)` drives noise. The step base time is truncated to the minute. The same seed and scenario produce the same values. Changing the seed changes the noise but not the scenario shape.

## Sensor malfunction

The scenario produces values such as 999, 0 and −5 with `SUSPECT` quality. The event sets `suppressAlert=true`; the step endpoint does not create an alert. The UI shows “Alert suppressed due to data quality” and the risk engine records missing inputs. This must never be read as environmental deterioration.

## Email previews

If no simulated alert exists yet, the preview endpoint returns `409 NO_SIMULATED_ALERT`. Advance the replay until an alert transition. Previews render the real notification templates but do not send email.

## Incident creation

The endpoint uses the real incident service to create a record with `is_simulated=true` and `simulation_session_id`. It is accessible from the simulation page but excluded from operational incident lists. No official determination is made.
