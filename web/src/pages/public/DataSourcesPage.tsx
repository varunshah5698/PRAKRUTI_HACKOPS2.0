import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { PublicPage, Prose, Callout } from './PublicPage';
import { PublicBadge, Button, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';

interface Source {
  id: string;
  name: string;
  category: string;
  provider: string;
  status: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  attribution?: string;
  documentationUrl?: string;
  recordCount?: number;
  errorMessage?: string;
  notes?: string;
}

export function DataSourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .get<{ sources: Source[] }>('/sources/status')
      .then((result) => setSources(result.sources))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load sources'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <PublicPage kicker="Data sources & attribution" title="What is connected, what is modelled, what is simulated.">
      <Prose>
        <p>
          Source status is part of the product, not a footnote. Ingestion sources are called CONNECTED only when the backend has a
          recent successful crawl. Keyless on-demand connectors (marine, flood, OSM, EONET, USGS) are registered as CONNECTED and
          report failures in the Live City workspace. A missing key or endpoint shows NOT_CONFIGURED and never crashes the platform.
        </p>
        <Callout title="Important distinction" tone="amber">
          <strong>CPCB and MPCB are not connected in this deployment.</strong> The station markers and readings in the demo
          are from a synthetic demo network and are labelled SIMULATION DATA. They are not CPCB readings and must not be cited
          as such. Weather is live from Open-Meteo. CAMS is a modelled regional product, not a station measurement.
        </Callout>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-ink/50"><Spinner /> Loading source registry…</div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
            {error}
            <Button variant="outline" size="sm" className="ml-3" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-ink/12 bg-white">
            <div className="hidden grid-cols-[1.2fr_0.8fr_0.8fr_1.2fr] gap-4 border-b border-ink/10 bg-[#f3f4ed] px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/45 md:grid">
              <span>Source</span><span>Status</span><span>Last success</span><span>Attribution / notes</span>
            </div>
            {sources.map((source) => (
              <div key={source.id} className="grid gap-3 border-b border-ink/8 px-5 py-4 last:border-0 md:grid-cols-[1.2fr_0.8fr_0.8fr_1.2fr] md:gap-4">
                <div>
                  <p className="text-sm font-semibold text-ink">{source.name}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-ink/40">{source.provider}</p>
                  {source.documentationUrl ? (
                    <a href={source.documentationUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] text-ink/50 underline">
                      Documentation <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
                <div>
                  <PublicBadge tone={source.status === 'CONNECTED' ? 'lime' : source.status === 'FAILED' ? 'outline' : 'soft'}>
                    {source.status.replace(/_/g, ' ')}
                  </PublicBadge>
                  {source.recordCount ? <p className="mt-1 text-[10px] text-ink/40">{source.recordCount} records</p> : null}
                </div>
                <p className="text-[11px] text-ink/50">{source.lastSuccessAt ? formatDate(source.lastSuccessAt) : '—'}</p>
                <div className="text-[11px] leading-relaxed text-ink/55">
                  <p>{source.attribution || '—'}</p>
                  {source.notes ? <p className="mt-1 text-ink/40">{source.notes}</p> : null}
                  {source.errorMessage ? <p className="mt-1 text-red-700">{source.errorMessage}</p> : null}
                </div>
              </div>
            ))}
          </div>
        )}
        <h2>Mapping and geospatial data</h2>
        <p>
          MapLibre GL JS renders OpenFreeMap vector tiles. OpenFreeMap states that its public instance is free with no request
          limit and permits commercial use; attribution is required. Map data is © OpenStreetMap contributors under ODbL 1.0.
          The Greater Mumbai boundary was retrieved from OpenStreetMap via Nominatim (Mumbai City District and Mumbai Suburban
          District relations) and stored locally. 3D building heights use OpenMapTiles render heights for visual context and
          are not surveyed building data.
        </p>
        <h2>Weather and modelled air quality</h2>
        <p>
          Weather observations and forecasts are from Open-Meteo at station coordinates. CAMS PM2.5 and PM10 values via the
          Open-Meteo air-quality API are modelled regional context. They are never presented as CPCB station readings or an
          official AQI.
        </p>
        <h2>Missing integrations</h2>
        <p>
          River AI and the vision provider are configured server-side through environment variables. If a key is absent,
          the AI Analyst returns a rule-based evidence digest and photographs remain unassessed. No LightGBM model has been
          trained. The UI exposes these states instead of substituting fabricated output.
        </p>
        <div className="flex flex-wrap gap-2">
          <PublicBadge tone="soft">OpenFreeMap · © OpenMapTiles</PublicBadge>
          <PublicBadge tone="soft">Data © OpenStreetMap contributors (ODbL)</PublicBadge>
          <PublicBadge tone="soft">Weather by Open-Meteo (CC BY 4.0)</PublicBadge>
          <PublicBadge tone="soft">CAMS via Open-Meteo</PublicBadge>
        </div>
      </Prose>
    </PublicPage>
  );
}
