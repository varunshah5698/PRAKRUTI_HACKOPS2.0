import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { MumbaiMap, type MapStation } from '../../components/MumbaiMap';
import { RiskBadge } from '../../components/Status';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel, EmptyState, LoadingBlock, Select, Textarea } from '../../components/ui';
import { api } from '../../lib/api';
import { CATEGORY_LABELS, categoryLabel, formatDate, number, timeAgo } from '../../lib/format';
import { useAuth } from '../../store/auth';

interface IncidentRow {
  id: string; public_ref: string; category: string; title: string; description: string; status: string;
  risk_level: string; detected_at: string; created_at: string; updated_at: string; is_simulated: boolean;
  locality_name: string | null; lat: number; lng: number; assigned_to_name: string | null; assigned_to: string | null;
  note_count: number; action_count: number; has_determination: boolean;
}

const STATUS_FLOW = ['NEW', 'UNDER_REVIEW', 'ASSIGNED', 'INVESTIGATION', 'CORRECTIVE_ACTION', 'MONITORING', 'RESOLVED', 'CLOSED'];

export function IncidentsPage() {
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    const query = new URLSearchParams({ pageSize: '60' });
    if (category) query.set('category', category);
    if (status) query.set('status', status);
    api.get<{ incidents: IncidentRow[] }>(`/incidents?${query.toString()}`)
      .then((result) => { setIncidents(result.incidents); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load incidents'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [category, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Badge tone="red" dot>Investigations</Badge><Badge tone="neutral">Audited lifecycle</Badge></div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">Incident & compliance centre</h2>
          <p className="mt-1 text-[11px] text-[#6f7f74]">A report does not automatically become a violation. Assign, investigate, record corrective action and close with authorised approval.</p>
        </div>
        <Link to="/map"><Button variant="dark" size="sm">Map <ArrowUpRight className="h-3.5 w-3.5" /></Button></Link>
      </div>

      <div className="grid gap-2 rounded-2xl border border-[#dfe6db] bg-[#ffffff] p-3 sm:grid-cols-2">
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 text-[11px]">
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 text-[11px]">
          <option value="">All statuses</option>
          {STATUS_FLOW.map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
        </Select>
      </div>

      {loading ? <LoadingBlock label="Loading incidents" /> : error ? (
        <EmptyState title="Incidents unavailable" description={error} icon={<AlertTriangle className="h-5 w-5" />} action={<Button variant="lime" onClick={load}>Retry</Button>} />
      ) : incidents.length === 0 ? (
        <EmptyState title="No incidents match this view" description="Clear filters or create an incident from a verified report or alert." icon={<ShieldAlert className="h-5 w-5" />} />
      ) : (
        <div className="space-y-2">
          {incidents.map((incident) => (
            <Link key={incident.id} to={`/incidents/${incident.id}`} className="group block rounded-2xl border border-[#dfe6db] bg-[#ffffff] p-4 transition hover:border-[#5b9e46]/35">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <RiskBadge level={incident.risk_level} />
                    <Badge tone="neutral">{categoryLabel(incident.category)}</Badge>
                    <Badge tone={incident.status === 'CLOSED' || incident.status === 'RESOLVED' ? 'green' : 'amber'}>{incident.status.replace(/_/g, ' ')}</Badge>
                    {incident.has_determination ? <Badge tone="teal">Official determination recorded</Badge> : null}
                    {incident.is_simulated ? <Badge tone="amber">Simulation</Badge> : null}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-[#1b2a1f]">{incident.title}</p>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[#5a6a5f]">{incident.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px] text-[#66766b]">
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {incident.locality_name ?? 'Mumbai'}</span>
                    <span>{incident.assigned_to_name ? `Assigned: ${incident.assigned_to_name}` : 'Unassigned'}</span>
                    <span>{incident.note_count} notes · {incident.action_count} actions</span>
                    <span>{timeAgo(incident.detected_at)}</span>
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-[#66766b] group-hover:text-[#3f7d2a]" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

interface IncidentDetail {
  incident: IncidentRow & {
    description: string; assigned_to_name: string | null; assigned_to_email: string | null; created_by_name: string | null;
    source_alert_ref: string | null; source_alert_title: string | null; source_report_ref: string | null;
    official_determination: string | null; official_determination_at: string | null; determination_by_name: string | null;
    locality_id: string | null;
  };
  notes: Array<{ id: string; note: string; created_at: string; is_simulated: boolean; author_name: string | null; author_role: string | null }>;
  correctiveActions: Array<{ id: string; description: string; status: string; due_at: string | null; created_at: string; completed_at: string | null; evidence_note: string | null; created_by_name: string | null }>;
  assignments: Array<{ id: string; assigned_at: string; note: string | null; assigned_to_name: string | null; assigned_by_name: string | null }>;
  relatedReports: Array<{ id: string; public_ref: string; category: string; incident_type: string; status: string; verification_state: string; submitted_at: string; is_simulated: boolean }>;
  relatedAlerts: Array<{ id: string; public_ref: string; level: string; state: string; trigger_type: string; title: string; summary: string; triggered_at: string; is_simulated: boolean }>;
  audit: Array<{ actor_id: string | null; action: string; before: unknown; after: unknown; created_at: string }>;
  notifications: Array<{ id: string; audience: string; template: string; status: string; created_at: string; is_simulated: boolean }>;
  nearbyReadings: Array<{ id: string; name: string; code: string; station_type: string; is_simulated: boolean; distance_m: number; latest_readings: Record<string, { value: number; unit: string; observedAt: string; sourceId: string; isSimulated: boolean }> | null }>;
  standards: Array<{ id: string; parameter: string; parameter_code: string | null; operator: string; threshold_value: number | null; threshold_max: number | null; unit: string; averaging_period: string; applicability: string; section_ref: string; notes: string; document_title: string; authority: string; url: string | null; verification_status: string }>;
  lifecycle: Record<string, string[]>;
}

export function IncidentDetailPage() {
  const { incidentId } = useParams();
  const [data, setData] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [action, setAction] = useState('');
  const [authorityUsers, setAuthorityUsers] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [assignee, setAssignee] = useState('');
  const [determination, setDetermination] = useState('');
  const [basis, setBasis] = useState('');
  const [working, setWorking] = useState(false);
  const { can } = useAuth();

  const load = () => {
    if (!incidentId) return;
    setLoading(true);
    api.get<IncidentDetail>(`/incidents/${incidentId}`)
      .then((result) => { setData(result); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load incident'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    if (can(['AUTHORITY_ADMIN', 'SYSTEM_ADMIN'])) {
      api.get<{ users: Array<{ id: string; name: string; role: string }> }>('/auth/authority-users').then((res) => setAuthorityUsers(res.users)).catch(() => undefined);
    }
  }, [incidentId]);

  const addNote = async () => {
    if (!data || note.trim().length < 3) return;
    setWorking(true);
    try {
      await api.post(`/incidents/${data.incident.id}/notes`, { note });
      setNote('');
      toast.success('Investigation note added.');
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not add note'); }
    finally { setWorking(false); }
  };

  const addAction = async () => {
    if (!data || action.trim().length < 5) return;
    setWorking(true);
    try {
      await api.post(`/incidents/${data.incident.id}/actions`, { description: action });
      setAction('');
      toast.success('Corrective action recorded.');
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not add action'); }
    finally { setWorking(false); }
  };

  const assign = async () => {
    if (!data || !assignee) return;
    setWorking(true);
    try {
      await api.post(`/incidents/${data.incident.id}/assign`, { userId: assignee });
      toast.success('Incident assigned.');
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Assignment failed'); }
    finally { setWorking(false); }
  };

  const transition = async (target: string) => {
    if (!data) return;
    const reason = window.prompt(`Reason for moving to ${target.replace(/_/g, ' ')}:`);
    if (!reason || reason.trim().length < 5) return;
    setWorking(true);
    try {
      await api.patch(`/incidents/${data.incident.id}/status`, { status: target, reason });
      toast.success(`Incident moved to ${target.replace(/_/g, ' ')}.`);
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Transition failed'); }
    finally { setWorking(false); }
  };

  const updateAction = async (actionId: string, status: string) => {
    if (!data) return;
    setWorking(true);
    try {
      await api.patch(`/incidents/${data.incident.id}/actions/${actionId}`, { status });
      toast.success('Corrective action updated.');
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Update failed'); }
    finally { setWorking(false); }
  };

  const recordDetermination = async () => {
    if (!data || determination.trim().length < 10 || basis.trim().length < 5) return;
    setWorking(true);
    try {
      await api.post(`/incidents/${data.incident.id}/determination`, { determination, basis });
      setDetermination('');
      setBasis('');
      toast.success('Official determination recorded.');
      load();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Determination failed'); }
    finally { setWorking(false); }
  };

  if (loading) return <LoadingBlock className="min-h-[60vh]" label="Loading incident workspace" />;
  if (error || !data) return <EmptyState title="Incident unavailable" description={error ?? 'Incident not found.'} icon={<AlertTriangle className="h-5 w-5" />} action={<Button variant="lime" onClick={load}>Retry</Button>} />;

  const marker: MapStation[] = [{ id: data.incident.id, name: data.incident.title, locality: data.incident.locality_name, lat: data.incident.lat, lng: data.incident.lng, color: '#c94a50', valueLabel: data.incident.public_ref, markerKind: 'OBSERVED', isSimulated: data.incident.is_simulated }];
  const nextStatuses = (data.lifecycle[data.incident.status] ?? []).filter((status) => status !== 'CLOSED' || can(['AUTHORITY_ADMIN', 'SYSTEM_ADMIN']));
  const currentIndex = STATUS_FLOW.indexOf(data.incident.status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{data.incident.public_ref}</Badge>
            <RiskBadge level={data.incident.risk_level} />
            <Badge tone={data.incident.status === 'CLOSED' || data.incident.status === 'RESOLVED' ? 'green' : 'amber'}>{data.incident.status.replace(/_/g, ' ')}</Badge>
            {data.incident.is_simulated ? <Badge tone="amber">Simulation data</Badge> : null}
            {data.incident.official_determination ? <Badge tone="teal">Official determination recorded</Badge> : null}
          </div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">{data.incident.title}</h2>
          <p className="mt-1 text-[11px] text-[#6f7f74]">{categoryLabel(data.incident.category)} · {data.incident.locality_name ?? 'Mumbai'} · detected {formatDate(data.incident.detected_at)}</p>
        </div>
        <Link to="/incidents"><Button variant="dark" size="sm"><ArrowLeft className="h-3.5 w-3.5" /> All incidents</Button></Link>
      </div>

      <Card>
        <div className="scrollbar-thin overflow-x-auto p-4">
          <div className="flex min-w-[760px] items-center gap-1">
            {STATUS_FLOW.map((status, index) => (
              <div key={status} className="flex flex-1 items-center gap-1">
                <div className={`flex-1 rounded-lg border px-2 py-2 text-center text-[9px] font-semibold uppercase tracking-[0.06em] ${index <= currentIndex ? 'border-[#5b9e46]/30 bg-[#5b9e46]/10 text-[#3f7d2a]' : 'border-[#dfe6db] bg-[#f5f8f2] text-[#66766b]'}`}>
                  {status.replace(/_/g, ' ')}
                </div>
                {index < STATUS_FLOW.length - 1 ? <ArrowRight className={`h-3 w-3 shrink-0 ${index < currentIndex ? 'text-[#3f7d2a]' : 'text-[#dfe6db]'}`} /> : null}
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Incident overview</CardTitle><Badge tone="neutral">Source and reason preserved</Badge></CardHeader>
            <div className="p-4">
              <p className="text-[12px] leading-relaxed text-[#405246]">{data.incident.description}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3"><DataLabel>Assigned</DataLabel><p className="mt-1 text-[11px] font-medium">{data.incident.assigned_to_name ?? 'Unassigned'}</p></div>
                <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3"><DataLabel>Source alert</DataLabel><p className="mt-1 text-[11px] font-medium">{data.incident.source_alert_ref ?? 'None'}</p></div>
                <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3"><DataLabel>Source report</DataLabel><p className="mt-1 text-[11px] font-medium">{data.incident.source_report_ref ?? 'None'}</p></div>
              </div>
              {data.incident.official_determination ? (
                <div className="mt-4 rounded-xl border border-teal-500/25 bg-teal-500/[0.05] p-4">
                  <div className="flex items-center gap-2 text-[#217a70]"><ShieldCheck className="h-4 w-4" /><p className="text-[10px] font-semibold uppercase tracking-[0.1em]">Official determination</p></div>
                  <p className="mt-2 text-[11px] leading-relaxed text-[#405246]">{data.incident.official_determination}</p>
                  <p className="mt-1 text-[9px] text-[#66766b]">{data.incident.determination_by_name} · {formatDate(data.incident.official_determination_at)}</p>
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>Evidence & related records</CardTitle><FileSearch className="h-4 w-4 text-[#6f7f74]" /></CardHeader>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3">
                <DataLabel>Related reports</DataLabel>
                <div className="mt-2 space-y-2">
                  {data.relatedReports.map((report) => (
                    <Link key={report.id} to={`/reports/${report.id}`} className="block text-[10px] text-[#5a6a5f] hover:text-[#142016]">
                      <span className="font-medium text-[#26362a]">{report.public_ref}</span> · {report.incident_type.replace(/_/g, ' ')} · {report.verification_state}
                    </Link>
                  ))}
                  {data.relatedReports.length === 0 ? <p className="text-[10px] text-[#66766b]">No related reports.</p> : null}
                </div>
              </div>
              <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3">
                <DataLabel>Related alerts</DataLabel>
                <div className="mt-2 space-y-2">
                  {data.relatedAlerts.map((alert) => (
                    <Link key={alert.id} to={`/alerts/${alert.id}`} className="block text-[10px] text-[#5a6a5f] hover:text-[#142016]">
                      <span className="font-medium text-[#26362a]">{alert.public_ref}</span> · {alert.level} · {alert.title}
                    </Link>
                  ))}
                  {data.relatedAlerts.length === 0 ? <p className="text-[10px] text-[#66766b]">No related alerts.</p> : null}
                </div>
              </div>
              <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3 sm:col-span-2">
                <DataLabel>Nearby readings</DataLabel>
                <div className="mt-2 space-y-2">
                  {data.nearbyReadings.map((station) => (
                    <div key={station.id} className="text-[10px] text-[#5a6a5f]">
                      <p className="font-medium text-[#26362a]">{station.name.replace(' demo air monitor', '')} · {Math.round(station.distance_m)} m</p>
                      {station.latest_readings ? <p className="mt-0.5 text-[9px] text-[#66766b]">{Object.entries(station.latest_readings).slice(0, 4).map(([code, value]) => `${code.toUpperCase()} ${number(value.value)} ${value.unit}`).join(' · ')}</p> : null}
                    </div>
                  ))}
                  {data.nearbyReadings.length === 0 ? <p className="text-[10px] text-[#66766b]">No nearby monitoring stations.</p> : null}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>Investigation notes</CardTitle><Badge tone="neutral">{data.notes.length}</Badge></CardHeader>
            <div className="divide-y divide-[#e7ece3]">
              {data.notes.map((entry) => (
                <div key={entry.id} className="p-4">
                  <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-semibold text-[#26362a]">{entry.author_name ?? 'System'} <span className="font-normal text-[#66766b]">· {entry.author_role?.replace(/_/g, ' ') ?? ''}</span></p><span className="text-[8px] text-[#66766b]">{formatDate(entry.created_at)}</span></div>
                  <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-[#5a6a5f]">{entry.note}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-[#e7ece3] p-3">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Record an evidence-based investigation note…" />
              <Button variant="dark" size="sm" className="mt-2" onClick={addNote} disabled={working || note.trim().length < 3}>Add note</Button>
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>Corrective actions</CardTitle><Badge tone="neutral">{data.correctiveActions.length}</Badge></CardHeader>
            <div className="divide-y divide-[#e7ece3]">
              {data.correctiveActions.map((action) => (
                <div key={action.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={action.status === 'COMPLETED' || action.status === 'VERIFIED' ? 'green' : action.status === 'CANCELLED' ? 'red' : 'amber'}>{action.status.replace(/_/g, ' ')}</Badge>
                    <span className="text-[8px] text-[#66766b]">Due {action.due_at ? formatDate(action.due_at) : '—'}</span>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-[#405246]">{action.description}</p>
                  {action.evidence_note ? <p className="mt-1 text-[9px] text-[#6f7f74]">{action.evidence_note}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {['IN_PROGRESS', 'COMPLETED', 'VERIFIED'].filter((status) => status !== action.status).map((status) => (
                      <Button key={status} variant="dark" size="sm" onClick={() => updateAction(action.id, status)} disabled={working}>{status.replace(/_/g, ' ')}</Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-[#e7ece3] p-3">
              <Textarea value={action} onChange={(e) => setAction(e.target.value)} rows={2} placeholder="Recommend a field inspection, repeat sampling, station calibration or follow-up monitoring…" />
              <Button variant="dark" size="sm" className="mt-2" onClick={addAction} disabled={working || action.trim().length < 5}>Add corrective action</Button>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>Incident location</CardTitle><Badge tone="neutral">Mumbai</Badge></CardHeader>
            <MumbaiMap stations={marker} className="h-[240px] w-full" compact theme="light" initialZoom={13.2} initialPitch={20} overlayLabel="Incident location" autoFit={false} />
            <p className="p-3 text-[9px] text-[#66766b]">{data.incident.lat.toFixed(5)}, {data.incident.lng.toFixed(5)} · validated inside Greater Mumbai</p>
          </Card>

          {can(['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN', 'SYSTEM_ADMIN']) ? (
            <Card>
              <CardHeader><CardTitle>Workflow actions</CardTitle><ClipboardCheck className="h-4 w-4 text-[#3f7d2a]" /></CardHeader>
              <div className="space-y-3 p-4">
                {nextStatuses.length ? (
                  <>
                    <p className="text-[10px] leading-relaxed text-[#5a6a5f]">Next permitted transitions. A reason is required and recorded in the audit trail.</p>
                    <div className="flex flex-wrap gap-1.5">
                      {nextStatuses.map((status) => (
                        <Button key={status} variant={status === 'CLOSED' ? 'danger' : 'dark'} size="sm" onClick={() => transition(status)} disabled={working}>
                          {status === 'CLOSED' ? <ShieldCheck className="h-3.5 w-3.5" /> : null} {status.replace(/_/g, ' ')}
                        </Button>
                      ))}
                    </div>
                  </>
                ) : <p className="text-[10px] text-[#66766b]">No further transitions. This incident is closed.</p>}
                {can(['AUTHORITY_ADMIN', 'SYSTEM_ADMIN']) ? (
                  <div className="border-t border-[#e7ece3] pt-3">
                    <DataLabel>Assign investigator</DataLabel>
                    <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="mt-1 h-9 text-[11px]">
                      <option value="">Select authority user</option>
                      {authorityUsers.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role.replace(/_/g, ' ')}</option>)}
                    </Select>
                    <Button variant="dark" size="sm" className="mt-2 w-full" onClick={assign} disabled={!assignee || working}><UserCheck className="h-3.5 w-3.5" /> Assign</Button>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}

          {can(['AUTHORITY_ADMIN', 'SYSTEM_ADMIN']) ? (
            <Card>
              <CardHeader><CardTitle>Official determination</CardTitle><Badge tone="neutral">Authorised only</Badge></CardHeader>
              <div className="space-y-2 p-4">
                <p className="text-[9px] leading-relaxed text-[#6f7f74]">Record the official determination only after reviewing evidence, standards and averaging periods. This is separate from automated risk scores.</p>
                <Textarea value={determination} onChange={(e) => setDetermination(e.target.value)} rows={3} placeholder="Official determination…" />
                <Textarea value={basis} onChange={(e) => setBasis(e.target.value)} rows={2} placeholder="Basis and evidence references…" />
                <Button variant="lime" size="sm" className="w-full" onClick={recordDetermination} disabled={working || determination.trim().length < 10 || basis.trim().length < 5}><ShieldCheck className="h-3.5 w-3.5" /> Record determination</Button>
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader><CardTitle>Regulatory references</CardTitle><Badge tone="neutral">{data.standards.length}</Badge></CardHeader>
            <div className="divide-y divide-[#e7ece3]">
              {data.standards.slice(0, 8).map((standard) => (
                <div key={standard.id} className="p-3 text-[9px] leading-relaxed text-[#5a6a5f]">
                  <p className="font-semibold text-[#26362a]">{standard.parameter} {standard.operator} {standard.threshold_value ?? ''}{standard.threshold_max ? `–${standard.threshold_max}` : ''} {standard.unit}</p>
                  <p className="mt-0.5">{standard.document_title} · {standard.section_ref}</p>
                  <p className="mt-0.5 text-[#66766b]">{standard.averaging_period} · {standard.verification_status}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>Audit history</CardTitle><Badge tone="neutral">{data.audit.length}</Badge></CardHeader>
            <div className="scrollbar-thin max-h-[300px] overflow-auto p-3">
              {data.audit.map((event, index) => (
                <div key={index} className="border-b border-[#e7ece3] py-2 text-[9px] leading-relaxed text-[#6f7f74] last:border-0">
                  <p className="font-semibold uppercase tracking-[0.06em] text-[#3f7d2a]">{event.action.replace(/_/g, ' ')}</p>
                  <p>{formatDate(event.created_at)}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
