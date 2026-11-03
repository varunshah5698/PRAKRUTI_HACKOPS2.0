import type { RiskAssessmentResult } from '../types.js';

export type RecommendationPriority = 'IMMEDIATE' | 'PRIORITY' | 'WATCH' | 'ROUTINE';
export type RecommendationAudience = 'PUBLIC' | 'AUTHORITY' | 'FIELD';

export interface SimulationRecommendation {
  id: string;
  priority: RecommendationPriority;
  audience: RecommendationAudience;
  title: string;
  action: string;
  reason: string;
  evidence: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface RecommendationConditions {
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  precipitationMm?: number | null;
  dispersion: string;
}

export interface RecommendationContext {
  scenario: string;
  category: string;
  step: number;
  totalSteps: number;
  stationName: string;
  risk: RiskAssessmentResult;
  values: Record<string, { value: number; unit: string; qualityState: string }>;
  conditions: RecommendationConditions | null;
  neighbour?: { name: string; pm25: number } | null;
  suppressAlert?: boolean;
}

const PRIORITY_ORDER: Record<RecommendationPriority, number> = {
  IMMEDIATE: 0,
  PRIORITY: 1,
  WATCH: 2,
  ROUTINE: 3,
};

const READING_LABELS: Record<string, string> = {
  pm25: 'PM2.5',
  pm10: 'PM10',
  no2: 'NO₂',
  so2: 'SO₂',
  co: 'CO',
  o3: 'O₃',
  ph: 'pH',
  do: 'Dissolved oxygen',
  turbidity: 'Turbidity',
  stack_pm: 'Stack PM',
  stack_nox: 'Stack NOx',
  stack_so2: 'Stack SO₂',
  verified_reports: 'Verified reports',
  unverified_reports: 'Unverified reports',
};

const AIR_SCREENING: Record<string, number> = { pm25: 60, pm10: 100, no2: 80, so2: 80, o3: 100 };

function confidenceOf(risk: RiskAssessmentResult): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (risk.confidenceLevel === 'HIGH') return 'HIGH';
  if (risk.confidenceLevel === 'MEDIUM') return 'MEDIUM';
  return 'LOW';
}

function compass(degrees: number | null | undefined): string {
  if (degrees === null || degrees === undefined || !Number.isFinite(degrees)) return 'an unknown direction';
  const points = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return `the ${points[Math.round(degrees / 45) % 8]}`;
}

function numberText(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-IN', { maximumFractionDigits: digits });
}

export function buildSimulationRecommendations(ctx: RecommendationContext): SimulationRecommendation[] {
  const items: SimulationRecommendation[] = [];
  const confidence = confidenceOf(ctx.risk);
  const add = (item: Omit<SimulationRecommendation, 'id' | 'confidence'> & { confidence?: 'HIGH' | 'MEDIUM' | 'LOW' }) => {
    items.push({
      ...item,
      id: `${ctx.category}-${ctx.step}-${item.audience.toLowerCase()}-${items.length}`,
      confidence: item.confidence ?? confidence,
    });
  };
  const reading = (code: string) => ctx.values[code];
  const readingText = (code: string) => {
    const value = reading(code);
    if (!value) return null;
    return `${READING_LABELS[code] ?? code.replace(/_/g, ' ').toUpperCase()} ${numberText(value.value)} ${value.unit}`;
  };
  const windText =
    ctx.conditions?.windSpeedKmh !== null && ctx.conditions?.windSpeedKmh !== undefined
      ? `${numberText(ctx.conditions.windSpeedKmh)} km/h from ${compass(ctx.conditions.windDirectionDeg)}`
      : 'wind data unavailable';
  const dispersionText = ctx.conditions?.dispersion ?? 'unknown dispersion';
  const totalSteps = ctx.totalSteps;

  if (ctx.category === 'air') {
    const pm25 = reading('pm25');
    const pm10 = reading('pm10');
    const quality = pm25?.qualityState ?? 'VALID';
    const persistence = ctx.risk.supportingEvidence.find((item) => item.parameter === 'station_persistence') as
      | { consecutivePm25AboveThreshold?: number; fractionAbove80Percent?: number; recentReadings?: number }
      | undefined;
    const forecast = ctx.risk.supportingEvidence.find((item) => item.kind === 'PREDICTED') as
      | { predictedValue?: number; lowerBound?: number; upperBound?: number }
      | undefined;
    const ratio = pm25 ? pm25.value / 60 : null;
    const consecutive = persistence?.consecutivePm25AboveThreshold ?? 0;
    const dominant = Object.entries(AIR_SCREENING)
      .flatMap(([code, threshold]) => {
        const value = reading(code);
        return value ? [{ code, value, ratio: value.value / threshold }] : [];
      })
      .sort((a, b) => b.ratio - a.ratio)[0] ?? null;
    const evidence = [
      readingText('pm25'),
      readingText('pm10'),
      `Alert ${ctx.risk.alertState.replace(/_/g, ' ')}`,
      ctx.stationName,
    ].filter((item): item is string => Boolean(item));

    if (ctx.suppressAlert || quality === 'SUSPECT') {
      add({
        audience: 'FIELD',
        priority: 'IMMEDIATE',
        title: 'Dispatch a station maintenance check',
        action:
          'Visit the station, inspect the inlet and logger, compare the reading with a co-located reference or the nearest neighbour, and record the fault in the maintenance log.',
        reason:
          'The replay is reporting physically implausible values (including 999, 0 and −5) and has flagged the series SUSPECT. The platform deliberately suppresses public alerts rather than presenting a equipment fault as pollution.',
        evidence: [readingText('pm25') ?? 'Implausible PM2.5', 'Quality SUSPECT', 'Alert suppressed'],
        confidence: 'HIGH',
      });
      add({
        audience: 'AUTHORITY',
        priority: 'PRIORITY',
        title: 'Do not issue a pollution advisory for this series',
        action:
          'Hold any public message until the station is checked and the reading is either corrected or replaced by a valid neighbour observation.',
        reason:
          'A faulty sensor can produce false extremes. The quality flag and alert suppression both indicate that this is a data-integrity event, not a verified change in air quality.',
        evidence: [`Confidence reduced to ${ctx.risk.confidenceScore ?? '—'}/100`, 'Quality gate active'],
        confidence: 'HIGH',
      });
      add({
        audience: 'PUBLIC',
        priority: 'ROUTINE',
        title: 'Ignore the implausible reading; use the official forecast',
        action:
          'If you need current guidance, check the nearest working monitor or the official city advisory instead of this station snapshot.',
        reason:
          'The reading is marked SUSPECT and has not produced an alert. The platform is showing the fault transparently instead of hiding or smoothing it.',
        evidence: ['Simulation-labelled station', 'No public alert generated'],
        confidence: 'MEDIUM',
      });
      add({
        audience: 'AUTHORITY',
        priority: 'ROUTINE',
        title: 'Record the quality event for audit',
        action:
          'Add a short data-quality note to the session and resume the replay once the station is back within its plausible range.',
        reason: 'Keeping the fault visible in the audit trail is what makes the suppression defensible later.',
        evidence: ['Replay session retained', 'Real observations untouched'],
        confidence: 'HIGH',
      });
      return finish(items);
    }

    if (ctx.risk.alertState === 'CRITICAL') {
      add({
        audience: 'PUBLIC',
        priority: 'IMMEDIATE',
        title: 'Limit outdoor exposure now',
        action:
          'Keep windows closed, move strenuous activity indoors and use a well-fitted N95 mask if you must travel. Check on children, older adults and anyone with asthma or heart disease.',
        reason:
          `PM2.5 is ${numberText(pm25?.value)} ${pm25?.unit ?? 'µg/m³'}${ratio ? ` (${numberText(ratio)}× the 60 µg/m³ screening value)` : ''}${dominant && dominant.code !== 'pm25' ? `, while ${READING_LABELS[dominant.code] ?? dominant.code} has the largest screening ratio at ${numberText(dominant.ratio)}× its reference` : ''}, and ${consecutive > 0 ? `${consecutive} consecutive steps` : 'the latest observation'} meet the critical screening condition. This is an indicative alert, not an official CPCB exceedance.`,
        evidence: [...evidence, 'Critical screening condition met'],
        confidence,
      });
      add({
        audience: 'AUTHORITY',
        priority: 'PRIORITY',
        title: 'Verify the monitor before a city-wide advisory',
        action:
          'Cross-check this station against its nearest neighbours, confirm calibration and data freshness, then issue any public message through the official channel with the evidence attached.',
        reason:
          'A single station cannot establish a locality-wide condition. The alert is driven by observed PM2.5 and a persistence rule; verifying the station first prevents a false public alarm.',
        evidence: [...evidence, `${ctx.risk.confidenceScore ?? '—'}/100 confidence`],
        confidence,
      });
      add({
        audience: 'FIELD',
        priority: 'PRIORITY',
        title: 'Inspect upwind dust and combustion sources',
        action:
          'Check construction dust controls, road sweeping, diesel idling, waste burning and any visible plume upwind. Capture photos, time and location.',
        reason:
          `Wind is ${windText} and dispersion is ${dispersionText}. These conditions can let local sources accumulate near the monitor instead of dispersing.`,
        evidence: [windText, `Dispersion ${dispersionText}`, readingText('pm10') ?? 'PM10 elevated'],
        confidence,
      });
      add({
        audience: 'AUTHORITY',
        priority: 'ROUTINE',
        title: 'Publish a cautious 3-hour outlook',
        action:
          forecast?.predictedValue !== undefined
            ? `Use language such as “expected to remain elevated”, with the persistence value ${numberText(forecast.predictedValue)} µg/m³ and its uncertainty band ${numberText(forecast.lowerBound)}–${numberText(forecast.upperBound)} µg/m³.`
            : 'State that the outlook is unavailable until enough history has accumulated.',
        reason:
          'The outlook is a transparent persistence baseline, not a trained model. Publishing the band prevents a single number from being read as certainty.',
        evidence: ['Persistence baseline', 'Not a trained ML forecast'],
        confidence: 'MEDIUM',
      });
    } else if (ctx.risk.alertState === 'EARLY_WARNING') {
      add({
        audience: 'AUTHORITY',
        priority: 'PRIORITY',
        title: 'Pre-position a field check',
        action:
          'Alert the field team now, identify the nearest construction, traffic and burning sources, and prepare a draft advisory without publishing it yet.',
        reason:
          `The predictive layer is showing EARLY WARNING while the observed condition is still below critical. Acting now buys time without overstating the current risk.`,
        evidence: [...evidence, 'Predictive condition met'],
        confidence,
      });
      add({
        audience: 'PUBLIC',
        priority: 'WATCH',
        title: 'Plan for dirtier air in the next few hours',
        action:
          'Sensitive groups should shorten outdoor exercise and keep reliever medication nearby. There is no need to change normal activity yet.',
        reason:
          `The persistence baseline projects ${numberText(forecast?.predictedValue)} µg/m³ over the next three hours. This is a planning signal, not a confirmed exceedance.`,
        evidence: [readingText('pm25') ?? 'PM2.5 rising', 'Early-warning state', windText],
        confidence,
      });
      add({
        audience: 'FIELD',
        priority: 'ROUTINE',
        title: 'Check the station inlet and nearby works',
        action: 'Confirm the inlet is clear and look for new dust-generating activity within roughly 500 m.',
        reason: 'A blocked inlet or a new local source can mimic a real regional rise, and both are quick to rule out.',
        evidence: ['Station quality check', `Dispersion ${dispersionText}`],
        confidence: 'MEDIUM',
      });
    } else if (ctx.risk.alertState === 'WATCH') {
      add({
        audience: 'PUBLIC',
        priority: 'WATCH',
        title: 'Sensitive groups should take breaks from outdoor exertion',
        action:
          'Children, older adults and people with heart or lung conditions should reduce prolonged outdoor activity and avoid busy roads at peak hours.',
        reason:
          `The indicative pollutant load is ${numberText(ratio ? ratio * 100 : null, 0)}% of the screening threshold. The current state is WATCH, not CRITICAL, so normal activity can continue with sensible precautions.`,
        evidence,
        confidence,
      });
      add({
        audience: 'AUTHORITY',
        priority: 'PRIORITY',
        title: 'Validate the trend before escalating',
        action:
          'Confirm the last six readings are valid, compare with the nearest neighbour and check that the station is not showing a localised or sensor-driven change.',
        reason:
          `Persistence is currently ${numberText((persistence?.fractionAbove80Percent ?? 0) * 100, 0)}% of recent readings at or above 80% of the threshold. One more sustained step could change the alert state.`,
        evidence: [...evidence, `${consecutive} consecutive elevated steps`],
        confidence,
      });
      add({
        audience: 'FIELD',
        priority: 'ROUTINE',
        title: 'Check nearby construction and traffic hotspots',
        action: 'Look for visible dust, idling queues or burning within walking distance and record what you find.',
        reason: `Wind is ${windText}; local sources are more likely to matter when dispersion is ${dispersionText.toLowerCase()}.`,
        evidence: [windText, `Dispersion ${dispersionText}`],
        confidence: 'MEDIUM',
      });
    } else {
      add({
        audience: 'PUBLIC',
        priority: 'ROUTINE',
        title: 'Normal outdoor activity is reasonable',
        action: 'No special precaution is needed from this simulated snapshot. Continue to follow official advisories for real conditions.',
        reason:
          `The latest simulated PM2.5 is ${numberText(pm25?.value)} ${pm25?.unit ?? 'µg/m³'}, below the watch condition. The replay is demonstrating a baseline state, not a health warning.`,
        evidence: [readingText('pm25') ?? 'PM2.5 available', 'Alert NORMAL'],
        confidence,
      });
      add({
        audience: 'AUTHORITY',
        priority: 'ROUTINE',
        title: 'Continue routine monitoring',
        action: 'Keep the station on its normal cadence and watch for persistence across the next few steps.',
        reason:
          'No screening condition is met. The value of the replay is showing the transition point, so the next few steps matter more than this one.',
        evidence: [`Step ${ctx.step + 1} of ${totalSteps}`, `Confidence ${ctx.risk.confidenceScore ?? '—'}/100`],
        confidence,
      });
    }

    if (ctx.scenario === 'construction_dust' && ctx.step >= 3) {
      add({
        audience: 'FIELD',
        priority: 'PRIORITY',
        title: 'Check dust controls at the active works',
        action:
          'Inspect the nearest construction or road-works site for uncovered stockpiles, unsealed haul routes, dry cutting, track-out and missing wheel washing. Photograph the controls and record the wind direction.',
        reason:
          `PM10 is ${numberText(pm10?.value)} ${pm10?.unit ?? 'µg/m³'}${pm10 ? ` (${numberText(pm10.value / 100)}× its screening reference)` : ''} while PM2.5 is ${numberText(pm25?.value)} ${pm25?.unit ?? 'µg/m³'}. A coarse-particle gap of this size points to mechanical dust rather than combustion. Wind is ${windText}.`,
        evidence: [readingText('pm10') ?? 'PM10 elevated', readingText('pm25') ?? 'PM2.5 lower', `Dispersion ${dispersionText}`],
        confidence,
      });
      add({
        audience: 'AUTHORITY',
        priority: 'ROUTINE',
        title: 'Call the works a screening lead, not a named source',
        action:
          'Record the inspection time, activity and controls observed. Do not name a contractor or allege a breach until the site record and the monitor record are linked.',
        reason:
          'A single downwind monitor cannot establish which site produced the dust. The PM10/PM2.5 contrast strengthens the dust hypothesis but does not identify the operator.',
        evidence: [ctx.stationName, 'No source attribution applied'],
        confidence: 'MEDIUM',
      });
    }

    if (ctx.scenario === 'festival_firecracker' && ctx.step >= 4) {
      const so2 = reading('so2');
      add({
        audience: 'PUBLIC',
        priority: ctx.risk.alertState === 'CRITICAL' ? 'IMMEDIATE' : 'WATCH',
        title: 'Avoid firecracker smoke, especially if you are sensitive',
        action:
          'Stay indoors with windows closed while the burst is active. Keep children, older adults and anyone with asthma or heart disease away from the smoke; use a well-fitted mask if you must go out.',
        reason:
          `The episode raises both PM2.5 (${numberText(pm25?.value)} ${pm25?.unit ?? 'µg/m³'}) and SO₂ (${numberText(so2?.value)} ${so2?.unit ?? 'µg/m³'}). Firecracker smoke mixes fine particles with irritant gases, so the usual particle-only advice is not enough.`,
        evidence: [readingText('pm25') ?? 'PM2.5 elevated', readingText('so2') ?? 'SO2 elevated', `Alert ${ctx.risk.alertState.replace(/_/g, ' ')}`],
        confidence,
      });
      add({
        audience: 'AUTHORITY',
        priority: 'ROUTINE',
        title: 'Keep enforcement language conditional',
        action:
          'If a local restriction applies, cite the actual rule and the evidence. Otherwise describe a short-duration emission episode and avoid naming individuals or neighbourhoods.',
        reason:
          'The replay detects a multi-pollutant burst but does not know which source, permission or local rule applies. The public-health advice can be firm without an unverified enforcement claim.',
        evidence: ['No permit rule evaluated', 'PM2.5 + SO2 episode'],
        confidence: 'MEDIUM',
      });
    }

    if (ctx.neighbour) {
      add({
        audience: 'AUTHORITY',
        priority: 'ROUTINE',
        title: 'Treat the neighbour divergence as spatial uncertainty',
        action:
          'Do not expand the alert to the whole locality. Report the two station values separately and state that the difference is unresolved.',
        reason:
          `${ctx.neighbour.name} is at ${numberText(ctx.neighbour.pm25)} µg/m³ while this station is at ${numberText(pm25?.value)} µg/m³. Two monitors moving in opposite directions are evidence of a local gradient, not a city-wide event.`,
        evidence: [`This station ${numberText(pm25?.value)} µg/m³`, `${ctx.neighbour.name} ${numberText(ctx.neighbour.pm25)} µg/m³`],
        confidence: 'MEDIUM',
      });
    }
  }

  if (ctx.category === 'water') {
    const ph = reading('ph');
    const dissolvedOxygen = reading('do');
    const turbidity = reading('turbidity');
    const evidence = [readingText('ph'), readingText('do'), readingText('turbidity'), ctx.stationName].filter(
      (item): item is string => Boolean(item),
    );
    const severe = ctx.risk.alertState === 'CRITICAL' || (ph && (ph.value < 6 || ph.value > 9)) || (dissolvedOxygen && dissolvedOxygen.value < 4);

    add({
      audience: 'PUBLIC',
      priority: severe ? 'IMMEDIATE' : 'WATCH',
      title: 'Avoid contact with the creek or river water',
      action:
        'Do not bathe, swim, fish or walk through discoloured or foaming water. Wash exposed skin with clean water and report the exact location.',
      reason:
        `The sample shows pH ${numberText(ph?.value)} and dissolved oxygen ${numberText(dissolvedOxygen?.value)} mg/L. The reference range is pH 6.5–8.5 and at least 5 mg/L DO; this is a screening comparison, not a regulatory determination.`,
      evidence,
      confidence,
    });
    add({
      audience: 'FIELD',
      priority: severe ? 'PRIORITY' : 'ROUTINE',
      title: 'Collect a confirmatory sample',
      action:
        'Repeat the sample at the same point, record the chain of custody and send it for laboratory pH, dissolved oxygen and turbidity confirmation.',
      reason:
        'Field probes drift. A second sample is the quickest way to separate a real discharge from an instrument or sampling artefact.',
      evidence: [...evidence, `Step ${ctx.step + 1} of ${totalSteps}`],
      confidence,
    });
    add({
      audience: 'AUTHORITY',
      priority: severe ? 'PRIORITY' : 'ROUTINE',
      title: 'Inspect upstream drains and outfalls',
      action:
        'Walk the upstream reach during the same window, look for active discharge, foam or odour, and check whether any industrial or municipal outfall is operating unusually.',
      reason:
        'Water quality can change quickly with a single discharge. The sample tells you the condition, not the source, so the source inspection has to happen while the condition is present.',
      evidence: ['Reference criteria only', `Alert ${ctx.risk.alertState.replace(/_/g, ' ')}`],
      confidence,
    });
    if (severe) {
      add({
        audience: 'AUTHORITY',
        priority: 'ROUTINE',
        title: 'Keep the public message separate from enforcement',
        action:
          'Use “avoid contact” language while the sample is confirmed. Do not describe the result as a legal violation or name a polluter without source evidence.',
        reason:
          'The ruleset compares against CPCB outdoor bathing criteria for context. It does not establish a discharge offence or identify the responsible party.',
        evidence: ['WATER_REFERENCE_V1', 'No legal determination'],
        confidence: 'HIGH',
      });
    }
    if (ctx.scenario === 'monsoon_drain_overflow' && ctx.step >= 2) {
      add({
        audience: 'PUBLIC',
        priority: severe ? 'IMMEDIATE' : 'WATCH',
        title: 'Avoid walking or cycling through drain overflow',
        action:
          'Do not enter floodwater or overflow near the outfall. Wash exposed skin with clean water, keep children away, and report the overflow location with a photo from a safe distance.',
        reason:
          `Turbidity is ${numberText(turbidity?.value, 0)} NTU and dissolved oxygen is ${numberText(dissolvedOxygen?.value)} mg/L. Overflow can carry sewage, debris and contaminants; the water can look clear and still be unsafe.`,
        evidence: [readingText('turbidity') ?? 'Turbidity elevated', readingText('do') ?? 'DO low', ctx.stationName],
        confidence,
      });
      add({
        audience: 'AUTHORITY',
        priority: 'PRIORITY',
        title: 'Inspect the overflowing outfall while it is active',
        action:
          'Record the outfall identifier, flow and colour, sample upstream and downstream of the discharge, and notify the drainage operator if the overflow is not an emergency release.',
        reason:
          'The source survey has to happen while the overflow is running; a later visit only shows the receded condition. A downstream sample separates an outfall signal from ambient creek water.',
        evidence: [readingText('turbidity') ?? 'Turbidity elevated', `Step ${ctx.step + 1} of ${totalSteps}`, 'Reference criteria only'],
        confidence,
      });
    }
  }

  if (ctx.category === 'waste') {
    const verified = Math.round(reading('verified_reports')?.value ?? 0);
    const unverified = Math.round(reading('unverified_reports')?.value ?? 0);
    const repeat = verified >= 2;
    const evidence = [`${verified} verified report${verified === 1 ? '' : 's'}`, `${unverified} unverified report${unverified === 1 ? '' : 's'}`];

    if (repeat) {
      add({
        audience: 'AUTHORITY',
        priority: 'PRIORITY',
        title: 'Open a hotspot inspection within 24 hours',
        action:
          'Assign a field officer to the locality, check the reported points, and record whether the same dumping or burning condition is still present.',
        reason:
          `${verified} verified reports meet the repeat-hotspot rule. That is report evidence, not a measured violation; the inspection is what turns it into an actionable finding.`,
        evidence: [...evidence, 'Repeat hotspot condition met'],
        confidence,
      });
      add({
        audience: 'FIELD',
        priority: 'PRIORITY',
        title: 'Visit the reported point and geotag the evidence',
        action: 'Photograph the waste, note the landmark and estimate the area affected. Add a second photo on departure to show whether it changed.',
        reason: 'Photos taken at the same point before and after the visit are the strongest evidence that the condition persisted.',
        evidence: [...evidence, 'Citizen evidence attached'],
        confidence,
      });
    } else if (verified === 1) {
      add({
        audience: 'AUTHORITY',
        priority: 'PRIORITY',
        title: 'Verify the remaining reports within 48 hours',
        action: 'Review the evidence, contact the reporter if the location is ambiguous and decide whether the report is verified or closed.',
        reason:
          'One verified report is not yet a repeat hotspot. Clearing the queue within 48 hours stops a real hotspot from being missed without treating a single complaint as a violation.',
        evidence,
        confidence,
      });
      add({
        audience: 'FIELD',
        priority: 'ROUTINE',
        title: 'Confirm the reported location',
        action: 'Use the landmark and photo to confirm the exact point before adding field evidence.',
        reason: 'Waste reports often cluster within a few metres. Confirming the point prevents duplicate reports from inflating the score.',
        evidence,
        confidence,
      });
    } else {
      add({
        audience: 'AUTHORITY',
        priority: 'ROUTINE',
        title: 'Triage the unverified report',
        action: 'Check the photo and location for duplicates, then assign verification or close the report with a reason.',
        reason:
          'The replay is still at the unverified stage. A single unverified complaint must never create a confirmed critical violation.',
        evidence,
        confidence: 'MEDIUM',
      });
    }

    add({
      audience: 'PUBLIC',
      priority: 'ROUTINE',
      title: 'Use authorised collection and never burn waste',
      action:
        'Keep the location clean, use the municipal collection point and add a photo if the same dumping or burning returns.',
      reason: 'Open burning releases fine particles and toxic gases. Citizen reports become evidence only after review, so a photo and landmark make the report usable.',
      evidence,
      confidence: 'HIGH',
    });
    add({
      audience: 'AUTHORITY',
      priority: 'ROUTINE',
      title: 'Do not call the report a confirmed violation',
      action: 'Keep the wording to “reported” and “verified report evidence” until the inspection and any enforcement step are complete.',
      reason: 'The risk score is built from report evidence. It does not measure a statutory limit or prove who caused the dumping.',
      evidence: ['WASTE_REPORT_EVIDENCE_V1'],
      confidence: 'HIGH',
    });
  }

  if (ctx.category === 'industrial') {
    const stackPm = reading('stack_pm');
    const stackNox = reading('stack_nox');
    const stackSo2 = reading('stack_so2');
    const evidence = [readingText('stack_pm'), readingText('stack_nox'), readingText('stack_so2'), ctx.stationName].filter(
      (item): item is string => Boolean(item),
    );
    const active = ctx.risk.alertState !== 'NORMAL';
    add({
      audience: 'AUTHORITY',
      priority: active ? 'PRIORITY' : 'ROUTINE',
      title: active ? 'Notify the operator for a stack check' : 'Continue relative-baseline monitoring',
      action: active
        ? 'Ask the operator to confirm process load, abatement operation and the last maintenance window, then record the response against this session.'
        : 'Keep the stack on its normal sampling cadence and compare the next reading with the recent baseline.',
      reason: active
        ? `The stack reading is above its own recent baseline. This is a relative anomaly, not an exceedance of a facility-specific limit, so the first step is an operational check.`
        : 'No relative anomaly is currently flagged. The baseline comparison becomes more useful as the replay accumulates steps.',
      evidence: [...evidence, `Alert ${ctx.risk.alertState.replace(/_/g, ' ')}`],
      confidence,
    });
    if (active) {
      add({
        audience: 'FIELD',
        priority: 'PRIORITY',
        title: 'Inspect abatement equipment and operating load',
        action:
          'Record the process load, visual stack condition, fan and filter status and any maintenance activity. Take a photo of the stack from a safe public viewpoint.',
        reason:
          'A relative rise can come from higher production, a bypass, or a monitoring artefact. The operating record is what distinguishes those causes.',
        evidence: [...evidence, 'No legal emission threshold applied'],
        confidence,
      });
      add({
        audience: 'PUBLIC',
        priority: 'WATCH',
        title: 'Move upwind if you see dark smoke or smell chemicals',
        action: 'Do not enter the plume. Report the time, landmark, wind direction and a photo from a safe distance.',
        reason:
          'The industrial ruleset cannot identify a facility or prove causation from a nearby air monitor. A visual report with a timestamp is still useful evidence.',
        evidence: [`Wind ${windText}`, `Alert ${ctx.risk.alertState.replace(/_/g, ' ')}`],
        confidence: 'MEDIUM',
      });
      add({
        audience: 'AUTHORITY',
        priority: 'ROUTINE',
        title: 'Do not apply a legal emission threshold',
        action: 'Describe the result as a change from the facility’s own baseline and avoid any compliance conclusion until a verified standard and stack test are available.',
        reason: 'Facility-specific standards and sampling methods were not verified for this record. Presenting a threshold would overstate what the simulation can prove.',
        evidence: ['INDUSTRIAL_RELATIVE_V1', 'No facility identified'],
        confidence: 'HIGH',
      });
    } else {
      add({
        audience: 'FIELD',
        priority: 'ROUTINE',
        title: 'Record process load with the next sample',
        action: 'Note production rate, fuel use and abatement status so the next relative comparison has context.',
        reason: 'A stack value without its operating load is hard to interpret and easy to misread later.',
        evidence: ['Baseline comparison', `Step ${ctx.step + 1} of ${totalSteps}`],
        confidence: 'MEDIUM',
      });
    }
  }

  return finish(items);
}

function finish(items: SimulationRecommendation[]): SimulationRecommendation[] {
  return [...items].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}
