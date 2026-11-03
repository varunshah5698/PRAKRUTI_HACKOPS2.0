# Data Schema

Database: PostgreSQL 18 + PostGIS 3.7. Schema source: `server/src/db/schema.sql`. Applied by `server/src/db/setup.ts`.

## Conventions

- UUID primary keys via `gen_random_uuid()` (pgcrypto).
- `timestamptz` for all event and ingestion times; display in Asia/Kolkata.
- `geography(Point,4326)` for point locations; GiST indexes.
- Text `CHECK` constraints instead of many enum types; `user_role` is a PostgreSQL enum.
- Public references use sequences: `EP-R-YYYY-nnnn`, `EP-A-YYYY-nnnn`, `EP-I-YYYY-nnnn`.
- Raw source payloads are retained in `raw jsonb` where available.
- Every environmental observation stores source, station, pollutant, value, unit, observation time, retrieval time, quality state, simulation flag and source record id.
- Simulation records carry `is_simulated=true`; simulation-session records additionally carry `simulation_session_id`.

## Core tables

| Table | Purpose | Key relationships |
|---|---|---|
| `data_sources` | Source registry and runtime health | Referenced by observations, weather, alerts |
| `localities` | 26 Mumbai locality reference points | Used by stations, reports, incidents, preferences |
| `wards` | Reserved; no verified ward geometries loaded | — |
| `users` | Accounts, role, status, department, jurisdiction | `user_preferences`, assignments, audit |
| `user_preferences` | Categories, email consent, locality, radius | users |
| `password_resets` | Hashed reset tokens, expiry | users |
| `monitoring_stations` | Air/water/industrial stations with PostGIS location | localities, observations, alerts |
| `station_health` | Health snapshots | stations |
| `pollutant_types` | Pollutant metadata and units | — |
| `environmental_observations` | Air, water and industrial time series | stations, localities, sources |
| `weather_observations` | Current and forecast weather | stations, localities |
| `environmental_reports` | Citizen/officer reports, verification state | users, localities, evidence, AI assessments, incidents |
| `report_evidence` | Private file metadata, hash, EXIF, GPS consistency | reports |
| `ai_assessments` | Vision/report assessment records (often NOT_CONFIGURED) | reports, stations |
| `model_registry` | Versioned model status and metrics | predictions, alerts |
| `ml_predictions` | Forecast records when a trained model exists | stations, model_registry |
| `risk_assessments` | Category-specific risk + confidence + alert state | risk_factor_breakdowns |
| `risk_factor_breakdowns` | Transparent factor contributions | risk_assessments |
| `environmental_alerts` | Alert record with trigger type and state | stations, localities, model_registry, incidents |
| `alert_history` | Append-only state transitions | alerts, users |
| `environmental_incidents` | Investigation record and official determination | alerts, reports, localities, users |
| `incident_assignments` | Assignment history | incidents, users |
| `investigation_notes` | Evidence-based notes | incidents, users |
| `corrective_actions` | Recommended/assigned/completed/verified actions | incidents, users |
| `regulatory_documents` | Verified reference documents | standards |
| `regulatory_standards` | Section-level thresholds, units, averaging, applicability | documents |
| `notifications` | Generated email records and delivery state | users, alerts, incidents |
| `notification_events` | Creation/delivery/acknowledgement events | notifications |
| `ingestion_jobs` | Ingestion attempts, counts and errors | data_sources |
| `simulation_sessions` | Deterministic replay sessions | stations, localities, users |
| `simulation_events` | Revealed step payloads | sessions |
| `audit_logs` | Append-only audit ledger | users |
| `app_config` | Seed metadata / configuration | — |

## Indexes

- `localities_location_gix`, `stations_location_gix`, `reports_location_gix`, `incidents_location_gix`, `obs_location_gix` — GiST.
- `obs_station_time_idx` on `(station_id, observed_at DESC)`.
- `obs_category_time_idx` on `(category, observed_at DESC)`.
- `obs_pollutant_idx` on `(pollutant_code, observed_at DESC)`.
- Unique `(station_id, pollutant_code, observed_at, source_id)` and a partial unique index on `(source_id, source_record_id)` to prevent duplicate ingestion.
- `alerts_state_idx`, `alerts_category_idx`, `incidents_status_idx`, `audit_entity_idx`.

## Constraints and integrity

- Foreign keys with `ON DELETE CASCADE` or `SET NULL` as appropriate.
- `environmental_observations.category` in `air|water|waste|industrial`; quality in `VALID|SUSPECT|INVALID|MODELLED|STALE`.
- `environmental_reports.status` and `verification_state` constrained.
- `environmental_incidents.status` constrained to the documented lifecycle.
- `environmental_alerts.trigger_type` constrained to `PREDICTIVE|OBSERVED|REPORT_EVIDENCE`.
- `regulatory_documents.title` unique; standards unique per document/section/parameter.

## Simulation isolation

- `environmental_reports`, `risk_assessments`, `environmental_alerts`, `environmental_incidents`, `notifications`, `simulation_sessions` and `investigation_notes`/`corrective_actions` carry simulation fields where relevant.
- Simulation risk assessments are persisted under entity type `simulation_station` with the session UUID, not the real station entity.
- Operational alert/incident/notification lists filter `simulation_session_id IS NULL`.
- Reset updates `current_step`/status only. It never deletes real observations.

## Not implemented

- No row-level security (RLS); authorisation is enforced in the API.
- No partitioning of the observation table; production volumes would need time partitioning.
- No verified ward polygons or ward association.
- No object-storage table; evidence metadata points to a private local key.
