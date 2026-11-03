import { one, query } from '../db/pool.js';
import { baselineForecast } from './forecast.js';
import { assessAir, assessIndustrial, assessWater, assessWaste, type LatestReading } from './risk-engine.js';
import type { RiskAssessmentResult } from '../types.js';
import { persistRisk } from './risk.js';
import { getLatestWeather } from './station-data.js';
import { buildSimulationRecommendations, type SimulationRecommendation } from './simulation-recommendations.js';

export interface ScenarioPhase {
  label: string;
  from: number;
  to: number;
  tone: 'calm' | 'build' | 'peak' | 'recovery' | 'fault';
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  category: 'air' | 'water' | 'waste' | 'industrial';
  steps: number;
  description: string;
  stationRequired: boolean;
  demonstrates: string[];
  phases: ScenarioPhase[];
  preview: number[];
  previewUnit: string;
}

export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'gradual_pm25',
    name: 'Gradual PM2.5 increase',
    category: 'air',
    steps: 24,
    description:
      'A progressive PM2.5 rise at the selected demo station, followed by a recovery. Demonstrates trend development, persistence baseline, alert escalation and recovery.',
    stationRequired: true,
    demonstrates: ['Changing readings', 'Persistence baseline', 'Early warning', 'Critical screening', 'Recovery'],
    phases: [
      { label: 'Baseline', from: 0, to: 5, tone: 'calm' },
      { label: 'Morning build-up', from: 5, to: 18, tone: 'build' },
      { label: 'Recovery', from: 18, to: 23, tone: 'recovery' },
    ],
    preview: [28, 31, 34, 38, 43, 49, 55, 62, 70, 79, 88, 96, 101, 104, 101, 94, 84, 72, 61, 52],
    previewUnit: 'µg/m³ PM2.5',
  },
  {
    id: 'sudden_spike',
    name: 'Sudden pollution spike',
    category: 'air',
    steps: 14,
    description:
      'An abrupt multi-hour spike, followed by a return towards baseline. Demonstrates anomaly detection, station validation and a critical observed-condition alert.',
    stationRequired: true,
    demonstrates: ['Abrupt change', 'Anomaly check', 'Critical alert', 'Authority email preview', 'Incident creation'],
    phases: [
      { label: 'Calm', from: 0, to: 4, tone: 'calm' },
      { label: 'Spike', from: 4, to: 8, tone: 'peak' },
      { label: 'Recovery', from: 8, to: 13, tone: 'recovery' },
    ],
    preview: [31, 30, 33, 31, 35, 58, 98, 142, 156, 132, 88, 55, 39, 34],
    previewUnit: 'µg/m³ PM2.5',
  },
  {
    id: 'persistent_deterioration',
    name: 'Persistent pollution deterioration',
    category: 'air',
    steps: 20,
    description:
      'Repeated elevated PM2.5 values with persistence checks, nearby-station context and an investigation workflow.',
    stationRequired: true,
    demonstrates: ['Persistence checks', 'Risk progression', 'Nearby-station context', 'Investigation'],
    phases: [
      { label: 'Baseline', from: 0, to: 4, tone: 'calm' },
      { label: 'Persistent rise', from: 4, to: 14, tone: 'build' },
      { label: 'Sustained', from: 14, to: 19, tone: 'peak' },
    ],
    preview: [32, 34, 36, 38, 40, 43, 46, 50, 55, 60, 66, 72, 78, 84, 90, 94, 96, 96, 94, 90],
    previewUnit: 'µg/m³ PM2.5',
  },
  {
    id: 'sensor_malfunction',
    name: 'Sensor malfunction',
    category: 'air',
    steps: 12,
    description:
      'Implausible readings with degraded data quality. Alerts are suppressed and a maintenance recommendation is produced. This scenario must not be read as pollution deterioration.',
    stationRequired: true,
    demonstrates: ['Quality flags', 'Confidence reduction', 'Alert suppression', 'Maintenance recommendation'],
    phases: [
      { label: 'Normal', from: 0, to: 3, tone: 'calm' },
      { label: 'Fault', from: 3, to: 8, tone: 'fault' },
      { label: 'Restored', from: 8, to: 11, tone: 'recovery' },
    ],
    preview: [27, 28, 26, 27, 62, 6, 0, 64, 66, 28, 27, 26],
    previewUnit: 'µg/m³ PM2.5 (implausible)',
  },
  {
    id: 'neighbouring_station_changes',
    name: 'Neighbouring station changes',
    category: 'air',
    steps: 16,
    description:
      'One station rises while a neighbouring station falls. Demonstrates spatial uncertainty and why a single station cannot establish a locality-wide condition.',
    stationRequired: true,
    demonstrates: ['Different station readings', 'Spatial uncertainty', 'Wind context', 'No fabricated zone'],
    phases: [
      { label: 'Together', from: 0, to: 3, tone: 'calm' },
      { label: 'Divergence', from: 3, to: 11, tone: 'build' },
      { label: 'Unresolved', from: 11, to: 15, tone: 'peak' },
    ],
    preview: [36, 37, 40, 43, 46, 49, 52, 55, 58, 61, 64, 67, 70, 73, 76, 79],
    previewUnit: 'µg/m³ PM2.5 at selected station',
  },
  {
    id: 'water_discharge',
    name: 'Suspected water discharge',
    category: 'water',
    steps: 14,
    description: 'Simulated pH and dissolved-oxygen deterioration at a demo water sampling point, with an investigation workflow.',
    stationRequired: true,
    demonstrates: ['pH and DO change', 'Reference comparison', 'Report evidence', 'Investigation'],
    phases: [
      { label: 'Baseline', from: 0, to: 4, tone: 'calm' },
      { label: 'Deterioration', from: 4, to: 8, tone: 'build' },
      { label: 'Sustained', from: 8, to: 13, tone: 'peak' },
    ],
    preview: [7.2, 7.15, 7.1, 7.02, 6.9, 6.74, 6.55, 6.35, 6.15, 6.02, 5.9, 5.84, 5.8, 5.82],
    previewUnit: 'pH (baseline 7.2)',
  },
  {
    id: 'waste_report',
    name: 'Citizen waste report escalation',
    category: 'waste',
    steps: 10,
    description:
      'A sequence of unverified and verified waste reports at one locality. Demonstrates that a single unverified complaint does not create a confirmed critical violation.',
    stationRequired: false,
    demonstrates: ['Report verification', 'Repeat hotspot', 'Risk escalation', 'Incident workflow'],
    phases: [
      { label: 'Unverified', from: 0, to: 2, tone: 'calm' },
      { label: 'Verification', from: 2, to: 6, tone: 'build' },
      { label: 'Repeat hotspot', from: 6, to: 9, tone: 'peak' },
    ],
    preview: [0, 0, 1, 1, 1, 2, 2, 2, 2, 2],
    previewUnit: 'verified reports',
  },
  {
    id: 'industrial_emission',
    name: 'Industrial emission anomaly',
    category: 'industrial',
    steps: 16,
    description:
      'Demo stack readings rise relative to their own baseline. No legal threshold is applied and no facility is identified.',
    stationRequired: true,
    demonstrates: ['Relative anomaly', 'No legal threshold', 'Investigation', 'Corrective action'],
    phases: [
      { label: 'Baseline', from: 0, to: 5, tone: 'calm' },
      { label: 'Relative rise', from: 5, to: 10, tone: 'build' },
      { label: 'Sustained', from: 10, to: 15, tone: 'peak' },
    ],
    preview: [40, 42, 44, 47, 50, 55, 61, 68, 76, 85, 95, 104, 110, 108, 98, 84],
    previewUnit: 'mg/Nm³ stack PM (own baseline 40)',
  },
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function reading(value: number, unit: string, observedAt: string, qualityState = 'VALID'): LatestReading {
  return {
    value: Number(value.toFixed(2)),
    unit,
    observedAt,
    qualityState,
    sourceId: 'demo-network',
    isSimulated: true,
  };
}

export interface SimulationConditions {
  temperatureC: number | null;
  relativeHumidity: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  precipitationMm: number | null;
  dispersion: 'Poor' | 'Moderate' | 'Good';
  source: string;
}

export interface SimulationOutlook {
  horizonHours: number;
  metric: string;
  value: number;
  lowerBound: number;
  upperBound: number;
  trend: 'RISING' | 'FALLING' | 'STEADY';
  method: string;
  note: string;
}

export interface SimulationStep {
  step: number;
  observedAt: string;
  values: Record<string, { value: number; unit: string; qualityState: string; isSimulated: boolean }>;
  risk: RiskAssessmentResult;
  note: string;
  suppressAlert: boolean;
  neighbour?: { name: string; pm25: number; note: string };
  emailPreviewAvailable: boolean;
  conditions: SimulationConditions;
  outlook?: SimulationOutlook;
  recommendations: SimulationRecommendation[];
}

interface StationInfo {
  id: string;
  name: string;
  code: string;
  station_type: string;
  locality_id: string | null;
  locality_name: string | null;
  lat: number;
  lng: number;
}

async function stationInfo(stationId: string): Promise<StationInfo | null> {
  return one<StationInfo>(
    `SELECT s.id, s.name, s.code, s.station_type, s.locality_id, l.name AS locality_name,
            ST_Y(s.location::geometry)::float8 AS lat, ST_X(s.location::geometry)::float8 AS lng
     FROM monitoring_stations s LEFT JOIN localities l ON l.id=s.locality_id WHERE s.id=$1`,
    [stationId],
  );
}

async function startingValues(stationId: string): Promise<Record<string, number>> {
  const rows = await query<{ pollutant_code: string; value: number }>(
    `SELECT DISTINCT ON (pollutant_code) pollutant_code, value::float8 AS value
     FROM environmental_observations WHERE station_id=$1 ORDER BY pollutant_code, observed_at DESC`,
    [stationId],
  );
  const values: Record<string, number> = {};
  for (const row of rows) values[row.pollutant_code] = Number(row.value);
  return values;
}

interface WeatherSeed {
  temperatureC: number | null;
  relativeHumidity: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  precipitationMm: number | null;
  isSimulated: boolean;
  sourceId: string;
}

interface NeighbourSeed {
  id: string;
  name: string;
  distanceKm: number;
  pm25: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function localHour(iso: string): number {
  const date = new Date(iso);
  return (date.getUTCHours() + 5.5) % 24;
}

/** Two soft traffic peaks: morning commute and a broader evening peak. */
function trafficCurve(hour: number): number {
  const morning = Math.exp(-((hour - 9.5) ** 2) / 10);
  const evening = 0.78 * Math.exp(-((hour - 19.5) ** 2) / 9);
  return clamp(0.2 + morning + evening, 0, 1.35);
}

function dispersionFor(windSpeedKmh: number | null): SimulationConditions['dispersion'] {
  if (windSpeedKmh === null) return 'Moderate';
  if (windSpeedKmh < 6) return 'Poor';
  if (windSpeedKmh < 12) return 'Moderate';
  return 'Good';
}

async function weatherSeed(stationId: string): Promise<WeatherSeed> {
  try {
    const rows = await getLatestWeather(stationId);
    const row = rows[0];
    const ageHours = row ? (Date.now() - new Date(row.observed_at).getTime()) / 3_600_000 : Number.POSITIVE_INFINITY;
    if (row && Number.isFinite(ageHours) && ageHours <= 6) {
      return {
        temperatureC: row.temperature_c,
        relativeHumidity: row.relative_humidity,
        windSpeedKmh: row.wind_speed_kmh,
        windDirectionDeg: row.wind_direction_deg,
        precipitationMm: row.precipitation_mm,
        isSimulated: row.is_simulated,
        sourceId: row.source_id,
      };
    }
  } catch {
    // A missing weather table row must not block a replay.
  }
  return {
    temperatureC: 29,
    relativeHumidity: 68,
    windSpeedKmh: 13,
    windDirectionDeg: 235,
    precipitationMm: 0,
    isSimulated: true,
    sourceId: 'REPLAY_ATMOSPHERE',
  };
}

async function nearestAirNeighbour(stationId: string): Promise<NeighbourSeed | null> {
  return one<NeighbourSeed>(
    `SELECT st.id, st.name,
            (ST_Distance(st.location, s.location) / 1000)::float8 AS "distanceKm",
            (SELECT o.value::float8 FROM environmental_observations o
              WHERE o.station_id=st.id AND o.pollutant_code='pm25' AND o.quality_state <> 'INVALID'
              ORDER BY o.observed_at DESC LIMIT 1) AS pm25
     FROM monitoring_stations st
     JOIN monitoring_stations s ON s.id=$1
     WHERE st.id <> s.id AND st.station_type='AIR_CAAQMS'
     ORDER BY ST_Distance(st.location, s.location) LIMIT 1`,
    [stationId],
  );
}

function buildConditions(params: {
  step: number;
  observedAt: string;
  scenario: string;
  weather: WeatherSeed;
  random: () => number;
}): SimulationConditions {
  const { step, observedAt, scenario, weather, random } = params;
  const baseWind = weather.windSpeedKmh ?? 13;
  const baseDirection = weather.windDirectionDeg ?? 235;
  const swing = Math.sin(step / 2.9) * 2.2 + (random() - 0.5) * 1.5;
  let wind = Math.max(2.5, baseWind + swing);

  if (scenario === 'sudden_spike' && step >= 4 && step <= 8) wind = Math.max(2.5, baseWind * 0.42 + swing * 0.35);
  else if (scenario === 'gradual_pm25' && step >= 4 && step <= 18) wind = Math.max(3.2, baseWind * 0.74 + swing * 0.5);
  else if (scenario === 'persistent_deterioration') wind = Math.max(3.5, baseWind * 0.82 + swing * 0.6);

  const hour = localHour(observedAt);
  const baseTemp = weather.temperatureC ?? 29;
  const temperature = baseTemp + Math.sin(((hour - 8) / 24) * Math.PI * 2) * 2.6 + (random() - 0.5) * 0.7;
  const baseHumidity = weather.relativeHumidity ?? 68;
  const humidity = clamp(baseHumidity + (baseTemp - temperature) * 1.4 + (random() - 0.5) * 3, 25, 98);
  const precipitation = Math.max(0, (weather.precipitationMm ?? 0) + (random() - 0.5) * 0.3);

  return {
    temperatureC: round(temperature, 1),
    relativeHumidity: round(humidity, 0),
    windSpeedKmh: round(wind, 1),
    windDirectionDeg: Math.round((baseDirection + Math.sin(step / 4.5) * 26 + (random() - 0.5) * 10 + 360) % 360),
    precipitationMm: round(precipitation, 1),
    dispersion: dispersionFor(wind),
    source: weather.isSimulated ? 'Synthetic replay atmosphere' : 'Open-Meteo observation at the nearest station',
  };
}

export async function generateSimulation(params: {
  scenario: ScenarioDefinition;
  stationId: string;
  seed: number;
}): Promise<{ steps: SimulationStep[]; station: StationInfo | null }> {
  const station = await stationInfo(params.stationId);
  if (!station) throw new Error('Station not found');
  const [start, weather, neighbourStation] = await Promise.all([
    startingValues(params.stationId),
    weatherSeed(params.stationId),
    params.scenario.id === 'neighbouring_station_changes' ? nearestAirNeighbour(params.stationId) : Promise.resolve(null),
  ]);
  const random = mulberry32(params.seed);
  const baseTime = new Date(Date.now() - (params.scenario.steps - 1) * 10 * 60_000);
  baseTime.setSeconds(0, 0);
  const steps: SimulationStep[] = [];
  const pmHistory: Array<{ observedAt: string; value: number }> = [];

  for (let step = 0; step < params.scenario.steps; step += 1) {
    const observedAt = new Date(baseTime.getTime() + step * 10 * 60_000).toISOString();
    const conditions = buildConditions({ step, observedAt, scenario: params.scenario.id, weather, random });
    const hour = localHour(observedAt);
    const traffic = trafficCurve(hour);
    let values: Record<string, { value: number; unit: string; qualityState: string; isSimulated: boolean }> = {};
    let risk: RiskAssessmentResult;
    let note = '';
    let suppressAlert = false;
    let neighbour: SimulationStep['neighbour'];

    if (params.scenario.id === 'water_discharge') {
      const basePh = clamp(start.ph ?? 7.2, 6.8, 7.8);
      const baseDo = clamp(start.do ?? 5.6, 4.6, 6.4);
      const progress = clamp((step - 3) / 6, 0, 1);
      const ph = basePh - progress * 1.32 + (random() - 0.5) * 0.08;
      const doValue = baseDo - progress * 2.85 + (random() - 0.5) * 0.18;
      const turbidity = 18 + progress * 74 + (random() - 0.5) * 4;
      values = {
        ph: reading(ph, 'pH', observedAt),
        do: reading(doValue, 'mg/L', observedAt),
        turbidity: reading(turbidity, 'NTU', observedAt),
      };
      risk = assessWater({
        siteId: station.id,
        siteName: station.name,
        isSimulated: true,
        latest: {
          ph: reading(ph, 'pH', observedAt),
          do: reading(doValue, 'mg/L', observedAt),
          turbidity: reading(turbidity, 'NTU', observedAt),
        },
        verifiedReports7d: step >= 6 ? 1 : 0,
        unverifiedReports7d: step >= 3 ? 2 : 0,
      });
      note =
        step < 4
          ? `Baseline water-quality sample. pH ${round(ph)} and dissolved oxygen ${round(doValue)} mg/L are within the screening reference.`
          : step < 8
            ? 'pH and dissolved oxygen deteriorating while turbidity rises. Reference criteria only; confirm with a repeat sample.'
            : 'Sustained deterioration. Repeat sampling and an upstream source inspection are the next evidence steps.';
    } else if (params.scenario.id === 'waste_report') {
      const verified = step >= 7 ? 2 : step >= 4 ? 1 : 0;
      const unverified = step >= 2 ? Math.min(3, 1 + Math.floor((step - 2) / 3)) : 0;
      risk = assessWaste({
        localityId: station.locality_id ?? station.id,
        localityName: station.locality_name ?? station.name,
        reports7d: Array.from({ length: verified + unverified }, (_, i) => ({
          id: `sim-${step}-${i}`,
          status: i < verified ? 'VERIFIED' : 'AWAITING_VERIFICATION',
          verificationState: i < verified ? 'VERIFIED' : 'UNVERIFIED',
          evidenceCount: i < verified ? 2 : 1,
          distanceM: 95 + i * 45,
          submittedAt: observedAt,
        })),
        criticalIncidents: 0,
      });
      note =
        verified >= 2
          ? `Two verified reports and ${unverified} unverified reports form a repeat hotspot. This is report evidence, not a measured violation.`
          : verified === 1
            ? 'One verified report with photo evidence. Field verification and duplicate triage still required.'
            : unverified > 0
              ? `${unverified} unverified report${unverified === 1 ? '' : 's'} in the locality. No confirmed critical condition.`
              : 'No reports yet. Monitoring the locality for the first complaint.';
      values = {
        verified_reports: { value: verified, unit: 'reports', qualityState: 'VALID', isSimulated: true },
        unverified_reports: { value: unverified, unit: 'reports', qualityState: 'VALID', isSimulated: true },
      };
    } else if (params.scenario.id === 'industrial_emission') {
      const basePm = clamp(start.stack_pm ?? 40, 20, 80);
      const baseNox = clamp(start.stack_nox ?? 100, 60, 180);
      const baseSo2 = clamp(start.stack_so2 ?? 70, 35, 130);
      const progress = clamp((step - 4) / 7, 0, 1);
      const load = 0.94 + progress * 0.34;
      const stackPm = basePm * (1 + progress * 1.55) * load + (random() - 0.5) * basePm * 0.07;
      const stackNox = baseNox * (1 + progress * 1.35) * load + (random() - 0.5) * baseNox * 0.06;
      const stackSo2 = baseSo2 * (1 + progress * 1.15) * load + (random() - 0.5) * baseSo2 * 0.05;
      values = {
        stack_pm: reading(stackPm, 'mg/Nm³', observedAt),
        stack_nox: reading(stackNox, 'mg/Nm³', observedAt),
        stack_so2: reading(stackSo2, 'mg/Nm³', observedAt),
      };
      risk = assessIndustrial({
        siteId: station.id,
        siteName: station.name,
        isSimulated: true,
        latest: {
          stack_pm: reading(stackPm, 'mg/Nm³', observedAt),
          stack_nox: reading(stackNox, 'mg/Nm³', observedAt),
          stack_so2: reading(stackSo2, 'mg/Nm³', observedAt),
        },
        baseline: { stack_pm: basePm, stack_nox: baseNox, stack_so2: baseSo2 },
        verifiedReports7d: step >= 8 ? 1 : 0,
        openIncidents: 0,
      });
      note =
        step < 5
          ? `Stack readings are close to the facility's own baseline (${round(basePm)} mg/Nm³ PM) at an estimated ${Math.round(load * 100)}% load.`
          : `Relative increase from the facility's own baseline at an estimated ${Math.round(load * 100)}% load. No legal emission threshold is applied and no facility is identified.`;
    } else {
      // Air scenarios.
      const basePm = clamp(start.pm25 ?? 42, 20, 78);
      const noise = (random() - 0.5) * 3.2;
      let target = basePm;
      let qualityState = 'VALID';

      if (params.scenario.id === 'gradual_pm25') {
        target =
          step <= 18
            ? basePm + (step / 18) * 58
            : Math.max(basePm * 0.78, basePm + 58 - ((step - 18) / 5) * 62);
        note =
          step <= 4
            ? 'Baseline before the morning build-up. Traffic and a shallow boundary layer begin to raise PM2.5.'
            : step <= 18
              ? 'Progressive rise consistent with a morning build-up. The persistence rule starts watching once the threshold is approached.'
              : 'Recovery phase: wind and a deeper boundary layer are dispersing the accumulated pollution.';
      } else if (params.scenario.id === 'sudden_spike') {
        const spike = [0, 0, 0, 0, 0, 62, 112, 146, 119, 0, 0, 0, 0, 0][step] ?? 0;
        target = basePm + spike;
        note =
          step >= 5 && step <= 8
            ? 'Abrupt spike while wind collapses. The anomaly check and station validation should run before any public conclusion.'
            : step > 8
              ? 'Wind returns and concentrations fall. Confirm the recovery with a repeat observation, not a single step.'
              : 'Baseline conditions ahead of the spike.';
      } else if (params.scenario.id === 'persistent_deterioration') {
        target = step <= 14 ? basePm + step * 2.7 : basePm + 38 + (step - 14) * 0.4;
        note =
          step <= 4
            ? 'Early elevation is not yet persistent enough for an alert.'
            : 'Persistent elevation. Consecutive observations, not one high value, are driving the escalation.';
      } else if (params.scenario.id === 'sensor_malfunction') {
        if (step >= 4 && step <= 8) {
          target = step === 5 ? -4.6 : step === 6 ? 0 : 997.4;
          qualityState = 'SUSPECT';
          suppressAlert = true;
          note = `Implausible value (${round(target)}) with a SUSPECT quality flag. This is a sensor malfunction, not environmental deterioration; the alert is suppressed.`;
        } else {
          note = 'Normal simulated value. The station is behaving within its expected range.';
        }
      } else if (params.scenario.id === 'neighbouring_station_changes') {
        const neighbourBase = clamp(neighbourStation?.pm25 ?? 82, 35, 120);
        target = basePm + step * 2.5;
        const neighbourValue = Math.max(22, neighbourBase - step * 2.4 + (random() - 0.5) * 3);
        neighbour = {
          name: neighbourStation?.name ?? 'Neighbouring demo station',
          pm25: round(neighbourValue),
          note: `The nearest same-network monitor${neighbourStation ? ` (${round(neighbourStation.distanceKm, 1)} km away)` : ''} is moving in the opposite direction. Two monitors disagreeing is spatial uncertainty, not a confirmed locality-wide condition.`,
        };
        note = 'Selected station rising while the nearest neighbour falls. Wind, local sources or an inlet problem could all explain the divergence.';
      }

      const dispersionFactor = 1 + Math.max(0, (10 - (conditions.windSpeedKmh ?? 10)) * 0.014);
      const pm25 =
        qualityState === 'SUSPECT'
          ? target
          : Math.max(3, (target + noise) * (0.9 + traffic * 0.1) * dispersionFactor);
      const pm10 = qualityState === 'SUSPECT' ? target * 1.8 + 12 : pm25 * 1.86 + 13 + (random() - 0.5) * 6;
      const no2 = qualityState === 'SUSPECT' ? target * 0.3 + 20 : 18 + pm25 * 0.26 + traffic * 12 + (random() - 0.5) * 3;
      const so2 = qualityState === 'SUSPECT' ? target * 0.06 + 6 : 6 + pm25 * 0.06 + (random() - 0.5) * 1.6;
      const co = qualityState === 'SUSPECT' ? target * 0.009 + 0.3 : 0.28 + pm25 * 0.0085 + traffic * 0.07 + (random() - 0.5) * 0.03;
      const daylight = clamp(Math.sin(((hour - 6) / 24) * Math.PI * 2) * 0.5 + 0.5, 0, 1);
      const o3 = qualityState === 'SUSPECT' ? 42 : Math.max(6, 22 + daylight * 58 - traffic * 7 + (random() - 0.5) * 6);

      pmHistory.push({ observedAt, value: pm25 });
      const latest = {
        pm25: reading(pm25, 'µg/m³', observedAt, qualityState),
        pm10: reading(pm10, 'µg/m³', observedAt, qualityState),
        no2: reading(no2, 'µg/m³', observedAt, qualityState),
        so2: reading(so2, 'µg/m³', observedAt, qualityState),
        co: reading(co, 'mg/m³', observedAt, qualityState),
        o3: reading(o3, 'µg/m³', observedAt, qualityState),
      };
      values = Object.fromEntries(
        Object.entries(latest).map(([code, r]) => [
          code,
          { value: r.value, unit: r.unit, qualityState: r.qualityState, isSimulated: true as const },
        ]),
      );
      const forecast = baselineForecast(pmHistory.slice(-12), 3, new Date(observedAt));
      risk = assessAir({
        stationId: station.id,
        stationName: station.name,
        isSimulated: true,
        latest,
        pm25History: pmHistory.slice(-12),
        forecastPm25: forecast,
        healthStatus: qualityState === 'SUSPECT' ? 'DEGRADED' : 'ONLINE',
        weather: {
          windSpeedKmh: conditions.windSpeedKmh,
          windDirectionDeg: conditions.windDirectionDeg,
          observedAt,
        },
        now: new Date(observedAt),
      });
      if (params.scenario.id === 'sensor_malfunction' && suppressAlert) {
        risk = {
          ...risk,
          alertState: 'NORMAL',
          observedAlertState: 'NORMAL',
          predictiveAlertState: 'NORMAL',
          riskLevel: 'UNKNOWN',
          riskScore: null,
          missingInputs: [...risk.missingInputs, 'Implausible readings — alert suppressed pending station maintenance'],
        };
      }
    }

    const outlook: SimulationOutlook | undefined =
      params.scenario.category === 'air'
        ? (() => {
            const forecast = baselineForecast(pmHistory.slice(-12), 3, new Date(observedAt));
            if (!forecast) return undefined;
            const trend =
              forecast.predictedValue - forecast.currentValue > 1.5
                ? 'RISING'
                : forecast.currentValue - forecast.predictedValue > 1.5
                  ? 'FALLING'
                  : 'STEADY';
            return {
              horizonHours: 3,
              metric: 'pm25',
              value: forecast.predictedValue,
              lowerBound: forecast.lowerBound,
              upperBound: forecast.upperBound,
              trend,
              method: forecast.method,
              note: 'Persistence baseline with an empirical band. Not a trained ML forecast and not a regulatory determination.',
            };
          })()
        : undefined;

    const recommendations = buildSimulationRecommendations({
      category: params.scenario.category,
      step,
      totalSteps: params.scenario.steps,
      stationName: station.name,
      risk,
      values,
      conditions: {
        windSpeedKmh: conditions.windSpeedKmh,
        windDirectionDeg: conditions.windDirectionDeg,
        precipitationMm: conditions.precipitationMm,
        dispersion: conditions.dispersion,
      },
      neighbour: neighbour ? { name: neighbour.name, pm25: neighbour.pm25 } : null,
      suppressAlert,
    });

    if (!note) note = `Replay step ${step + 1} of ${params.scenario.steps}. ${outlook?.trend === 'RISING' ? 'The persistence baseline is trending upward.' : ''}`.trim();

    steps.push({
      step,
      observedAt,
      values,
      risk,
      note,
      suppressAlert,
      neighbour,
      emailPreviewAvailable: risk.alertState !== 'NORMAL',
      conditions,
      outlook,
      recommendations,
    });
  }
  return { steps, station };
}

export async function persistSimulationSteps(
  sessionId: string,
  steps: SimulationStep[],
): Promise<void> {
  for (const step of steps) {
    await persistRisk(
      { ...step.risk, entityType: 'simulation_station', entityId: sessionId },
      true,
      sessionId,
    );
    await query(
      `INSERT INTO simulation_events (session_id, step, event_type, payload)
       VALUES ($1,$2,'READING',$3::jsonb)
       ON CONFLICT (session_id, step, event_type) DO NOTHING`,
      [sessionId, step.step, JSON.stringify(step)],
    );
  }
}
