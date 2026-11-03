import {
  confidenceLevelFromScore,
  riskLevelFromScore,
  type AlertState,
  type RiskAssessmentResult,
} from '../types.js';
import type { BaselineForecast } from './forecast.js';

const AIR_THRESHOLDS: Record<string, number> = {
  pm25: 60,
  pm10: 100,
  no2: 80,
  so2: 80,
  co: 2,
  o3: 100,
};

export interface LatestReading {
  value: number;
  unit: string;
  observedAt: string;
  qualityState: string;
  sourceId: string;
  isSimulated: boolean;
}

export interface AirRiskInput {
  stationId: string;
  stationName: string;
  isSimulated: boolean;
  latest: Record<string, LatestReading | undefined>;
  pm25History: Array<{ observedAt: string; value: number }>;
  forecastPm25: BaselineForecast | null;
  healthStatus: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';
  weather?: { windSpeedKmh: number | null; windDirectionDeg: number | null; observedAt: string } | null;
  now?: Date;
}

function ageHours(iso: string | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / 3_600_000;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function confidenceLevel(score: number | null): 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' {
  return confidenceLevelFromScore(score);
}

export function assessAir(input: AirRiskInput): RiskAssessmentResult {
  const now = input.now ?? new Date();
  const latestEntries = Object.entries(input.latest).filter(([, v]) => v && v.qualityState !== 'INVALID');
  const suspectCount = latestEntries.filter(([, v]) => v?.qualityState === 'SUSPECT').length;
  const missingInputs: string[] = [];
  if (suspectCount > 0) missingInputs.push(`${suspectCount} latest reading(s) flagged SUSPECT`);
  for (const pollutant of Object.keys(AIR_THRESHOLDS)) {
    if (!input.latest[pollutant]) missingInputs.push(`No recent ${pollutant.toUpperCase()} value`);
  }

  const ratios: Array<{ pollutant: string; value: number; threshold: number; ratio: number; observedAt: string }> = [];
  for (const [pollutant, reading] of latestEntries) {
    if (!reading) continue;
    const threshold = AIR_THRESHOLDS[pollutant];
    if (!threshold) continue;
    ratios.push({
      pollutant,
      value: reading.value,
      threshold,
      ratio: reading.value / threshold,
      observedAt: reading.observedAt,
    });
  }
  const maxRatio = ratios.length ? Math.max(...ratios.map((r) => r.ratio)) : 0;
  const dominant = ratios.sort((a, b) => b.ratio - a.ratio)[0] ?? null;

  const sortedHistory = [...input.pm25History].sort(
    (a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime(),
  );
  const recentHistory = sortedHistory.slice(-6);
  const persistence =
    recentHistory.length === 0
      ? 0
      : recentHistory.filter((h) => h.value >= AIR_THRESHOLDS.pm25 * 0.8).length / recentHistory.length;
  const consecutiveAbove = (() => {
    let count = 0;
    for (let i = sortedHistory.length - 1; i >= 0; i -= 1) {
      if (sortedHistory[i].value >= AIR_THRESHOLDS.pm25) count += 1;
      else break;
    }
    return count;
  })();

  const latestAge = ageHours(
    latestEntries.map(([, v]) => v?.observedAt).filter(Boolean).sort().at(-1) as string | undefined,
    now,
  );
  const completeness = Math.min(1, latestEntries.length / 6);
  const recencyPoints = latestAge === null ? 0 : latestAge <= 2 ? 25 : latestAge <= 6 ? 15 : 5;
  const historyPoints = sortedHistory.length >= 6 ? 20 : sortedHistory.length >= 3 ? 10 : 0;
  const healthPoints =
    input.healthStatus === 'ONLINE' ? 20 : input.healthStatus === 'DEGRADED' ? 10 : input.healthStatus === 'UNKNOWN' ? 5 : 0;
  const confidenceScore = Math.max(0, Math.round(completeness * 35 + recencyPoints + historyPoints + healthPoints - suspectCount * 10));
  if (input.healthStatus === 'OFFLINE') missingInputs.push('Station is offline');
  if (latestAge !== null && latestAge > 6) missingInputs.push('Latest station reading is older than 6 hours');
  if (!input.forecastPm25) missingInputs.push('Insufficient history for a persistence baseline forecast');

  const forecastPressure = (() => {
    if (!input.forecastPm25 || !input.latest.pm25) return 0;
    const current = input.latest.pm25.value;
    const denominator = Math.max(1, current * 0.2);
    return clamp01((input.forecastPm25.predictedValue - current) / denominator);
  })();

  const riskScore = Math.round(
    100 * (0.6 * clamp01(maxRatio / 1.5) + 0.25 * persistence + 0.15 * forecastPressure),
  );

  const observedCritical = consecutiveAbove >= 3 && confidenceScore >= 50 && suspectCount === 0;
  const observedWatch = maxRatio >= 0.7;
  const predictiveWarning =
    suspectCount === 0 &&
    Boolean(input.forecastPm25) &&
    input.forecastPm25!.predictedValue >= AIR_THRESHOLDS.pm25 &&
    persistence >= 0.5;

  const observedAlertState: AlertState = observedCritical ? 'CRITICAL' : observedWatch ? 'WATCH' : 'NORMAL';
  const predictiveAlertState: AlertState = predictiveWarning ? 'EARLY_WARNING' : 'NORMAL';
  const alertState: AlertState =
    observedAlertState === 'CRITICAL'
      ? 'CRITICAL'
      : predictiveAlertState === 'EARLY_WARNING'
        ? 'EARLY_WARNING'
        : observedAlertState === 'WATCH'
          ? 'WATCH'
          : 'NORMAL';

  // A critical alert must never be presented with a low severity score.
  const hasEvidence = latestEntries.length > 0;
  const finalRiskScore = !hasEvidence ? null : alertState === 'CRITICAL' ? Math.max(riskScore, 75) : riskScore;

  const supportingEvidence: Array<Record<string, unknown>> = [];
  for (const ratio of ratios.slice(0, 6)) {
    supportingEvidence.push({
      kind: 'OBSERVED',
      pollutant: ratio.pollutant.toUpperCase(),
      value: ratio.value,
      unit: input.latest[ratio.pollutant]?.unit,
      threshold: ratio.threshold,
      unitThreshold: 'µg/m³ (except CO mg/m³)',
      observedAt: ratio.observedAt,
      sourceId: input.latest[ratio.pollutant]?.sourceId,
      isSimulated: input.latest[ratio.pollutant]?.isSimulated,
      note: 'Screening comparison only. NAAQS thresholds use specified averaging periods; hourly values are indicative and not an official exceedance.',
    });
  }
  if (input.forecastPm25) {
    supportingEvidence.push({
      kind: 'PREDICTED',
      method: input.forecastPm25.method,
      horizonHours: 3,
      predictedValue: input.forecastPm25.predictedValue,
      lowerBound: input.forecastPm25.lowerBound,
      upperBound: input.forecastPm25.upperBound,
      confidence: input.forecastPm25.confidence,
      note: 'Persistence baseline, not a trained ML forecast. Not a regulatory determination.',
    });
  }
  if (input.weather) {
    supportingEvidence.push({
      kind: 'OBSERVED',
      parameter: 'weather',
      windSpeedKmh: input.weather.windSpeedKmh,
      windDirectionDeg: input.weather.windDirectionDeg,
      observedAt: input.weather.observedAt,
      note: 'Meteorological context only; not evidence of causation.',
    });
  }
  supportingEvidence.push({
    kind: 'OBSERVED',
    parameter: 'station_persistence',
    recentReadings: recentHistory.length,
    fractionAbove80Percent: Number(persistence.toFixed(2)),
    consecutivePm25AboveThreshold: consecutiveAbove,
  });

  const factors = [
    {
      factor: 'Indicative pollutant load (max value / NAAQS 24h threshold)',
      weight: 0.6,
      contribution: Number((60 * clamp01(maxRatio / 1.5)).toFixed(1)),
      detail: dominant
        ? `${dominant.pollutant.toUpperCase()} at ${dominant.value} vs ${dominant.threshold}; ratio ${dominant.ratio.toFixed(2)}.`
        : 'No comparable pollutant values.',
    },
    {
      factor: 'Persistence of elevated PM2.5',
      weight: 0.25,
      contribution: Number((25 * persistence).toFixed(1)),
      detail: `${Math.round(persistence * 100)}% of the last ${recentHistory.length} hourly values were ≥80% of the 24h PM2.5 threshold.`,
    },
    {
      factor: 'Persistence baseline trend pressure',
      weight: 0.15,
      contribution: Number((15 * forecastPressure).toFixed(1)),
      detail: input.forecastPm25
        ? `+3h persistence baseline: ${input.forecastPm25.predictedValue} µg/m³ (not a trained ML forecast).`
        : 'No forecast available.',
    },
  ];

  return {
    category: 'air',
    entityType: 'station',
    entityId: input.stationId,
    riskScore: finalRiskScore,
    riskLevel: riskLevelFromScore(finalRiskScore),
    confidenceScore,
    confidenceLevel: confidenceLevel(confidenceScore),
    alertState,
    observedAlertState,
    predictiveAlertState,
    method: 'AIR_SCREEN_V1: 60% indicative pollutant load + 25% persistence + 15% baseline trend pressure',
    rulesetVersion: 'AIR_SCREEN_V1',
    supportingEvidence,
    missingInputs,
    factors,
    calculatedAt: now.toISOString(),
  };
}

export interface WaterRiskInput {
  siteId: string;
  siteName: string;
  isSimulated: boolean;
  latest: Record<string, LatestReading | undefined>;
  verifiedReports7d: number;
  unverifiedReports7d: number;
  now?: Date;
}

export function assessWater(input: WaterRiskInput): RiskAssessmentResult {
  const now = input.now ?? new Date();
  const ph = input.latest.ph;
  const doValue = input.latest.do;
  const turbidity = input.latest.turbidity;
  const missingInputs: string[] = [];
  if (!ph) missingInputs.push('No recent pH measurement');
  if (!doValue) missingInputs.push('No recent dissolved oxygen measurement');
  if (!turbidity) missingInputs.push('No recent turbidity measurement');

  const phDeviation = ph ? clamp01(Math.max(0, 6.5 - ph.value) / 1.5 + Math.max(0, ph.value - 8.5) / 1.5) : 0;
  const doDeficit = doValue ? clamp01(Math.max(0, 5 - doValue.value) / 5) : 0;
  const reportPressure = clamp01((input.verifiedReports7d * 0.5 + input.unverifiedReports7d * 0.15) / 2);
  const riskScore = Math.round(100 * (0.35 * phDeviation + 0.35 * doDeficit + 0.3 * reportPressure));

  const latestAge = ageHours(ph?.observedAt ?? doValue?.observedAt, now);
  const parameterCompleteness = [ph, doValue, turbidity].filter(Boolean).length / 3;
  const recencyPoints = latestAge === null ? 0 : latestAge <= 24 ? 30 : latestAge <= 72 ? 15 : 5;
  const evidencePoints = input.verifiedReports7d > 0 ? 30 : input.unverifiedReports7d > 0 ? 10 : 0;
  const confidenceScore = Math.round(parameterCompleteness * 40 + recencyPoints + evidencePoints);

  const severePh = Boolean(ph && (ph.value < 6.0 || ph.value > 9.0));
  const severeDo = Boolean(doValue && doValue.value < 4);
  const observedViolation = Boolean(
    ph && doValue && severePh && severeDo && confidenceScore >= 50,
  );
  const watch = Boolean(ph && (ph.value < 6.5 || ph.value > 8.5)) || Boolean(doValue && doValue.value < 5) || input.verifiedReports7d > 0;
  const alertState: AlertState = observedViolation ? 'CRITICAL' : watch ? 'WATCH' : 'NORMAL';

  const hasEvidence = Boolean(ph || doValue || input.verifiedReports7d > 0 || input.unverifiedReports7d > 0);
  const finalRiskScore = !hasEvidence ? null : alertState === 'CRITICAL' ? Math.max(riskScore, 75) : riskScore;

  const supportingEvidence: Array<Record<string, unknown>> = [];
  if (ph) {
    supportingEvidence.push({
      kind: 'OBSERVED',
      parameter: 'pH',
      value: ph.value,
      unit: ph.unit,
      referenceRange: '6.5–8.5 (CPCB outdoor bathing criteria, reference only)',
      observedAt: ph.observedAt,
      sourceId: ph.sourceId,
      isSimulated: ph.isSimulated,
    });
  }
  if (doValue) {
    supportingEvidence.push({
      kind: 'OBSERVED',
      parameter: 'Dissolved oxygen',
      value: doValue.value,
      unit: doValue.unit,
      referenceMinimum: '5 mg/L (CPCB outdoor bathing criteria, reference only)',
      observedAt: doValue.observedAt,
      sourceId: doValue.sourceId,
      isSimulated: doValue.isSimulated,
    });
  }
  if (turbidity) {
    supportingEvidence.push({
      kind: 'OBSERVED',
      parameter: 'Turbidity',
      value: turbidity.value,
      unit: turbidity.unit,
      note: 'Informational only; no threshold applied in this ruleset.',
      observedAt: turbidity.observedAt,
    });
  }
  supportingEvidence.push({
    kind: 'REPORTED',
    verifiedReports7d: input.verifiedReports7d,
    unverifiedReports7d: input.unverifiedReports7d,
    note: 'Citizen reports are not measurements. Verified status requires an authorised reviewer.',
  });

  return {
    category: 'water',
    entityType: 'station',
    entityId: input.siteId,
    riskScore: finalRiskScore,
    riskLevel: riskLevelFromScore(finalRiskScore),
    confidenceScore,
    confidenceLevel: confidenceLevel(confidenceScore),
    alertState,
    observedAlertState: alertState,
    predictiveAlertState: 'NORMAL',
    method: 'WATER_REFERENCE_V1: 35% pH deviation + 35% DO deficit + 30% report evidence',
    rulesetVersion: 'WATER_REFERENCE_V1',
    supportingEvidence,
    missingInputs,
    factors: [
      {
        factor: 'pH deviation from 6.5–8.5 reference range',
        weight: 0.35,
        contribution: Number((35 * phDeviation).toFixed(1)),
        detail: ph ? `pH ${ph.value}` : 'No pH value',
      },
      {
        factor: 'Dissolved oxygen deficit below 5 mg/L reference',
        weight: 0.35,
        contribution: Number((35 * doDeficit).toFixed(1)),
        detail: doValue ? `DO ${doValue.value} mg/L` : 'No DO value',
      },
      {
        factor: 'Verified and unverified report pressure',
        weight: 0.3,
        contribution: Number((30 * reportPressure).toFixed(1)),
        detail: `${input.verifiedReports7d} verified, ${input.unverifiedReports7d} unverified reports in 7 days.`,
      },
    ],
    calculatedAt: now.toISOString(),
  };
}

export interface WasteRiskInput {
  localityId: string;
  localityName: string;
  reports7d: Array<{
    id: string;
    status: string;
    verificationState: string;
    evidenceCount: number;
    distanceM: number;
    submittedAt: string;
  }>;
  criticalIncidents: number;
  now?: Date;
}

export function assessWaste(input: WasteRiskInput): RiskAssessmentResult {
  const now = input.now ?? new Date();
  const verified = input.reports7d.filter((r) => r.verificationState === 'VERIFIED').length;
  const unverified = input.reports7d.filter((r) => r.verificationState !== 'VERIFIED').length;
  const withEvidence = input.reports7d.filter((r) => r.evidenceCount > 0).length;
  const repeatHotspot = verified >= 2;
  const score = Math.min(
    100,
    Math.round(verified * 18 + unverified * 5 + Math.min(15, withEvidence * 3) + (repeatHotspot ? 15 : 0) + input.criticalIncidents * 20),
  );
  const confidenceScore = Math.min(
    100,
    Math.round(20 + verified * 20 + withEvidence * 8 + (input.reports7d.length > 0 ? 10 : 0)),
  );
  const critical = repeatHotspot || input.criticalIncidents > 0;
  const watch = input.reports7d.length >= 2 || verified > 0;
  const alertState: AlertState = critical ? 'CRITICAL' : watch ? 'WATCH' : 'NORMAL';
  const hasEvidence = input.reports7d.length > 0 || input.criticalIncidents > 0;
  const finalRiskScore = !hasEvidence ? null : alertState === 'CRITICAL' ? Math.max(score, 75) : score;

  return {
    category: 'waste',
    entityType: 'locality',
    entityId: input.localityId,
    riskScore: finalRiskScore,
    riskLevel: riskLevelFromScore(finalRiskScore),
    confidenceScore,
    confidenceLevel: confidenceLevel(confidenceScore),
    alertState,
    observedAlertState: alertState,
    predictiveAlertState: 'NORMAL',
    method: 'WASTE_REPORT_EVIDENCE_V1: verified reports, evidence quality, repeat hotspot and incident history',
    rulesetVersion: 'WASTE_REPORT_EVIDENCE_V1',
    supportingEvidence: [
      {
        kind: 'REPORTED',
        reports7d: input.reports7d.length,
        verified,
        unverified,
        withPhotographicEvidence: withEvidence,
        repeatHotspot,
        criticalIncidents: input.criticalIncidents,
        note: 'A single unverified complaint never produces a confirmed critical violation.',
      },
    ],
    missingInputs: input.reports7d.length === 0 ? ['No recent reports in this locality'] : [],
    factors: [
      { factor: 'Verified reports', weight: 0.45, contribution: Math.min(45, verified * 18), detail: `${verified} verified reports` },
      { factor: 'Unverified reports', weight: 0.2, contribution: Math.min(20, unverified * 5), detail: `${unverified} unverified reports` },
      {
        factor: 'Evidence and repeat-hotspot pressure',
        weight: 0.35,
        contribution: Math.min(35, Math.min(15, withEvidence * 3) + (repeatHotspot ? 15 : 0) + input.criticalIncidents * 20),
        detail: `${withEvidence} reports with evidence; repeat hotspot: ${repeatHotspot ? 'yes' : 'no'}.`,
      },
    ],
    calculatedAt: now.toISOString(),
  };
}

export interface IndustrialRiskInput {
  siteId: string;
  siteName: string;
  isSimulated: boolean;
  latest: Record<string, LatestReading | undefined>;
  baseline: Record<string, number | undefined>;
  verifiedReports7d: number;
  openIncidents: number;
  now?: Date;
}

export function assessIndustrial(input: IndustrialRiskInput): RiskAssessmentResult {
  const now = input.now ?? new Date();
  const parameters = Object.keys(input.latest);
  const missingInputs: string[] = [];
  if (parameters.length === 0) missingInputs.push('No recent industrial monitoring readings');
  if (input.verifiedReports7d === 0) missingInputs.push('No verified industrial reports in the last 7 days');

  let anomalyPressure = 0;
  const anomalies: Array<Record<string, unknown>> = [];
  for (const [parameter, reading] of Object.entries(input.latest)) {
    if (!reading) continue;
    const base = input.baseline[parameter];
    if (!base || base <= 0) continue;
    const change = (reading.value - base) / base;
    const pressure = clamp01(change / 0.5);
    anomalyPressure = Math.max(anomalyPressure, pressure);
    if (change > 0.2) {
      anomalies.push({
        kind: 'OBSERVED',
        parameter,
        value: reading.value,
        unit: reading.unit,
        baselineValue: base,
        relativeChange: Number(change.toFixed(2)),
        observedAt: reading.observedAt,
        sourceId: reading.sourceId,
        isSimulated: reading.isSimulated,
        note: 'Change from own recent baseline. No legal emission threshold is applied because facility-specific standards were not verified for this record.',
      });
    }
  }

  const reportPressure = clamp01((input.verifiedReports7d * 0.5 + input.openIncidents * 0.3) / 2);
  const riskScore = Math.round(100 * (0.4 * anomalyPressure + 0.4 * reportPressure + 0.2 * Math.min(1, input.openIncidents / 2)));
  const confidenceScore = Math.round(
    Math.min(1, parameters.length / 3) * 40 + (input.verifiedReports7d > 0 ? 30 : 10) + (anomalies.length > 0 ? 30 : 10),
  );
  const critical = input.verifiedReports7d >= 2 && anomalyPressure >= 0.5;
  const watch = anomalyPressure >= 0.4 || input.verifiedReports7d > 0;
  const alertState: AlertState = critical ? 'CRITICAL' : watch ? 'WATCH' : 'NORMAL';
  const hasEvidence = parameters.length > 0 || input.verifiedReports7d > 0 || input.openIncidents > 0;
  const finalRiskScore = !hasEvidence ? null : alertState === 'CRITICAL' ? Math.max(riskScore, 75) : riskScore;

  return {
    category: 'industrial',
    entityType: 'station',
    entityId: input.siteId,
    riskScore: finalRiskScore,
    riskLevel: riskLevelFromScore(finalRiskScore),
    confidenceScore,
    confidenceLevel: confidenceLevel(confidenceScore),
    alertState,
    observedAlertState: alertState,
    predictiveAlertState: 'NORMAL',
    method:
      'INDUSTRIAL_RELATIVE_V1: 40% relative change from own baseline + 40% verified report pressure + 20% open incidents. No legal threshold applied.',
    rulesetVersion: 'INDUSTRIAL_RELATIVE_V1',
    supportingEvidence: [
      ...anomalies,
      {
        kind: 'REPORTED',
        verifiedReports7d: input.verifiedReports7d,
        openIncidents: input.openIncidents,
        note: 'A nearby air-quality station cannot by itself establish that a specific facility caused pollution.',
      },
    ],
    missingInputs,
    factors: [
      {
        factor: 'Relative change from own recent baseline',
        weight: 0.4,
        contribution: Number((40 * anomalyPressure).toFixed(1)),
        detail: anomalies.length ? `${anomalies.length} parameters above +20% of baseline.` : 'No relative anomaly.',
      },
      {
        factor: 'Verified report pressure',
        weight: 0.4,
        contribution: Number((40 * reportPressure).toFixed(1)),
        detail: `${input.verifiedReports7d} verified reports in 7 days.`,
      },
      {
        factor: 'Open incident history',
        weight: 0.2,
        contribution: Number((20 * Math.min(1, input.openIncidents / 2)).toFixed(1)),
        detail: `${input.openIncidents} open incidents.`,
      },
    ],
    calculatedAt: now.toISOString(),
  };
}
