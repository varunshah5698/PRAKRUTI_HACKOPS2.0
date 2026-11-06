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
  recommendations_version integer NOT NULL DEFAULT 0,
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
ALTER TABLE simulation_sessions ADD COLUMN IF NOT EXISTS recommendations_version integer NOT NULL DEFAULT 0;
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

CREATE TABLE IF NOT EXISTS service_health (
  key text PRIMARY KEY,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_heartbeat_at timestamptz,
  last_error text,
  success_count bigint NOT NULL DEFAULT 0,
  failure_count bigint NOT NULL DEFAULT 0,
  detail jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Citizen report responses. Added after the fact, so it must be idempotent for
-- databases that already ran the original schema.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS report_id uuid REFERENCES environmental_reports(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS notifications_report_idx ON notifications (report_id, created_at DESC);

-- Google identity and citizen onboarding. PUBLIC is the application's citizen
-- role; the portal labels it Citizen. Do not add a second duplicate role.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'password';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_idx ON users (google_sub) WHERE google_sub IS NOT NULL;

ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS weather_notifications boolean NOT NULL DEFAULT false;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS news_notifications boolean NOT NULL DEFAULT true;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS location_label text;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS weather_consent_at timestamptz;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS news_consent_at timestamptz;
CREATE INDEX IF NOT EXISTS user_preferences_weather_idx
  ON user_preferences (weather_notifications) WHERE weather_notifications = true;

-- Per-location readings fetched for citizens, independent of monitoring stations.
CREATE TABLE IF NOT EXISTS citizen_weather_readings (
  id bigserial PRIMARY KEY,
  location_key text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  observed_at timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  temperature_c numeric,
  relative_humidity numeric,
  precipitation_mm numeric,
  wind_speed_kmh numeric,
  wind_gust_kmh numeric,
  weather_code integer,
  source_id text NOT NULL,
  is_simulated boolean NOT NULL DEFAULT false,
  raw jsonb,
  UNIQUE (location_key, observed_at, source_id)
);
CREATE INDEX IF NOT EXISTS citizen_weather_readings_location_idx
  ON citizen_weather_readings (location_key, observed_at DESC);
ALTER TABLE citizen_weather_readings ADD COLUMN IF NOT EXISTS relative_humidity numeric;

-- One row per location + condition + severity + day. The unique key is the
-- duplicate guard: the same ongoing event cannot generate a second email.
CREATE TABLE IF NOT EXISTS weather_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  location_key text NOT NULL,
  location_label text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  condition text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('NORMAL','MODERATE','HIGH','CRITICAL')),
  measured_value numeric,
  unit text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  source_id text NOT NULL,
  is_simulated boolean NOT NULL DEFAULT false,
  raw jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS weather_events_location_idx ON weather_events (location_key, last_seen_at DESC);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS weather_event_id uuid REFERENCES weather_events(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS news_item_id text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_weather_event_user_idx
  ON notifications (weather_event_id, user_id) WHERE weather_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_news_item_user_idx
  ON notifications (news_item_id, user_id) WHERE news_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_news_idx
  ON notifications (created_at DESC) WHERE template = 'NEWS_ALERT';
CREATE INDEX IF NOT EXISTS notifications_retry_idx
  ON notifications (next_retry_at) WHERE status = 'FAILED' AND next_retry_at IS NOT NULL;

-- Event intelligence foundation (Phase 1). Additive only: no existing table is
-- altered, renamed or dropped. Authority workflow tables arrive in Phase 4.
CREATE TABLE IF NOT EXISTS disaster_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN (
    'EXTREME_RAINFALL','URBAN_FLOOD','RIVER_FLOOD','HEATWAVE','EXTREME_TEMPERATURE',
    'CYCLONE','SEVERE_STORM','DROUGHT','LANDSLIDE','EARTHQUAKE','AIR_POLLUTION','WILDFIRE','OTHER'
  )),
  title text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'UNKNOWN' CHECK (severity IN ('NORMAL','MODERATE','HIGH','CRITICAL','UNKNOWN')),
  status text NOT NULL DEFAULT 'DETECTED' CHECK (status IN (
    'DETECTED','EVIDENCE_COLLECTED','READY_FOR_REVIEW','AUTHORITY_NOTIFIED','ACKNOWLEDGED',
    'VERIFIED','ACTION_INITIATED','RESOLVED','CLOSED','NOTIFICATION_FAILED',
    'AWAITING_ACKNOWLEDGEMENT','REJECTED','DUPLICATE','UNDER_INVESTIGATION','ESCALATED','UNRESOLVED'
  )),
  confidence numeric(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  data_quality text,
  detection_source text,
  start_at timestamptz,
  last_observed_at timestamptz,
  detected_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  primary_location geography(Point,4326),
  affected_area geography(MultiPolygon,4326),
  admin_area text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disaster_events_status_idx ON disaster_events (status, detected_at DESC);
CREATE INDEX IF NOT EXISTS disaster_events_category_idx ON disaster_events (category, detected_at DESC);
CREATE INDEX IF NOT EXISTS disaster_events_start_idx ON disaster_events (start_at DESC);
CREATE INDEX IF NOT EXISTS disaster_events_location_gix ON disaster_events USING gist (primary_location);
CREATE INDEX IF NOT EXISTS disaster_events_area_gix ON disaster_events USING gist (affected_area);

-- Phase 2 adds EARTHQUAKE for USGS/GDACS seismic events. This only touches the
-- Phase 1 table, never an existing production table.
ALTER TABLE disaster_events DROP CONSTRAINT IF EXISTS disaster_events_category_check;
ALTER TABLE disaster_events ADD CONSTRAINT disaster_events_category_check CHECK (category IN (
  'EXTREME_RAINFALL','URBAN_FLOOD','RIVER_FLOOD','HEATWAVE','EXTREME_TEMPERATURE',
  'CYCLONE','SEVERE_STORM','DROUGHT','LANDSLIDE','EARTHQUAKE','AIR_POLLUTION','WILDFIRE','OTHER'
));

CREATE TABLE IF NOT EXISTS event_links (
  event_id uuid NOT NULL REFERENCES disaster_events(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN (
    'ALERT','INCIDENT','REPORT','WEATHER_OBSERVATION','ENVIRONMENTAL_OBSERVATION','EXTERNAL'
  )),
  entity_id text NOT NULL,
  relationship text NOT NULL,
  confidence numeric(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS event_links_entity_idx ON event_links (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS event_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES disaster_events(id) ON DELETE CASCADE,
  evidence_type text NOT NULL CHECK (evidence_type IN (
    'OFFICIAL_WARNING','WEATHER_OBSERVATION','SATELLITE','HISTORICAL_DATASET',
    'NEWS','CITIZEN_REPORT','AUTHORITY_UPDATE','MODEL_OUTPUT','OTHER'
  )),
  source_id text,
  source_name text,
  source_url text,
  source_record_id text,
  source_entity_type text,
  source_entity_id text,
  title text,
  raw_content jsonb,
  content_hash text,
  observed_at timestamptz,
  published_at timestamptz,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  location geography(Point,4326),
  verification_status text NOT NULL DEFAULT 'SOURCE_REPORTED' CHECK (verification_status IN (
    'OFFICIAL_VERIFIED','INDEPENDENTLY_CORROBORATED','SOURCE_REPORTED',
    'CITIZEN_UNVERIFIED','MODEL_GENERATED','DISPUTED','UNAVAILABLE'
  )),
  reliability_class text NOT NULL DEFAULT 'UNKNOWN' CHECK (reliability_class IN (
    'OFFICIAL','PRIMARY_OBSERVATION','INDEPENDENT_CORROBORATION','AGGREGATOR','NEWS','CITIZEN','MODEL','UNKNOWN'
  )),
  freshness_status text NOT NULL DEFAULT 'UNKNOWN' CHECK (freshness_status IN ('LIVE','STALE','HISTORICAL','UNKNOWN')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_evidence_event_idx ON event_evidence (event_id, observed_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS event_evidence_location_gix ON event_evidence USING gist (location);
CREATE UNIQUE INDEX IF NOT EXISTS event_evidence_source_record_idx
  ON event_evidence (event_id, source_id, source_record_id) WHERE source_record_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_evidence_content_hash_idx
  ON event_evidence (event_id, source_id, content_hash) WHERE content_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_evidence_null_source_record_idx
  ON event_evidence (event_id, source_record_id) WHERE source_id IS NULL AND source_record_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_evidence_null_source_hash_idx
  ON event_evidence (event_id, content_hash) WHERE source_id IS NULL AND content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS event_correlations (
  event_a_id uuid NOT NULL REFERENCES disaster_events(id) ON DELETE CASCADE,
  event_b_id uuid NOT NULL REFERENCES disaster_events(id) ON DELETE CASCADE,
  relationship text NOT NULL,
  distance_m numeric,
  time_delta_seconds integer,
  confidence numeric(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  reason text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (event_a_id < event_b_id),
  PRIMARY KEY (event_a_id, event_b_id)
);
CREATE INDEX IF NOT EXISTS event_correlations_b_idx ON event_correlations (event_b_id);

CREATE TABLE IF NOT EXISTS event_timeline (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES disaster_events(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN (
    'EVENT_CREATED','EVIDENCE_ADDED','SOURCE_LINKED','CORRELATION_ADDED','STATUS_CHANGED','NOTE','VALIDATION'
  )),
  actor_type text NOT NULL CHECK (actor_type IN ('SYSTEM','USER')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  summary text NOT NULL,
  detail jsonb,
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text UNIQUE
);
CREATE INDEX IF NOT EXISTS event_timeline_event_idx ON event_timeline (event_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS event_timeline_type_idx ON event_timeline (entry_type, occurred_at DESC);

CREATE OR REPLACE FUNCTION reject_event_timeline_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'event_timeline is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS event_timeline_immutable ON event_timeline;
CREATE TRIGGER event_timeline_immutable
  BEFORE UPDATE OR DELETE ON event_timeline
  FOR EACH ROW EXECUTE FUNCTION reject_event_timeline_mutation();

-- Phase 2: evidence-linked analysis and forecasts. Additive only.
CREATE TABLE IF NOT EXISTS event_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES disaster_events(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('PAST','PRESENT','FUTURE')),
  summary text NOT NULL,
  conclusions jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  methodology text,
  model_name text,
  model_version text,
  limitations text,
  generated_by text NOT NULL DEFAULT 'SYSTEM',
  valid_from timestamptz,
  valid_to timestamptz,
  generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_analysis_event_idx ON event_analysis (event_id, stage, generated_at DESC);

CREATE TABLE IF NOT EXISTS event_analysis_evidence (
  analysis_id uuid NOT NULL REFERENCES event_analysis(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES event_evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (analysis_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS event_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES disaster_events(id) ON DELETE CASCADE,
  analysis_id uuid REFERENCES event_analysis(id) ON DELETE SET NULL,
  evidence_id uuid REFERENCES event_evidence(id) ON DELETE SET NULL,
  horizon_hours integer NOT NULL,
  valid_from timestamptz,
  valid_to timestamptz,
  summary text NOT NULL,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  uncertainty text,
  source_id text,
  model_name text,
  generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_forecasts_event_idx ON event_forecasts (event_id, horizon_hours, generated_at DESC);

-- Phase 3: event-specific, evidence-backed recommendations. Recommendations are
-- decision support, not official orders. Authority acceptance workflow is Phase 4.
CREATE TABLE IF NOT EXISTS action_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES disaster_events(id) ON DELETE CASCADE,
  audience text NOT NULL CHECK (audience IN ('CITIZEN','AUTHORITY')),
  recommendation_key text NOT NULL,
  title text NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  urgency text NOT NULL CHECK (urgency IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  location_label text,
  admin_area text,
  location geography(Point,4326),
  timeframe text NOT NULL,
  confidence numeric(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','ACCEPTED','IN_PROGRESS','COMPLETED','REJECTED','EXPIRED')),
  generated_by text NOT NULL DEFAULT 'RULE_ENGINE',
  methodology text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, audience, recommendation_key)
);
CREATE INDEX IF NOT EXISTS action_recommendations_event_idx ON action_recommendations (event_id, audience, urgency, created_at DESC);
CREATE INDEX IF NOT EXISTS action_recommendations_status_idx ON action_recommendations (status, urgency);
CREATE INDEX IF NOT EXISTS action_recommendations_location_gix ON action_recommendations USING gist (location);

CREATE TABLE IF NOT EXISTS recommendation_evidence (
  recommendation_id uuid NOT NULL REFERENCES action_recommendations(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES event_evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (recommendation_id, evidence_id)
);

-- Phase 4: verified authority directory, memberships and per-authority event
-- lifecycle. No direct government API is claimed; channels are manual/internal.
CREATE TABLE IF NOT EXISTS authority_directory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  abbreviation text,
  level text NOT NULL CHECK (level IN ('NATIONAL','STATE','DISTRICT','MUNICIPAL','LOCAL','OTHER')),
  parent_id uuid REFERENCES authority_directory(id) ON DELETE SET NULL,
  official_url text,
  official_contacts jsonb NOT NULL DEFAULT '{}'::jsonb,
  reporting_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_feeds jsonb NOT NULL DEFAULT '[]'::jsonb,
  coverage_country text DEFAULT 'India',
  coverage_state text,
  coverage_district text,
  coverage_city text,
  jurisdiction_area geography(MultiPolygon,4326),
  verification_status text NOT NULL DEFAULT 'PARTIALLY_VERIFIED'
    CHECK (verification_status IN ('SOURCE_VERIFIED','PARTIALLY_VERIFIED','UNVERIFIED','DISPUTED')),
  verified_at timestamptz,
  source_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS authority_directory_coverage_idx ON authority_directory (coverage_state, coverage_district, coverage_city);
CREATE INDEX IF NOT EXISTS authority_directory_jurisdiction_gix ON authority_directory USING gist (jurisdiction_area);

CREATE TABLE IF NOT EXISTS authority_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  authority_id uuid NOT NULL REFERENCES authority_directory(id) ON DELETE CASCADE,
  membership_role text NOT NULL CHECK (membership_role IN ('VIEWER','OFFICER','ADMIN')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','REVOKED')),
  verified_at timestamptz,
  verification_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, authority_id)
);
CREATE INDEX IF NOT EXISTS authority_memberships_authority_idx ON authority_memberships (authority_id, status);

CREATE TABLE IF NOT EXISTS event_authority (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES disaster_events(id) ON DELETE CASCADE,
  authority_id uuid NOT NULL REFERENCES authority_directory(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'READY_FOR_REVIEW' CHECK (status IN (
    'READY_FOR_REVIEW','AUTHORITY_NOTIFIED','ACKNOWLEDGED','VERIFIED','ACTION_INITIATED',
    'RESOLVED','CLOSED','REJECTED','NOTIFICATION_FAILED','AWAITING_ACKNOWLEDGEMENT',
    'UNDER_INVESTIGATION','ESCALATED','UNRESOLVED'
  )),
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  acknowledgement_due_at timestamptz,
  resolution_due_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by uuid REFERENCES users(id) ON DELETE SET NULL,
  withdrawal_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, authority_id)
);
CREATE INDEX IF NOT EXISTS event_authority_authority_idx ON event_authority (authority_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS event_authority_event_idx ON event_authority (event_id, status);

CREATE TABLE IF NOT EXISTS event_authority_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_authority_id uuid NOT NULL REFERENCES event_authority(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES disaster_events(id) ON DELETE CASCADE,
  authority_id uuid NOT NULL REFERENCES authority_directory(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('AUTHORITY_USER','SYSTEM')),
  action_type text NOT NULL CHECK (action_type IN (
    'NOTIFICATION_SENT','NOTIFICATION_FAILED','ACKNOWLEDGE','VERIFY','START_ACTION','RESOLVE',
    'CLOSE','REJECT','ESCALATE','MARK_UNRESOLVED','NOTE'
  )),
  previous_status text,
  new_status text,
  channel text,
  delivery_reference text,
  response text,
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_authority_actions_event_idx ON event_authority_actions (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_authority_actions_authority_idx ON event_authority_actions (authority_id, created_at DESC);

CREATE OR REPLACE FUNCTION reject_authority_action_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'event_authority_actions is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS event_authority_actions_immutable ON event_authority_actions;
CREATE TRIGGER event_authority_actions_immutable
  BEFORE UPDATE OR DELETE ON event_authority_actions
  FOR EACH ROW EXECUTE FUNCTION reject_authority_action_mutation();

ALTER TABLE event_timeline DROP CONSTRAINT IF EXISTS event_timeline_entry_type_check;
ALTER TABLE event_timeline ADD CONSTRAINT event_timeline_entry_type_check CHECK (entry_type IN (
  'EVENT_CREATED','EVIDENCE_ADDED','SOURCE_LINKED','CORRELATION_ADDED','STATUS_CHANGED',
  'AUTHORITY_ACTION','NOTE','VALIDATION'
));

-- Phase 4 follow-up: operational notification links, SLA tracking and
-- withdrawal history. Additive and idempotent for databases that already ran
-- the Phase 4 tables.
ALTER TABLE event_authority ADD COLUMN IF NOT EXISTS notified_at timestamptz;
ALTER TABLE event_authority ADD COLUMN IF NOT EXISTS acknowledgement_due_at timestamptz;
ALTER TABLE event_authority ADD COLUMN IF NOT EXISTS resolution_due_at timestamptz;
ALTER TABLE event_authority ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
ALTER TABLE event_authority ADD COLUMN IF NOT EXISTS withdrawn_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE event_authority ADD COLUMN IF NOT EXISTS withdrawal_reason text;
CREATE INDEX IF NOT EXISTS event_authority_active_idx ON event_authority (authority_id, status) WHERE withdrawn_at IS NULL;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS disaster_event_id uuid REFERENCES disaster_events(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_authority_id uuid REFERENCES event_authority(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS notifications_disaster_event_idx ON notifications (disaster_event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_event_authority_idx ON notifications (event_authority_id, created_at DESC);
