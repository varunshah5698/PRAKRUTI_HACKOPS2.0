import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Bot, BrainCircuit, Info, Send, ShieldAlert, Sparkles, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel, LoadingBlock, Select, Textarea } from '../../components/ui';
import { api } from '../../lib/api';
import { CATEGORY_LABELS, formatDate } from '../../lib/format';

interface AiAnswer {
  status: string;
  provider: string;
  model: string | null;
  generatedAt: string;
  question: string;
  narrative: string;
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

const SUGGESTIONS = [
  'Which Mumbai areas show rising PM2.5?',
  'What could happen at the selected station in three hours?',
  'Which stations are reporting abnormal trends?',
  'Is the observed pollution increase consistent with wind conditions?',
  'What evidence supports the current warning?',
  'Are there nearby citizen reports?',
  'What standards may apply, and what evidence is missing?',
  'What should an authority investigate next?',
];

export function AiAnalystPage() {
  const [stations, setStations] = useState<StationOption[]>([]);
  const [stationId, setStationId] = useState('');
  const [category, setCategory] = useState('air');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text?: string; answer?: AiAnswer }>>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ river: string; model: string | null; vision: string; mode: string; note: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    api.get<{ stations: Array<{ id: string; name: string; stationType: string; localityName: string | null; isSimulated: boolean }> }>('/map/stations').then((result) => {
      setStations(result.stations);
      const first = result.stations.find((s) => s.stationType === 'AIR_CAAQMS') ?? result.stations[0];
      if (first) setStationId(first.id);
    }).catch(() => undefined);
    api.get<{ river: string; model: string | null; vision: string; mode: string; note: string }>('/ai/status').then(setStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    const match = stations.find((s) =>
      category === 'air' ? s.stationType === 'AIR_CAAQMS' : category === 'water' ? s.stationType === 'WATER_SAMPLING' : category === 'industrial' ? s.stationType === 'INDUSTRIAL_STACK' : true,
    );
    setStationId(match?.id ?? '');
  }, [category, stations]);

  const ask = async (text?: string) => {
    const prompt = (text ?? question).trim();
    if (!prompt || loading) return;
    setMessages((prev) => [...prev, { role: 'user', text: prompt }]);
    setQuestion('');
    setLoading(true);
    try {
      const answer = await api.post<AiAnswer>('/ai/chat', {
        question: prompt,
        stationId: stationId || undefined,
        category,
      });
      setMessages((prev) => [...prev, { role: 'assistant', answer }]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'AI request failed');
      setMessages((prev) => [...prev, { role: 'assistant', text: 'The analysis request failed. No answer was generated.' }]);
    } finally {
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
            <Badge tone="neutral">Three analysis systems</Badge>
            <Badge tone="neutral">Grounded in application records</Badge>
          </div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">AI environmental analyst</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[#788493]">
            Observation & anomaly, predictive explanation and compliance context are kept separate. The assistant explains supplied evidence;
            it cannot invent readings, create forecasts or override model output.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 w-[170px] text-[11px]">
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select value={stationId} onChange={(e) => setStationId(e.target.value)} className="h-9 w-[240px] text-[11px]">
            <option value="">Citywide context</option>
            {stations.filter((s) => category === 'air' ? s.stationType === 'AIR_CAAQMS' : category === 'water' ? s.stationType === 'WATER_SAMPLING' : category === 'industrial' ? s.stationType === 'INDUSTRIAL_STACK' : true).map((station) => (
              <option key={station.id} value={station.id}>{station.name}</option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card className="flex min-h-[620px] flex-col">
          <CardHeader>
            <div><CardTitle>Grounded analysis</CardTitle><p className="mt-1 text-[10px] text-[#6f7c89]">Answers are labelled OBSERVED / PREDICTED / REPORTED / ESTIMATED / AI-GENERATED</p></div>
            <Badge tone="teal">Evidence first</Badge>
          </CardHeader>
          <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="rounded-2xl border border-[#303945] bg-[#101317] p-5">
                <div className="flex items-center gap-2 text-[#b5e36b]"><Sparkles className="h-4 w-4" /><span className="text-xs font-semibold">Ask about Mumbai evidence</span></div>
                <p className="mt-2 text-[11px] leading-relaxed text-[#8d99a6]">
                  The analyst retrieves observations, forecasts, reports, alerts and reference standards from this application. If River AI is not configured,
                  the server returns a rule-based digest instead of pretending an LLM answered.
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.slice(0, 6).map((suggestion) => (
                    <button key={suggestion} onClick={() => ask(suggestion)} className="rounded-xl border border-[#303945] bg-[#181d23] p-3 text-left text-[10px] leading-relaxed text-[#a2adba] hover:border-[#b5e36b]/35 hover:text-white">
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((message, index) =>
              message.role === 'user' ? (
                <div key={index} className="flex justify-end gap-2">
                  <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#b5e36b] px-4 py-2.5 text-[12px] font-medium text-[#111310]">{message.text}</div>
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#29323d] text-[#a2adba]"><UserRound className="h-3.5 w-3.5" /></span>
                </div>
              ) : message.answer ? (
                <div key={index} className="flex gap-2">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#b5e36b]/15 text-[#b5e36b]"><Bot className="h-3.5 w-3.5" /></span>
                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={message.answer.provider === 'RIVER_AI' ? 'lime' : 'amber'}>
                        {message.answer.provider === 'RIVER_AI' ? 'AI-generated explanation' : 'Rule-based evidence digest'}
                      </Badge>
                      <Badge tone={message.answer.status === 'COMPLETED' ? 'green' : 'neutral'}>{message.answer.status.replace(/_/g, ' ')}</Badge>
                      <span className="text-[9px] text-[#5f6b78]">{formatDate(message.answer.generatedAt)}</span>
                    </div>
                    <div className="rounded-2xl rounded-tl-sm border border-[#303945] bg-[#101317] p-4">
                      <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[#c5d0db]">{message.answer.narrative}</p>
                      <div className="mt-3 space-y-2">
                        {[
                          ['OBSERVED', message.answer.sections.observed, 'green'],
                          ['PREDICTED', message.answer.sections.predicted, 'teal'],
                          ['REPORTED / UNVERIFIED', message.answer.sections.reported, 'amber'],
                          ['ESTIMATED', message.answer.sections.estimated, 'neutral'],
                          ['REFERENCE STANDARDS', message.answer.sections.standards, 'neutral'],
                          ['LIMITATIONS', message.answer.sections.limitations, 'red'],
                          ['SUGGESTED NEXT ACTIONS', message.answer.sections.nextActions, 'lime'],
                        ].map(([label, items, tone]) => Array.isArray(items) && items.length ? (
                          <div key={String(label)} className="rounded-xl border border-[#2b333e] bg-[#181d23] p-3">
                            <Badge tone={tone as never}>{String(label)}</Badge>
                            <ul className="mt-2 space-y-1.5 text-[10px] leading-relaxed text-[#a2adba]">
                              {items.map((item, itemIndex) => <li key={itemIndex} className="flex gap-2"><span className="text-[#6f7c89]">—</span>{item}</li>)}
                            </ul>
                          </div>
                        ) : null)}
                      </div>
                      {message.answer.citations.length ? (
                        <div className="mt-3 rounded-xl border border-[#2b333e] bg-[#181d23] p-3">
                          <DataLabel>Citations</DataLabel>
                          <ul className="mt-2 space-y-1 text-[10px] text-[#a2adba]">
                            {message.answer.citations.map((citation, citationIndex) => (
                              <li key={citationIndex}>{citation.title} · {citation.section} · {citation.authority}{citation.url ? <> · <a href={citation.url} target="_blank" rel="noreferrer" className="text-[#b5e36b] underline">source</a></> : null}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <p className="mt-3 text-[9px] leading-relaxed text-[#5f6b78]">{message.answer.disclaimer}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div key={index} className="flex gap-2">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#29323d] text-[#a2adba]"><Bot className="h-3.5 w-3.5" /></span>
                  <div className="rounded-2xl rounded-tl-sm border border-[#303945] bg-[#101317] px-4 py-3 text-[11px] text-[#8d99a6]">{message.text}</div>
                </div>
              ),
            )}
            {loading ? (
              <div className="flex items-center gap-2 text-[11px] text-[#788493]"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#b5e36b]/10"><BrainCircuit className="h-3.5 w-3.5 animate-pulse text-[#b5e36b]" /></span> Retrieving application evidence and building the analysis…</div>
            ) : null}
            <div ref={bottomRef} />
          </div>
          <div className="border-t border-[#2b333e] p-3">
            <div className="flex gap-2">
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
                rows={2}
                maxLength={1200}
                placeholder="Ask about observed conditions, forecasts, reports, standards or evidence gaps…"
                className="min-h-[48px] resize-none"
              />
              <Button variant="lime" size="icon" onClick={() => ask()} disabled={loading || !question.trim()} className="h-[48px] w-[48px] shrink-0" aria-label="Send question">
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1.5 text-[9px] text-[#5f6b78]">Enter to send · Shift+Enter for a new line · Prompt injection is treated as untrusted data.</p>
          </div>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHeader><CardTitle>Analyst status</CardTitle><Badge tone={status?.river === 'CONFIGURED' ? 'green' : 'amber'}>{status?.river ?? '—'}</Badge></CardHeader>
            <div className="p-4 text-[10px] leading-relaxed text-[#8d99a6]">
              <p>{status?.note ?? 'Loading status…'}</p>
              <div className="mt-3 space-y-2 border-t border-[#2b333e] pt-3">
                <div className="flex items-center justify-between"><span>Vision</span><span className="text-amber-300">{status?.vision ?? 'NOT_CONFIGURED'}</span></div>
                <div className="flex items-center justify-between"><span>Mode</span><span className="text-[#dbe2e9]">{status?.mode ?? '—'}</span></div>
                <div className="flex items-center justify-between"><span>Grounded evidence</span><span className="text-emerald-300">Required</span></div>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader><CardTitle>Suggested questions</CardTitle></CardHeader>
            <div className="space-y-1.5 p-3">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} onClick={() => ask(suggestion)} className="block w-full rounded-lg px-2.5 py-2 text-left text-[10px] leading-relaxed text-[#a2adba] hover:bg-[#29323d] hover:text-white">
                  {suggestion}
                </button>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader><CardTitle>Response rules</CardTitle><ShieldAlert className="h-4 w-4 text-[#b5e36b]" /></CardHeader>
            <div className="space-y-2 p-4 text-[10px] leading-relaxed text-[#788493]">
              <p className="flex gap-2"><Info className="mt-0.5 h-3 w-3 shrink-0 text-[#56c1b3]" /> Every numeric claim must come from supplied evidence.</p>
              <p className="flex gap-2"><Info className="mt-0.5 h-3 w-3 shrink-0 text-[#56c1b3]" /> Standards require exact document and section references.</p>
              <p className="flex gap-2"><Info className="mt-0.5 h-3 w-3 shrink-0 text-[#56c1b3]" /> Missing evidence is stated, not filled with assumptions.</p>
              <p className="flex gap-2"><Info className="mt-0.5 h-3 w-3 shrink-0 text-[#56c1b3]" /> No official violation is declared by the assistant.</p>
              <Link to="/data-sources" className="mt-2 inline-flex items-center gap-1 font-semibold text-[#b5e36b]">Source status <ArrowUpRight className="h-3 w-3" /></Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
