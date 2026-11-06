import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock,
  FileSearch,
  MapPin,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, CardTitle, EmptyState, Input, LoadingBlock, Select, Textarea } from '../../components/ui';
import { RiskBadge } from '../../components/Status';
import { api } from '../../lib/api';
import { categoryLabel, formatDate, timeAgo } from '../../lib/format';
import { useAuth } from '../../store/auth';

interface Membership {
  id: string;
  authority_id: string;
  authority_name: string;
  level: string;
  membership_role: 'VIEWER' | 'OFFICER' | 'ADMIN';
  status: string;
}

interface AuthorityEventRow {
  id: string;
  event_id: string;
  authority_id: string;
  authority_name: string;
  authority_status: string;
  title: string;
  category: string;
  severity: string;
  event_status: string;
  detected_at: string;
  admin_area: string | null;
  assigned_at: string;
  notified_at: string | null;
  acknowledgement_due_at: string | null;
  resolution_due_at: string | null;
  acknowledgement_overdue: boolean;
  resolution_overdue: boolean;
  action_count: number;
  last_action_at: string | null;
  evidence_count: number;
  latitude: number | null;
  longitude: number | null;
}

interface AuthorityAction {
  id: string;
  action_type: string;
  previous_status: string;
  new_status: string;
  channel: string | null;
  delivery_reference: string | null;
  response: string | null;
  evidence_ids: string[];
  notes: string | null;
  created_at: string;
}

interface AuthorityNotification {
  id: string;
  subject: string;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  error: string | null;
  is_simulated: boolean;
  created_at: string;
  recipient_masked: string;
}

interface EvidenceRow {
  id: string;
  evidence_type: string;
  source_name: string | null;
  source_url: string | null;
  title: string | null;
  observed_at: string | null;
  published_at: string | null;
  verification_status: string;
  reliability_class: string;
  freshness_status: string;
}

interface AuthorityDetail {
  event: {
    id: string;
    title: string;
    description: string | null;
    category: string;
    severity: string;
    status: string;
    admin_area: string | null;
    detected_at: string;
    evidence_count: number;
  };
  authority: {
    id: string;
    status: string;
    assigned_at: string;
    notified_at: string | null;
    acknowledgement_due_at: string | null;
    resolution_due_at: string | null;
    acknowledgement_overdue: boolean;
    resolution_overdue: boolean;
    authority_name: string;
    official_url: string | null;
  };
  actions: AuthorityAction[];
  evidence: EvidenceRow[];
  notifications: AuthorityNotification[];
}

const STATUSES = [
  'READY_FOR_REVIEW',
  'AUTHORITY_NOTIFIED',
  'ACKNOWLEDGED',
  'VERIFIED',
  'ACTION_INITIATED',
  'RESOLVED',
  'CLOSED',
  'REJECTED',
  'NOTIFICATION_FAILED',
  'AWAITING_ACKNOWLEDGEMENT',
  'UNDER_INVESTIGATION',
  'ESCALATED',
  'UNRESOLVED',
];

const NEXT_ACTIONS: Record<string, string[]> = {
  READY_FOR_REVIEW: ['NOTIFICATION_SENT', 'REJECT'],
  AUTHORITY_NOTIFIED: ['ACKNOWLEDGE', 'NOTIFICATION_FAILED', 'REJECT'],
  ACKNOWLEDGED: ['VERIFY', 'ESCALATE', 'REJECT'],
  VERIFIED: ['START_ACTION', 'RESOLVE', 'ESCALATE', 'REJECT'],
  ACTION_INITIATED: ['RESOLVE', 'MARK_UNRESOLVED', 'ESCALATE'],
  UNRESOLVED: ['START_ACTION', 'CLOSE'],
  ESCALATED: ['ACKNOWLEDGE', 'CLOSE'],
  NOTIFICATION_FAILED: ['NOTIFICATION_SENT', 'REJECT'],
  AWAITING_ACKNOWLEDGEMENT: ['ACKNOWLEDGE', 'NOTIFICATION_FAILED', 'ESCALATE'],
  UNDER_INVESTIGATION: ['VERIFY', 'ESCALATE', 'REJECT'],
  RESOLVED: ['CLOSE'],
  CLOSED: ['NOTE'],
  REJECTED: ['NOTE'],
};

const ACTION_LABEL: Record<string, string> = {
  NOTIFICATION_SENT: 'Log manual notification',
  NOTIFICATION_FAILED: 'Record notification failure',
  ACKNOWLEDGE: 'Acknowledge',
  VERIFY: 'Verify',
  START_ACTION: 'Start action',
  RESOLVE: 'Resolve',
  CLOSE: 'Close',
  REJECT: 'Reject',
  ESCALATE: 'Escalate',
  MARK_UNRESOLVED: 'Mark unresolved',
  NOTE: 'Add note',
};

function statusTone(status: string): 'neutral' | 'green' | 'amber' | 'red' | 'teal' | 'lime' {
  if (['RESOLVED', 'CLOSED', 'VERIFIED'].includes(status)) return 'green';
  if (['REJECTED', 'NOTIFICATION_FAILED'].includes(status)) return 'red';
  if (['ACKNOWLEDGED', 'ACTION_INITIATED'].includes(status)) return 'teal';
  if (['AUTHORITY_NOTIFIED', 'AWAITING_ACKNOWLEDGEMENT'].includes(status)) return 'amber';
  if (status === 'ESCALATED') return 'red';
  return 'neutral';
}

function dueText(value: string | null): string {
  return value ? formatDate(value) : 'Not set';
}

export function AuthorityPage() {
  const { user } = useAuth();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [authorityId, setAuthorityId] = useState('');
  const [events, setEvents] = useState<AuthorityEventRow[]>([]);
  const [status, setStatus] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<AuthorityEventRow | null>(null);
  const [detail, setDetail] = useState<AuthorityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionType, setActionType] = useState('');
  const [response, setResponse] = useState('');
  const [channel, setChannel] = useState('PHONE_CALL');
  const [deliveryReference, setDeliveryReference] = useState('');
  const [evidenceIds, setEvidenceIds] = useState('');
  const [working, setWorking] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const membership = useMemo(
    () => memberships.find((item) => item.authority_id === authorityId) ?? null,
    [memberships, authorityId],
  );

  useEffect(() => {
    api
      .get<{ memberships: Membership[] }>('/authority/me')
      .then((result) => {
        setMemberships(result.memberships);
        if (result.memberships[0]) setAuthorityId(result.memberships[0].authority_id);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load authority memberships'))
      .finally(() => setLoading(false));
  }, []);

  const loadEvents = () => {
    if (!authorityId) return;
    api
      .get<{ events: AuthorityEventRow[] }>(`/authority/events${status ? `?status=${status}` : ''}`)
      .then((result) => {
        const rows = result.events.filter((row) => row.authority_id === authorityId);
        setEvents(rows);
        setSelectedEvent((current) => rows.find((row) => row.event_id === current?.event_id) ?? rows[0] ?? null);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load assigned events'));
  };

  useEffect(loadEvents, [authorityId, status]);

  useEffect(() => {
    if (!selectedEvent) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    api
      .get<AuthorityDetail>(`/authority/events/${selectedEvent.event_id}?authorityId=${selectedEvent.authority_id}`)
      .then((result) => {
        setDetail(result);
        const next = NEXT_ACTIONS[result.authority.status] ?? [];
        setActionType(next[0] ?? 'NOTE');
        setResponse('');
        setChannel('PHONE_CALL');
        setDeliveryReference('');
        setEvidenceIds('');
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not load event detail'))
      .finally(() => setDetailLoading(false));
  }, [selectedEvent?.event_id, selectedEvent?.authority_id, refreshKey]);

  const submitAction = async () => {
    if (!detail || !authorityId || !actionType) return;
    if (membership?.membership_role === 'VIEWER') {
      toast.error('Viewer membership is read-only.');
      return;
    }
    setWorking(true);
    try {
      await api.post(`/authority/events/${detail.event.id}/actions`, {
        authorityId,
        actionType,
        channel: actionType === 'NOTIFICATION_SENT' ? channel : null,
        deliveryReference: actionType === 'NOTIFICATION_SENT' ? deliveryReference : null,
        response: response.trim() || null,
        notes: null,
        evidenceIds: evidenceIds
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      });
      toast.success(`${ACTION_LABEL[actionType] ?? actionType} recorded.`);
      loadEvents();
      const refreshed = await api.get<AuthorityDetail>(
        `/authority/events/${detail.event.id}?authorityId=${authorityId}`,
      );
      setDetail(refreshed);
      setResponse('');
      setDeliveryReference('');
      setEvidenceIds('');
      const next = NEXT_ACTIONS[refreshed.authority.status] ?? [];
      setActionType(next[0] ?? 'NOTE');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <LoadingBlock className="min-h-[60vh]" label="Loading authority desk" />;
  if (error && memberships.length === 0) {
    return (
      <EmptyState
        title="Authority membership required"
        description={error}
        icon={<ShieldCheck className="h-5 w-5" />}
        action={<Button variant="lime" onClick={() => window.location.reload()}>Retry</Button>}
      />
    );
  }
  if (memberships.length === 0) {
    return (
      <EmptyState
        title="No active authority membership"
        description="A system administrator must approve an authority membership before this desk can show assigned events."
        icon={<ShieldCheck className="h-5 w-5" />}
      />
    );
  }

  const canWrite = membership?.membership_role !== 'VIEWER';
  const allowedActions = detail ? NEXT_ACTIONS[detail.authority.status] ?? [] : [];
  const requiresReason = [
    'REJECT',
    'ESCALATE',
    'MARK_UNRESOLVED',
    'VERIFY',
    'START_ACTION',
    'RESOLVE',
    'CLOSE',
    'NOTIFICATION_FAILED',
  ].includes(actionType);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="teal" dot>Authority desk</Badge>
            <Badge tone="neutral">Per-authority lifecycle</Badge>
            {membership ? <Badge tone={membership.membership_role === 'VIEWER' ? 'amber' : 'green'}>{membership.membership_role}</Badge> : null}
          </div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">Assigned events & response trail</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[#6f7f74]">
            Review linked evidence, acknowledge, verify, record action and close. Every decision is written to an append-only audit trail.
            This desk does not create official warnings or determinations.
          </p>
        </div>
        <Button variant="dark" size="sm" onClick={() => { loadEvents(); setRefreshKey((value) => value + 1); }}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {error ? (
        <div className="rounded-xl border border-[#f0cdce] bg-[#fdeeee] px-3 py-2 text-[10px] text-[#a83c41]">{error}</div>
      ) : null}

      <div className="grid gap-2 rounded-2xl border border-[#dfe6db] bg-white p-3 sm:grid-cols-[1fr_220px]">
        <Select value={authorityId} onChange={(event) => setAuthorityId(event.target.value)} className="h-9 text-[11px]">
          {memberships.map((item) => (
            <option key={item.authority_id} value={item.authority_id}>{item.authority_name}</option>
          ))}
        </Select>
        <Select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 text-[11px]">
          <option value="">All authority statuses</option>
          {STATUSES.map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
        </Select>
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Assigned events</CardTitle>
            <Badge tone="neutral">{events.length}</Badge>
          </CardHeader>
          {events.length === 0 ? (
            <EmptyState
              title="No assigned events"
              description="Events assigned to this authority by a system administrator will appear here."
              icon={<FileSearch className="h-5 w-5" />}
            />
          ) : (
            <div className="max-h-[72vh] divide-y divide-[#e7ece3] overflow-y-auto">
              {events.map((row) => {
                const active = selectedEvent?.event_id === row.event_id;
                return (
                  <button
                    key={`${row.event_id}-${row.authority_id}`}
                    onClick={() => setSelectedEvent(row)}
                    className={`block w-full p-4 text-left transition ${active ? 'bg-[#eef8e6]' : 'hover:bg-[#f7faf4]'}`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <RiskBadge level={row.severity} />
                      <Badge tone={statusTone(row.authority_status)}>{row.authority_status.replace(/_/g, ' ')}</Badge>
                      {row.acknowledgement_overdue ? <Badge tone="red">Ack overdue</Badge> : null}
                      {row.resolution_overdue ? <Badge tone="red">Resolution overdue</Badge> : null}
                    </div>
                    <p className="mt-2 text-[12px] font-semibold text-[#1b2a1f]">{row.title}</p>
                    <p className="mt-1 text-[9px] text-[#66766b]">
                      {categoryLabel(row.category)} · {row.evidence_count} evidence · {row.action_count} actions · {timeAgo(row.detected_at)}
                    </p>
                    <p className="mt-1 inline-flex items-center gap-1 text-[9px] text-[#66766b]">
                      <MapPin className="h-3 w-3" /> {row.admin_area ?? 'Location not labelled'}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          {detailLoading ? (
            <LoadingBlock className="min-h-[40vh]" label="Loading event workspace" />
          ) : !detail ? (
            <EmptyState
              title="Select an assigned event"
              description="The event workspace will show linked evidence, the authority status and the immutable action trail."
              icon={<ShieldCheck className="h-5 w-5" />}
            />
          ) : (
            <>
              <Card>
                <CardHeader>
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <RiskBadge level={detail.event.severity} />
                      <Badge tone={statusTone(detail.authority.status)}>{detail.authority.status.replace(/_/g, ' ')}</Badge>
                      {detail.authority.acknowledgement_overdue ? <Badge tone="red" dot>Acknowledgement overdue</Badge> : null}
                      {detail.authority.resolution_overdue ? <Badge tone="red" dot>Resolution overdue</Badge> : null}
                    </div>
                    <CardTitle className="mt-2 text-[18px]">{detail.event.title}</CardTitle>
                    <p className="mt-1 text-[10px] text-[#6f7f74]">
                      {detail.authority.authority_name} · {categoryLabel(detail.event.category)} · detected {formatDate(detail.event.detected_at)}
                    </p>
                  </div>
                  {detail.authority.official_url ? (
                    <a href={detail.authority.official_url} target="_blank" rel="noreferrer" className="text-[10px] font-semibold text-[#2f6a24] underline">
                      Official site
                    </a>
                  ) : null}
                </CardHeader>
                <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-[#e3eadd] bg-white/60 p-3">
                    <p className="text-[9px] uppercase tracking-[0.12em] text-[#74847a]">Assigned</p>
                    <p className="mt-1 text-[11px] font-semibold">{formatDate(detail.authority.assigned_at)}</p>
                  </div>
                  <div className="rounded-xl border border-[#e3eadd] bg-white/60 p-3">
                    <p className="text-[9px] uppercase tracking-[0.12em] text-[#74847a]">Ack due</p>
                    <p className={`mt-1 text-[11px] font-semibold ${detail.authority.acknowledgement_overdue ? 'text-[#a83c41]' : ''}`}>
                      {dueText(detail.authority.acknowledgement_due_at)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#e3eadd] bg-white/60 p-3">
                    <p className="text-[9px] uppercase tracking-[0.12em] text-[#74847a]">Resolution due</p>
                    <p className={`mt-1 text-[11px] font-semibold ${detail.authority.resolution_overdue ? 'text-[#a83c41]' : ''}`}>
                      {dueText(detail.authority.resolution_due_at)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#e3eadd] bg-white/60 p-3">
                    <p className="text-[9px] uppercase tracking-[0.12em] text-[#74847a]">Linked evidence</p>
                    <p className="mt-1 text-[11px] font-semibold">{detail.evidence.length} record(s)</p>
                  </div>
                </div>
                {detail.event.description ? <p className="px-4 pb-4 text-[11px] leading-relaxed text-[#5a6a5f]">{detail.event.description}</p> : null}
              </Card>

              <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                <Card>
                  <CardHeader><CardTitle>Evidence</CardTitle><Badge tone="neutral">{detail.evidence.length}</Badge></CardHeader>
                  {detail.evidence.length === 0 ? (
                    <EmptyState title="No evidence linked" description="An event without evidence must not be verified or actioned as fact." icon={<AlertTriangle className="h-5 w-5" />} />
                  ) : (
                    <div className="divide-y divide-[#e7ece3]">
                      {detail.evidence.map((row) => (
                        <div key={row.id} className="p-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone="neutral">{row.evidence_type.replace(/_/g, ' ')}</Badge>
                            <Badge tone={row.verification_status === 'OFFICIAL_VERIFIED' ? 'green' : row.verification_status === 'DISPUTED' ? 'red' : 'amber'}>
                              {row.verification_status.replace(/_/g, ' ')}
                            </Badge>
                            <Badge tone="outline">{row.reliability_class.replace(/_/g, ' ')}</Badge>
                          </div>
                          <p className="mt-1.5 text-[11px] font-semibold text-[#26362a]">{row.title ?? 'Untitled evidence'}</p>
                          <p className="mt-1 text-[9px] text-[#66766b]">
                            {row.source_name ?? 'Source not named'} · {formatDate(row.observed_at ?? row.published_at)}
                          </p>
                          {row.source_url ? (
                            <a href={row.source_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[9px] font-semibold text-[#2f6a24] underline">
                              Open source
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card>
                  <CardHeader><CardTitle>Email dispatch</CardTitle><Badge tone="neutral">{detail.notifications.length}</Badge></CardHeader>
                  {detail.notifications.length === 0 ? (
                    <EmptyState title="No system email dispatch" description="A system administrator can dispatch an event email to active members. Manual notifications remain recordable." icon={<BellRing className="h-5 w-5" />} />
                  ) : (
                    <div className="divide-y divide-[#e7ece3]">
                      {detail.notifications.map((row) => (
                        <div key={row.id} className="p-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={row.status === 'SENT' || row.status === 'DELIVERED' ? 'green' : row.status === 'FAILED' ? 'red' : 'amber'}>
                              {row.status}
                            </Badge>
                            {row.is_simulated ? <Badge tone="amber">Simulated</Badge> : null}
                          </div>
                          <p className="mt-1.5 text-[11px] font-semibold text-[#26362a]">{row.subject}</p>
                          <p className="mt-1 text-[9px] text-[#66766b]">
                            {row.recipient_masked} · {timeAgo(row.created_at)} · {row.delivered_at ? `delivered ${formatDate(row.delivered_at)}` : row.sent_at ? `accepted ${formatDate(row.sent_at)}` : 'not sent'}
                          </p>
                          {row.error ? <p className="mt-1 text-[9px] text-[#a83c41]">{row.error}</p> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Record authority decision</CardTitle>
                  <Badge tone={canWrite ? 'green' : 'amber'}>{canWrite ? membership?.membership_role : 'VIEWER · read only'}</Badge>
                </CardHeader>
                {!canWrite ? (
                  <p className="p-4 text-[11px] text-[#5a6a5f]">Viewer membership can read this workspace but cannot record actions.</p>
                ) : allowedActions.length === 0 ? (
                  <p className="p-4 text-[11px] text-[#5a6a5f]">No further lifecycle action is available from {detail.authority.status.replace(/_/g, ' ')}.</p>
                ) : (
                  <div className="space-y-3 p-4">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-[#5d6e63]">Action</label>
                        <Select value={actionType} onChange={(event) => setActionType(event.target.value)} className="h-9 text-[11px]">
                          {allowedActions.map((value) => <option key={value} value={value}>{ACTION_LABEL[value] ?? value.replace(/_/g, ' ')}</option>)}
                        </Select>
                      </div>
                      {actionType === 'NOTIFICATION_SENT' ? (
                        <div>
                          <label className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-[#5d6e63]">Manual channel</label>
                          <Select value={channel} onChange={(event) => setChannel(event.target.value)} className="h-9 text-[11px]">
                            {['PHONE_CALL', 'EMAIL', 'SMS', 'IN_PERSON', 'RADIO', 'OTHER'].map((value) => (
                              <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>
                            ))}
                          </Select>
                        </div>
                      ) : null}
                    </div>
                    {actionType === 'NOTIFICATION_SENT' ? (
                      <div>
                        <label className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-[#5d6e63]">Delivery reference (required)</label>
                        <Input value={deliveryReference} onChange={(event) => setDeliveryReference(event.target.value)} placeholder="Call log, email message ID or register reference" className="h-9 text-[11px]" />
                        <p className="mt-1 text-[9px] text-[#8a6a1f]">This records a manual notification. It is not proof of delivery.</p>
                      </div>
                    ) : null}
                    <div>
                      <label className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-[#5d6e63]">
                        {requiresReason ? 'Reason (required)' : 'Response / note'}
                      </label>
                      <Textarea
                        value={response}
                        onChange={(event) => setResponse(event.target.value)}
                        rows={3}
                        placeholder={requiresReason ? 'Explain the decision for the audit trail.' : 'What was checked, decided or observed?'}
                        className="text-[11px]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-[#5d6e63]">Evidence IDs (optional, comma separated)</label>
                      <Input value={evidenceIds} onChange={(event) => setEvidenceIds(event.target.value)} placeholder="Evidence UUIDs already linked to this event" className="h-9 text-[11px]" />
                    </div>
                    <Button
                      variant="teal"
                      size="sm"
                      onClick={submitAction}
                      disabled={working || (actionType === 'NOTIFICATION_SENT' && deliveryReference.trim().length < 3) || (requiresReason && response.trim().length < 3)}
                    >
                      {working ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Record {ACTION_LABEL[actionType] ?? actionType}
                    </Button>
                  </div>
                )}
              </Card>

              <Card>
                <CardHeader><CardTitle>Immutable action trail</CardTitle><Badge tone="neutral">{detail.actions.length}</Badge></CardHeader>
                {detail.actions.length === 0 ? (
                  <EmptyState title="No authority actions yet" description="Acknowledge, verify and record action here. Records cannot be edited or deleted." icon={<Clock className="h-5 w-5" />} />
                ) : (
                  <div className="divide-y divide-[#e7ece3]">
                    {detail.actions.map((row) => (
                      <div key={row.id} className="flex gap-3 p-4">
                        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#e8f5f3] text-[#1f766d]">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone="teal">{row.action_type.replace(/_/g, ' ')}</Badge>
                            <span className="text-[9px] text-[#66766b]">{row.previous_status} → {row.new_status}</span>
                            <span className="text-[9px] text-[#66766b]">{formatDate(row.created_at)}</span>
                          </div>
                          {row.response ? <p className="mt-1 text-[11px] leading-relaxed text-[#26362a]">{row.response}</p> : null}
                          {row.notes ? <p className="mt-1 text-[10px] leading-relaxed text-[#5a6a5f]">{row.notes}</p> : null}
                          {row.channel || row.delivery_reference ? (
                            <p className="mt-1 text-[9px] text-[#66766b]">{row.channel ?? 'Manual'} · {row.delivery_reference ?? 'No reference'}</p>
                          ) : null}
                          {row.evidence_ids?.length ? <p className="mt-1 text-[9px] text-[#66766b]">Evidence: {row.evidence_ids.join(', ')}</p> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      <p className="text-[9px] leading-relaxed text-[#74847a]">
        Signed in as {user?.name} ({user?.role.replace(/_/g, ' ')}). Authority status is separate from the canonical event status.
        Evidence and action records are append-only; corrections must be recorded as new actions.
      </p>
    </div>
  );
}
