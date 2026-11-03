import { useEffect, useState } from 'react';
import { Database, ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel, EmptyState, LoadingBlock, Select } from '../../components/ui';
import { SourceBadge } from '../../components/Status';
import { api } from '../../lib/api';
import { formatDate, timeAgo } from '../../lib/format';
import { useAuth } from '../../store/auth';

interface Source {
  id: string; name: string; category: string; provider: string; status: string; lastAttemptAt?: string;
  lastSuccessAt?: string; attribution?: string; documentationUrl?: string; recordCount?: number; errorMessage?: string; notes?: string;
}
interface Job { id: string; source_name: string; started_at: string; finished_at: string | null; status: string; records: number; error: string | null }

export function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { can, isAuthority } = useAuth();

  const load = () => {
    setLoading(true);
    Promise.all([api.get<{ sources: Source[] }>('/sources/status'), api.get<{ jobs: Job[] }>('/sources/jobs')])
      .then(([sourceResult, jobResult]) => { setSources(sourceResult.sources); setJobs(jobResult.jobs); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load sources'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const result = await api.post<{ results: Record<string, { records: number; message?: string }> }>('/sources/refresh');
      toast.success('Ingestion attempted.');
      console.info(result.results);
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Refresh failed'); }
    finally { setRefreshing(false); }
  };

  if (loading) return <LoadingBlock className="min-h-[60vh]" label="Loading source registry" />;
  if (error) return <EmptyState title="Sources unavailable" description={error} icon={<Database className="h-5 w-5" />} action={<Button variant="lime" onClick={load}>Retry</Button>} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Badge tone="amber" dot>Source health</Badge><Badge tone="neutral">Missing keys never crash the app</Badge></div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">Data sources & ingestion</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[#6f7f74]">
            Ingestion sources are shown CONNECTED only after recent successful ingestion. Keyless on-demand connectors (marine, flood, OSM, EONET, USGS) are registered as CONNECTED and report failures on the Live City page. CPCB and MPCB are not configured. The demo network is explicitly simulation-labelled.
          </p>
        </div>
        {can(['AUTHORITY_ADMIN', 'SYSTEM_ADMIN']) ? <Button variant="lime" size="sm" onClick={refresh} disabled={refreshing}><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Run ingestion</Button> : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {sources.map((source) => (
          <Card key={source.id}>
            <div className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-[#1b2a1f]">{source.name}</p>
                  <p className="mt-0.5 text-[9px] uppercase tracking-[0.08em] text-[#66766b]">{source.provider} · {source.category}</p>
                </div>
                <SourceBadge status={source.status} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-[#5a6a5f]">
                <div><DataLabel>Last attempt</DataLabel><p className="mt-1">{source.lastAttemptAt ? timeAgo(source.lastAttemptAt) : '—'}</p></div>
                <div><DataLabel>Last success</DataLabel><p className="mt-1">{source.lastSuccessAt ? formatDate(source.lastSuccessAt) : '—'}</p></div>
                <div><DataLabel>Records</DataLabel><p className="mt-1">{source.recordCount ?? 0}</p></div>
                <div><DataLabel>Attribution</DataLabel><p className="mt-1 truncate">{source.attribution ?? '—'}</p></div>
              </div>
              {source.notes ? <p className="mt-3 text-[9px] leading-relaxed text-[#66766b]">{source.notes}</p> : null}
              {source.errorMessage ? <p className="mt-2 rounded-lg border border-red-500/25 bg-red-500/10 p-2 text-[9px] text-red-700">{source.errorMessage}</p> : null}
              {source.documentationUrl ? <a href={source.documentationUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[9px] text-[#3f7d2a] underline">Documentation <ExternalLink className="h-3 w-3" /></a> : null}
            </div>
          </Card>
        ))}
      </div>

      {isAuthority() ? (
      <Card>
        <CardHeader><CardTitle>Recent ingestion jobs</CardTitle><Badge tone="neutral">{jobs.length}</Badge></CardHeader>
        {jobs.length === 0 ? <EmptyState title="No ingestion jobs" description="Trigger ingestion or wait for a scheduled job." /> : (
          <div className="scrollbar-thin max-h-[400px] overflow-auto">
            <table className="w-full text-left text-[10px]">
              <thead className="sticky top-0 bg-[#ffffff] text-[9px] uppercase tracking-[0.1em] text-[#66766b]"><tr><th className="px-4 py-2">Source</th><th className="px-4 py-2">Started</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Records</th><th className="px-4 py-2">Error</th></tr></thead>
              <tbody className="divide-y divide-[#e7ece3]">
                {jobs.map((job) => (
                  <tr key={job.id} className="text-[#5a6a5f]">
                    <td className="px-4 py-2">{job.source_name}</td>
                    <td className="px-4 py-2">{formatDate(job.started_at)}</td>
                    <td className="px-4 py-2"><Badge tone={job.status === 'SUCCESS' ? 'green' : job.status === 'FAILED' ? 'red' : 'amber'}>{job.status}</Badge></td>
                    <td className="px-4 py-2">{job.records}</td>
                    <td className="px-4 py-2 text-[9px] text-red-600/70">{job.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      ) : null}

      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.05] p-4 text-[10px] leading-relaxed text-amber-700/75">
        <ShieldAlert className="mb-1 h-3.5 w-3.5" />
        No CPCB or MPCB credential is configured. The system does not invent endpoints or station identifiers. Weather is live Open-Meteo; CAMS is modelled context; the demo network is synthetic.
      </div>
    </div>
  );
}
