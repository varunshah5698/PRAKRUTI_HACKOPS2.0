# API Documentation

Base URL: `/api/v1` (development API at `http://localhost:4000/api/v1`).

Authentication uses the HTTP-only cookie `ep_token`. Send requests with `credentials: include`. Unsafe methods are origin-checked; send `Origin: http://localhost:5173` in local tools.

Errors:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request.", "details": {} } }
```

Common codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `UNAVAILABLE` (503), `INTERNAL_ERROR` (500).

Rate limits: global 400/min; auth 40/15 min; report submission 12/hour; AI 20/min.

## Health and public

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | public | Database health, demo mode, SSE client count |
| GET | `/api/v1/public/overview` | public | Demo stations, alert/report counts, live weather, source summary, map style/attribution |
| GET | `/api/v1/public/localities` | public | 26 Mumbai locality reference points |
| GET | `/api/v1/public/dashboard-preview` | public | Sanitised KPI/category/alert preview |

## Auth

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | Citizen or authority request. Authority creates `PENDING_APPROVAL` with role PUBLIC. |
| GET | `/auth/session` | optional | Returns `{user:null}` when not signed in; used by the web session bootstrap |
| POST | `/auth/login` | public | Sets `ep_token`; `rememberMe` gives 7d, otherwise 12h |
| POST | `/auth/logout` | public | Clears cookie |
| GET | `/auth/me` | user | Current user + preferences |
| PATCH | `/auth/me` | user | Update name / locality |
| POST | `/auth/forgot-password` | public | Generates reset token; local log only |
| POST | `/auth/reset-password` | public | Token + new password |
| GET | `/auth/admin/pending-authorities` | system/authority admin | Pending authority registrations |
| POST | `/auth/admin/approve-authority` | system admin | Approve with role |
| GET | `/auth/authority-users` | authority admin | Active authority users for assignment |

## Dashboard / categories

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/dashboard/summary` | user | Full command-centre payload: KPIs, categories, stations, alerts, reports, incidents, sources, weather, CAMS, charts, integrations |
| GET | `/dashboard/categories` | user | Category summary |
| GET | `/environment/categories` | user | Alias for category summary |

## Map / stations

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/map/timeline` | user | `at` ISO timestamp, `category`, `pollutant`, `localityId`, `sourceId`, `severity`, `verification`, `includeForecast`. Returns PAST/CURRENT/FUTURE mode, stations, reports, incidents, alerts, warnings, forecast metadata and `sourceImpact` (simulated industrial plume screen, per-monitor source shares, land footprints). No interpolated pollution surface. |
| GET | `/map/localities` | user | Locality reference points |
| GET | `/map/layers` | user | Category/marker legend, model status, source status |
| GET | `/map/stations` | user | Station snapshots; optional `category` |
| GET | `/map/stations/:id` | user | Station identity, values, AQI, 48h series, weather, baseline or trained forecasts, anomaly, nearby stations/reports, alerts, industrial `sourceAttribution` screen, risk, data quality |
| GET | `/map/stations/:id/observations` | user | `pollutant`, `hours` (max 168) |
| GET | `/map/stations/:id/forecasts` | user | 1/3/6h LightGBM forecasts when the trained service and history are available; labelled persistence baseline otherwise |
| GET | `/api/v1/stations` | user | Alias for `/map/stations` |
| GET | `/api/v1/stations/:id` | user | Alias for `/map/stations/:id` |

## Predictions / risk

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/predictions` | user | `stationId` optional; current PM2.5, history, 1/3/6h baseline, anomaly, warning criteria, risk, model registry, CAMS context, status |
| GET | `/predictions/models` | user | Model registry |
| GET | `/predictions/:stationId` | user | Station prediction detail |
| GET | `/risks` | user | Latest risk assessment per entity; optional category |

## AI analyst

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/ai/status` | user | River/vision status and mode |
| POST | `/ai/analyse` | user | `{stationId?, localityId?, reportId?, category?, type: observation|predictive|compliance|custom, question?}` |
| POST | `/ai/chat` | user | `{question, stationId?, localityId?, reportId?, category?}` |

`reportId` focuses the evidence bundle on one citizen report: its description and evidence metadata, nearby monitors and weather, related reports, alerts and incidents. Without a report focus, the bundle includes the aggregated report register (counts by category/status/verification) and the latest reports. Every bundle also includes the cached environmental news feed, treated as reported and unverified. Responses include `provider` (`RIVER_AI` or `RULE_BASED`), `status`, narrative, labelled sections (observed/predicted/reported/estimated/standards/limitations/nextActions), citations, evidence and disclaimer. Without `RIVER_API_KEY`, status is `NOT_CONFIGURED` and provider is `RULE_BASED`.

## Reports / evidence

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/reports` | optional user | `multipart/form-data`: category, incidentType, description, lat, lng, localityId, occurredAt, contact fields, consent, optional `photo` |
| GET | `/reports` | user | Public users see own; authority sees all. Filters: category, status, verification, localityId, page, pageSize |
| GET | `/reports/:id` | owner/authority | Report, evidence metadata, AI assessments, enrichment, audit |
| PATCH | `/reports/:id/status` | verifier | `{status: AWAITING_VERIFICATION|VERIFIED|UNVERIFIED, reason}`; transitions enforced |
| POST | `/reports/:id/link-incident` | verifier | `{incidentId, reason}`; only a VERIFIED report |
| GET | `/evidence/:id` | owner/authority | Streams private evidence with `private, no-store` |

## Alerts

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/alerts` | user | Filters category/state/trigger; excludes simulation-session alerts |
| GET | `/alerts/:id` | user | Alert, evidence, history, risk assessments, linked incidents, notification delivery |
| POST | `/alerts/:id/close` | authority admin | `{reason}`; audit recorded |

## Incidents / compliance

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/incidents` | user | Excludes simulation-session incidents; filters category/status |
| POST | `/incidents` | authority | Create from alert/report; reason required; source preserved |
| GET | `/incidents/:id` | user | Overview, map data, notes, actions, assignments, related reports/alerts, nearby readings, standards, audit, notifications |
| PATCH | `/incidents/:id/status` | authority | Enforces NEW→UNDER_REVIEW→ASSIGNED→INVESTIGATION→CORRECTIVE_ACTION→MONITORING→RESOLVED→CLOSED; close only authority admin |
| POST | `/incidents/:id/notes` | verifier | `{note}` |
| POST | `/incidents/:id/assign` | authority admin | `{userId, note?}` |
| POST | `/incidents/:id/actions` | verifier | `{description, dueAt?}` |
| PATCH | `/incidents/:id/actions/:actionId` | verifier | `{status, evidenceNote?}`; VERIFIED only authority admin |
| POST | `/incidents/:id/determination` | authority admin | `{determination, basis}`; official determination with audit |
| GET | `/compliance/standards` | user | Filters category/q |
| GET | `/compliance/documents` | user | Documents + standard counts |
| GET | `/compliance/documents/:id` | user | Document + standards |
| GET | `/compliance/search` | user | Lexical search over documents/standards |
| GET | `/compliance/compare` | user | `stationId`, `parameter`; checks unit, averaging, source type; never declares a violation |

## Notifications

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/notifications` | user | Own notifications, excludes simulation-session notifications |
| GET | `/notifications/preferences` | user | Preferences + provider status |
| PUT | `/notifications/preferences` | user | Categories, locality, radius, notifyEmail, consent |
| POST | `/notifications/:id/acknowledge` | owner | Acknowledge |
| GET | `/notifications/:id/preview` | owner/authority | Stored HTML preview |
| POST | `/notifications/webhook` | webhook secret | `{providerMessageId, status, error?}`; marks DELIVERED/FAILED |
| GET | `/notification-templates/:alertId` | authority | Public/authority/recovery email previews; incident updates are generated on status/assignment changes |

## Simulations

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/simulations/scenarios` | user | 11 scenarios (7 air, 2 water, waste, industrial) with phases and preview shapes |
| GET | `/simulations` | user | Own sessions; authority sees all |
| POST | `/simulations` | authority | `{scenario, stationId?, seed?}`; returns `scenarioVersion` and the stored `weatherSnapshot` |
| GET | `/simulations/:id` | user | Session, revealed events (recommendations + reasons per step), alerts/notifications/incidents; legacy sessions are backfilled on demand |
| POST | `/simulations/:id/play` | authority | Status PLAYING |
| POST | `/simulations/:id/pause` | authority | Status PAUSED |
| POST | `/simulations/:id/step` | authority | Advance one event; creates simulated alerts on transitions |
| POST | `/simulations/:id/seek` | authority | `{step}`; move the replay position and rebuild derived simulated alerts/notifications for that step |
| POST | `/simulations/:id/reset` | authority | Rewind to step 0 and rebuild derived simulated alerts; never deletes real observations |
| POST | `/simulations/:id/email-preview` | authority | Public/authority email previews |
| POST | `/simulations/:id/incident` | authority | Create simulation-labelled incident |

## Sources / governance / events

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/sources/status` | public | Runtime source health |
| GET | `/sources/catalogue` | public | Declarative source registry |
| GET | `/sources/jobs` | user | Recent ingestion jobs |
| POST | `/sources/refresh` | authority admin | Run configured ingestion adapters |
| GET | `/governance/audit` | authority | Audit ledger, optional entityType, pagination |
| GET | `/events` | user | SSE stream (`text/event-stream`), heartbeat 25s |

## Pagination

Endpoints that list reports, alerts, incidents, notifications and audit accept `page` (1-based) and `pageSize` (max 50–100 depending on endpoint). Responses include `page`, `pageSize` and, where implemented, `total`.
