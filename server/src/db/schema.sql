-- प्रकृति schema. PostgreSQL 16 + PostGIS 3.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SEQUENCE IF NOT EXISTS alert_ref_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS report_ref_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS incident_ref_seq START 1001;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('PUBLIC','FIELD_OFFICER','ENVIRONMENTAL_ANALYST','AUTHORITY_ADMIN','SYSTEM_ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS data_sources (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('CONNECTED','NOT_CONFIGURED','FAILED','STALE')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  attribution text,
  documentation_url text,
  record_count integer DEFAULT 0,
  error_message text,
  notes text,
  is_simulated boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS localities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  location geography(Point,4326) NOT NULL,
  osm_type text,
  osm_id bigint,
  geocode_source text NOT NULL DEFAULT 'OpenStreetMap via Nominatim',
  coordinate_kind text NOT NULL DEFAULT 'reference_point',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS localities_location_gix ON localities USING gist (location);

CREATE TABLE IF NOT EXISTS wards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE,
  verified boolean NOT NULL DEFAULT false,
  geometry geometry(MultiPolygon,4326),
  notes text
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role user_role NOT NULL DEFAULT 'PUBLIC',
  account_status text NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE','PENDING_APPROVAL','SUSPENDED')),
  department text,
  designation text,
  jurisdiction text,
  locality_id uuid REFERENCES localities(id),
  requested_role text,
  email_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  alert_categories text[] NOT NULL DEFAULT ARRAY['air','water','waste','industrial'],
  notify_email boolean NOT NULL DEFAULT false,
  locality_id uuid REFERENCES localities(id),
  radius_km numeric(5,1),
  consent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monitoring_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  provider text NOT NULL,
  station_type text NOT NULL DEFAULT 'AIR_CAAQMS',
  locality_id uuid REFERENCES localities(id),
  location geography(Point,4326) NOT NULL,
  operator text,
  health_status text NOT NULL DEFAULT 'UNKNOWN' CHECK (health_status IN ('ONLINE','DEGRADED','OFFLINE','UNKNOWN')),
  last_seen_at timestamptz,
  is_simulated boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stations_location_gix ON monitoring_stations USING gist (location);
CREATE INDEX IF NOT EXISTS stations_locality_idx ON monitoring_stations (locality_id);

CREATE TABLE IF NOT EXISTS station_health (
  id bigserial PRIMARY KEY,
  station_id uuid NOT NULL REFERENCES monitoring_stations(id) ON DELETE CASCADE,
  status text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  latency_ms integer,
  message text,
  data_quality_score numeric(5,2)
);
CREATE INDEX IF NOT EXISTS station_health_station_idx ON station_health (station_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS pollutant_types (
  code text PRIMARY KEY,
  name text NOT NULL,
  unit text NOT NULL,
  category text NOT NULL DEFAULT 'air',
  averaging_period text,
  description text
);

CREATE TABLE IF NOT EXISTS environmental_observations (
  id bigserial PRIMARY KEY,
  station_id uuid REFERENCES monitoring_stations(id) ON DELETE CASCADE,
  locality_id uuid REFERENCES localities(id),
  category text NOT NULL CHECK (category IN ('air','water','waste','industrial')),
  pollutant_code text NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL,
  observed_at timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  quality_state text NOT NULL DEFAULT 'VALID' CHECK (quality_state IN ('VALID','SUSPECT','INVALID','MODELLED','STALE')),
  is_simulated boolean NOT NULL DEFAULT false,
  source_id text NOT NULL REFERENCES data_sources(id),
  source_record_id text,
  location geography(Point,4326),
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (station_id, pollutant_code, observed_at, source_id)
);
CREATE INDEX IF NOT EXISTS obs_station_time_idx ON environmental_observations (station_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS obs_category_time_idx ON environmental_observations (category, observed_at DESC);
CREATE INDEX IF NOT EXISTS obs_pollutant_idx ON environmental_observations (pollutant_code, observed_at DESC);
CREATE INDEX IF NOT EXISTS obs_location_gix ON environmental_observations USING gist (location);
CREATE UNIQUE INDEX IF NOT EXISTS obs_source_record_uidx ON environmental_observations (source_id, source_record_id)
  WHERE source_record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS weather_observations (
  id bigserial PRIMARY KEY,
  station_id uuid REFERENCES monitoring_stations(id) ON DELETE CASCADE,
  locality_id uuid REFERENCES localities(id),
  location geography(Point,4326) NOT NULL,
  observed_at timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('OBSERVATION','FORECAST')),
  temperature_c numeric,
  relative_humidity numeric,
  wind_speed_kmh numeric,
  wind_direction_deg numeric,
  precipitation_mm numeric,
  pressure_hpa numeric,
  source_id text NOT NULL REFERENCES data_sources(id),
  is_simulated boolean NOT NULL DEFAULT false,
  raw jsonb,
  UNIQUE (station_id, observed_at, kind, source_id)
);
CREATE INDEX IF NOT EXISTS weather_station_time_idx ON weather_observations (station_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS environmental_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_ref text NOT NULL UNIQUE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN ('air','water','waste','industrial')),
  incident_type text NOT NULL,
  description text NOT NULL,
  location geography(Point,4326) NOT NULL,
  locality_id uuid REFERENCES localities(id),
  occurred_at timestamptz NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','AI_ASSESSED','AWAITING_VERIFICATION','VERIFIED','UNVERIFIED','LINKED_TO_INVESTIGATION')),
  verification_state text NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_state IN ('UNVERIFIED','VERIFIED','REJECTED')),
  contact_name text,
  contact_email text,
  contact_phone text,
  consent boolean NOT NULL DEFAULT false,
  ai_vision_status text NOT NULL DEFAULT 'NOT_CONFIGURED',
  is_simulated boolean NOT NULL DEFAULT false,
  simulation_session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_location_gix ON environmental_reports USING gist (location);
CREATE INDEX IF NOT EXISTS reports_category_time_idx ON environmental_reports (category, submitted_at DESC);
CREATE INDEX IF NOT EXISTS reports_status_idx ON environmental_reports (status);

CREATE TABLE IF NOT EXISTS report_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES environmental_reports(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  original_name text,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  exif jsonb,
  gps_consistency text,
  malware_scan_status text NOT NULL DEFAULT 'NOT_CONFIGURED',
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  is_simulated boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS ai_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES environmental_reports(id) ON DELETE CASCADE,
  station_id uuid REFERENCES monitoring_stations(id) ON DELETE SET NULL,
  assessment_type text NOT NULL,
  provider text NOT NULL,
  model text,
  status text NOT NULL CHECK (status IN ('COMPLETED','NOT_CONFIGURED','FAILED')),
  output jsonb NOT NULL,
  is_simulated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  version text NOT NULL,
  category text NOT NULL DEFAULT 'air',
  target text NOT NULL,
  horizon_hours integer,
  model_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('NOT_TRAINED','TRAINED','FAILED','DEPRECATED','BASELINE')),
  metrics jsonb,
  trained_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS ml_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES monitoring_stations(id) ON DELETE CASCADE,
  model_id uuid REFERENCES model_registry(id),
  pollutant_code text NOT NULL,
  horizon_hours integer NOT NULL,
  predicted_value numeric NOT NULL,
  lower_bound numeric,
  upper_bound numeric,
  target_time timestamptz NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  method text NOT NULL,
  confidence text NOT NULL DEFAULT 'NOT_CALIBRATED',
  features jsonb,
  is_simulated boolean NOT NULL DEFAULT false,
  simulation_session_id uuid
);
CREATE INDEX IF NOT EXISTS predictions_station_time_idx ON ml_predictions (station_id, target_time);

CREATE TABLE IF NOT EXISTS risk_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('air','water','waste','industrial')),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  risk_score numeric(5,2),
  risk_level text NOT NULL,
  confidence_score numeric(5,2),
  confidence_level text NOT NULL,
  alert_state text NOT NULL CHECK (alert_state IN ('NORMAL','WATCH','EARLY_WARNING','CRITICAL','RECOVERY')),
  method text NOT NULL,
  supporting_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_inputs text[] NOT NULL DEFAULT '{}',
  calculated_at timestamptz NOT NULL DEFAULT now(),
  ruleset_version text NOT NULL,
  is_simulated boolean NOT NULL DEFAULT false,
  simulation_session_id uuid
);
CREATE INDEX IF NOT EXISTS risk_entity_idx ON risk_assessments (entity_type, entity_id, calculated_at DESC);

CREATE TABLE IF NOT EXISTS risk_factor_breakdowns (
  id bigserial PRIMARY KEY,
  assessment_id uuid NOT NULL REFERENCES risk_assessments(id) ON DELETE CASCADE,
  factor text NOT NULL,
  weight numeric,
  contribution numeric,
  detail text
);

CREATE TABLE IF NOT EXISTS environmental_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_ref text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN ('air','water','waste','industrial')),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  station_id uuid REFERENCES monitoring_stations(id) ON DELETE SET NULL,
  locality_id uuid REFERENCES localities(id),
  level text NOT NULL CHECK (level IN ('WATCH','EARLY_WARNING','CRITICAL','RECOVERY')),
  state text NOT NULL CHECK (state IN ('WATCH','EARLY_WARNING','CRITICAL','RECOVERY','CLOSED')),
  trigger_type text NOT NULL CHECK (trigger_type IN ('PREDICTIVE','OBSERVED','REPORT_EVIDENCE')),
  title text NOT NULL,
  summary text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_id text REFERENCES data_sources(id),
  model_id uuid REFERENCES model_registry(id),
  forecast_horizon_hours integer,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_simulated boolean NOT NULL DEFAULT false,
  simulation_session_id uuid
);
CREATE INDEX IF NOT EXISTS alerts_state_idx ON environmental_alerts (state, triggered_at DESC);
CREATE INDEX IF NOT EXISTS alerts_category_idx ON environmental_alerts (category, triggered_at DESC);

CREATE TABLE IF NOT EXISTS alert_history (
  id bigserial PRIMARY KEY,
  alert_id uuid NOT NULL REFERENCES environmental_alerts(id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL,
  reason text NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS environmental_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_ref text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN ('air','water','waste','industrial')),
  title text NOT NULL,
  description text,
  locality_id uuid REFERENCES localities(id),
  location geography(Point,4326),
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','UNDER_REVIEW','ASSIGNED','INVESTIGATION','CORRECTIVE_ACTION','MONITORING','RESOLVED','CLOSED')),
  risk_level text NOT NULL DEFAULT 'MODERATE',
  detected_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  source_alert_id uuid REFERENCES environmental_alerts(id) ON DELETE SET NULL,
  source_report_id uuid REFERENCES environmental_reports(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  official_determination text,
  official_determination_by uuid REFERENCES users(id) ON DELETE SET NULL,
  official_determination_at timestamptz,
  is_simulated boolean NOT NULL DEFAULT false,
  simulation_session_id uuid,
  closed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incidents_status_idx ON environmental_incidents (status, detected_at DESC);
CREATE INDEX IF NOT EXISTS incidents_location_gix ON environmental_incidents USING gist (location);

CREATE TABLE IF NOT EXISTS incident_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES environmental_incidents(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL REFERENCES users(id),
  assigned_by uuid REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  note text
);

CREATE TABLE IF NOT EXISTS investigation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES environmental_incidents(id) ON DELETE CASCADE,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_simulated boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS corrective_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES environmental_incidents(id) ON DELETE CASCADE,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'RECOMMENDED' CHECK (status IN ('RECOMMENDED','ASSIGNED','IN_PROGRESS','COMPLETED','VERIFIED','CANCELLED')),
  due_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  evidence_note text,
  is_simulated boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS regulatory_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL UNIQUE,
  short_title text NOT NULL,
  authority text NOT NULL,
  published_at date,
  effective_from date,
  effective_to date,
  category text NOT NULL,
  url text,
  licence text,
  verification_status text NOT NULL DEFAULT 'REFERENCE_ONLY',
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS regulatory_standards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES regulatory_documents(id) ON DELETE CASCADE,
  category text NOT NULL,
  parameter text NOT NULL,
  parameter_code text,
  operator text NOT NULL DEFAULT '<=',
  threshold_value numeric,
  threshold_max numeric,
  unit text NOT NULL,
  averaging_period text NOT NULL,
  applicability text NOT NULL,
  section_ref text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, section_ref, parameter)
);
CREATE INDEX IF NOT EXISTS standards_param_idx ON regulatory_standards (category, parameter_code);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  alert_id uuid REFERENCES environmental_alerts(id) ON DELETE SET NULL,
  incident_id uuid REFERENCES environmental_incidents(id) ON DELETE SET NULL,
  audience text NOT NULL CHECK (audience IN ('PUBLIC','AUTHORITY')),
  channel text NOT NULL DEFAULT 'EMAIL',
  template text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  status text NOT NULL CHECK (status IN ('SIMULATED','QUEUED','SENT','DELIVERED','FAILED','ACKNOWLEDGED')),
  provider_message_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  error text,
  is_simulated boolean NOT NULL DEFAULT false,
  simulation_session_id uuid,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_events (
  id bigserial PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  event text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES data_sources(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('RUNNING','SUCCESS','FAILED','SKIPPED')),
  records integer DEFAULT 0,
  error text
);

CREATE TABLE IF NOT EXISTS simulation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario text NOT NULL,
  category text NOT NULL,
  scenario_version integer NOT NULL DEFAULT 1,
  station_id uuid REFERENCES monitoring_stations(id),
  locality_id uuid REFERENCES localities(id),
  seed integer NOT NULL,
  weather_snapshot jsonb,
  status text NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','PLAYING','PAUSED','COMPLETED','RESET')),
  current_step integer NOT NULL DEFAULT 0,
  total_steps integer NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_simulated boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS simulation_events (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES simulation_sessions(id) ON DELETE CASCADE,
  step integer NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, step, event_type)
);

ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS scenario_version integer NOT NULL DEFAULT 1;
ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS weather_snapshot jsonb;
CREATE INDEX IF NOT EXISTS simulation_sessions_scenario_idx ON simulation_sessions (scenario, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before jsonb,
  after jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Citizen report responses. Added after the fact, so it must be idempotent for
-- databases that already ran the original schema.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS report_id uuid REFERENCES environmental_reports(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS notifications_report_idx ON notifications (report_id, created_at DESC);
