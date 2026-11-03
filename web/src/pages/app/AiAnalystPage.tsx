import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Bot, BrainCircuit, ChevronDown, Info, Send, ShieldAlert, Sparkles, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel, LoadingBlock, Select, Textarea } from '../../components/ui';
import { AiActionText } from '../../components/AiActionText';
import { api, ApiError, API_ORIGIN } from '../../lib/api';
import { CATEGORY_LABELS, formatDate } from '../../lib/format';

interface AiAnswer {
  status: string;
  provider: string;
  model: string | null;
  generatedAt: string;
  question: string;
  narrative: string;
  mode?: 'conversational';
  sections: { observed: string[]; predicted: string[]; reported: string[]; estimated: string[]; standards: string[]; limitations: string[]; nextActions: string[] };
  citations: Array<{ title: string; section: string; authority: string; url: string | null }>;
  evidence: unknown;
  disclaimer: string;
}

interface StationOption {
  id: string;
  name: string;
  stationType: string;
  localityName: string | null;
  isSimulated: boolean;
}

interface ReportOption {
  id: string;
  public_ref: string;
  category: string;
  incident_type: string;
  status: string;
  verification_state: string;
  locality_name: string | null;
}

const SUGGESTIONS = [
  'What can this website do?',
  'Which data sources are live or not configured?',
  'Where do I verify a citizen report?',
  'Analyse Mumbai air quality and explain what is driving it.',
  'How might pollution change in the next few hours?',
  'Which stations are worst and cleanest right now?',
  'What is the environmental news saying today?',
  'Analyse all recent citizen reports',
  'Which reports need verification first?',
  'What patterns do the reports show?',
  'Is the wind helping or hurting air quality?',
  'Which standards might apply here?',
  'What evidence is missing?',
  'What should be checked next?',
];

function hasEvidence(answer: AiAnswer) {
  return answer.citations.length > 0 || Object.values(answer.sections).some((items) => items.length > 0);
}

export function AiAnalystPage() {
  const [searchParams] = useSearchParams();
  const reportParam = searchParams.get('report');
  const categoryParam = searchParams.get('category');
  const [stations, setStations] = useState<StationOption[]>([]);
  const [reports, setReports] = useState<ReportOption[]>([]);
  const [stationId, setStationId] = useState('');
  const [reportId, setReportId] = useState('');
  const [category, setCategory] = useState('air');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text?: string; answer?: AiAnswer }>>([]);
  const [loading, setLoading] = useState(false);
  const [waitingForServer, setWaitingForServer] = useState(false);
  const [failedPrompt, setFailedPrompt] = useState<string | null>(null);
  const [status, setStatus] = useState<{ river: string; model: string | null; vision: string; mode: string; note: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api.get<{ stations: Array<{ id: string; name: string; stationType: string; localityName: string | null; isSimulated: boolean }> }>('/map/stations').then((result) => {
      setStations(result.stations);
    }).catch(() => undefined);
    // shortcut: the focus picker lists the latest 50 reports; add server-side search when the register grows.
    api.get<{ reports: ReportOption[] }>('/reports?pageSize=50').then((result) => {
      setReports(result.reports);
    }).catch(() => undefined);
    api.get<{ river: string; model: string | null; vision: string; mode: string; note: string }>('/ai/status').then(setStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // A station from the previous category is not valid evidence for a new one.
  useEffect(() => {
    setStationId('');
  }, [category]);

  useEffect(() => {
    if (reportParam) setReportId(reportParam);
  }, [reportParam]);

  useEffect(() => {
    if (categoryParam && ['air', 'water', 'waste', 'industrial'].includes(categoryParam)) {
      setCategory(categoryParam);
    }
  }, [categoryParam]);

  // A selected report also decides the category, so the right standards load.
  useEffect(() => {
    const report = reports.find((item) => item.id === reportId);
    if (report) setCategory(report.category);
  }, [reportId, reports]);

  const ask = async (text?: string) => {
    const prompt = (text ?? question).trim();
    if (!prompt || loading) return;
    setMessages((prev) => [...prev, { role: 'user', text: prompt }]);
    setQuestion('');
    setLoading(true);
    setFailedPrompt(null);
    try {
      const post = () => api.post<AiAnswer>('/ai/chat', {
        question: prompt,
        stationId: stationId || undefined,
        reportId: reportId || undefined,
        category,
      });
      let answer: AiAnswer | null = null;
      // Deploys and free-tier restarts take the API down briefly. Wait for its
      // health check instead of discarding a question the user already typed.
      for (let attempt = 0; attempt < 5 && !answer; attempt += 1) {
        try {
          answer = await post();
        } catch (error) {
          const retryable = error instanceof ApiError
            ? [502, 503, 504].includes(error.status)
            : error instanceof TypeError;
          if (!retryable || attempt === 4) throw error;
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
            continue;
          }
          setWaitingForServer(true);
          let healthy = false;
          for (let probe = 0; probe < 30 && !healthy; probe += 1) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            try {
              healthy = (await fetch(`${API_ORIGIN}/api/health`)).ok;
            } catch {
              // The API is still restarting.
            }
          }
          setWaitingForServer(false);
          if (!healthy) throw error;
        }
      }
      if (!answer) throw new Error('The AI service did not return a response.');
      setMessages((prev) => [...prev, { role: 'assistant', answer }]);
    } catch (error) {
      let detail = error instanceof Error ? error.message : 'Unknown network or server error';
      if (error instanceof ApiError && error.status === 401) detail = 'Your session expired. Sign in again, then retry.';
      if (error instanceof ApiError && error.status === 429) detail = 'Too many requests. Wait a minute, then retry.';
      toast.error(detail);
      setFailedPrompt(prompt);
      setMessages((prev) => [...prev, { role: 'assistant', text: `The analysis request failed: ${detail}` }]);
    } finally {
      setWaitingForServer(false);
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status?.river === 'CONFIGURED' ? 'lime' : 'amber'} dot>
              {status?.river === 'CONFIGURED' ? `River AI · ${status.model}` : 'Rule-based evidence digest'}
            </Badge>
            <Badge tone="neutral">News + reports in view</Badge>
            <Badge tone="neutral">Answers from app records</Badge>
          </div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">AI environmental analyst</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[#6f7f74]">
            Ask in plain English about the news, every citizen report or one specific report. I'll separate what's observed, predicted, reported and estimated — and tell you when the evidence is thin.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 w-[150px] text-[11px]">
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select value={stationId} onChange={(e) => { setStationId(e.target.value); if (e.target.value) setReportId(''); }} className="h-9 w-[220px] text-[11px]">
            <option value="">Citywide context</option>
            {stations.filter((s) => category === 'air' ? s.stationType === 'AIR_CAAQMS' : category === 'water' ? s.stationType === 'WATER_SAMPLING' : category === 'industrial' ? s.stationType === 'INDUSTRIAL_STACK' : true).map((station) => (
              <option key={station.id} value={station.id}>{station.name}</option>
            ))}
          </Select>
          <Select value={reportId} onChange={(e) => { setReportId(e.target.value); setStationId(''); }} className="h-9 w-[280px] text-[11px]">
            <option value="">All reports (citywide)</option>
            {reportId && !reports.some((report) => report.id === reportId) ? <option value={reportId}>Selected report</option> : null}
            {reports.map((report) => (
              <option key={report.id} value={report.id}>{report.public_ref} · {report.category} · {report.incident_type.replace(/_/g, ' ')}</option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card className="flex min-h-[620px] flex-col">
          <CardHeader>
            <div><CardTitle>Grounded analysis</CardTitle><p className="mt-1 text-[10px] text-[#66766b]">I keep measured facts, forecasts and reports clearly separate.</p></div>
            <Badge tone="teal">Evidence first</Badge>
          </CardHeader>
          <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="rounded-2xl border border-[#dfe6db] bg-[#f5f8f2] p-5">
                <div className="flex items-center gap-2 text-[#3f7d2a]"><Sparkles className="h-4 w-4" /><span className="text-xs font-semibold">Namaste — I'm Prakriti</span></div>
                <p className="mt-2 text-[11px] leading-relaxed text-[#5a6a5f]">
                  Your Mumbai environment guide. Ask about today's air, the latest environmental news, all citizen reports or one selected report — I'll keep it short and stick to what the data shows.
                </p>
                <p className="mt-3 text-[10px] font-medium text-[#66766b]">Try one of these:</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.slice(0, 6).map((suggestion) => (
                    <button key={suggestion} onClick={() => ask(suggestion)} className="rounded-xl border border-[#dfe6db] bg-[#ffffff] p-3 text-left text-[10px] leading-relaxed text-[#5a6a5f] hover:border-[#5b9e46]/35 hover:text-[#142016]">
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((message, index) =>
              message.role === 'user' ? (
                <div key={index} className="flex justify-end gap-2">
                  <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#5b9e46] px-4 py-2.5 text-[12px] font-medium text-[#111310]">{message.text}</div>
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#eaf2e4] text-[#5a6a5f]"><UserRound className="h-3.5 w-3.5" /></span>
                </div>
              ) : message.answer ? (
                message.answer.mode === 'conversational' ? (
                  <div key={index} className="flex gap-2">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#5b9e46]/15 text-[#3f7d2a]"><Bot className="h-3.5 w-3.5" /></span>
                    <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-[#dfe6db] bg-[#f5f8f2] px-4 py-3 text-[12px] leading-relaxed text-[#405246]">{message.answer.narrative}</div>
                  </div>
                ) : (
                <div key={index} className="flex gap-2">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#5b9e46]/15 text-[#3f7d2a]"><Bot className="h-3.5 w-3.5" /></span>
                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={message.answer.mode === 'conversational' ? 'teal' : message.answer.provider === 'RIVER_AI' ? 'lime' : 'amber'}>
                        {message.answer.mode === 'conversational' ? 'Conversational reply' : message.answer.provider === 'RIVER_AI' ? 'AI-generated explanation' : 'Rule-based evidence digest'}
                      </Badge>
                      <Badge tone={message.answer.status === 'COMPLETED' ? 'green' : 'neutral'}>{message.answer.status.replace(/_/g, ' ')}</Badge>
                      <span className="text-[9px] text-[#66766b]">{formatDate(message.answer.generatedAt)}</span>
                    </div>
                    <div className="rounded-2xl rounded-tl-sm border border-[#dfe6db] bg-[#f5f8f2] p-4">
                      <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[#405246]">{message.answer.narrative}</p>
                      {hasEvidence(message.answer) ? (
                        <details className="group mt-3">
                          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-[10px] font-semibold text-[#3f7d2a] hover:text-[#142016] [&::-webkit-details-marker]:hidden">
                            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                            Show the evidence
                          </summary>
                          <div className="mt-2 space-y-2">
                            {[
                              ['OBSERVED', message.answer.sections.observed, 'green'],
                              ['PREDICTED', message.answer.sections.predicted, 'teal'],
                              ['REPORTED / UNVERIFIED', message.answer.sections.reported, 'amber'],
                              ['ANALYSIS / REASONING', message.answer.sections.estimated, 'neutral'],
                              ['REFERENCE STANDARDS', message.answer.sections.standards, 'neutral'],
                              ['LIMITATIONS', message.answer.sections.limitations, 'red'],
                              ['SUGGESTED NEXT ACTIONS', message.answer.sections.nextActions, 'lime'],
                            ].map(([label, items, tone]) => Array.isArray(items) && items.length ? (
                              <div key={String(label)} className="rounded-xl border border-[#e7ece3] bg-[#ffffff] p-3">
                                <Badge tone={tone as never}>{String(label)}</Badge>
                                <ul className="mt-2 space-y-1.5 text-[10px] leading-relaxed text-[#5a6a5f]">
                                  {items.map((item, itemIndex) => <li key={itemIndex} className="flex gap-2"><span className="text-[#66766b]">—</span><AiActionText text={item} /></li>)}
                                </ul>
                              </div>
                            ) : null)}
                          </div>
                          {message.answer.citations.length ? (
                            <div className="mt-3 rounded-xl border border-[#e7ece3] bg-[#ffffff] p-3">
                              <DataLabel>Citations</DataLabel>
                              <ul className="mt-2 space-y-1 text-[10px] text-[#5a6a5f]">
                                {message.answer.citations.map((citation, citationIndex) => (
                                  <li key={citationIndex}>{citation.title} · {citation.section} · {citation.authority}{citation.url ? <> · <a href={citation.url} target="_blank" rel="noreferrer" className="text-[#3f7d2a] underline">source</a></> : null}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </details>
                      ) : null}
                      {message.answer.disclaimer ? <p className="mt-3 text-[9px] leading-relaxed text-[#66766b]">{message.answer.disclaimer}</p> : null}
                    </div>
                  </div>
                </div>
                )
              ) : (
                <div key={index} className="flex gap-2">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#eaf2e4] text-[#5a6a5f]"><Bot className="h-3.5 w-3.5" /></span>
                  <div className="rounded-2xl rounded-tl-sm border border-[#dfe6db] bg-[#f5f8f2] px-4 py-3 text-[11px] text-[#5a6a5f]">{message.text}</div>
                </div>
              ),
            )}
            {loading ? (
              <div className="flex items-center gap-2 text-[11px] text-[#6f7f74]"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5b9e46]/10"><BrainCircuit className="h-3.5 w-3.5 animate-pulse text-[#3f7d2a]" /></span> {waitingForServer ? 'The server is updating. Retrying automatically…' : 'Let me look into that…'}</div>
            ) : null}
            <div ref={bottomRef} />
          </div>
          <div className="border-t border-[#e7ece3] p-3">
            {failedPrompt ? (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-900">
                <span>That question did not complete. You can try it again.</span>
                <Button variant="dark" size="sm" onClick={() => ask(failedPrompt)} disabled={loading}>Retry question</Button>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
                rows={2}
                maxLength={1200}
                placeholder={reportId ? 'Ask about this report, its evidence or next checks…' : 'Ask about the news, all reports, the air or a station…'}
                className="min-h-[48px] resize-none"
              />
              <Button variant="lime" size="icon" onClick={() => ask()} disabled={loading || !question.trim()} className="h-[48px] w-[48px] shrink-0" aria-label="Send question">
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1.5 text-[9px] text-[#66766b]">Enter to send · Shift+Enter for a new line</p>
          </div>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHeader><CardTitle>Analyst status</CardTitle><Badge tone={status?.river === 'CONFIGURED' ? 'green' : 'amber'}>{status?.river ?? '—'}</Badge></CardHeader>
            <div className="p-4 text-[10px] leading-relaxed text-[#5a6a5f]">
              <p>{status?.note ?? 'Loading status…'}</p>
              <div className="mt-3 space-y-2 border-t border-[#e7ece3] pt-3">
                <div className="flex items-center justify-between"><span>Vision</span><span className={status?.vision === 'CONFIGURED' ? 'text-emerald-600' : 'text-amber-600'}>{status?.vision ?? 'NOT_CONFIGURED'}</span></div>
                <div className="flex items-center justify-between"><span>Mode</span><span className="text-[#26362a]">{status?.mode ?? '—'}</span></div>
                <div className="flex items-center justify-between"><span>Answers from records</span><span className="text-emerald-600">Always</span></div>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader><CardTitle>Suggested questions</CardTitle></CardHeader>
            <div className="space-y-1.5 p-3">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} onClick={() => ask(suggestion)} className="block w-full rounded-lg px-2.5 py-2 text-left text-[10px] leading-relaxed text-[#5a6a5f] hover:bg-[#eaf2e4] hover:text-[#142016]">
                  {suggestion}
                </button>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader><CardTitle>Response rules</CardTitle><ShieldAlert className="h-4 w-4 text-[#3f7d2a]" /></CardHeader>
            <div className="space-y-2 p-4 text-[10px] leading-relaxed text-[#6f7f74]">
              <p className="flex gap-2"><Info className="mt-0.5 h-3 w-3 shrink-0 text-[#2f8f84]" /> Every number comes from the app's records.</p>
              <p className="flex gap-2"><Info className="mt-0.5 h-3 w-3 shrink-0 text-[#2f8f84]" /> Regulatory references name the exact document and section.</p>
              <p className="flex gap-2"><Info className="mt-0.5 h-3 w-3 shrink-0 text-[#2f8f84]" /> When the evidence is thin, I say so instead of guessing.</p>
              <p className="flex gap-2"><Info className="mt-0.5 h-3 w-3 shrink-0 text-[#2f8f84]" /> I can't declare an official violation — only an authorised officer can.</p>
              <Link to="/data-sources" className="mt-2 inline-flex items-center gap-1 font-semibold text-[#3f7d2a]">Source status <ArrowUpRight className="h-3 w-3" /></Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
