# Security & Privacy

## Authentication

- Passwords hashed with bcrypt (cost 12).
- JWT stored in an HTTP-only, SameSite=Lax cookie (`ep_token`); `Secure` in production.
- Login rate-limited to 40 requests / 15 minutes per IP.
- JWT expiry 12 hours; “remember me” 7 days.
- On every authenticated request, `requireAuth` reloads role and account status from the database. A role change or suspension takes effect without waiting for token expiry.
- Authority registration creates a `PENDING_APPROVAL` account with role `PUBLIC`; approval is a system-administrator action and is audited.

## Authorisation

Server-side roles:

- `PUBLIC` — submit reports, view own reports, view public information.
- `FIELD_OFFICER` — investigate assigned cases, notes, corrective actions, verify reports.
- `ENVIRONMENTAL_ANALYST` — review evidence/assessments, notes, verify reports.
- `AUTHORITY_ADMIN` — assign/validate cases, official determinations, close incidents/alerts.
- `SYSTEM_ADMIN` — platform configuration, authority approval, all authority actions.

The UI hides unavailable actions but is not the security boundary. Role checks are in API middleware/handlers.

## Transport and headers

- Helmet is enabled (CSP disabled because MapLibre/OpenFreeMap/ECharts assets are cross-origin in this demo; production should define a strict CSP).
- CORS allows the configured frontend origins with credentials.
- Unsafe methods are origin-checked. The email webhook is exempt and requires `EMAIL_WEBHOOK_SECRET`.
- Global rate limit 400 requests/min; AI 20/min; reports 12/hour.

## Evidence handling

- Multer memory storage, 8 MB maximum, one file.
- MIME allow-list: JPEG, PNG, WebP.
- File signature checked against declared MIME; mismatch rejected.
- Random UUID filename; stored with mode `0600` in a private local directory.
- SHA-256 recorded.
- EXIF parsed; GPS compared with claimed location → `MATCH` / `MISMATCH` / `NO_GPS`. Client metadata is not trusted.
- Evidence served only through authenticated `/api/v1/evidence/:id`, with ownership/authority checks, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`.
- **Malware scanning is NOT_CONFIGURED.** Do not upload untrusted sensitive files until an AV/scanner is integrated.
- No public object bucket.

## Personal information

- Citizen email/phone/name are stored on the report and returned only to the report owner or an authority role.
- Public map/overview endpoints exclude contact details.
- Notification recipient addresses are masked in audit detail.
- Evidence access is audited.
- Notification preferences require explicit consent; consent timestamp stored.

## Secrets

- River AI, vision, SMTP, data.gov.in, OpenAQ and storage secrets are read server-side from environment variables.
- No secret is returned to the browser or committed. `.env.local` is gitignored; `.env.example` contains placeholders.
- `JWT_SECRET` must be replaced in any non-local deployment.

## Simulation safety

- Simulation inputs/outputs are `is_simulated=true` and carry a session id.
- Simulation alerts/notifications/incidents are excluded from operational lists.
- Simulation risk assessments use `simulation_station` entity ids, not real station ids.
- Reset does not delete real observations.
- Demo mode restricts email to `DEMO_EMAIL_RECIPIENT`; otherwise emails are `SIMULATED` records.

## Audit

Append-only `audit_logs` covers login, registration, authority approval, report status/linkage, evidence access, alert close, incident creation/status/assignment, corrective actions, official determinations, source ingestion and simulation actions.

## Known gaps

- No CSRF token (SameSite=Lax + Origin check is the current mitigation).
- No MFA.
- No malware scanner.
- No S3-compatible encrypted object storage adapter.
- No field-level encryption for contact details.
- No formal retention/deletion worker or DSAR workflow.
- No strict Content-Security-Policy.
- No distributed rate limiting or WAF.
- No penetration test or load test.
- Email webhook is generic and requires a shared secret; provider-specific signature verification is not implemented.
- Local storage path/permissions depend on the host; production should use encrypted object storage with signed, short-lived access.
