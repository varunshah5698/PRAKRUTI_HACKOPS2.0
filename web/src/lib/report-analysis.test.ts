import { describe, expect, it } from 'vitest';
import {
  buildReportAnalysis,
  categoryOf,
  projectToScene,
  stationMatchesCategory,
  type AnalysisInput,
  type RawStation,
} from './report-analysis';

const now = new Date();
const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
const twoDaysAgo = new Date(now.getTime() - 2 * 86_400_000).toISOString();

function baseInput(): AnalysisInput {
  return {
    report: {
      id: 'report-1',
      public_ref: 'R-1',
      category: 'air',
      incident_type: 'OPEN_BURNING',
      description: 'Visible smoke and burning smell beside the service road.',
      status: 'VERIFIED',
      verification_state: 'VERIFIED',
      occurred_at: hourAgo,
      submitted_at: now.toISOString(),
      locality_name: 'Chembur',
      lat: 19.052,
      lng: 72.9,
      consent: true,
      is_simulated: false,
    },
    evidence: [
      {
        id: 'e1',
        mime_type: 'image/jpeg',
        size_bytes: 4000,
        sha256: 'abc123',
        gps_consistency: 'MATCH',
        malware_scan_status: 'NOT_CONFIGURED',
        uploaded_at: now.toISOString(),
      },
      {
        id: 'e2',
        mime_type: 'image/jpeg',
        size_bytes: 5000,
        sha256: 'def456',
        gps_consistency: 'MATCH',
        malware_scan_status: 'NOT_CONFIGURED',
        uploaded_at: now.toISOString(),
      },
    ],
    aiAssessments: [{ assessment_type: 'REPORT_VISUAL_ASSESSMENT', provider: 'google', status: 'COMPLETED' }],
    enrichment: {
      stations: [
        {
          id: 'station-1',
          name: 'Chembur demo air monitor',
          station_type: 'AIR_CAAQMS',
          lat: 19.056,
          lng: 72.902,
          distance_m: 420,
          latest_readings: {
            pm25: { value: 90, unit: 'µg/m³', observedAt: hourAgo, sourceId: 'demo-network', isSimulated: true },
            pm10: { value: 160, unit: 'µg/m³', observedAt: hourAgo, sourceId: 'demo-network', isSimulated: true },
          },
        },
      ],
      weather: {
        observed_at: hourAgo,
        temperature_c: 30,
        relative_humidity: 70,
        wind_speed_kmh: 6,
        wind_direction_deg: 240,
        precipitation_mm: 0,
        is_simulated: true,
        source_id: 'open-meteo-weather',
      },
      nearbyReports: [
        {
          id: 'nearby-1',
          public_ref: 'R-2',
          category: 'air',
          incident_type: 'DUST',
          status: 'VERIFIED',
          verification_state: 'VERIFIED',
          distance_m: 180,
          submitted_at: twoDaysAgo,
        },
        {
          id: 'nearby-2',
          public_ref: 'R-3',
          category: 'air',
          incident_type: 'OPEN_BURNING',
          status: 'VERIFIED',
          verification_state: 'VERIFIED',
          distance_m: 350,
          submitted_at: twoDaysAgo,
        },
      ],
      alerts: [
        {
          id: 'alert-1',
          public_ref: 'A-1',
          category: 'air',
          level: 'HIGH',
          state: 'ACTIVE',
          trigger_type: 'THRESHOLD',
          title: 'Air quality watch',
          triggered_at: hourAgo,
        },
      ],
      incidents: [
        {
          id: 'incident-1',
          public_ref: 'I-1',
          category: 'air',
          title: 'Open burning',
          status: 'INVESTIGATION',
          risk_level: 'HIGH',
          detected_at: hourAgo,
          distance_m: 900,
        },
      ],
    },
    audit: [
      { action: 'REPORT_SUBMITTED', created_at: hourAgo, after: { status: 'SUBMITTED' } },
      { action: 'REPORT_STATUS_CHANGED', created_at: now.toISOString(), after: { status: 'VERIFIED', verification: 'VERIFIED', reason: 'Field check completed.' } },
    ],
  };
}

describe('report analysis', () => {
  it('scores a well-corroborated report and keeps the evidence dimensions separate', () => {
    const result = buildReportAnalysis(baseInput());
    expect(result.overall).toBeGreaterThanOrEqual(80);
    expect(result.grade.label).toBe('Robust');
    expect(result.stations).toHaveLength(1);
    expect(result.primaryStation?.primary?.status).toBe('exceeds');
    expect(result.primaryStation?.tone).toBe('#b3860f');
    expect(result.nearbySameCategory).toHaveLength(2);
    expect(result.nearbyVerified).toHaveLength(2);
    expect(result.alerts).toHaveLength(1);
    expect(result.incidents).toHaveLength(1);
    expect(result.timeline.map((entry) => entry.label)).toEqual(['Report submitted', 'Verification status changed']);
  });

  it('makes missing evidence visible instead of inventing a result', () => {
    const input = baseInput();
    input.report = {
      ...input.report,
      category: 'waste',
      status: 'AWAITING_VERIFICATION',
      verification_state: 'UNVERIFIED',
      consent: false,
      occurred_at: twoDaysAgo,
    };
    input.evidence = [];
    input.aiAssessments = [];
    input.enrichment = { stations: [], weather: null, nearbyReports: [], alerts: [], incidents: [] };
    input.audit = [];
    const result = buildReportAnalysis(input);
    expect(result.overall).toBeLessThan(30);
    expect(result.grade.label).toBe('Insufficient');
    expect(result.stations).toHaveLength(0);
    expect(result.brief.nextChecks.some((check) => check.title.includes('photograph'))).toBe(true);
    expect(result.brief.limitations.join(' ')).toContain('not an official violation');
  });

  it('filters stations to the report category and flags water readings against the loaded criteria', () => {
    const input = baseInput();
    input.report = { ...input.report, category: 'water', incident_type: 'SUSPECTED_DISCHARGE' };
    input.enrichment.stations = [
      {
        id: 'air-station',
        name: 'Chembur demo air monitor',
        station_type: 'AIR_CAAQMS',
        distance_m: 100,
        latest_readings: { pm25: { value: 80, unit: 'µg/m³', observedAt: hourAgo, sourceId: 'demo-network', isSimulated: true } },
      },
      {
        id: 'water-station',
        name: 'Mithi River — Mahim demo sampling point',
        station_type: 'WATER_SAMPLING',
        distance_m: 600,
        latest_readings: {
          do: { value: 3.6, unit: 'mg/L', observedAt: hourAgo, sourceId: 'demo-network', isSimulated: true },
          ph: { value: 6.2, unit: 'pH', observedAt: hourAgo, sourceId: 'demo-network', isSimulated: true },
        },
      },
    ];
    const result = buildReportAnalysis(input);
    expect(result.stations).toHaveLength(1);
    expect(result.stations[0].name).toContain('Mithi');
    expect(result.stations[0].primary?.code).toBe('do');
    expect(result.stations[0].primary?.status).toBe('below');
    expect(result.stations[0].comparisons.find((row) => row.code === 'ph')?.status).toBe('below');
  });

  it('does not count a monitor with no recent reading as reporting context', () => {
    const input = baseInput();
    input.enrichment.stations = [
      {
        id: 'empty-air-station',
        name: 'Chembur, Mumbai - MPCB',
        station_type: 'AIR_CAAQMS',
        distance_m: 900,
        latest_readings: null,
      },
    ];
    const result = buildReportAnalysis(input);
    expect(result.stations).toHaveLength(1);
    expect(result.primaryStation).toBeNull();
    expect(result.dimensions.find((dimension) => dimension.key === 'environment')?.score).toBeLessThan(40);
    expect(result.brief.limitations.join(' ')).toContain('has no recent reading');
  });

  it('classifies station types when an older response omits the type field', () => {
    const station: RawStation = {
      id: 's',
      name: 'legacy monitor',
      distance_m: 200,
      latest_readings: { stack_pm: { value: 40, unit: 'mg/Nm³', observedAt: hourAgo, sourceId: 'demo-network', isSimulated: true } },
    };
    expect(stationMatchesCategory(station, 'industrial')).toBe(true);
    expect(stationMatchesCategory(station, 'air')).toBe(false);
    expect(categoryOf('water')).toBe('water');
    expect(categoryOf('unknown')).toBe('air');
  });

  it('projects north above the centre and east to the right', () => {
    const centre = projectToScene(19.05, 72.9, 19.05, 72.9);
    const north = projectToScene(19.06, 72.9, 19.05, 72.9);
    const east = projectToScene(19.05, 72.91, 19.05, 72.9);
    expect(centre.x).toBe(280);
    expect(centre.y).toBe(160);
    expect(north.y).toBeLessThan(centre.y);
    expect(east.x).toBeGreaterThan(centre.x);
  });
});
