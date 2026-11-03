import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Camera, CheckCircle2, FileWarning, Filter, RefreshCw, ShieldAlert } from 'lucide-react';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel, EmptyState, LoadingBlock, Select } from '../../components/ui';
import { RiskBadge } from '../../components/Status';
import { api } from '../../lib/api';
import { CATEGORY_LABELS, categoryLabel, formatDate, timeAgo } from '../../lib/format';
import { useAuth } from '../../store/auth';

interface ReportRow {
  id: string; public_ref: string; category: string; incident_type: string; description: string;
  status: string; verification_state: string; occurred_at: string; submitted_at: string;
  is_simulated: boolean; locality_id: string | null; locality_name: string | null; lat: number; lng: number;
  evidence_count: number; ai_assessed: number;
}

export function ReportsPage() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [verification, setVerification] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const { isAuthority } = useAuth();

  const load = () => {
    setLoading(true);
    const query = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (category) query.set('category', category);
    if (status) query.set('status', status);
    if (verification) query.set('verification', verification);
    api.get<{ reports: ReportRow[]; total: number }>(`/reports?${query.toString()}`)
      .then((result) => { setReports(result.reports); setTotal(result.total); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load reports'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [page, category, status, verification]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Badge tone="amber" dot>Evidence</Badge><Badge tone="neutral">{isAuthority() ? 'All reports' : 'Your reports'}</Badge></div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">Citizen reports & evidence</h2>
          <p className="mt-1 text-[11px] text-[#788493]">Verification state is preserved. A report is never automatically an official violation.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="dark" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
          <Link to="/report"><Button variant="lime" size="sm">New report <ArrowUpRight className="h-3.5 w-3.5" /></Button></Link>
        </div>
      </div>

      <div className="grid gap-2 rounded-2xl border border-[#303945] bg-[#181d23] p-3 sm:grid-cols-3">
        <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="h-9 text-[11px]">
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-9 text-[11px]">
          <option value="">All statuses</option>
          {['SUBMITTED', 'AI_ASSESSED', 'AWAITING_VERIFICATION', 'VERIFIED', 'UNVERIFIED', 'LINKED_TO_INVESTIGATION'].map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
        </Select>
        <Select value={verification} onChange={(e) => { setVerification(e.target.value); setPage(1); }} className="h-9 text-[11px]">
          <option value="">Any verification</option>
          <option value="VERIFIED">Verified</option>
          <option value="UNVERIFIED">Unverified</option>
          <option value="REJECTED">Rejected</option>
        </Select>
      </div>

      {loading ? <LoadingBlock label="Loading reports" /> : error ? (
        <EmptyState title="Reports unavailable" description={error} icon={<FileWarning className="h-5 w-5" />} action={<Button variant="lime" onClick={load}>Retry</Button>} />
      ) : reports.length === 0 ? (
        <EmptyState title="No reports match this view" description="Try clearing filters. New citizen reports will appear here with their verification state intact." icon={<FileWarning className="h-5 w-5" />} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {reports.map((report) => (
            <Link key={report.id} to={`/reports/${report.id}`} className="group rounded-2xl border border-[#303945] bg-[#181d23] p-4 transition hover:border-[#b5e36b]/35">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral">{categoryLabel(report.category)}</Badge>
                    <Badge tone={report.verification_state === 'VERIFIED' ? 'green' : report.verification_state === 'REJECTED' ? 'red' : 'amber'}>{report.verification_state}</Badge>
                    {report.is_simulated ? <Badge tone="amber">Sim</Badge> : null}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-[#e8edf2]">{report.incident_type.replace(/_/g, ' ')}</p>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[#8d99a6]">{report.description}</p>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-[#5f6b78] transition group-hover:text-[#b5e36b]" />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[#2b333e] pt-2.5 text-[9px] text-[#6f7c89]">
                <span><DataLabel>Locality</DataLabel><br />{report.locality_name ?? '—'}</span>
                <span><DataLabel>Evidence</DataLabel><br />{report.evidence_count ? `${report.evidence_count} photo` : 'None'}</span>
                <span><DataLabel>Submitted</DataLabel><br />{timeAgo(report.submitted_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {total > 20 ? (
        <div className="flex items-center justify-between rounded-xl border border-[#303945] bg-[#181d23] px-4 py-2 text-[10px] text-[#788493]">
          <span>{total} reports · page {page}</span>
          <div className="flex gap-2">
            <Button variant="dark" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="dark" size="sm" disabled={page * 20 >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
