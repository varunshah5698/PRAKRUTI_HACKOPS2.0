export interface StandardLike {
  parameter: string;
  parameter_code?: string | null;
  operator: string;
  threshold_value: number | null;
  threshold_max: number | null;
  unit: string;
  averaging_period: string;
  applicability: string;
  section_ref: string;
  notes?: string | null;
}

export interface ObservationLike {
  value: number;
  unit: string;
  observed_at: string;
  quality_state: string;
  source_id: string;
  is_simulated: boolean;
}

export interface ComparisonResult {
  comparability: 'COMPARABLE_REFERENCE' | 'NOT_COMPARABLE_UNIT' | 'NOT_COMPARABLE_AVERAGING' | 'NOT_APPLICABLE_SOURCE_TYPE';
  reason: string;
  indicative: 'ABOVE_REFERENCE' | 'WITHIN_REFERENCE' | 'NOT_ASSESSED';
  label: string;
}

const normalizeUnit = (u: string) => u.replace('µg/m3', 'µg/m³').replace('mg/m3', 'mg/m³').trim();

export function compareObservation(
  stationType: string,
  observation: ObservationLike,
  standard: StandardLike,
): ComparisonResult {
  const standardUnit = normalizeUnit(standard.unit);
  const observationUnit = normalizeUnit(observation.unit);
  const unitComparable = standardUnit === observationUnit;
  const averaging = standard.averaging_period;
  const isStack = stationType === 'INDUSTRIAL_STACK';
  const sourceTypeComparable = !isStack;
  const averagingComparable = !['24 hours', '8 hours'].includes(averaging) || stationType !== 'AIR_CAAQMS';

  let comparability: ComparisonResult['comparability'] = 'COMPARABLE_REFERENCE';
  let reason = 'Reference comparison only. Official determination requires an authorised officer.';
  if (!unitComparable) {
    comparability = 'NOT_COMPARABLE_UNIT';
    reason = `Observation unit ${observation.unit} does not match standard unit ${standard.unit}. No conversion was applied.`;
  } else if (!sourceTypeComparable) {
    comparability = 'NOT_APPLICABLE_SOURCE_TYPE';
    reason = 'Stack monitoring readings are not effluent samples and cannot be compared with effluent standards.';
  } else if (!averagingComparable) {
    comparability = 'NOT_COMPARABLE_AVERAGING';
    reason = `A single available observation is not a valid ${averaging} average. The comparison is indicative only and must not be labelled an official exceedance.`;
  }

  const threshold = standard.threshold_value;
  const thresholdMax = standard.threshold_max;
  let indicative: ComparisonResult['indicative'] = 'NOT_ASSESSED';
  if (comparability === 'COMPARABLE_REFERENCE' && threshold !== null) {
    if (standard.operator === 'range' && thresholdMax !== null) {
      indicative = observation.value < threshold || observation.value > thresholdMax ? 'ABOVE_REFERENCE' : 'WITHIN_REFERENCE';
    } else if (standard.operator === '>=') {
      indicative = observation.value < threshold ? 'ABOVE_REFERENCE' : 'WITHIN_REFERENCE';
    } else {
      indicative = observation.value > threshold ? 'ABOVE_REFERENCE' : 'WITHIN_REFERENCE';
    }
  }

  return {
    comparability,
    reason,
    indicative,
    label:
      comparability === 'COMPARABLE_REFERENCE' && indicative === 'ABOVE_REFERENCE'
        ? 'POTENTIAL COMPLIANCE CONCERN — reference comparison only'
        : comparability !== 'COMPARABLE_REFERENCE'
          ? 'NOT COMPARABLE — see reason'
          : 'WITHIN REFERENCE RANGE (reference only)',
  };
}
