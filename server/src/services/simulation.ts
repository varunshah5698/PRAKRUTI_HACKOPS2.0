import { one, query } from '../db/pool.js';
import { baselineForecast } from './forecast.js';
import { assessAir, assessIndustrial, assessWater, assessWaste, type LatestReading } from './risk-engine.js';
import type { RiskAssessmentResult } from '../types.js';
import { persistRisk } from './risk.js';

export interface ScenarioDefinition {
  id: string;
  name: string;
  category: 'air' | 'water' | 'waste' | 'industrial';
  steps: number;
  description: string;
  stationRequired: boolean;
  demonstrates: string[];
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
  },
  {
    id: 'water_discharge',
    name: 'Suspected water discharge',
    category: 'water',
    steps: 14,
    description: 'Simulated pH and dissolved-oxygen deterioration at a demo water sampling point, with an investigation workflow.',
    stationRequired: true,
    demonstrates: ['pH and DO change', 'Reference comparison', 'Report evidence', 'Investigation'],
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

export interface SimulationStep {
  step: number;
  observedAt: string;
  values: Record<string, { value: number; unit: string; qualityState: string; isSimulated: boolean }>;
  risk: RiskAssessmentResult;
  note: string;
  suppressAlert: boolean;
  neighbour?: { name: string; pm25: number; note: string };
  emailPreviewAvailable: boolean;
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

export async function generateSimulation(params: {
  scenario: ScenarioDefinition;
  stationId: string;
  seed: number;
}): Promise<{ steps: SimulationStep[]; station: StationInfo | null }> {
  const station = await stationInfo(params.stationId);
  if (!station) throw new Error('Station not found');
  const start = await startingValues(params.stationId);
  const random = mulberry32(params.seed);
  const baseTime = new Date();
  baseTime.setSeconds(0, 0);
  const steps: SimulationStep[] = [];
  const pmHistory: Array<{ observedAt: string; value: number }> = [];
  let previousState = 'NORMAL';

  for (let step = 0; step < params.scenario.steps; step += 1) {
    const observedAt = new Date(baseTime.getTime() + step * 10 * 60_000).toISOString();
    let values: Record<string, { value: number; unit: string; qualityState: string; isSimulated: boolean }> = {};
    let risk: RiskAssessmentResult;
    let note = '';
    let suppressAlert = false;
    let neighbour: SimulationStep['neighbour'];

    if (params.scenario.id === 'water_discharge') {
      const progress = Math.min(1, step / 8);
      const ph = 7.2 - progress * 1.4 + (random() - 0.5) * 0.1;
      const doValue = 5.5 - progress * 3.0 + (random() - 0.5) * 0.2;
      const turbidity = 20 + progress * 70 + (random() - 0.5) * 5;
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
        unverifiedReports7d: step >= 3 ? 1 : 0,
      });
      note =
        step < 4
          ? 'Baseline water-quality sample.'
          : step < 8
            ? 'pH and dissolved oxygen deteriorating. Reference criteria only; confirm sampling.'
            : 'Sustained deterioration. Repeat sampling and source inspection recommended.';
    } else if (params.scenario.id === 'waste_report') {
      const verified = step >= 6 ? 2 : step >= 4 ? 1 : 0;
      const unverified = step >= 2 ? 1 : 0;
      risk = assessWaste({
        localityId: station.locality_id ?? station.id,
        localityName: station.locality_name ?? station.name,
        reports7d: Array.from({ length: verified + unverified }, (_, i) => ({
          id: `sim-${step}-${i}`,
          status: i < verified ? 'VERIFIED' : 'AWAITING_VERIFICATION',
          verificationState: i < verified ? 'VERIFIED' : 'UNVERIFIED',
          evidenceCount: 0,
          distanceM: 120 + i * 40,
          submittedAt: observedAt,
        })),
        criticalIncidents: 0,
      });
      note =
        verified >= 2
          ? 'Two verified reports form a repeat hotspot. This is report evidence, not a measured violation.'
          : verified === 1
            ? 'One verified report. Field verification still required.'
            : 'Unverified report only. No confirmed critical condition.';
      values = {
        verified_reports: { value: verified, unit: 'reports', qualityState: 'VALID', isSimulated: true },
        unverified_reports: { value: unverified, unit: 'reports', qualityState: 'VALID', isSimulated: true },
      };
    } else if (params.scenario.id === 'industrial_emission') {
      const progress = Math.min(1, step / 10);
      const stackPm = 40 + progress * 80 + (random() - 0.5) * 5;
      const stackNox = 100 + progress * 150 + (random() - 0.5) * 8;
      const stackSo2 = 70 + progress * 110 + (random() - 0.5) * 6;
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
        baseline: { stack_pm: 40, stack_nox: 100, stack_so2: 70 },
        verifiedReports7d: step >= 8 ? 1 : 0,
        openIncidents: 0,
      });
      note =
        step < 5
          ? 'Readings close to the station’s own recent baseline.'
          : 'Relative increase from the station baseline. No legal emission threshold is applied and no facility is identified.';
    } else {
      // Air scenarios.
      const basePm = start.pm25 ?? 45;
      const noise = (random() - 0.5) * 4;
      let pm25 = basePm;
      let qualityState = 'VALID';
      if (params.scenario.id === 'gradual_pm25') {
        if (step <= 18) pm25 = basePm + (step / 18) * 42 + noise;
        else pm25 = Math.max(basePm * 0.8, basePm + 42 - ((step - 18) / 5) * 45 + noise);
        note = step <= 18 ? 'Progressive increase in simulated PM2.5.' : 'Recovery phase: values declining.';
      } else if (params.scenario.id === 'sudden_spike') {
        pm25 = step >= 5 && step <= 8 ? basePm + 85 + noise : basePm + noise;
        note = step >= 5 && step <= 8 ? 'Abrupt spike. Anomaly check and station validation required.' : 'Baseline conditions.';
      } else if (params.scenario.id === 'persistent_deterioration') {
        pm25 = step <= 14 ? basePm + step * 2.2 + noise : basePm + 30 + noise;
        note = 'Persistent elevation. Consecutive observations are required before escalation.';
      } else if (params.scenario.id === 'sensor_malfunction') {
        if (step >= 4 && step <= 8) {
          pm25 = step === 5 ? -5 : step === 6 ? 0 : 999;
          qualityState = 'SUSPECT';
          suppressAlert = true;
          note = 'Implausible value and quality flag. This is treated as a sensor malfunction, not environmental deterioration.';
        } else {
          note = 'Normal simulated value.';
        }
      } else if (params.scenario.id === 'neighbouring_station_changes') {
        pm25 = basePm + step * 1.8 + noise;
        neighbour = {
          name: 'Neighbouring demo station',
          pm25: Number((80 - step * 2.2 + noise).toFixed(1)),
          note: 'Neighbouring station moves in the opposite direction. A single station cannot establish a locality-wide condition.',
        };
        note = 'Selected station rising while a neighbouring station falls. Spatial uncertainty is material.';
      }

      pmHistory.push({ observedAt, value: pm25 });
      const pm10 = pm25 * 2.05 + 12 + (random() - 0.5) * 8;
      const latest = {
        pm25: reading(pm25, 'µg/m³', observedAt, qualityState),
        pm10: reading(pm10, 'µg/m³', observedAt, qualityState),
        no2: reading(25 + basePm * 0.2 + (random() - 0.5) * 4, 'µg/m³', observedAt),
        so2: reading(8 + basePm * 0.08 + (random() - 0.5) * 2, 'µg/m³', observedAt),
        co: reading(0.4 + basePm * 0.008 + (random() - 0.5) * 0.05, 'mg/m³', observedAt),
        o3: reading(45 + (random() - 0.5) * 15, 'µg/m³', observedAt),
      };
      values = Object.fromEntries(
        Object.entries(latest).map(([code, r]) => [
          code,
          { value: r.value, unit: r.unit, qualityState: r.qualityState, isSimulated: true as const },
        ]),
      );
      risk = assessAir({
        stationId: station.id,
        stationName: station.name,
        isSimulated: true,
        latest,
        pm25History: pmHistory.slice(-12),
        forecastPm25: baselineForecast(pmHistory.slice(-12), 3),
        healthStatus: qualityState === 'SUSPECT' ? 'DEGRADED' : 'ONLINE',
        weather: { windSpeedKmh: 12, windDirectionDeg: 240, observedAt },
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

    if (risk.alertState !== 'NORMAL' && risk.alertState !== previousState) {
      // Transition marker is recorded in the event. Actual alert creation happens on step.
    }
    previousState = risk.alertState;
    steps.push({
      step,
      observedAt,
      values,
      risk,
      note,
      suppressAlert,
      neighbour,
      emailPreviewAvailable: risk.alertState !== 'NORMAL',
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
