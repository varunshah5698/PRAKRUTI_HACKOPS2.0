import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, BookOpen, ExternalLink, Scale, Search, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, CardHeader, CardTitle, DataLabel, EmptyState, Input, LoadingBlock, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { CATEGORY_LABELS, categoryLabel, formatDate, number } from '../../lib/format';

interface Standard {
  id: string; category: string; parameter: string; parameter_code: string | null; operator: string;
  threshold_value: number | null; threshold_max: number | null; unit: string; averaging_period: string;
  applicability: string; section_ref: string; notes: string; document_id: string; document_title: string;
  short_title: string; authority: string; url: string | null; verification_status: string; published_at: string | null;
}
interface DocumentRow {
  id: string; title: string; short_title: string; authority: string; category: string; url: string | null;
  verification_status: string; summary: string; published_at: string | null; effective_from: string | null; standard_count: number;
}
interface StationOption { id: string; name: string; stationType: string; localityName: string | null; values: Record<string, { value: number; unit: string }>; }
interface Comparison {
  standard: Standard;
  comparison: { observedValue: number; observedUnit: string; observedAt: string; qualityState: string; sourceId: string; isSimulated: boolean; comparability: string; reason: string; indicative: string; label: string };
}

export function CompliancePage() {
  const [standards, setStandards] = useState<Standard[]>([]);
  const [stations, setStations] = useState<StationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [stationId, setStationId] = useState('');
  const [parameter, setParameter] = useState('pm25');
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [caution, setCaution] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ standards: Standard[] }>(`/compliance/standards${category ? `?category=${category}` : ''}`),
      api.get<{ stations: StationOption[] }>('/map/stations'),
    ])
      .then(([standardsResult, stationsResult]) => {
        setStandards(standardsResult.standards);
        setStations(stationsResult.stations);
        if (stationsResult.stations[0]) setStationId(stationsResult.stations[0].id);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load compliance data'))
      .finally(() => setLoading(false));
  }, [category]);

  useEffect(() => {
    if (!stationId) return;
    const station = stations.find((s) => s.id === stationId);
    const codes = Object.keys(station?.values ?? {});
    if (codes.length && !codes.includes(parameter)) setParameter(codes[0]);
  }, [stationId, stations]);

  const compare = async () => {
    if (!stationId || !parameter) return;
    setCompareLoading(true);
    setCompareError(null);
    try {
      const result = await api.get<{ comparisons: Comparison[]; caution: string }>(`/compliance/compare?stationId=${stationId}&parameter=${parameter}`);
      setComparisons(result.comparisons);
      setCaution(result.caution);
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : 'Comparison failed');
      setComparisons([]);
    } finally {
      setCompareLoading(false);
    }
  };

  const filtered = standards.filter((standard) => !query || standard.parameter.toLowerCase().includes(query.toLowerCase()) || standard.document_title.toLowerCase().includes(query.toLowerCase()));

  if (loading) return <LoadingBlock className="min-h-[60vh]" label="Loading regulatory intelligence" />;
  if (error) return <EmptyState title="Compliance data unavailable" description={error} icon={<AlertTriangle className="h-5 w-5" />} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Badge tone="teal" dot>Reference only</Badge><Badge tone="neutral">Averaging-aware</Badge></div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">Regulatory intelligence</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[#788493]">
            Standards are stored with document, section, unit, averaging period and applicability. Comparisons are labelled NOT COMPARABLE when unit,
            averaging or source type does not match. Only an authorised officer can record a determination.
          </p>
        </div>
        <Link to="/compliance/documents"><Button variant="dark" size="sm"><BookOpen className="h-3.5 w-3.5" /> Documents</Button></Link>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader><CardTitle>Reference standards</CardTitle><Badge tone="neutral">{filtered.length}</Badge></CardHeader>
          <div className="flex flex-wrap gap-2 border-b border-[#2b333e] p-3">
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 w-[170px] text-[11px]">
              <option value="">All categories</option>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6f7c89]" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search parameter or document" className="h-9 pl-9 text-[11px]" />
            </div>
          </div>
          <div className="scrollbar-thin max-h-[620px] overflow-auto">
            {filtered.map((standard) => (
              <div key={standard.id} className="border-b border-[#252d37] p-4 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><Badge tone="neutral">{categoryLabel(standard.category)}</Badge><Badge tone={standard.verification_status === 'REFERENCE_ONLY' ? 'amber' : 'green'}>{standard.verification_status.replace(/_/g, ' ')}</Badge></div>
                  <span className="text-[9px] text-[#6f7c89]">{standard.averaging_period}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-[#e8edf2]">{standard.parameter} {standard.operator} {standard.threshold_value ?? ''}{standard.threshold_max ? `–${standard.threshold_max}` : ''} <span className="text-[#a2adba]">{standard.unit}</span></p>
                <p className="mt-1 text-[10px] text-[#8d99a6]">{standard.document_title} · {standard.section_ref}</p>
                <p className="mt-1 text-[9px] leading-relaxed text-[#6f7c89]">{standard.applicability}. {standard.notes}</p>
                {standard.url ? <a href={standard.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[9px] text-[#b5e36b] underline">Official reference <ExternalLink className="h-3 w-3" /></a> : null}
              </div>
            ))}
            {filtered.length === 0 ? <EmptyState title="No standards match" description="Clear filters or search a different parameter." /> : null}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Evidence comparison</CardTitle><Scale className="h-4 w-4 text-[#b5e36b]" /></CardHeader>
            <div className="space-y-3 p-4">
              <div>
                <DataLabel>Station</DataLabel>
                <Select value={stationId} onChange={(e) => setStationId(e.target.value)} className="mt-1 h-9 text-[11px]">
                  {stations.map((station) => <option key={station.id} value={station.id}>{station.name.replace(' demo air monitor', '')} · {station.stationType.replace(/_/g, ' ')}</option>)}
                </Select>
              </div>
              <div>
                <DataLabel>Parameter</DataLabel>
                <Select value={parameter} onChange={(e) => setParameter(e.target.value)} className="mt-1 h-9 text-[11px]">
                  {Object.entries(stations.find((s) => s.id === stationId)?.values ?? {}).map(([code, value]) => <option key={code} value={code}>{code.toUpperCase()} · {value.unit}</option>)}
                </Select>
              </div>
              <Button variant="lime" size="sm" className="w-full" onClick={compare} disabled={compareLoading}>{compareLoading ? 'Comparing…' : 'Compare observation with reference'}</Button>
              {compareError ? <p className="rounded-lg border border-red-500/25 bg-red-500/10 p-2 text-[10px] text-red-200">{compareError}</p> : null}
            </div>
          </Card>

          {comparisons.length ? (
            <div className="space-y-3">
              {comparisons.map(({ standard, comparison }) => (
                <Card key={standard.id} className={comparison.comparability !== 'COMPARABLE_REFERENCE' ? 'border-amber-500/25' : comparison.indicative === 'ABOVE_REFERENCE' ? 'border-orange-500/30' : 'border-emerald-500/20'}>
                  <div className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge tone={comparison.comparability === 'COMPARABLE_REFERENCE' ? (comparison.indicative === 'ABOVE_REFERENCE' ? 'amber' : 'green') : 'neutral'}>{comparison.comparability.replace(/_/g, ' ')}</Badge>
                      <span className="text-[9px] text-[#6f7c89]">{formatDate(comparison.observedAt)}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-[#e8edf2]">{comparison.label}</p>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                      <div><DataLabel>Observed</DataLabel><p className="mt-1 font-semibold">{number(comparison.observedValue)} {comparison.observedUnit}</p></div>
                      <div><DataLabel>Reference</DataLabel><p className="mt-1 font-semibold">{standard.operator} {standard.threshold_value ?? ''}{standard.threshold_max ? `–${standard.threshold_max}` : ''} {standard.unit}</p></div>
                      <div><DataLabel>Averaging</DataLabel><p className="mt-1 font-semibold">{standard.averaging_period}</p></div>
                    </div>
                    <p className="mt-2 text-[9px] leading-relaxed text-[#8d99a6]">{comparison.reason}</p>
                    <p className="mt-1 text-[9px] text-[#6f7c89]">{standard.document_title} · {standard.section_ref}</p>
                    {comparison.isSimulated ? <p className="mt-1 text-[9px] text-amber-300/70">Observation is simulation-labelled.</p> : null}
                  </div>
                </Card>
              ))}
              <p className="rounded-xl border border-[#303945] bg-[#101317] p-3 text-[9px] leading-relaxed text-[#6f7c89]">{caution}</p>
            </div>
          ) : (
            <Card className="p-4 text-[10px] leading-relaxed text-[#788493]">
              <ShieldCheck className="mb-2 h-4 w-4 text-[#b5e36b]" />
              A comparison is only shown after you select a station and parameter. The engine checks unit, averaging period and source type before labelling a potential concern. It never declares a violation.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export function ComplianceDocumentsPage() {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ documents: DocumentRow[] }>('/compliance/documents')
      .then((result) => setDocuments(result.documents))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load documents'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingBlock className="min-h-[50vh]" label="Loading regulatory documents" />;
  if (error) return <EmptyState title="Documents unavailable" description={error} icon={<AlertTriangle className="h-5 w-5" />} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Badge tone="teal" dot>Verified source registry</Badge><Badge tone="amber">Reference only</Badge></div>
          <h2 className="display mt-2 text-[26px] font-bold tracking-[-0.04em]">Regulatory documents</h2>
          <p className="mt-1 text-[11px] text-[#788493]">Documents are stored with authority, publication metadata and section-level standards. Applicability and current amendments must be confirmed against the official text.</p>
        </div>
        <Link to="/compliance"><Button variant="dark" size="sm"><Scale className="h-3.5 w-3.5" /> Back to compliance</Button></Link>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {documents.map((document) => (
          <Card key={document.id}>
            <CardHeader><CardTitle>{document.short_title}</CardTitle><Badge tone="neutral">{document.standard_count} standards</Badge></CardHeader>
            <div className="p-4">
              <p className="text-[11px] font-medium text-[#dbe2e9]">{document.title}</p>
              <p className="mt-1 text-[10px] text-[#8d99a6]">{document.authority} · {document.category}</p>
              <p className="mt-2 text-[10px] leading-relaxed text-[#788493]">{document.summary}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[9px] text-[#6f7c89]">
                <Badge tone={document.verification_status === 'REFERENCE_ONLY' ? 'amber' : 'green'}>{document.verification_status.replace(/_/g, ' ')}</Badge>
                {document.published_at ? <span>Published {formatDate(document.published_at, false)}</span> : null}
                {document.url ? <a href={document.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#b5e36b] underline">Official source <ExternalLink className="h-3 w-3" /></a> : null}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
