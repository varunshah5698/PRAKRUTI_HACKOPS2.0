import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCircle2, Database, LockKeyhole, Settings as SettingsIcon, ShieldCheck, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel, Input, LoadingBlock, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../store/auth';

interface PendingRequest { id: string; name: string; email: string; department: string | null; designation: string | null; jurisdiction: string | null; requested_role: string | null; created_at: string }

export function SettingsPage() {
  const { user, loadMe, can } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [roles, setRoles] = useState<Record<string, string>>({});

  useEffect(() => { setName(user?.name ?? ''); }, [user]);
  useEffect(() => {
    if (can(['SYSTEM_ADMIN', 'AUTHORITY_ADMIN'])) {
      api.get<{ requests: PendingRequest[] }>('/auth/admin/pending-authorities').then((res) => setPending(res.requests)).catch(() => undefined);
    }
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/auth/me', { name });
      await loadMe();
      toast.success('Profile updated.');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Update failed'); }
    finally { setSaving(false); }
  };

  const approve = async (request: PendingRequest) => {
    const role = roles[request.id] ?? 'AUTHORITY_ADMIN';
    try {
      await api.post('/auth/admin/approve-authority', { userId: request.id, role });
      toast.success(`${request.name} approved as ${role.replace(/_/g, ' ')}.`);
      setPending((prev) => prev.filter((item) => item.id !== request.id));
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Approval failed'); }
  };

  if (!user) return <LoadingBlock label="Loading account" />;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2"><Badge tone="neutral" dot>Account</Badge><Badge tone="neutral">{user.role.replace(/_/g, ' ')}</Badge></div>
        <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">Settings</h2>
        <p className="mt-1 text-[11px] text-[#6f7f74]">Profile, notification consent and administrative approvals. Authority permissions are checked server-side.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle><UserRound className="h-4 w-4 text-[#6f7f74]" /></CardHeader>
          <div className="space-y-3 p-4">
            <div><DataLabel>Name</DataLabel><Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" /></div>
            <div><DataLabel>Email</DataLabel><p className="mt-1 text-[12px] text-[#405246]">{user.email}</p></div>
            <div className="grid grid-cols-2 gap-2">
              <div><DataLabel>Role</DataLabel><p className="mt-1 text-[11px] text-[#405246]">{user.role.replace(/_/g, ' ')}</p></div>
              <div><DataLabel>Account status</DataLabel><p className="mt-1 text-[11px] text-[#405246]">{user.accountStatus}</p></div>
              <div><DataLabel>Department</DataLabel><p className="mt-1 text-[11px] text-[#405246]">{user.department ?? '—'}</p></div>
              <div><DataLabel>Jurisdiction</DataLabel><p className="mt-1 text-[11px] text-[#405246]">{user.jurisdiction ?? '—'}</p></div>
            </div>
            <Button variant="lime" size="sm" onClick={save} disabled={saving}><CheckCircle2 className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save profile'}</Button>
          </div>
        </Card>

        <Card>
          <CardHeader><CardTitle>Notifications & privacy</CardTitle><Bell className="h-4 w-4 text-[#6f7f74]" /></CardHeader>
          <div className="space-y-3 p-4 text-[11px] leading-relaxed text-[#68786d]">
            <p>Notification categories, locality, radius and consent are managed in the notification centre. No email is sent in demo mode without a configured demonstration recipient.</p>
            <Link to="/notifications"><Button variant="dark" size="sm"><Bell className="h-3.5 w-3.5" /> Open notification settings</Button></Link>
            <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3 text-[9px] text-[#74847a]">
              <p className="inline-flex items-center gap-1 text-[#5a6a5f]"><LockKeyhole className="h-3 w-3" /> Session cookie is HTTP-only and SameSite=Lax.</p>
              <p className="mt-1">Evidence is private by default. Citizen contact details are never exposed in public map responses.</p>
            </div>
          </div>
        </Card>
      </div>

      {can(['SYSTEM_ADMIN', 'AUTHORITY_ADMIN']) ? (
        <Card>
          <CardHeader><CardTitle>Pending authority approvals</CardTitle><Badge tone="neutral">{pending.length}</Badge></CardHeader>
          {pending.length === 0 ? <p className="p-4 text-[11px] text-[#74847a]">No pending authority registrations.</p> : (
            <div className="divide-y divide-[#e7ece3]">
              {pending.map((request) => (
                <div key={request.id} className="flex flex-wrap items-end justify-between gap-3 p-4">
                  <div>
                    <p className="text-[12px] font-semibold text-[#1b2a1f]">{request.name}</p>
                    <p className="mt-0.5 text-[10px] text-[#68786d]">{request.email} · {request.department ?? '—'} · {request.designation ?? '—'}</p>
                    <p className="mt-0.5 text-[9px] text-[#74847a]">Requested {request.requested_role?.replace(/_/g, ' ')} · {request.jurisdiction ?? '—'}</p>
                  </div>
                  {can(['SYSTEM_ADMIN']) ? (
                    <div className="flex items-end gap-2">
                      <Select value={roles[request.id] ?? 'AUTHORITY_ADMIN'} onChange={(e) => setRoles((prev) => ({ ...prev, [request.id]: e.target.value }))} className="h-9 w-[190px] text-[10px]">
                        <option value="FIELD_OFFICER">Field officer</option>
                        <option value="ENVIRONMENTAL_ANALYST">Environmental analyst</option>
                        <option value="AUTHORITY_ADMIN">Authority admin</option>
                      </Select>
                      <Button variant="lime" size="sm" onClick={() => approve(request)}><ShieldCheck className="h-3.5 w-3.5" /> Approve</Button>
                    </div>
                  ) : <Badge tone="amber">System admin approval required</Badge>}
                </div>
              ))}
            </div>
          )}
          <p className="border-t border-[#e7ece3] px-4 py-2 text-[9px] text-[#7b8a80]">Approval grants a server-side role. It is audited and cannot be self-assigned at registration.</p>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Platform configuration</CardTitle><SettingsIcon className="h-4 w-4 text-[#6f7f74]" /></CardHeader>
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          {[
            ['Demo mode', 'ON — station data is simulation-labelled'],
            ['CPCB / MPCB', 'NOT_CONFIGURED'],
            ['River AI', 'Configured server-side only when key is present'],
            ['ML models', 'NOT_TRAINED — persistence baseline only'],
            ['Vision AI', 'NOT_CONFIGURED'],
            ['Email', 'SIMULATED unless provider + demo recipient configured'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3">
              <DataLabel>{label}</DataLabel>
              <p className="mt-1 text-[10px] leading-relaxed text-[#5a6a5f]">{value}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function ProfilePage() {
  const { user } = useAuth();
  if (!user) return <LoadingBlock label="Loading profile" />;
  const permissions: Record<string, string[]> = {
    PUBLIC: ['Submit reports', 'View own reports', 'View public information'],
    FIELD_OFFICER: ['Investigate assigned cases', 'Add investigation notes', 'Update corrective actions', 'Verify reports'],
    ENVIRONMENTAL_ANALYST: ['Review evidence', 'Review assessments', 'Add analysis notes', 'Verify reports'],
    AUTHORITY_ADMIN: ['Assign cases', 'Validate cases', 'Record official determinations', 'Close incidents', 'Close alerts'],
    SYSTEM_ADMIN: ['Platform configuration', 'Approve authority accounts', 'All authority actions'],
  };
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2"><Badge tone="lime" dot>{user.role.replace(/_/g, ' ')}</Badge><Badge tone="neutral">Server-side permissions</Badge></div>
        <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">Profile</h2>
        <p className="mt-1 text-[11px] text-[#6f7f74]">Account identity and the actions your role may perform.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Identity</CardTitle><UserRound className="h-4 w-4 text-[#6f7f74]" /></CardHeader>
          <div className="space-y-3 p-4 text-[11px]">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#5b9e46]/15 text-lg font-bold text-[#3f7d2a]">{user.name.slice(0, 1)}</span>
              <div><p className="text-sm font-semibold text-[#1b2a1f]">{user.name}</p><p className="text-[10px] text-[#6f7f74]">{user.email}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><DataLabel>Role</DataLabel><p className="mt-1 text-[#405246]">{user.role.replace(/_/g, ' ')}</p></div>
              <div><DataLabel>Account</DataLabel><p className="mt-1 text-[#405246]">{user.accountStatus}</p></div>
              <div><DataLabel>Department</DataLabel><p className="mt-1 text-[#405246]">{user.department ?? '—'}</p></div>
              <div><DataLabel>Designation</DataLabel><p className="mt-1 text-[#405246]">{user.designation ?? '—'}</p></div>
              <div><DataLabel>Jurisdiction</DataLabel><p className="mt-1 text-[#405246]">{user.jurisdiction ?? '—'}</p></div>
              <div><DataLabel>Locality</DataLabel><p className="mt-1 text-[#405246]">{user.localityName ?? '—'}</p></div>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader><CardTitle>Permissions</CardTitle><ShieldCheck className="h-4 w-4 text-[#3f7d2a]" /></CardHeader>
          <div className="p-4">
            <ul className="space-y-2 text-[11px] text-[#5a6a5f]">
              {(permissions[user.role] ?? []).map((permission) => <li key={permission} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#3f7d2a]" /> {permission}</li>)}
            </ul>
            <p className="mt-4 rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3 text-[9px] leading-relaxed text-[#74847a]">
              Role checks are enforced by API middleware. The UI hides unavailable actions but is not the security boundary. Public users cannot verify reports, assign incidents or record determinations.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
