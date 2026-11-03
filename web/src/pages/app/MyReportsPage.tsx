import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Camera,
  ChevronDown,
  ClipboardList,
  FileWarning,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { Badge, Button, DataLabel, EmptyState, LoadingBlock, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { CATEGORY_LABELS, categoryLabel, formatDate, timeAgo } from '../../lib/format';
import { toast } from 'sonner';

interface ReportRow {
  id: string;
  public_ref: string;
  category: string;
  incident_type: string;
  description: string;
  status: string;
  verification_state: string;
  occurred_at: string;
  submitted_at: string;
  is_simulated: boolean;
  locality_name: string | null;
  lat: number;
  lng: number;
  evidence_count: number;
  ai_assessed: number;
}

interface AuditRow {
  id: string;
  action: string;
  after: Record<string, unknown> | null;
  created_at: string;
}

interface ReportDetail {
  report: { id: string; public_ref: string; status: string; verification_state: string; description: string };
  evidence: Array<{ id: string; original_name: string | null; mime_type: string; uploaded_at: string }>;
  audit: AuditRow[];
}

const STEPS = ['SUBMITTED', 'AI_ASSESSED', 'AWAITING_VERIFICATION', 'VERIFIED', 'LINKED_TO_INVESTIGATION'] as const;

const STEP_COPY: Record<string, string> = {
  SUBMITTED: 'Received by प्रकृति',
  AI_ASSESSED: 'Automatically screened',
  AWAITING_VERIFICATION: 'With an authority officer',
  VERIFIED: 'Verified by the authority',
  UNVERIFIED: 'Not verified',
  LINKED_TO_INVESTIGATION: 'Linked to an investigation',
};

/** Only fields the citizen is allowed to see from the governance audit trail. */
function authorityUpdate(row: AuditRow) {
  const after = row.after ?? {};
  const status = typeof after.status === 'string' ? after.status : null;
  const reason = typeof after.reason === 'string' ? after.reason : null;
  const verification = typeof after.verification === 'string' ? after.verification : null;
  const incident = typeof after.incidentId === 'string' ? after.incidentId : null;
  const label =
    row.action === 'REPORT_SUBMITTED'
      ? 'Your report was recorded'
      : row.action === 'REPORT_STATUS_CHANGED'
        ? `Status moved to ${(status ?? '').replace(/_/g, ' ').toLowerCase()}`
        : row.action === 'REPORT_LINKED_TO_INCIDENT'
          ? 'Linked to an official investigation'
          : row.action.replace(/_/g, ' ').toLowerCase();
  return { label, reason, verification, status, incident, at: row.created_at };
}

function stepIndex(status: string) {
  if (status === 'UNVERIFIED') return 3;
  const index = STEPS.indexOf(status as (typeof STEPS)[number]);
  return index === -1 ? 0 : index;
}

function Tracker({ report }: { report: ReportRow }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const current = stepIndex(report.status);
  const rejected = report.status === 'UNVERIFIED';

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || detail) return;
    setLoading(true);
    try {
      setDetail(await api.get<ReportDetail>(`/reports/${report.id}`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load the update history');
    } finally {
      setLoading(false);
    }
  };

  return (
    <article className="rounded-2xl border border-[#dfe6db] bg-[#ffffff] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={rejected ? 'red' : report.status === 'VERIFIED' || report.status === 'LINKED_TO_INVESTIGATION' ? 'green' : 'amber'} dot>
              {STEP_COPY[report.status] ?? report.status.replace(/_/g, ' ')}
            </Badge>
            <Badge tone="neutral">{categoryLabel(report.category)}</Badge>
            {report.is_simulated ? <Badge tone="amber">Demo record</Badge> : null}
          </div>
          <p className="mt-2 text-sm font-semibold text-[#1b2a1f]">{report.incident_type.replace(/_/g, ' ')}</p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[#68786d]">{report.description}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.14em] text-[#74847a]">Reference</p>
          <p className="font-mono text-[11px] text-[#26362a]">{report.public_ref}</p>
          <p className="mt-1 text-[9px] text-[#74847a]">{timeAgo(report.submitted_at)}</p>
        </div>
      </div>

      <ol className="mt-4 flex items-center gap-1">
        {STEPS.map((step, index) => {
          const reached = index <= current;
          const isFinal = step === 'VERIFIED';
          const tone = rejected && isFinal ? 'bg-[#c94a50]' : reached ? 'bg-[#5b9e46]' : 'bg-[#dfe6db]';
          return (
            <li key={step} className="flex-1">
              <div className={`h-1 rounded-full ${tone}`} />
              <p className={`mt-1.5 text-[8px] uppercase tracking-[0.1em] ${reached ? 'text-[#5a6a5f]' : 'text-[#7b8a80]'}`}>
                {rejected && isFinal ? 'Not verified' : step.replace(/_/g, ' ')}
              </p>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[#e7ece3] pt-3 text-[9px] text-[#74847a]">
        <span><DataLabel>Locality</DataLabel><br />{report.locality_name ?? '—'}</span>
        <span><DataLabel>Evidence</DataLabel><br />{report.evidence_count ? `${report.evidence_count} file${report.evidence_count > 1 ? 's' : ''}` : 'None'}</span>
        <span><DataLabel>Screened</DataLabel><br />{report.ai_assessed ? 'Yes' : 'Pending'}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="dark" size="sm" onClick={toggle} aria-expanded={open}>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ClipboardList className="h-3.5 w-3.5" />}
          Authority updates
        </Button>
        <a href={`https://www.openstreetmap.org/?mlat=${report.lat}&mlon=${report.lng}#map=16/${report.lat}/${report.lng}`} target="_blank" rel="noreferrer">
          <Button variant="dark" size="sm"><MapPin className="h-3.5 w-3.5" /> Report location</Button>
        </a>
      </div>

      {open ? (
        <div className="mt-3 border-t border-[#e7ece3] pt-3">
          {loading ? (
            <LoadingBlock label="Loading updates" />
          ) : detail ? (
            <ol className="space-y-2">
              {detail.audit.map((row) => {
                const update = authorityUpdate(row);
                return (
                  <li key={row.id} className="rounded-xl border border-[#e7ece3] bg-[#f5f8f2] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold text-[#26362a]">{update.label}</p>
                      <span className="text-[9px] text-[#74847a]">{formatDate(row.created_at)}</span>
                    </div>
                    {update.reason ? <p className="mt-1 text-[10px] leading-relaxed text-[#5a6a5f]">Officer note: {update.reason}</p> : null}
                    {update.verification ? (
                      <p className="mt-1 text-[9px] uppercase tracking-[0.12em] text-[#74847a]">verification {update.verification}</p>
                    ) : null}
                  </li>
                );
              })}
              {detail.audit.length === 0 ? <p className="text-[11px] text-[#74847a]">No updates recorded yet.</p> : null}
            </ol>
          ) : null}
          <p className="mt-2 text-[9px] leading-relaxed text-[#74847a]">
            This trail is the same record authorities see. A report is only an official violation once it is verified.
          </p>
        </div>
      ) : null}
    </article>
  );
}

export function MyReportsPage() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = () => {
    setLoading(true);
    const query = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (status) query.set('status', status);
    api
      .get<{ reports: ReportRow[]; total: number }>(`/reports?${query.toString()}`)
      .then((result) => {
        setReports(result.reports);
        setTotal(result.total);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your reports'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [page, status]);

  const visible = useMemo(
    () =>
      reports.filter(
        (report) =>
          !term ||
          report.public_ref.toLowerCase().includes(term.toLowerCase()) ||
          report.description.toLowerCase().includes(term.toLowerCase()) ||
          report.incident_type.toLowerCase().includes(term.toLowerCase()),
      ),
    [reports, term],
  );

  const counts = useMemo(() => {
    const done = reports.filter((r) => ['VERIFIED', 'LINKED_TO_INVESTIGATION'].includes(r.status)).length;
    const waiting = reports.filter((r) => ['SUBMITTED', 'AI_ASSESSED', 'AWAITING_VERIFICATION'].includes(r.status)).length;
    return { done, waiting };
  }, [reports]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone="green" dot>Your reports</Badge>
            <Badge tone="neutral">{total} submitted</Badge>
            {counts.waiting ? <Badge tone="amber">{counts.waiting} with authority</Badge> : null}
            {counts.done ? <Badge tone="green">{counts.done} actioned</Badge> : null}
          </div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">Track the problems you flagged</h2>
          <p className="mt-1 max-w-2xl text-[11px] text-[#6f7f74]">
            Every report you submit is stored with its reference and moves through the same verification trail authority
            officers use. Open a report to read their updates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="dark" size="sm" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Link to="/report">
            <Button variant="lime" size="sm">
              Flag a problem <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-2 rounded-2xl border border-[#dfe6db] bg-[#ffffff] p-3 sm:grid-cols-[1fr_auto]">
        <div className="flex items-center gap-2 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] px-3">
          <Search className="h-3.5 w-3.5 text-[#74847a]" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search reference, type or description"
            className="h-9 w-full bg-transparent text-[11px] text-[#1b2a1f] outline-none placeholder:text-[#7b8a80]"
          />
        </div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-9 w-[190px] text-[11px]">
          <option value="">All stages</option>
          {['SUBMITTED', 'AI_ASSESSED', 'AWAITING_VERIFICATION', 'VERIFIED', 'UNVERIFIED', 'LINKED_TO_INVESTIGATION'].map((value) => (
            <option key={value} value={value}>{STEP_COPY[value]}</option>
          ))}
        </Select>
      </div>

      {loading ? (
        <LoadingBlock label="Loading your reports" />
      ) : error ? (
        <EmptyState title="Could not load your reports" description={error} icon={<FileWarning className="h-5 w-5" />} action={<Button variant="lime" onClick={load}>Retry</Button>} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={term || status ? 'Nothing matches this filter' : 'You have not flagged a problem yet'}
          description={
            term || status
              ? 'Clear the search or stage filter to see everything you submitted.'
              : 'Use the report form to flag air, water, waste or industrial problems. They appear here with their reference so you can follow the authority response.'
          }
          icon={<ShieldCheck className="h-5 w-5" />}
          action={term || status ? undefined : <Link to="/report"><Button variant="lime">Flag a problem</Button></Link>}
        />
      ) : (
        <div className="space-y-3">
          {visible.map((report) => (
            <Tracker key={report.id} report={report} />
          ))}
        </div>
      )}

      {total > 20 ? (
        <div className="flex items-center justify-between rounded-xl border border-[#dfe6db] bg-[#ffffff] px-4 py-2 text-[10px] text-[#6f7f74]">
          <span>{total} reports · page {page}</span>
          <div className="flex gap-2">
            <Button variant="dark" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="dark" size="sm" disabled={page * 20 >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      ) : null}

      <div className="flex items-start gap-2 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3 text-[10px] leading-relaxed text-[#6f7f74]">
        <Camera className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          Photos stay private. Officers see them only through the authorised evidence route, and every access is written
          to the governance ledger. Categories: {Object.values(CATEGORY_LABELS).join(', ')}.
        </p>
      </div>
    </div>
  );
}
