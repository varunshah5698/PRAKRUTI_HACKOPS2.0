import { Link } from 'react-router-dom';
import { ArrowUpRight, Database, MapPinned, ShieldAlert } from 'lucide-react';
import { PublicPage, Prose, Callout } from './PublicPage';
import { PublicBadge } from '../../components/ui';

export function AboutPage() {
  return (
    <PublicPage kicker="About the platform" title="Environmental intelligence with its limits in plain sight.">
      <Prose>
        <p>
          प्रकृति is a unified environmental monitoring and decision-support platform for Greater Mumbai. It
          connects observations, weather context, predictions, citizen reports, regulatory references and investigation
          workflows. It is built around a simple rule: every displayed value must have a data origin, and every automated
          finding must remain separate from an official regulatory decision.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            [MapPinned, 'Strictly Mumbai', 'The operating boundary is Mumbai City District + Mumbai Suburban District. No Thane, Navi Mumbai or Pune records are included in the primary map.'],
            [Database, 'Source-labelled', 'CPCB is not connected in this deployment. Demo station records are marked SIMULATION DATA. Weather is live Open-Meteo. CAMS is modelled context.'],
            [ShieldAlert, 'Human authority', 'Only an authorised officer can record an official determination. Forecasts and risk scores are decision support, not violations.'],
          ].map(([Icon, title, copy]) => {
            const Component = Icon as typeof MapPinned;
            return (
              <div key={String(title)} className="rounded-2xl border border-ink/12 bg-white p-5">
                <Component className="h-4 w-4" />
                <p className="mt-4 text-sm font-semibold text-ink">{String(title)}</p>
                <p className="mt-2 text-[12px] leading-relaxed text-ink/55">{String(copy)}</p>
              </div>
            );
          })}
        </div>
        <h2>What is functional</h2>
        <ul>
          <li>Interactive Mumbai map with OpenStreetMap boundary, OpenFreeMap vector tiles, 3D building render heights and a measured/predicted/reported marker system.</li>
          <li>Environmental command centre with category cards, KPIs, alerts, reports, incidents, source health and analytics derived from application records.</li>
          <li>Citizen reporting with validated Mumbai coordinates, private evidence storage, EXIF review, AI vision NOT_CONFIGURED state and nearby evidence enrichment.</li>
          <li>Category-specific risk rules for air, water, waste and industrial evidence; confidence is stored separately from severity.</li>
          <li>Incident workflow with assignment, notes, corrective actions, regulatory references, audit trail and authorised determination.</li>
          <li>Deterministic simulation and replay isolated from real observations.</li>
        </ul>
        <h2>What is deliberately not claimed</h2>
        <ul>
          <li>No live CPCB or MPCB station feed is connected. No CPCB station identifier is fabricated.</li>
          <li>No LightGBM, quantile, deterioration or anomaly model is trained. A persistence baseline is shown instead, clearly labelled.</li>
          <li>No River AI key is configured by default. The AI analyst falls back to a rule-based evidence digest, not an LLM.</li>
          <li>No interpolated pollution surface is drawn. The network is sparse and demo observations are synthetic.</li>
          <li>No image analysis is performed without a separately configured vision model. The River text model is not assumed to inspect images.</li>
        </ul>
        <Callout title="Demonstration deployment">
          Station observations, reports, alerts and incidents are simulation-labelled. The source registry and dashboard
          banner repeat this. Do not use this deployment for enforcement or public health decisions.
        </Callout>
        <h2>How to explore</h2>
        <p>
          Open the <Link to="/dashboard">command centre</Link> with a demo account, inspect the <Link to="/map">Mumbai map</Link>,
          review <Link to="/intelligence/predictions">predictive intelligence</Link>, or submit a <Link to="/report">citizen report</Link>.
          Source status and limitations are on the <Link to="/data-sources">data sources</Link> page.
        </p>
      </Prose>
      <div className="mt-8">
        <Link to="/dashboard" className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white">
          Open the command centre <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </PublicPage>
  );
}
