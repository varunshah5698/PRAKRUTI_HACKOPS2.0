import { aqiCategory, aqiFromPm25 } from './aqi';
import { AQI_COLORS, CATEGORY_LABELS, number as formatNumber, windDirection } from './format';

export type ReportCategory = 'air' | 'water' | 'waste' | 'industrial';

export function categoryOf(value?: string | null): ReportCategory {
  return value === 'water' || value === 'waste' || value === 'industrial' ? value : 'air';
}

export interface RawReading {
  value: number;
  unit: string;
  observedAt: string;
  sourceId: string;
  isSimulated: boolean;
}

export interface RawStation {
  id: string;
  name: string;
  station_type?: string | null;
  lat?: number | null;
  lng?: number | null;
  distance_m: number;
  latest_readings: Record<string, RawReading> | null;
}

export interface RawNearbyReport {
  id: string;
  public_ref: string;
  category: string;
  incident_type: string;
  status: string;
  verification_state: string;
  distance_m: number;
  submitted_at: string;
  lat?: number | null;
  lng?: number | null;
  is_simulated?: boolean;
}

export interface RawAlert {
  id: string;
  public_ref: string;
  category?: string;
  level: string;
  state: string;
  trigger_type: string;
  title: string;
  triggered_at: string;
}

export interface RawIncident {
  id: string;
  public_ref: string;
  category?: string;
  title: string;
  status: string;
  risk_level: string;
  detected_at: string;
  distance_m: number;
}

export interface RawWeather {
  observed_at: string;
  temperature_c: number;
  relative_humidity: number;
  wind_speed_kmh: number;
  wind_direction_deg: number;
  precipitation_mm?: number;
  is_simulated?: boolean;
  source_id: string;
}

export interface RawEvidence {
  id: string;
  mime_type?: string;
  size_bytes?: number;
  sha256?: string;
  gps_consistency: string;
  malware_scan_status: string;
  uploaded_at?: string;
}

export interface RawAssessment {
  id?: string;
  assessment_type: string;
  provider: string;
  model?: string | null;
  status: string;
  created_at?: string;
}

export interface RawAudit {
  action: string;
  created_at: string;
  after?: Record<string, unknown> | null;
}

export interface ReportFacts {
  id: string;
  public_ref: string;
  category: string;
  incident_type: string;
  description: string;
  status: string;
  verification_state: string;
  occurred_at: string;
  submitted_at: string;
  locality_name: string | null;
  lat: number;
  lng: number;
  consent: boolean;
  is_simulated: boolean;
}

export interface AnalysisInput {
  report: ReportFacts;
  evidence: RawEvidence[];
  aiAssessments: RawAssessment[];
  enrichment: {
    stations: RawStation[];
    weather: RawWeather | null;
    nearbyReports: RawNearbyReport[];
    alerts: RawAlert[];
    incidents: RawIncident[];
  };
  audit: RawAudit[];
}

export type ComparisonStatus = 'meets' | 'exceeds' | 'below' | 'above' | 'within' | 'unrated';

export interface ComparisonReference {
  kind: 'max' | 'min' | 'range';
  label: string;
  value?: number;
  min?: number;
  max?: number;
}

export interface ReadingComparison {
  code: string;
  label: string;
  value: number;
  unit: string;
  scaleMax: number;
  fraction: number;
  status: ComparisonStatus;
  reference: ComparisonReference | null;
  note: string;
}

export interface StationInsight {
  id: string;
  name: string;
  typeLabel: string;
  lat: number | null;
  lng: number | null;
  distance_m: number;
  observedAt: string | null;
  isSimulated: boolean;
  isStale: boolean;
  comparisons: ReadingComparison[];
  primary: ReadingComparison | null;
  severity: number;
  tone: string;
  headline: string;
}

export interface DimensionFactor {
  id: string;
  label: string;
  points: number;
  max: number;
  applicable: boolean;
  detail: string;
}

export interface AnalysisDimension {
  key: 'evidence' | 'environment' | 'community';
  label: string;
  score: number;
  factors: DimensionFactor[];
  summary: string;
}

export interface NextCheck {
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
}

export interface TimelineEntry {
  id: string;
  action: string;
  label: string;
  at: string;
  detail: string | null;
}

export interface ReportAnalysis {
  category: ReportCategory;
  dimensions: AnalysisDimension[];
  overall: number;
  grade: { label: string; tone: string; note: string };
  stations: StationInsight[];
  primaryStation: StationInsight | null;
  nearbySameCategory: RawNearbyReport[];
  nearbyVerified: RawNearbyReport[];
  alerts: RawAlert[];
  incidents: RawIncident[];
  weather: {
    raw: RawWeather;
    direction: string;
    dispersion: string;
    dispersionTone: string;
    note: string;
  } | null;
  brief: {
    headline: string;
    paragraphs: string[];
    nextChecks: NextCheck[];
    limitations: string[];
    provenance: string[];
  };
  timeline: TimelineEntry[];
}

const STATION_TYPE: Record<ReportCategory, string | null> = {
  air: 'AIR_CAAQMS',
  water: 'WATER_SAMPLING',
  waste: null,
  industrial: 'INDUSTRIAL_STACK',
};

const TYPE_LABEL: Record<ReportCategory, string> = {
  air: 'Ambient air monitor',
  water: 'Water sampling point',
  waste: 'No waste monitor type',
  industrial: 'Stack monitor',
};

const READING_ORDER: Record<ReportCategory, string[]> = {
  air: ['pm25', 'pm10', 'no2', 'so2', 'co', 'o3'],
  water: ['do', 'ph', 'turbidity', 'conductivity'],
  waste: [],
  industrial: ['stack_pm', 'stack_nox', 'stack_so2'],
};

const AIR_REFERENCES: Record<string, { label: string; value: number; scaleMax: number }> = {
  pm25: { label: 'PM2.5 24h screening reference', value: 60, scaleMax: 120 },
  pm10: { label: 'PM10 24h screening reference', value: 100, scaleMax: 200 },
  no2: { label: 'NO₂ 24h reference', value: 80, scaleMax: 160 },
  so2: { label: 'SO₂ 24h reference', value: 80, scaleMax: 160 },
  co: { label: 'CO 8h reference', value: 2, scaleMax: 4 },
  o3: { label: 'O₃ 8h reference', value: 100, scaleMax: 200 },
};

const WATER_SCALES: Record<string, { label: string; scaleMax: number }> = {
  do: { label: 'Dissolved oxygen', scaleMax: 10 },
  ph: { label: 'pH', scaleMax: 14 },
  turbidity: { label: 'Turbidity', scaleMax: 120 },
  conductivity: { label: 'Conductivity', scaleMax: 1500 },
};

const INDUSTRIAL_LABELS: Record<string, string> = {
  stack_pm: 'Stack particulate matter',
  stack_nox: 'Stack nitrogen oxides',
  stack_so2: 'Stack sulphur dioxide',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const ageHours = (value: string | null | undefined) => {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - time) / 3_600_000);
};

function readingMatchesCategory(code: string, category: ReportCategory): boolean {
  if (category === 'waste') return false;
  if (category === 'air') return ['pm25', 'pm10', 'no2', 'so2', 'co', 'o3'].includes(code);
  if (category === 'water') return ['ph', 'do', 'turbidity', 'conductivity'].includes(code);
  return code.startsWith('stack_');
}

export function stationMatchesCategory(station: RawStation, category: ReportCategory): boolean {
  if (category === 'waste') return false;
  if (station.station_type) return station.station_type === STATION_TYPE[category];
  const codes = Object.keys(station.latest_readings ?? {});
  return codes.some((code) => readingMatchesCategory(code, category));
}

function comparisonFor(
  category: ReportCategory,
  code: string,
  reading: RawReading,
  stackMax: number,
): ReadingComparison {
  const value = reading.value;
  if (category === 'air') {
    const spec = AIR_REFERENCES[code];
    const scaleMax = spec?.scaleMax ?? Math.max(100, value * 1.5);
    const reference = spec?.value ?? null;
    return {
      code,
      label: spec?.label.split(' ')[0] ?? code.toUpperCase(),
      value,
      unit: reading.unit,
      scaleMax,
      fraction: clamp(value / scaleMax, 0, 1),
      status: reference === null ? 'unrated' : value > reference ? 'exceeds' : 'meets',
      reference: reference === null ? null : { kind: 'max', label: spec.label, value: reference },
      note: reference === null ? 'No screening reference loaded.' : `Compared with ${spec.label}.`,
    };
  }

  if (category === 'water') {
    const spec = WATER_SCALES[code];
    const scaleMax = spec?.scaleMax ?? Math.max(10, value * 1.5);
    if (code === 'do') {
      return {
        code,
        label: 'Dissolved oxygen',
        value,
        unit: reading.unit,
        scaleMax,
        fraction: clamp(value / scaleMax, 0, 1),
        status: value < 5 ? 'below' : 'meets',
        reference: { kind: 'min', label: 'CPCB outdoor bathing criterion · minimum 5 mg/L', value: 5 },
        note: value < 5 ? 'Below the 5 mg/L screening minimum.' : 'At or above the 5 mg/L screening minimum.',
      };
    }
    if (code === 'ph') {
      const within = value >= 6.5 && value <= 8.5;
      return {
        code,
        label: 'pH',
        value,
        unit: reading.unit,
        scaleMax,
        fraction: clamp(value / scaleMax, 0, 1),
        status: within ? 'within' : value < 6.5 ? 'below' : 'above',
        reference: { kind: 'range', label: 'CPCB outdoor bathing range 6.5–8.5', min: 6.5, max: 8.5 },
        note: within ? 'Inside the 6.5–8.5 screening range.' : 'Outside the 6.5–8.5 screening range.',
      };
    }
    return {
      code,
      label: spec?.label ?? code.toUpperCase(),
      value,
      unit: reading.unit,
      scaleMax,
      fraction: clamp(value / scaleMax, 0, 1),
      status: 'unrated',
      reference: null,
      note: 'No numeric screening reference is loaded for this parameter.',
    };
  }

  if (category === 'industrial') {
    return {
      code,
      label: INDUSTRIAL_LABELS[code] ?? code.replace(/_/g, ' ').toUpperCase(),
      value,
      unit: reading.unit,
      scaleMax: Math.max(1, stackMax),
      fraction: clamp(value / Math.max(1, stackMax), 0, 1),
      status: 'unrated',
      reference: null,
      note: 'No numeric stack reference is loaded. Height and bar show relative magnitude only.',
    };
  }

  return {
    code,
    label: code.replace(/_/g, ' ').toUpperCase(),
    value,
    unit: reading.unit,
    scaleMax: 1,
    fraction: 0,
    status: 'unrated',
    reference: null,
    note: 'No screening comparison is available for this category.',
  };
}

function buildStation(category: ReportCategory, station: RawStation, stackMax: number): StationInsight {
  const readings = station.latest_readings ?? {};
  const comparisons = READING_ORDER[category]
    .flatMap((code) => (readings[code] ? [comparisonFor(category, code, readings[code], stackMax)] : []));

  const primary = comparisons.find((row) => row.reference) ?? comparisons[0] ?? null;
  const severity = comparisons.reduce((highest, row) => {
    if (row.reference?.kind === 'max' && row.reference.value) return Math.max(highest, row.value / row.reference.value);
    if (row.reference?.kind === 'min' && row.reference.value) return Math.max(highest, row.reference.value / Math.max(0.01, row.value));
    if (row.reference?.kind === 'range') {
      const min = row.reference.min ?? 0;
      const max = row.reference.max ?? 0;
      const outside = row.value < min ? (min - row.value) / (max - min || 1) : row.value > max ? (row.value - max) / (max - min || 1) : 0;
      return Math.max(highest, 1 + outside);
    }
    return Math.max(highest, 0.35 + row.fraction * 0.6);
  }, 0);

  const observedAt = comparisons
    .map((row) => readings[row.code]?.observedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const isSimulated = comparisons.some((row) => readings[row.code]?.isSimulated);

  const pm25 = readings.pm25?.value;
  const indicativeAqi = pm25 === undefined ? null : aqiFromPm25(pm25);
  const tone = category === 'air'
    ? (indicativeAqi === null ? '#2d7c94' : AQI_COLORS[aqiCategory(indicativeAqi)] ?? '#2d7c94')
    : category === 'water'
      ? (comparisons.some((row) => row.status === 'below' || row.status === 'above') ? '#c97445' : '#2f8f84')
      : severity >= 0.8 ? '#cf7227' : severity >= 0.5 ? '#b3860f' : '#2d7c94';

  return {
    id: station.id,
    name: station.name,
    typeLabel: TYPE_LABEL[category],
    lat: typeof station.lat === 'number' && Number.isFinite(station.lat) ? station.lat : null,
    lng: typeof station.lng === 'number' && Number.isFinite(station.lng) ? station.lng : null,
    distance_m: station.distance_m,
    observedAt,
    isSimulated,
    isStale: ageHours(observedAt) > 6,
    comparisons,
    primary,
    severity: clamp(severity, 0.05, 1.5),
    tone,
    headline: primary
      ? `${primary.label} ${formatNumber(primary.value, 1)} ${primary.unit}`
      : 'No recent comparable reading',
  };
}

function scoreDimension(key: AnalysisDimension['key'], label: string, factors: DimensionFactor[], summary: string): AnalysisDimension {
  const applicable = factors.filter((factor) => factor.applicable);
  const possible = applicable.reduce((sum, factor) => sum + factor.max, 0);
  const points = applicable.reduce((sum, factor) => sum + factor.points, 0);
  return {
    key,
    label,
    score: possible > 0 ? Math.round((points / possible) * 100) : 0,
    factors,
    summary,
  };
}

function gradeFor(score: number): ReportAnalysis['grade'] {
  if (score >= 80) return { label: 'Robust', tone: '#2f8f66', note: 'Multiple independent evidence layers agree.' };
  if (score >= 60) return { label: 'Solid', tone: '#4e9b3f', note: 'Enough context to support an authority review.' };
  if (score >= 40) return { label: 'Developing', tone: '#b3860f', note: 'Some layers are present, but verification gaps remain.' };
  if (score >= 20) return { label: 'Thin', tone: '#cf7227', note: 'The report is a lead; independent evidence is limited.' };
  return { label: 'Insufficient', tone: '#c94a50', note: 'Too little evidence to support a determination.' };
}

function timelineFor(audit: RawAudit[]): TimelineEntry[] {
  const labels: Record<string, string> = {
    REPORT_SUBMITTED: 'Report submitted',
    REPORT_STATUS_CHANGED: 'Verification status changed',
    REPORT_LINKED_TO_INCIDENT: 'Linked to an investigation',
    EVIDENCE_VIEWED: 'Evidence accessed',
  };
  return [...audit]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((row, index) => {
      const after = row.after ?? {};
      const reason = typeof after.reason === 'string' ? after.reason : null;
      const status = typeof after.status === 'string' ? `Status ${after.status.replace(/_/g, ' ').toLowerCase()}.` : null;
      return {
        id: `${row.action}-${row.created_at}-${index}`,
        action: row.action,
        label: labels[row.action] ?? row.action.replace(/_/g, ' ').toLowerCase(),
        at: row.created_at,
        detail: reason ?? status,
      };
    });
}

export function buildReportAnalysis(input: AnalysisInput): ReportAnalysis {
  const { report, evidence, aiAssessments, enrichment, audit } = input;
  const category = categoryOf(report.category);
  const rawStations = enrichment.stations.filter((station) => stationMatchesCategory(station, category));
  const stackMax = Math.max(
    1,
    ...rawStations.map((station) => station.latest_readings?.stack_pm?.value ?? 0),
  );
  const stations = rawStations
    .map((station) => buildStation(category, station, stackMax))
    .sort((a, b) => a.distance_m - b.distance_m);

  const reportingStations = stations.filter((station) => station.comparisons.length > 0);
  const primaryStation = reportingStations.find((station) => station.primary) ?? reportingStations[0] ?? null;
  const nearbySameCategory = enrichment.nearbyReports
    .filter((row) => row.category === category)
    .sort((a, b) => a.distance_m - b.distance_m);
  const nearbyVerified = nearbySameCategory.filter((row) => row.verification_state === 'VERIFIED');
  const alerts = enrichment.alerts.filter((row) => !row.category || row.category === category);
  const incidents = enrichment.incidents.filter((row) => !row.category || row.category === category);

  const photoCount = evidence.length;
  const gpsMatch = evidence.some((row) => row.gps_consistency === 'MATCH');
  const gpsMissing = evidence.some((row) => row.gps_consistency === 'NO_GPS');
  const gpsMismatch = evidence.some((row) => row.gps_consistency === 'MISMATCH');
  const aiComplete = aiAssessments.some((row) => row.status === 'COMPLETED');
  const hasHash = evidence.some((row) => Boolean(row.sha256));
  const hasCleanScan = evidence.some((row) => row.malware_scan_status === 'CLEAN' || row.malware_scan_status === 'COMPLETED');
  const ageAtSubmission = (new Date(report.submitted_at).getTime() - new Date(report.occurred_at).getTime()) / 3_600_000;

  const evidenceFactors: DimensionFactor[] = [
    {
      id: 'photo',
      label: 'Photographic evidence',
      points: photoCount >= 2 ? 25 : photoCount === 1 ? 20 : 0,
      max: 25,
      applicable: true,
      detail: photoCount ? `${photoCount} private evidence file${photoCount > 1 ? 's' : ''} attached.` : 'No photograph attached. The description and location carry the report alone.',
    },
    {
      id: 'gps',
      label: 'Location consistency',
      points: gpsMatch ? 20 : gpsMismatch ? 0 : gpsMissing ? 8 : 0,
      max: 20,
      applicable: true,
      detail: gpsMatch
        ? 'At least one photograph carries GPS coordinates within 2 km of the claimed location.'
        : gpsMismatch
          ? 'A photograph GPS point is more than 2 km from the claimed location.'
          : gpsMissing
            ? 'A photograph has no GPS metadata. Location is not independently checked.'
            : 'No photographic GPS metadata is available.',
    },
    {
      id: 'ai',
      label: 'Visual screening',
      points: aiComplete ? 15 : 0,
      max: 15,
      applicable: true,
      detail: aiComplete ? 'A visual assessment completed.' : 'No completed visual assessment. Manual review is still required.',
    },
    {
      id: 'consent',
      label: 'Consent record',
      points: report.consent ? 10 : 0,
      max: 10,
      applicable: true,
      detail: report.consent ? 'Submission consent is recorded.' : 'Consent is not recorded.',
    },
    {
      id: 'hash',
      label: 'Chain-of-custody hash',
      points: hasHash ? 10 : 0,
      max: 10,
      applicable: true,
      detail: hasHash ? 'A SHA-256 evidence hash is stored.' : 'No evidence hash is stored.',
    },
    {
      id: 'scan',
      label: 'Malware scan',
      points: hasCleanScan ? 10 : 0,
      max: 10,
      applicable: true,
      detail: hasCleanScan ? 'An evidence scan is recorded.' : 'No malware scanner is configured. This is a known control gap, not an allegation about the file.',
    },
    {
      id: 'timeliness',
      label: 'Submission timeliness',
      points: ageAtSubmission >= 0 && ageAtSubmission <= 24 ? 10 : ageAtSubmission <= 72 ? 5 : 0,
      max: 10,
      applicable: true,
      detail: Number.isFinite(ageAtSubmission)
        ? `Submitted ${formatNumber(ageAtSubmission, 1)} hours after the reported occurrence.`
        : 'Occurrence time could not be compared with submission time.',
    },
  ];

  const hasMonitor = reportingStations.length > 0;
  const hasReferenceSignal = reportingStations.some((station) => station.primary?.reference);
  const strongest = reportingStations.reduce<StationInsight | null>((best, station) => (!best || station.severity > best.severity ? station : best), null);
  const concern = strongest?.primary?.status === 'exceeds' || strongest?.primary?.status === 'below' || strongest?.primary?.status === 'above';
  const weather = enrichment.weather;
  const rain = weather?.precipitation_mm ?? 0;
  const ventilated = Boolean(weather && (weather.wind_speed_kmh >= 10 || rain > 0.5));
  const environmentFactors: DimensionFactor[] = [
    {
      id: 'monitor',
      label: 'Category-matched monitor',
      points: hasMonitor ? 30 : stations.length ? 10 : 0,
      max: 30,
      applicable: category !== 'waste',
      detail: category === 'waste'
        ? 'No waste-monitoring station type exists in this deployment. Field inspection carries the evidence.'
        : stations.length
          ? `${reportingStations.length} of ${stations.length} matched ${TYPE_LABEL[category].toLowerCase()}${stations.length > 1 ? 's' : ''} has a recent reading.`
          : `No ${TYPE_LABEL[category].toLowerCase()} within 3 km.`,
    },
    {
      id: 'multiple',
      label: 'Monitor redundancy',
      points: reportingStations.length >= 2 ? 10 : 0,
      max: 10,
      applicable: category !== 'waste',
      detail: reportingStations.length >= 2 ? 'More than one category-matched monitor has a recent reading.' : 'Only one or no category-matched monitor has a recent reading.',
    },
    {
      id: 'signal',
      label: category === 'industrial' ? 'Relative stack signal' : 'Reading against screening reference',
      points: !hasMonitor ? 0 : !hasReferenceSignal && category !== 'industrial' ? 10 : concern ? 30 : 15,
      max: 30,
      applicable: category !== 'waste',
      detail: !hasMonitor
        ? 'No category-matched reading to compare.'
        : category === 'industrial'
          ? hasReferenceSignal
            ? 'A reading is present; the comparison is shown, but no stack reference is loaded.'
            : 'Relative stack magnitude across nearby monitors.'
          : concern
            ? `${primaryStation?.name ?? 'The nearest monitor'} is outside a loaded screening reference. This supports follow-up; it does not confirm the report.`
            : `${primaryStation?.name ?? 'The nearest monitor'} is inside the loaded screening references. That does not invalidate a local incident.`,
    },
    {
      id: 'weather',
      label: 'Weather context',
      points: weather ? 20 : 0,
      max: 20,
      applicable: true,
      detail: weather ? `Weather observation from ${weather.source_id}, ${weather.is_simulated ? 'simulation-labelled' : 'observed'}.` : 'No nearby weather observation.',
    },
    {
      id: 'ventilation',
      label: 'Dispersion context',
      points: ventilated ? 10 : 0,
      max: 10,
      applicable: Boolean(weather),
      detail: !weather
        ? 'No wind or rain context.'
        : ventilated
          ? 'Wind or rain supports dispersion at the reported time.'
          : 'Light wind and no rain indicate weak dispersion; local build-up is plausible.',
    },
  ];

  const communityFactors: DimensionFactor[] = [
    {
      id: 'same-category',
      label: 'Same-category reports nearby',
      points: nearbySameCategory.length >= 2 ? 35 : nearbySameCategory.length === 1 ? 25 : 0,
      max: 35,
      applicable: true,
      detail: nearbySameCategory.length
        ? `${nearbySameCategory.length} other ${CATEGORY_LABELS[category].toLowerCase()} report${nearbySameCategory.length > 1 ? 's' : ''} within 500 m.`
        : 'No other same-category report within 500 m.',
    },
    {
      id: 'verified-nearby',
      label: 'Verified nearby reports',
      points: nearbyVerified.length ? 15 : 0,
      max: 15,
      applicable: true,
      detail: nearbyVerified.length ? `${nearbyVerified.length} nearby report${nearbyVerified.length > 1 ? 's are' : ' is'} verified.` : 'None of the nearby same-category reports is verified.',
    },
    {
      id: 'alert',
      label: 'Open alert in this category',
      points: alerts.length ? 25 : 0,
      max: 25,
      applicable: true,
      detail: alerts.length ? `${alerts.length} open alert${alerts.length > 1 ? 's' : ''} in this category.` : 'No open alert in this category.',
    },
    {
      id: 'incident',
      label: 'Incident within 3 km',
      points: incidents.length ? 25 : 0,
      max: 25,
      applicable: true,
      detail: incidents.length ? `${incidents.length} incident${incidents.length > 1 ? 's' : ''} within 3 km.` : 'No incident within 3 km.',
    },
  ];

  const dimensions = [
    scoreDimension('evidence', 'Evidence integrity', evidenceFactors, photoCount ? 'The file record is stronger than the description alone.' : 'The report currently rests on text and coordinates.'),
    scoreDimension('environment', 'Environmental context', environmentFactors, category === 'waste' ? 'No waste monitor type exists; weather is the only environmental context.' : hasMonitor ? 'Nearby monitoring adds independent context, but not proof of this specific incident.' : 'No category-matched monitor is close enough to corroborate.'),
    scoreDimension('community', 'Community corroboration', communityFactors, nearbySameCategory.length || alerts.length || incidents.length ? 'Independent reports and case records raise review priority; they do not prove the report.' : 'Nothing nearby independently repeats or records the concern.'),
  ];
  const overall = Math.round(
    dimensions[0].score * 0.45 + dimensions[1].score * 0.3 + dimensions[2].score * 0.25,
  );
  const grade = gradeFor(overall);

  const windSpeed = weather?.wind_speed_kmh ?? 0;
  const dispersion = windSpeed >= 18 || rain >= 2 ? 'Strong ventilation' : windSpeed >= 10 || rain > 0.2 ? 'Moderate dispersion' : 'Weak dispersion';
  const dispersionTone = windSpeed >= 18 || rain >= 2 ? '#2f8f66' : windSpeed >= 10 || rain > 0.2 ? '#2d7c94' : '#b3860f';

  const location = report.locality_name ?? 'Mumbai';
  const evidenceSentence = photoCount
    ? `${photoCount === 1 ? 'One photograph is' : `${photoCount} photographs are`} attached. ${gpsMatch ? 'The file GPS matches the claimed location.' : gpsMismatch ? 'The file GPS conflicts with the claimed location.' : 'The file carries no usable GPS match.'} ${aiComplete ? 'Visual screening is complete.' : 'Visual screening is not complete.'}`
    : 'No photograph is attached, so the dossier cannot test the description against an image.';
  const contextSentence = primaryStation
    ? `${primaryStation.name.replace(/ demo (air monitor|sampling point|stack monitor)/i, '')} is ${Math.round(primaryStation.distance_m)} m away and reports ${primaryStation.headline}. ${primaryStation.primary?.note ?? ''}`
    : category === 'waste'
      ? 'This category has no numeric monitor station type in the deployment; a field inspection is the primary evidence route.'
      : `No ${TYPE_LABEL[category].toLowerCase()} is within 3 km, so there is no independent reading to compare.`;
  const communitySentence = nearbySameCategory.length || alerts.length || incidents.length
    ? `${nearbySameCategory.length} other same-category report${nearbySameCategory.length === 1 ? '' : 's'} sit within 500 m${nearbyVerified.length ? `, ${nearbyVerified.length} verified` : ''}. ${alerts.length ? `${alerts.length} open alert${alerts.length === 1 ? '' : 's'} match this category.` : 'No open category alert is linked.'} ${incidents.length ? `${incidents.length} incident${incidents.length === 1 ? '' : 's'} sit within 3 km.` : 'No nearby incident is recorded.'}`
    : 'No nearby report, alert or incident independently repeats the concern. That is a gap in corroboration, not evidence that nothing happened.';
  const weatherSentence = weather
    ? `The nearest weather record shows ${formatNumber(weather.temperature_c, 0)}°C, ${formatNumber(weather.relative_humidity, 0)}% humidity and ${formatNumber(weather.wind_speed_kmh, 0)} km/h wind from ${windDirection(weather.wind_direction_deg)}. ${dispersion}${rain > 0.2 ? ' with some rain washout at the site.' : ' with no washout rain recorded.'}`
    : 'No nearby weather record is available, so dispersion at the reported time cannot be described.';

  const nextChecks: NextCheck[] = [];
  if (!photoCount) nextChecks.push({ title: 'Request a timestamped photograph', detail: 'A field image or a fresh citizen photo would let a reviewer test the description and location.', priority: 'high' });
  if (gpsMismatch) nextChecks.push({ title: 'Reconcile the location conflict', detail: 'The photograph GPS is more than 2 km from the claimed point. Confirm the coordinates before field dispatch.', priority: 'high' });
  if (!aiComplete && photoCount) nextChecks.push({ title: 'Queue a manual visual review', detail: 'No vision model is configured. An analyst can still record visible features and limitations.', priority: 'medium' });
  if (!hasMonitor && category !== 'waste') nextChecks.push({ title: `Collect a ${category === 'water' ? 'water sample' : category === 'industrial' ? 'stack record' : 'local air reading'}`, detail: 'The nearest matched monitor is outside 3 km. A targeted sample or operator record would close the context gap.', priority: 'high' });
  if (!nearbySameCategory.length) nextChecks.push({ title: 'Seek independent corroboration', detail: 'A second report, a field photograph or a sensor trace from the same time would strengthen the dossier.', priority: 'medium' });
  if (alerts.length || incidents.length) nextChecks.push({ title: 'Compare with the open case record', detail: 'Read the matching alert or incident before linking. A link preserves the investigation chain and must be justified.', priority: 'medium' });
  if (report.verification_state !== 'VERIFIED') nextChecks.push({ title: 'Complete authority verification', detail: 'Only an authorised reviewer can verify the report. Linking to an incident is blocked until then.', priority: 'medium' });
  if (category === 'air') nextChecks.push({ title: 'Compare the report time with the hourly monitor', detail: 'A local source can spike between hourly averages. Ask for the station trace around the reported time.', priority: 'low' });
  if (category === 'water') nextChecks.push({ title: 'Sample before the plume disperses', detail: 'A grab sample for pH and dissolved oxygen is more useful than a photograph for water chemistry.', priority: 'low' });
  if (category === 'waste') nextChecks.push({ title: 'Record volume, access and recurrence', detail: 'Waste evidence is usually field-observed. Note the pile size, access point and whether the same spot was reported before.', priority: 'low' });
  if (category === 'industrial') nextChecks.push({ title: 'Request stack monitoring records', detail: 'This report does not assert a facility identity. Match the time and plume direction to consented stack records.', priority: 'low' });

  const limitations = [
    'A citizen report is not an official violation. Only an authorised officer can record a determination.',
    'A photograph cannot establish chemical composition, toxicity, concentration or legal responsibility.',
    'Dossier strength is a completeness heuristic computed from the records on this page. It is not a risk score, a legal test or a probability.',
  ];
  if (category === 'industrial') limitations.push('No numeric stack reference standard is loaded, so this analysis does not calculate a stack exceedance.');
  if (category === 'waste') limitations.push('The waste category has no numeric air or water threshold in this deployment. The analysis cannot infer contamination from the report.');
  if (!hasMonitor && category !== 'waste') {
    limitations.push(
      stations.length
        ? 'A category-matched monitor is within 3 km but has no recent reading, so no local reading is claimed.'
        : 'No category-matched monitoring station is within 3 km, so no local reading is claimed.',
    );
  }
  if (stations.some((station) => station.isSimulated)) limitations.push('One or more nearby station readings are simulation-labelled, not CPCB/MPCB measurements.');
  if (weather?.is_simulated) limitations.push('The weather context is simulation-labelled.');

  const provenance = [
    `${photoCount} evidence file${photoCount === 1 ? '' : 's'}`,
    photoCount ? `GPS ${gpsMatch ? 'match' : gpsMismatch ? 'mismatch' : 'not matched'}` : 'No photo GPS',
    `AI ${aiComplete ? 'screen complete' : 'screen incomplete'}`,
    `${stations.length} matched monitor${stations.length === 1 ? '' : 's'}`,
    weather ? (weather.is_simulated ? 'Simulated weather' : 'Weather observation') : 'No weather',
    `${audit.length} audit event${audit.length === 1 ? '' : 's'}`,
  ];
  if (report.is_simulated) provenance.push('Simulation record');

  return {
    category,
    dimensions,
    overall,
    grade,
    stations,
    primaryStation,
    nearbySameCategory,
    nearbyVerified,
    alerts,
    incidents,
    weather: weather
      ? {
          raw: weather,
          direction: windDirection(weather.wind_direction_deg),
          dispersion,
          dispersionTone,
          note: `${formatNumber(weather.wind_speed_kmh, 0)} km/h wind · ${formatNumber(rain, 1)} mm rain · ${formatNumber(weather.temperature_c, 0)}°C · ${formatNumber(weather.relative_humidity, 0)}% RH`,
        }
      : null,
    brief: {
      headline: `${grade.label} dossier · ${CATEGORY_LABELS[category]} report in ${location}`,
      paragraphs: [evidenceSentence, contextSentence, weatherSentence, communitySentence],
      nextChecks: nextChecks.slice(0, 6),
      limitations,
      provenance,
    },
    timeline: timelineFor(audit),
  };
}

export const SCENE = {
  width: 560,
  height: 320,
  centerX: 280,
  centerY: 160,
  pxPerKm: 44,
};

/** Project a real coordinate into the 3D stage, preserving true relative direction. */
export function projectToScene(lat: number, lng: number, centerLat: number, centerLng: number) {
  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.32 * Math.cos((centerLat * Math.PI) / 180);
  const dxKm = (lng - centerLng) * kmPerDegLng;
  const dyKm = (lat - centerLat) * kmPerDegLat;
  return {
    x: SCENE.centerX + dxKm * SCENE.pxPerKm,
    y: SCENE.centerY - dyKm * SCENE.pxPerKm,
  };
}

export function sceneFraction(value: number, max: number): number {
  return clamp(value / Math.max(1, max), 0, 1);
}
