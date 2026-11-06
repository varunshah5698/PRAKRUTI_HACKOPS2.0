import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Database,
  ExternalLink,
  Mail,
  MapPinned,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  UserPlus,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, CardTitle, EmptyState, Input, LoadingBlock, Select, Textarea } from '../../components/ui';
import { api } from '../../lib/api';
import { categoryLabel, formatDate } from '../../lib/format';

interface AuthorityRow {
  id: string;
  code: string;
  name: string;
  abbreviation: string | null;
  level: string;
  official_url: string | null;
  official_contacts: Record<string, unknown>;
  coverage_country: string | null;
  coverage_state: string | null;
  coverage_district: string | null;
  coverage_city: string | null;
  jurisdiction_area: unknown;
  verification_status: string;
  verified_at: string | null;
  source_url: string | null;
  notes: string | null;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string | null;
}

interface MembershipRow {
  id: string;
  user_id: string;
  user_name: string;
  email: string;
  user_role: string;
  membership_role: string;
  status: string;
  verified_at: string | null;
  verification_source: string | null;
}

interface EventRow {
  id: string;
  event_key: string;
  category: string;
  title: string;
  severity: string;
  status: string;
  admin_area: string | null;
  detected_at: string;
}

interface AssignmentRow {
  id: string;
  event_id: string;
  authority_id: string;
  authority_name: string;
  authority_code: string;
  level: string;
  status: string;
  assigned_at: string;
  notified_at: string | null;
  acknowledgement_due_at: string | null;
  resolution_due_at: string | null;
  acknowledgement_overdue: boolean;
  resolution_overdue: boolean;
  action_count: number;
  evidence_count: number;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
}

interface AutoMapMatch {
  code: string;
  name: string;
  reason: string;
  specificity: number;
}

const EMPTY_FORM = {
  code: '',
  name: '',
  abbreviation: '',
  level: 'MUNICIPAL',
  officialUrl: '',
  sourceUrl: '',
  verificationStatus: 'PARTIALLY_VERIFIED',
  coverageState: '',
  coverageDistrict: '',
  coverageCity: '',
  contactEmail: '',
  contactPhone: '',
  emailVerified: false,
  phoneVerified: false,
  notes: '',
  jurisdictionArea: '',
};

type AuthorityForm = typeof EMPTY_FORM;

function statusTone(status: string): 'neutral' | 'green' | 'amber' | 'red' | 'teal' {
  if (['RESOLVED', 'CLOSED', 'VERIFIED'].includes(status)) return 'green';
  if (['REJECTED', 'NOTIFICATION_FAILED'].includes(status)) return 'red';
  if (['ACKNOWLEDGED', 'ACTION_INITIATED'].includes(status)) return 'teal';
  if (['AUTHORITY_NOTIFIED', 'AWAITING_ACKNOWLEDGEMENT'].includes(status)) return 'amber';
  return 'neutral';
}

export function AuthorityAdminPage() {
  const [authorities, setAuthorities] = useState<AuthorityRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<AuthorityForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState('');
  const [savingAuthority, setSavingAuthority] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [assignAuthorityId, setAssignAuthorityId] = useState('');
  const [autoMatches, setAutoMatches] = useState<AutoMapMatch[] | null>(null);
  const [includeWithdrawn, setIncludeWithdrawn] = useState(false);
  const [selectedAuthorityId, setSelectedAuthorityId] = useState('');
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [membershipUserId, setMembershipUserId] = useState('');
  const [membershipRole, setMembershipRole] = useState('OFFICER');
  const [membershipStatus, setMembershipStatus] = useState('ACTIVE');
  const [verificationSource, setVerificationSource] = useState('System administrator approval');
  const [working, setWorking] = useState(false);
  const [ingesting, setIngesting] = useState(false);

  const selectedAuthority = useMemo(
    () => authorities.find((item) => item.id === selectedAuthorityId) ?? null,
    [authorities, selectedAuthorityId],
  );
  const selectedEvent = useMemo(() => events.find((item) => item.id === selectedEventId) ?? null, [events, selectedEventId]);

  const loadDirectory = () =>
    api.get<{ authorities: AuthorityRow[] }>('/authorities').then((result) => {
      setAuthorities(result.authorities);
      setSelectedAuthorityId((current) => current || result.authorities[0]?.id || '');
      setAssignAuthorityId((current) => current || result.authorities[0]?.id || '');
      setError(null);
    });

  const loadAssignments = (eventId: string) => {
    if (!eventId) {
      setAssignments([]);
      return;
    }
    api
      .get<{ authorities: AssignmentRow[] }>(
        `/intelligence/events/${eventId}/authorities${includeWithdrawn ? '?includeWithdrawn=true' : ''}`,
      )
      .then((result) => setAssignments(result.authorities))
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not load assignments'));
  };

  const loadMemberships = (authorityId: string) => {
    if (!authorityId) {
      setMemberships([]);
      return;
    }
    api
      .get<{ memberships: MembershipRow[] }>(`/authorities/${authorityId}/memberships`)
      .then((result) => setMemberships(result.memberships))
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not load memberships'));
  };

  useEffect(() => {
    Promise.all([
      loadDirectory(),
      api.get<{ users: UserRow[] }>('/auth/authority-users').then((result) => {
        setUsers(result.users);
        setMembershipUserId((current) => current || result.users[0]?.id || '');
      }),
      api.get<{ events: EventRow[] }>('/intelligence/events?pageSize=40').then((result) => {
        setEvents(result.events);
        setSelectedEventId((current) => current || result.events[0]?.id || '');
      }),
    ])
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load authority administration'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => loadMemberships(selectedAuthorityId), [selectedAuthorityId]);
  useEffect(() => loadAssignments(selectedEventId), [selectedEventId, includeWithdrawn]);

  const editAuthority = (row: AuthorityRow) => {
    const contacts = row.official_contacts ?? {};
    setEditingId(row.id);
    setForm({
      code: row.code,
      name: row.name,
      abbreviation: row.abbreviation ?? '',
      level: row.level,
      officialUrl: row.official_url ?? '',
      sourceUrl: row.source_url ?? '',
      verificationStatus: row.verification_status,
      coverageState: row.coverage_state ?? '',
      coverageDistrict: row.coverage_district ?? '',
      coverageCity: row.coverage_city ?? '',
      contactEmail: typeof contacts.email === 'string' ? contacts.email : '',
      contactPhone: typeof contacts.phone === 'string' ? contacts.phone : '',
      emailVerified: contacts.emailVerified === true,
      phoneVerified: contacts.phoneVerified === true,
      notes: row.notes ?? '',
      jurisdictionArea: row.jurisdiction_area ? JSON.stringify(row.jurisdiction_area, null, 2) : '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetForm = () => {
    setEditingId('');
    setForm(EMPTY_FORM);
  };

  const saveAuthority = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error('Authority code and name are required.');
      return;
    }
    let jurisdictionArea: unknown = null;
    if (form.jurisdictionArea.trim()) {
      try {
        jurisdictionArea = JSON.parse(form.jurisdictionArea);
      } catch {
        toast.error('Jurisdiction must be valid GeoJSON.');
        return;
      }
      if ((jurisdictionArea as { type?: string }).type !== 'MultiPolygon') {
        toast.error('Jurisdiction must be a GeoJSON MultiPolygon.');
        return;
      }
    }
    const existingContacts = editingId
      ? authorities.find((item) => item.id === editingId)?.official_contacts ?? {}
      : {};
    const officialContacts: Record<string, unknown> = { ...existingContacts };
    if (form.contactEmail.trim()) {
      officialContacts.email = form.contactEmail.trim();
      officialContacts.emailVerified = form.emailVerified;
    } else {
      delete officialContacts.email;
      delete officialContacts.emailVerified;
    }
    if (form.contactPhone.trim()) {
      officialContacts.phone = form.contactPhone.trim();
      officialContacts.phoneVerified = form.phoneVerified;
    } else {
      delete officialContacts.phone;
      delete officialContacts.phoneVerified;
    }
    setSavingAuthority(true);
    try {
      await api.post('/authorities', {
        code: form.code.trim(),
        name: form.name.trim(),
        abbreviation: form.abbreviation.trim() || null,
        level: form.level,
        officialUrl: form.officialUrl.trim() || null,
        sourceUrl: form.sourceUrl.trim() || null,
        verificationStatus: form.verificationStatus,
        coverageCountry: 'India',
        coverageState: form.coverageState.trim() || null,
        coverageDistrict: form.coverageDistrict.trim() || null,
        coverageCity: form.coverageCity.trim() || null,
        officialContacts,
        jurisdictionArea,
        notes: form.notes.trim() || null,
      });
      toast.success(editingId ? 'Authority directory entry updated.' : 'Authority directory entry created.');
      await loadDirectory();
      resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save authority');
    } finally {
      setSavingAuthority(false);
    }
  };

  const saveMembership = async () => {
    if (!selectedAuthorityId || !membershipUserId) {
      toast.error('Select an authority and a user.');
      return;
    }
    setWorking(true);
    try {
      await api.post(`/authorities/${selectedAuthorityId}/memberships`, {
        userId: membershipUserId,
        membershipRole,
        status: membershipStatus,
        verificationSource: verificationSource.trim() || null,
      });
      toast.success('Authority membership saved.');
      loadMemberships(selectedAuthorityId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save membership');
    } finally {
      setWorking(false);
    }
  };

  const assign = async (autoMap = false) => {
    if (!selectedEventId) return;
    setWorking(true);
    try {
      const body = autoMap ? { autoMap: true } : { authorityIds: [assignAuthorityId] };
      const result = await api.post<{ assigned: number; reactivated: number; existing: number; matches?: AutoMapMatch[]; note?: string }>(
        `/intelligence/events/${selectedEventId}/authorities`,
        body,
      );
      toast.success(
        autoMap
          ? result.note ?? `${result.assigned} assigned, ${result.reactivated} reactivated, ${result.existing} already active.`
          : result.assigned
            ? 'Authority assigned.'
            : result.reactivated
              ? 'Authority re-assigned.'
              : 'Authority was already assigned.',
      );
      setAutoMatches(result.matches ?? null);
      loadAssignments(selectedEventId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not assign authority');
    } finally {
      setWorking(false);
    }
  };

  const notify = async (assignment: AssignmentRow) => {
    setWorking(true);
    try {
      const result = await api.post<{ delivered: boolean; sent: number; failed: number; simulated: number; demoMode: boolean; authorityStatus: string }>(
        `/intelligence/events/${selectedEventId}/authorities/${assignment.authority_id}/notify`,
      );
      if (result.delivered) {
        toast.success(`Email accepted for ${result.sent} recipient(s). Delivery is not confirmed until a provider webhook.`);
      } else {
        toast.warning(
          `No email delivered. ${result.simulated} simulated, ${result.failed} failed. ${result.demoMode ? 'Demo mode is on.' : 'Check provider configuration.'}`,
        );
      }
      loadAssignments(selectedEventId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not notify authority');
    } finally {
      setWorking(false);
    }
  };

  const withdraw = async (assignment: AssignmentRow) => {
    const reason = window.prompt(`Reason for withdrawing ${assignment.authority_name}:`);
    if (!reason || reason.trim().length < 5) return;
    setWorking(true);
    try {
      await api.post(`/intelligence/events/${selectedEventId}/authorities/${assignment.authority_id}/withdraw`, {
        reason: reason.trim(),
      });
      toast.success('Authority withdrawn. The assignment history is retained.');
      loadAssignments(selectedEventId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not withdraw authority');
    } finally {
      setWorking(false);
    }
  };

  const ingestFeeds = async () => {
    setIngesting(true);
    try {
      const result = await api.post<{
        fetched: number;
        eventsCreated: number;
        eventsExisting: number;
        evidenceCreated: number;
        officialWarnings: { configured: boolean; reason: string };
      }>('/intelligence/events/ingest');
      toast.success(
        `Feed check: ${result.fetched} items, ${result.eventsCreated} new events, ${result.evidenceCreated} evidence records.`,
      );
      if (!result.officialWarnings.configured) toast.info(result.officialWarnings.reason);
      const eventsResult = await api.get<{ events: EventRow[] }>('/intelligence/events?pageSize=40');
      setEvents(eventsResult.events);
      setSelectedEventId((current) => current || eventsResult.events[0]?.id || '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not ingest disaster feeds');
    } finally {
      setIngesting(false);
    }
  };

  if (loading) return <LoadingBlock className="min-h-[60vh]" label="Loading authority administration" />;
  if (error) {
    return <EmptyState title="Authority administration unavailable" description={error} icon={<AlertTriangle className="h-5 w-5" />} action={<Button variant="lime" onClick={() => window.location.reload()}>Retry</Button>} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="teal" dot>Authority administration</Badge>
            <Badge tone="neutral">System administrator only</Badge>
          </div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">Directory, memberships & routing</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[#6f7f74]">
            Add only contacts and boundaries verified from the official source URL. The platform will not invent official phone numbers,
            email addresses, polygons or warnings. System administrators manage routing but cannot act as an authority.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="teal" size="sm" onClick={ingestFeeds} disabled={ingesting}>
            {ingesting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
            {ingesting ? 'Checking feeds…' : 'Ingest disaster feeds'}
          </Button>
          <Button variant="dark" size="sm" onClick={() => { loadDirectory(); loadAssignments(selectedEventId); loadMemberships(selectedAuthorityId); }}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{editingId ? 'Edit authority directory entry' : 'Add authority directory entry'}</CardTitle>
          <Badge tone={form.verificationStatus === 'SOURCE_VERIFIED' ? 'green' : 'amber'}>{form.verificationStatus.replace(/_/g, ' ')}</Badge>
        </CardHeader>
        <div className="space-y-3 p-4">
          <div className="grid gap-2 md:grid-cols-3">
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Code, e.g. bmc-dm" className="h-9 text-[11px]" disabled={Boolean(editingId)} />
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Official authority name" className="h-9 text-[11px] md:col-span-2" />
            <Input value={form.abbreviation} onChange={(e) => setForm({ ...form, abbreviation: e.target.value })} placeholder="Abbreviation" className="h-9 text-[11px]" />
            <Select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} className="h-9 text-[11px]">
              {['NATIONAL', 'STATE', 'DISTRICT', 'MUNICIPAL', 'LOCAL', 'OTHER'].map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
            <Select value={form.verificationStatus} onChange={(e) => setForm({ ...form, verificationStatus: e.target.value })} className="h-9 text-[11px]">
              {['PARTIALLY_VERIFIED', 'SOURCE_VERIFIED', 'UNVERIFIED', 'DISPUTED'].map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
            </Select>
            <Input value={form.officialUrl} onChange={(e) => setForm({ ...form, officialUrl: e.target.value })} placeholder="Official URL" className="h-9 text-[11px] md:col-span-2" />
            <Input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="Verification source URL (required for SOURCE_VERIFIED)" className="h-9 text-[11px]" />
            <Input value={form.coverageState} onChange={(e) => setForm({ ...form, coverageState: e.target.value })} placeholder="Coverage state" className="h-9 text-[11px]" />
            <Input value={form.coverageDistrict} onChange={(e) => setForm({ ...form, coverageDistrict: e.target.value })} placeholder="Coverage district" className="h-9 text-[11px]" />
            <Input value={form.coverageCity} onChange={(e) => setForm({ ...form, coverageCity: e.target.value })} placeholder="Coverage city" className="h-9 text-[11px]" />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <Input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="Verified official email (leave blank if unknown)" className="h-9 text-[11px]" />
            <Input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} placeholder="Verified official phone (leave blank if unknown)" className="h-9 text-[11px]" />
            <label className="flex items-center gap-2 text-[10px] text-[#5a6a5f]">
              <input type="checkbox" checked={form.emailVerified} onChange={(e) => setForm({ ...form, emailVerified: e.target.checked })} /> Email checked against source URL
            </label>
            <label className="flex items-center gap-2 text-[10px] text-[#5a6a5f]">
              <input type="checkbox" checked={form.phoneVerified} onChange={(e) => setForm({ ...form, phoneVerified: e.target.checked })} /> Phone checked against source URL
            </label>
          </div>
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Verification notes, limitations or source observations" className="text-[11px]" />
          <Textarea value={form.jurisdictionArea} onChange={(e) => setForm({ ...form, jurisdictionArea: e.target.value })} rows={4} placeholder="Optional GeoJSON MultiPolygon from a verified source. Leave blank rather than draw an approximate boundary." className="font-mono text-[10px]" />
          <div className="flex flex-wrap gap-2">
            <Button variant="teal" size="sm" onClick={saveAuthority} disabled={savingAuthority}>
              {savingAuthority ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {editingId ? 'Update entry' : 'Add entry'}
            </Button>
            {editingId ? <Button variant="ghost" size="sm" onClick={resetForm}>Cancel edit</Button> : null}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Directory</CardTitle><Badge tone="neutral">{authorities.length}</Badge></CardHeader>
          <div className="divide-y divide-[#e7ece3]">
            {authorities.map((row) => (
              <div key={row.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={row.verification_status === 'SOURCE_VERIFIED' ? 'green' : row.verification_status === 'DISPUTED' ? 'red' : 'amber'}>
                        {row.verification_status.replace(/_/g, ' ')}
                      </Badge>
                      <Badge tone="neutral">{row.level}</Badge>
                      {row.jurisdiction_area ? <Badge tone="teal"><MapPinned className="h-3 w-3" /> Polygon stored</Badge> : null}
                      {row.official_contacts?.email || row.official_contacts?.phone ? <Badge tone="neutral"><Mail className="h-3 w-3" /> Contact recorded</Badge> : null}
                      {row.official_contacts?.emailVerified === true || row.official_contacts?.phoneVerified === true ? <Badge tone="green">Contact verified</Badge> : null}
                    </div>
                    <p className="mt-2 text-[12px] font-semibold text-[#1b2a1f]">{row.name}</p>
                    <p className="mt-1 text-[9px] text-[#66766b]">
                      {row.code} · {[row.coverage_city, row.coverage_district, row.coverage_state].filter(Boolean).join(', ') || 'Coverage not set'}
                    </p>
                    {row.notes ? <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-[#5a6a5f]">{row.notes}</p> : null}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {row.official_url ? (
                      <a href={row.official_url} target="_blank" rel="noreferrer">
                        <Button variant="dark" size="sm"><ExternalLink className="h-3.5 w-3.5" /> Source</Button>
                      </a>
                    ) : null}
                    <Button variant="dark" size="sm" onClick={() => editAuthority(row)}>Edit</Button>
                    <Button variant="subtle" size="sm" onClick={() => setSelectedAuthorityId(row.id)}>Members</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Memberships</CardTitle><Badge tone="neutral">{selectedAuthority?.code ?? 'select'}</Badge></CardHeader>
            <div className="space-y-3 p-4">
              <Select value={selectedAuthorityId} onChange={(e) => setSelectedAuthorityId(e.target.value)} className="h-9 text-[11px]">
                {authorities.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </Select>
              <div className="grid gap-2 sm:grid-cols-2">
                <Select value={membershipUserId} onChange={(e) => setMembershipUserId(e.target.value)} className="h-9 text-[11px]">
                  {users.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.role.replace(/_/g, ' ')}</option>)}
                </Select>
                <Select value={membershipRole} onChange={(e) => setMembershipRole(e.target.value)} className="h-9 text-[11px]">
                  {['VIEWER', 'OFFICER', 'ADMIN'].map((value) => <option key={value} value={value}>{value}</option>)}
                </Select>
                <Select value={membershipStatus} onChange={(e) => setMembershipStatus(e.target.value)} className="h-9 text-[11px]">
                  {['ACTIVE', 'PENDING', 'SUSPENDED', 'REVOKED'].map((value) => <option key={value} value={value}>{value}</option>)}
                </Select>
                <Input value={verificationSource} onChange={(e) => setVerificationSource(e.target.value)} placeholder="Verification source" className="h-9 text-[11px]" />
              </div>
              <Button variant="teal" size="sm" onClick={saveMembership} disabled={working || !selectedAuthorityId || !membershipUserId}>
                <UserPlus className="h-3.5 w-3.5" /> Save membership
              </Button>
              <div className="divide-y divide-[#e7ece3] rounded-xl border border-[#e3eadd]">
                {memberships.length === 0 ? (
                  <p className="p-3 text-[10px] text-[#66766b]">No memberships for this authority.</p>
                ) : (
                  memberships.map((row) => (
                    <div key={row.id} className="p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={row.status === 'ACTIVE' ? 'green' : row.status === 'REVOKED' ? 'red' : 'amber'}>{row.status}</Badge>
                        <Badge tone="neutral">{row.membership_role}</Badge>
                        <span className="text-[9px] text-[#66766b]">{row.user_role.replace(/_/g, ' ')}</span>
                      </div>
                      <p className="mt-1 text-[11px] font-semibold text-[#26362a]">{row.user_name}</p>
                      <p className="text-[9px] text-[#66766b]">{row.email} · {row.verification_source ?? 'No source recorded'}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Event routing & dispatch</CardTitle>
          <Badge tone={selectedEvent?.severity === 'CRITICAL' ? 'red' : 'neutral'}>{selectedEvent ? selectedEvent.severity : 'no event'}</Badge>
        </CardHeader>
        <div className="space-y-3 p-4">
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
            <Select value={selectedEventId} onChange={(e) => setSelectedEventId(e.target.value)} className="h-9 text-[11px]">
              {events.map((row) => <option key={row.id} value={row.id}>{row.title} · {row.severity} · {row.status.replace(/_/g, ' ')}</option>)}
            </Select>
            <Select value={assignAuthorityId} onChange={(e) => setAssignAuthorityId(e.target.value)} className="h-9 text-[11px]">
              {authorities.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </Select>
            <Button variant="teal" size="sm" onClick={() => assign(false)} disabled={working || !selectedEventId || !assignAuthorityId}>
              <ShieldCheck className="h-3.5 w-3.5" /> Assign
            </Button>
            <Button variant="dark" size="sm" onClick={() => assign(true)} disabled={working || !selectedEventId}>
              <MapPinned className="h-3.5 w-3.5" /> Exact auto-map
            </Button>
          </div>
          <label className="flex items-center gap-2 text-[9px] text-[#5a6a5f]">
            <input type="checkbox" checked={includeWithdrawn} onChange={(e) => setIncludeWithdrawn(e.target.checked)} /> Show withdrawn assignments and their retained history
          </label>
          {selectedEvent ? (
            <p className="text-[9px] text-[#66766b]">
              {categoryLabel(selectedEvent.category)} · {selectedEvent.admin_area ?? 'No admin area label'} · detected {formatDate(selectedEvent.detected_at)}
            </p>
          ) : null}
          {autoMatches ? (
            <div className="rounded-xl border border-[#d9e3d5] bg-[#f7faf4] p-3">
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#5d6e63]">Auto-map matches</p>
              {autoMatches.length === 0 ? (
                <p className="mt-1 text-[10px] text-[#5a6a5f]">No exact match. Assign manually; substring matching is disabled.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {autoMatches.map((match) => (
                    <li key={match.code} className="text-[10px] text-[#26362a]"><strong>{match.code}</strong> · {match.reason}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          <div className="divide-y divide-[#e7ece3] rounded-xl border border-[#e3eadd]">
            {assignments.length === 0 ? (
              <p className="p-3 text-[10px] text-[#66766b]">No authorities assigned to this event.</p>
            ) : (
              assignments.map((row) => (
                <div key={row.id} className="p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={statusTone(row.status)}>{row.status.replace(/_/g, ' ')}</Badge>
                        <Badge tone="neutral">{row.level}</Badge>
                        {row.withdrawn_at ? <Badge tone="red">Withdrawn</Badge> : null}
                        {!row.withdrawn_at && row.acknowledgement_overdue ? <Badge tone="red">Ack overdue</Badge> : null}
                        {!row.withdrawn_at && row.resolution_overdue ? <Badge tone="red">Resolution overdue</Badge> : null}
                        {row.evidence_count === 0 ? <Badge tone="amber">No evidence</Badge> : null}
                      </div>
                      <p className="mt-1 text-[11px] font-semibold text-[#26362a]">{row.authority_name}</p>
                      <p className="text-[9px] text-[#66766b]">
                        {row.action_count} actions · ack due {row.acknowledgement_due_at ? formatDate(row.acknowledgement_due_at) : 'not set'} ·
                        {' '}resolution due {row.resolution_due_at ? formatDate(row.resolution_due_at) : 'not set'}
                      </p>
                      {row.withdrawn_at ? (
                        <p className="mt-1 text-[9px] text-[#a83c41]">
                          Withdrawn {formatDate(row.withdrawn_at)} · {row.withdrawal_reason ?? 'No reason recorded'}
                        </p>
                      ) : null}
                    </div>
                    {!row.withdrawn_at ? (
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        <Button variant="teal" size="sm" onClick={() => notify(row)} disabled={working || row.evidence_count === 0}>
                          {row.notified_at ? <BellRing className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                          {row.notified_at ? 'Resend email' : 'Notify email'}
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => withdraw(row)} disabled={working}>
                          <UserX className="h-3.5 w-3.5" /> Withdraw
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
          <p className="text-[9px] leading-relaxed text-[#74847a]">
            Email dispatch goes to active members of the selected authority. SENT means the provider accepted the message; DELIVERED requires a provider webhook.
            No SMS or phone call is sent by the system. Manual notifications are recorded in the authority desk with a reference.
          </p>
        </div>
      </Card>
    </div>
  );
}
