import { PublicPage, Prose, Callout } from './PublicPage';

export function PrivacyPage() {
  return (
    <PublicPage kicker="Privacy" title="Citizen evidence and personal information are private by default.">
      <Prose>
        <p>
          This demonstration deployment stores citizen report contact details and evidence so that an authorised reviewer can
          verify the report. It does not publish citizen email addresses, phone numbers or photographs.
        </p>
        <h2>What we collect</h2>
        <ul>
          <li>Report category, incident type, description, incident time and Mumbai location.</li>
          <li>Optional contact name, email and phone number, only when supplied with consent.</li>
          <li>Photograph evidence, file metadata and a SHA-256 hash. EXIF GPS is compared with the claimed location and recorded as MATCH, MISMATCH or NO_GPS.</li>
          <li>Account details for registered users, notification preferences and consent timestamp.</li>
          <li>Audit events for report status changes, evidence access and investigation actions.</li>
        </ul>
        <h2>How evidence is protected</h2>
        <p>
          Evidence is stored in a private local directory with restricted file permissions by default. It is served only through
          an authenticated API route that checks report ownership or an authority role. Files are validated by signature and
          size before storage. Malware scanning is NOT_CONFIGURED in this deployment. Do not upload sensitive personal
          documents.
        </p>
        <h2>Notifications</h2>
        <p>
          Email notifications require explicit consent and a verified preference. In DEMO_MODE, email is only sent to a
          configured demonstration recipient; otherwise notifications are stored as SIMULATED records. You can change your
          preferences in Settings.
        </p>
        <h2>Retention and access</h2>
        <p>
          This is a demonstration deployment. Production retention, deletion, data-sharing and access-review policies must be
          defined before real citizen data is processed. Audit logs record evidence access and administrative actions.
        </p>
        <Callout title="No public evidence by default">
          Photographs are not placed in a public bucket and are not returned by public endpoints. Citizen contact details are
          excluded from public map and alert responses.
        </Callout>
      </Prose>
    </PublicPage>
  );
}

export function TermsPage() {
  return (
    <PublicPage kicker="Terms" title="Decision support, not an official regulatory determination.">
      <Prose>
        <p>
          प्रकृति is a demonstration environmental intelligence platform. By using it, you acknowledge that the
          records, assessments, forecasts and alerts shown may be simulated, modelled, unverified or incomplete.
        </p>
        <h2>No official determination</h2>
        <p>
          Automated risk scores, alerts, forecasts and AI explanations do not constitute an official finding of violation.
          Only an authorised officer may record an official determination through the incident workflow. Predictions are not
          confirmed future conditions.
        </p>
        <h2>Data and attribution</h2>
        <p>
          Map data is © OpenStreetMap contributors under ODbL 1.0 and is rendered using OpenFreeMap and OpenMapTiles. Weather
          data is by Open-Meteo. CAMS values are modelled products. CPCB and MPCB records are not connected in this deployment.
          Do not remove attribution notices.
        </p>
        <h2>Citizen reports</h2>
        <p>
          Submit only information you believe to be accurate. Do not upload personal data about other people without a lawful
          basis. Reports are not automatically verified, and a report does not establish that a particular person or facility
          caused an environmental condition.
        </p>
        <h2>Availability and liability</h2>
        <p>
          The platform is provided for demonstration and evaluation. It may be unavailable, incomplete or incorrect. Do not
          rely on it for emergency response, enforcement, health advice or legal decisions.
        </p>
      </Prose>
    </PublicPage>
  );
}
