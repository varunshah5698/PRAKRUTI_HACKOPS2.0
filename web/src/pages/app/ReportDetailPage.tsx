import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Camera,
  CheckCircle2,
  CloudSun,
  Link2,
  MapPin,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { MumbaiMap, type MapStation } from '../../components/MumbaiMap';
import { ReportAnalysisPanel } from '../../components/ReportAnalysis';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel, EmptyState, LoadingBlock, Select } from '../../components/ui';
import { AiActionText } from '../../components/AiActionText';
import { api } from '../../lib/api';
import { categoryLabel, formatDate } from '../../lib/format';
import { useAuth } from '../../store/auth';

interface ReportDetail {
  report: {
    id: string; public_ref: string; category: string; incident_type: string; description: string; status: string;
    verification_state: string; occurred_at: string; submitted_at: string; is_simulated: boolean; locality_name: string | null;
    lat: number; lng: number; contact_name: string | null; contact_email: string | null; contact_phone: string | null;
    ai_vision_status: string; consent: boolean;
  };
  evidence: Array<{ id: string; original_name: string | null; mime_type: string; size_bytes: number; sha256: string; gps_consistency: string; malware_scan_status: string; uploaded_at: string }>;
  aiAssessments: Array<{ id: string; assessment_type: string; provider: string; model: string | null; status: string; output: Record<string, unknown>; created_at: string }>;
  enrichment: {
    stations: Array<{ id: string; name: string; station_type: string | null; lat: number; lng: number; distance_m: number; latest_readings: Record<string, { value: number; unit: string; observedAt: string; sourceId: string; isSimulated: boolean }> | null }>;
    weather: { observed_at: string; temperature_c: number; relative_humidity: number; wind_speed_kmh: number; wind_direction_deg: number; precipitation_mm: number; is_simulated: boolean; source_id: string } | null;
    nearbyReports: Array<{ id: string; public_ref: string; category: string; incident_type: string; status: string; verification_state: string; distance_m: number; submitted_at: string; lat: number; lng: number }>;
    alerts: Array<{ id: string; public_ref: string; category: string; level: string; state: string; trigger_type: string; title: string; triggered_at: string }>;
    incidents: Array<{ id: string; public_ref: string; category: string; title: string; status: string; risk_level: string; detected_at: string; distance_m: number }>;
  };
  audit: Array<{ action: string; actor_id: string | null; after: Record<string, unknown>; created_at: string }>;
}

interface IncidentOption { id: string; public_ref: string; title: string; status: string }

interface AiAnswer {
  status: string;
  provider: string;
  model: string | null;
  generatedAt: string;
  narrative: string;
  sections: { observed: string[]; predicted: string[]; reported: string[]; estimated: string[]; standards: string[]; limitations: string[]; nextActions: string[] };
  citations: Array<{ title: string; section: string; authority: string; url: string | null }>;
  disclaimer: string;
}

function sentenceCase(value: string) {
  return value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

export function ReportDetailPage() {
  const { reportId } = useParams();
  const [data, setData] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<IncidentOption[]>([]);
  const [incidentId, setIncidentId] = useState('');
  const [aiAnswer, setAiAnswer] = useState<AiAnswer | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const { isAuthority } = useAuth();
  const navigate = useNavigate();

  const load = () => {
    if (!reportId) return;
    setLoading(true);
    api.get<ReportDetail>(`/reports/${reportId}`)
      .then((result) => {
        setData(result);
        setError(null);
        if (isAuthority()) {
          api.get<{ incidents: IncidentOption[] }>(`/incidents?category=${result.report.category}&pageSize=50`).then((res) => setIncidents(res.incidents)).catch(() => undefined);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load report'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [reportId]);

  const setStatus = async (status: 'VERIFIED' | 'UNVERIFIED') => {
    if (!data) return;
    const reason = window.prompt(`Reason for marking this report ${status.toLowerCase()} (required, min 5 characters):`);
    if (!reason || reason.trim().length < 5) return;
    setWorking(true);
    try {
      await api.patch(`/reports/${data.report.id}/status`, { status, reason });
      toast.success(`Report marked ${status.toLowerCase()}.`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Status change failed');
    } finally {
      setWorking(false);
    }
  };

  const linkIncident = async () => {
    if (!data || !incidentId) return;
    const reason = window.prompt('Reason for linking this report to the incident:');
    if (!reason || reason.trim().length < 5) return;
    setWorking(true);
    try {
      await api.post(`/reports/${data.report.id}/link-incident`, { incidentId, reason });
      toast.success('Report linked to incident.');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Linking failed');
    } finally {
      setWorking(false);
    }
  };

  const analyseWithAi = async () => {
    if (!data || aiLoading) return;
    setAiLoading(true);
    try {
      const answer = await api.post<AiAnswer>('/ai/analyse', {
        reportId: data.report.id,
        category: data.report.category,
        type: 'custom',
        question: `Analyse citizen report ${data.report.public_ref}. Explain what was reported, what nearby monitors and weather show, what other reports or cases are related, how strong the evidence is, and what should be verified next. Do not declare a violation.`,
      });
      setAiAnswer(answer);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI analysis failed');
    } finally {
      setAiLoading(false);
    }
  };

  if (loading) return <LoadingBlock className="min-h-[60vh]" label="Loading report evidence" />;
  if (error || !data) return <EmptyState title="Report unavailable" description={error ?? 'Report not found.'} icon={<AlertTriangle className="h-5 w-5" />} action={<Button variant="lime" onClick={load}>Retry</Button>} />;

  const marker: MapStation[] = [{
    id: data.report.id,
    name: data.report.incident_type.replace(/_/g, ' '),
    locality: data.report.locality_name,
    lat: data.report.lat,
    lng: data.report.lng,
    color: '#5b9e46',
    valueLabel: data.report.public_ref,
    markerKind: 'OBSERVED',
    isSimulated: data.report.is_simulated,
  }];

  const nearestStation = data.enrichment.stations?.[0] ?? null;
  const nearestReadingEntry = nearestStation?.latest_readings ? Object.entries(nearestStation.latest_readings)[0] ?? null : null;
  const nearestReading = nearestReadingEntry?.[1] ?? null;
  const nearestReadingCode = nearestReadingEntry?.[0]?.replace(/_/g, ' ') ?? null;
  const weather = data.enrichment.weather;
  const incidentTitle = sentenceCase(data.report.incident_type);
  const readingValue = nearestReading ? `${Math.round(nearestReading.value * 10) / 10}` : 'No reading';
  const readingUnit = nearestReading?.unit ?? '';

  return (
    <div className="report-airy space-y-5">
      <section className="report-hero">
        <div className="report-hero-sky" aria-hidden="true" />
        <div className="relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link to="/reports" className="report-back"><ArrowLeft className="h-3.5 w-3.5" /> All reports</Link>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{data.report.public_ref}</Badge>
              <Badge tone={data.report.verification_state === 'VERIFIED' ? 'green' : data.report.verification_state === 'REJECTED' ? 'red' : 'amber'}>{data.report.verification_state}</Badge>
              <Badge tone="neutral">{data.report.status.replace(/_/g, ' ')}</Badge>
              {data.report.is_simulated ? <Badge tone="amber">Simulation data</Badge> : null}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="report-kicker">{categoryLabel(data.report.category)} · {data.report.locality_name ?? 'Mumbai'} · submitted {formatDate(data.report.submitted_at)}</p>
              <h1 className="display mt-2 max-w-[15ch] text-[38px] font-bold leading-[0.94] tracking-[-0.05em] text-[#142016] sm:text-[48px] lg:text-[54px]">{incidentTitle}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isAuthority() && ['SUBMITTED', 'AI_ASSESSED', 'AWAITING_VERIFICATION'].includes(data.report.status) ? (
                <>
                  <Button variant="lime" size="sm" onClick={() => setStatus('VERIFIED')} disabled={working}><CheckCircle2 className="h-3.5 w-3.5" /> Verify</Button>
                  <Button variant="danger" size="sm" onClick={() => setStatus('UNVERIFIED')} disabled={working}>Mark unverified</Button>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="report-summary-card">
              <div className="report-summary-top">
                <span className="report-summary-label">Verification</span>
                <span className="report-summary-icon"><ShieldCheck className="h-4 w-4" /></span>
              </div>
              <p className="report-summary-value">{sentenceCase(data.report.verification_state)}</p>
              <p className="report-summary-meta">{sentenceCase(data.report.status)} · AI vision {sentenceCase(data.report.ai_vision_status)}</p>
            </div>

            <div className="report-summary-card">
              <div className="report-summary-top">
                <span className="report-summary-label">Nearest monitor</span>
                <span className="report-summary-icon"><Activity className="h-4 w-4" /></span>
              </div>
              <p className="report-summary-value">{readingValue}{nearestReading ? <span className="report-summary-unit"> {readingUnit}</span> : null}</p>
              <p className="report-summary-meta">
                {nearestStation
                  ? `${nearestReadingCode ? `${nearestReadingCode.toUpperCase()} · ` : ''}${nearestStation.name} · ${Math.round(nearestStation.distance_m)} m`
                  : 'No category-matched monitor within 3 km'}
              </p>
            </div>

            <div className="report-summary-card">
              <div className="report-summary-top">
                <span className="report-summary-label">Weather now</span>
                <span className="report-summary-icon"><CloudSun className="h-4 w-4" /></span>
              </div>
              <p className="report-summary-value">{weather ? `${Math.round(weather.temperature_c)}°C` : 'No weather'}</p>
              <p className="report-summary-meta">
                {weather
                  ? `${Math.round(weather.relative_humidity)}% humidity · ${Math.round(weather.wind_speed_kmh)} km/h wind${Number(weather.precipitation_mm) > 0 ? ` · ${weather.precipitation_mm} mm rain` : ''}`
                  : 'No nearby weather observation'}
              </p>
            </div>

            <div className="report-summary-card">
              <div className="report-summary-top">
                <span className="report-summary-label">Evidence</span>
                <span className="report-summary-icon"><Camera className="h-4 w-4" /></span>
              </div>
              <p className="report-summary-value">{data.evidence.length} {data.evidence.length === 1 ? 'photo' : 'photos'}</p>
              <p className="report-summary-meta">{data.aiAssessments.length} AI assessment{data.aiAssessments.length === 1 ? '' : 's'} · consent {data.report.consent ? 'recorded' : 'not recorded'}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <p className="report-kicker">Evidence</p>
          <h2 className="display mt-1 text-[24px] font-bold tracking-[-0.04em] text-[#142016]">Forensic dossier</h2>
        </div>
        <p className="max-w-[44ch] text-[11px] leading-relaxed text-[#6f7f74]">A guided, evidence-bound read of the site, environmental context, dispersion and community signals.</p>
      </div>

      <ReportAnalysisPanel
        report={data.report}
        evidence={data.evidence}
        aiAssessments={data.aiAssessments}
        enrichment={data.enrichment}
        audit={data.audit}
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>AI report analysis</CardTitle>
            <p className="mt-1 text-[10px] text-[#66766b]">Grounded in this report, nearby monitors, weather, related reports and today's environmental news.</p>
          </div>
          <Badge tone={aiLoading ? 'amber' : aiAnswer?.status === 'COMPLETED' ? 'green' : aiAnswer ? 'amber' : 'neutral'}>
            {aiLoading ? 'ANALYSING' : aiAnswer ? aiAnswer.status.replace(/_/g, ' ') : 'NOT RUN'}
          </Badge>
        </CardHeader>
        <div className="space-y-3 p-4">
          {aiLoading ? <LoadingBlock label="Reading the report, nearby evidence and news" /> : null}
          {!aiAnswer && !aiLoading ? (
            <>
              <p className="text-[11px] leading-relaxed text-[#5a6a5f]">
                Ask Prakriti to read this report against the evidence on this page. Citizen claims stay labelled as reported; nearby readings stay separate.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="lime" size="sm" onClick={analyseWithAi}><Sparkles className="h-3.5 w-3.5" /> Analyse this report</Button>
                <Link to={`/ai-analyst?report=${data.report.id}&category=${data.report.category}`}><Button variant="dark" size="sm"><Bot className="h-3.5 w-3.5" /> Open AI analyst</Button></Link>
              </div>
            </>
          ) : null}
          {aiAnswer ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={aiAnswer.provider === 'RIVER_AI' ? 'lime' : 'amber'}>{aiAnswer.provider === 'RIVER_AI' ? 'AI-generated explanation' : 'Rule-based evidence digest'}</Badge>
                <Badge tone={aiAnswer.status === 'COMPLETED' ? 'green' : 'neutral'}>{aiAnswer.status.replace(/_/g, ' ')}</Badge>
                <span className="text-[9px] text-[#66766b]">{formatDate(aiAnswer.generatedAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[#405246]">{aiAnswer.narrative}</p>
              {([
                ['OBSERVED', aiAnswer.sections.observed, 'green'],
                ['PREDICTED', aiAnswer.sections.predicted, 'teal'],
                ['REPORTED / UNVERIFIED', aiAnswer.sections.reported, 'amber'],
                ['ANALYSIS / REASONING', aiAnswer.sections.estimated, 'neutral'],
                ['REFERENCE STANDARDS', aiAnswer.sections.standards, 'neutral'],
                ['LIMITATIONS', aiAnswer.sections.limitations, 'red'],
                ['SUGGESTED NEXT ACTIONS', aiAnswer.sections.nextActions, 'lime'],
              ] as Array<[string, string[], 'green' | 'teal' | 'amber' | 'neutral' | 'red' | 'lime']>).map(([label, items, tone]) => items.length ? (
                <div key={label} className="rounded-xl border border-[#e7ece3] bg-[#ffffff] p-3">
                  <Badge tone={tone}>{label}</Badge>
                  <ul className="mt-2 space-y-1.5 text-[10px] leading-relaxed text-[#5a6a5f]">
                    {items.map((item, index) => <li key={index} className="flex gap-2"><span className="text-[#66766b]">—</span><AiActionText text={item} /></li>)}
                  </ul>
                </div>
              ) : null)}
              {aiAnswer.citations.length ? (
                <div className="rounded-xl border border-[#e7ece3] bg-[#ffffff] p-3">
                  <DataLabel>Citations</DataLabel>
                  <ul className="mt-2 space-y-1 text-[10px] text-[#5a6a5f]">
                    {aiAnswer.citations.map((citation, index) => (
                      <li key={index}>{citation.title} · {citation.section} · {citation.authority}{citation.url ? <> · <a href={citation.url} target="_blank" rel="noreferrer" className="text-[#3f7d2a] underline">source</a></> : null}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {aiAnswer.disclaimer ? <p className="text-[9px] leading-relaxed text-[#66766b]">{aiAnswer.disclaimer}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="dark" size="sm" onClick={analyseWithAi} disabled={aiLoading}><RefreshCw className="h-3.5 w-3.5" /> Analyse again</Button>
                <Link to={`/ai-analyst?report=${data.report.id}&category=${data.report.category}`}><Button variant="outline" size="sm"><Bot className="h-3.5 w-3.5" /> Follow up in AI analyst</Button></Link>
              </div>
            </>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Report evidence</CardTitle><Badge tone={data.evidence.length ? 'green' : 'neutral'}>{data.evidence.length ? `${data.evidence.length} photograph` : 'No photograph'}</Badge></CardHeader>
            <div className="p-4">
              <p className="text-[12px] leading-relaxed text-[#405246]">{data.report.description}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3"><DataLabel>Occurred</DataLabel><p className="mt-1 text-[11px] font-medium">{formatDate(data.report.occurred_at)}</p></div>
                <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3"><DataLabel>AI vision</DataLabel><p className={`mt-1 text-[11px] font-medium ${data.report.ai_vision_status === 'COMPLETED' ? 'text-emerald-600' : 'text-amber-600'}`}>{data.report.ai_vision_status.replace(/_/g, ' ')}</p></div>
                <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3"><DataLabel>Consent</DataLabel><p className="mt-1 text-[11px] font-medium">{data.report.consent ? 'Recorded' : 'Not recorded'}</p></div>
              </div>
              {data.evidence.length ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {data.evidence.map((item) => (
                    <div key={item.id} className="overflow-hidden rounded-xl border border-[#dfe6db] bg-[#f5f8f2]">
                      <img src={`/api/v1/evidence/${item.id}`} alt="Citizen evidence" className="h-52 w-full object-cover" />
                      <div className="p-3 text-[9px] leading-relaxed text-[#66766b]">
                        <p className="font-semibold text-[#5a6a5f]">{item.original_name ?? 'Evidence photograph'}</p>
                        <p className="mt-1">{item.mime_type} · {item.size_bytes < 1024 ? `${item.size_bytes} B` : `${(item.size_bytes / 1024).toFixed(1)} KB`} · GPS {item.gps_consistency}</p>
                        <p className="mt-1">Malware scan: {item.malware_scan_status.replace(/_/g, ' ')} · private by default</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-[#dfe6db] p-6 text-center text-[10px] text-[#66766b]">
                  <Camera className="mx-auto mb-2 h-5 w-5" /> No photograph attached. The report relies on the description and location.
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader><CardTitle>AI assessment</CardTitle><Badge tone={data.aiAssessments.some((a) => a.status === 'COMPLETED') ? 'green' : 'amber'}>{data.evidence.length === 0 ? 'NO PHOTO' : data.aiAssessments[0]?.status ?? 'NOT_CONFIGURED'}</Badge></CardHeader>
            <div className="space-y-3 p-4">
              {data.evidence.length === 0 ? (
                <p className="text-[11px] text-[#66766b]">No photograph attached, so no visual assessment was performed.</p>
              ) : null}
              {data.evidence.length > 0 ? data.aiAssessments.map((assessment) => {
                const output = assessment.output as {
                  description?: unknown;
                  visibleFeatures?: unknown;
                  confidence?: unknown;
                  limitations?: unknown;
                  reason?: unknown;
                };
                const features = Array.isArray(output.visibleFeatures)
                  ? output.visibleFeatures.filter((feature): feature is string => typeof feature === 'string')
                  : [];
                const limitations = Array.isArray(output.limitations)
                  ? output.limitations.filter((limitation): limitation is string => typeof limitation === 'string')
                  : [];
                return (
                  <div key={assessment.id} className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-3 text-[10px] leading-relaxed text-[#5a6a5f]">
                    <div className="flex items-center justify-between"><span className="font-semibold text-[#26362a]">{assessment.assessment_type.replace(/_/g, ' ')}</span><span>{assessment.provider} · {assessment.status}</span></div>
                    {assessment.status === 'COMPLETED' && typeof output.description === 'string' ? (
                      <div className="mt-2 space-y-2">
                        <p className="text-[11px] text-[#3f5145]">{output.description}</p>
                        {features.length ? (
                          <div className="flex flex-wrap gap-1">
                            {features.map((feature) => (
                              <span key={feature} className="rounded-full border border-[#dfe6db] px-2 py-0.5 text-[9px] text-[#5a6a5f]">{feature}</span>
                            ))}
                          </div>
                        ) : null}
                        {typeof output.confidence === 'string' ? <p className="text-[9px] text-[#66766b]">Confidence: {output.confidence}</p> : null}
                        {limitations.length ? (
                          <ul className="space-y-0.5 text-[9px] text-[#66766b]">
                            {limitations.map((limitation) => <li key={limitation}>— {limitation}</li>)}
                          </ul>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-2 whitespace-pre-wrap">{String(output.reason ?? JSON.stringify(assessment.output))}</p>
                    )}
                    <p className="mt-2 text-[9px] text-[#66766b]">A photograph cannot establish chemical composition, toxicity, concentration or legal responsibility.</p>
                  </div>
                );
              }) : null}
              {data.evidence.length > 0 && data.aiAssessments.length === 0 ? <p className="text-[11px] text-[#66766b]">No AI assessment record.</p> : null}
            </div>
          </Card>

        </div>

        <div className="space-y-4">
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>Location</CardTitle><Badge tone="neutral">Mumbai</Badge></CardHeader>
            <MumbaiMap stations={marker} className="h-[260px] w-full" compact theme="light" initialZoom={13.4} initialPitch={20} overlayLabel="Report location" autoFit={false} />
            <div className="p-3 text-[10px] text-[#6f7f74]">
              <p className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {data.report.locality_name ?? 'Mumbai'} · {data.report.lat.toFixed(5)}, {data.report.lng.toFixed(5)}</p>
              <p className="mt-1 text-[9px] text-[#66766b]">Location validated inside the Greater Mumbai boundary.</p>
            </div>
          </Card>

          {isAuthority() ? (
            <Card>
              <CardHeader><CardTitle>Authority actions</CardTitle><ShieldCheck className="h-4 w-4 text-[#3f7d2a]" /></CardHeader>
              <div className="space-y-3 p-4">
                {data.report.status === 'VERIFIED' ? (
                  <>
                    <p className="text-[10px] leading-relaxed text-[#5a6a5f]">This report is verified. Link it to a matching incident to preserve the investigation chain.</p>
                    <Select value={incidentId} onChange={(e) => setIncidentId(e.target.value)} className="h-9 text-[11px]">
                      <option value="">Select incident</option>
                      {incidents.map((incident) => <option key={incident.id} value={incident.id}>{incident.public_ref} · {incident.title.slice(0, 50)}</option>)}
                    </Select>
                    <Button variant="lime" size="sm" className="w-full" onClick={linkIncident} disabled={!incidentId || working}><Link2 className="h-3.5 w-3.5" /> Link report to incident</Button>
                  </>
                ) : data.report.status === 'LINKED_TO_INVESTIGATION' ? (
                  <p className="text-[10px] leading-relaxed text-[#5a6a5f]">This report is linked to an investigation. No further report action is available. The incident workspace holds the investigation record.</p>
                ) : (
                  <p className="text-[10px] leading-relaxed text-[#5a6a5f]">Verify or reject the report first. Only a verified report can be linked to an incident. Every status change is audited.</p>
                )}
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-3 text-[9px] leading-relaxed text-amber-700/70">
                  <ShieldAlert className="mb-1 h-3.5 w-3.5" /> A report is not an official violation. Official determinations are recorded only in the incident workflow by an authorised administrator.
                </div>
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader><CardTitle>Contact</CardTitle><UserRound className="h-4 w-4 text-[#6f7f74]" /></CardHeader>
            <div className="p-4 text-[10px] leading-relaxed text-[#5a6a5f]">
              <p>Name: {data.report.contact_name || 'Not supplied'}</p>
              <p>Email: {data.report.contact_email || 'Not supplied'}</p>
              <p>Phone: {data.report.contact_phone || 'Not supplied'}</p>
              <p className="mt-2 text-[9px] text-[#66766b]">Private contact information. Do not share outside authorised review.</p>
            </div>
          </Card>

        </div>
      </div>
    </div>
  );
}
