/**
 * AQI sub-index calculation using CPCB breakpoints.
 *
 * IMPORTANT: CPCB AQI is defined for specific averaging periods (mostly 24h).
 * In this application, sub-indices are computed from available hourly demo
 * values only to give an indicative city view. The result is never labelled an
 * official CPCB AQI.
 */

type Breakpoint = { conc: number; aqi: number };

const BREAKPOINTS: Record<string, { unit: string; averaging: string; points: Breakpoint[] }> = {
  pm25: {
    unit: 'µg/m³',
    averaging: '24h (indicative hourly input)',
    points: [
      { conc: 0, aqi: 0 },
      { conc: 30, aqi: 50 },
      { conc: 60, aqi: 100 },
      { conc: 90, aqi: 200 },
      { conc: 120, aqi: 300 },
      { conc: 250, aqi: 400 },
      { conc: 500, aqi: 500 },
    ],
  },
  pm10: {
    unit: 'µg/m³',
    averaging: '24h (indicative hourly input)',
    points: [
      { conc: 0, aqi: 0 },
      { conc: 50, aqi: 50 },
      { conc: 100, aqi: 100 },
      { conc: 250, aqi: 200 },
      { conc: 350, aqi: 300 },
      { conc: 430, aqi: 400 },
      { conc: 600, aqi: 500 },
    ],
  },
  no2: {
    unit: 'µg/m³',
    averaging: '24h (indicative hourly input)',
    points: [
      { conc: 0, aqi: 0 },
      { conc: 40, aqi: 50 },
      { conc: 80, aqi: 100 },
      { conc: 180, aqi: 200 },
      { conc: 280, aqi: 300 },
      { conc: 400, aqi: 400 },
      { conc: 800, aqi: 500 },
    ],
  },
  so2: {
    unit: 'µg/m³',
    averaging: '24h (indicative hourly input)',
    points: [
      { conc: 0, aqi: 0 },
      { conc: 40, aqi: 50 },
      { conc: 80, aqi: 100 },
      { conc: 380, aqi: 200 },
      { conc: 800, aqi: 300 },
      { conc: 1600, aqi: 400 },
      { conc: 2000, aqi: 500 },
    ],
  },
  co: {
    unit: 'mg/m³',
    averaging: '8h (indicative hourly input)',
    points: [
      { conc: 0, aqi: 0 },
      { conc: 1, aqi: 50 },
      { conc: 2, aqi: 100 },
      { conc: 10, aqi: 200 },
      { conc: 17, aqi: 300 },
      { conc: 34, aqi: 400 },
      { conc: 50, aqi: 500 },
    ],
  },
  o3: {
    unit: 'µg/m³',
    averaging: '8h (indicative hourly input)',
    points: [
      { conc: 0, aqi: 0 },
      { conc: 50, aqi: 50 },
      { conc: 100, aqi: 100 },
      { conc: 168, aqi: 200 },
      { conc: 208, aqi: 300 },
      { conc: 748, aqi: 400 },
      { conc: 1000, aqi: 500 },
    ],
  },
};

export interface SubIndex {
  pollutant: string;
  value: number;
  unit: string;
  subIndex: number;
  averaging: string;
}

export interface AqiResult {
  aqi: number | null;
  category: string;
  dominantPollutant: string | null;
  subIndices: SubIndex[];
  method: string;
  caveat: string;
}

export function aqiCategory(aqi: number | null): string {
  if (aqi === null) return 'INSUFFICIENT DATA';
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Satisfactory';
  if (aqi <= 200) return 'Moderate';
  if (aqi <= 300) return 'Poor';
  if (aqi <= 400) return 'Very Poor';
  return 'Severe';
}

export function subIndex(pollutant: string, concentration: number): number | null {
  const bp = BREAKPOINTS[pollutant];
  if (!bp || !Number.isFinite(concentration) || concentration < 0) return null;
  const points = bp.points;
  if (concentration >= points[points.length - 1].conc) return 500;
  for (let i = 1; i < points.length; i += 1) {
    const lo = points[i - 1];
    const hi = points[i];
    if (concentration <= hi.conc) {
      const value = ((hi.aqi - lo.aqi) / (hi.conc - lo.conc)) * (concentration - lo.conc) + lo.aqi;
      return Math.round(value);
    }
  }
  return 500;
}

export function calculateAqi(values: Record<string, number | null | undefined>): AqiResult {
  const subIndices: SubIndex[] = [];
  for (const [pollutant, bp] of Object.entries(BREAKPOINTS)) {
    const raw = values[pollutant];
    if (raw === null || raw === undefined || !Number.isFinite(raw)) continue;
    const si = subIndex(pollutant, raw);
    if (si === null) continue;
    subIndices.push({
      pollutant,
      value: raw,
      unit: bp.unit,
      subIndex: si,
      averaging: bp.averaging,
    });
  }
  if (subIndices.length === 0) {
    return {
      aqi: null,
      category: 'INSUFFICIENT DATA',
      dominantPollutant: null,
      subIndices,
      method: 'CPCB sub-index breakpoints (indicative hourly input)',
      caveat: 'No pollutant values available.',
    };
  }
  const dominant = subIndices.reduce((a, b) => (b.subIndex > a.subIndex ? b : a));
  return {
    aqi: dominant.subIndex,
    category: aqiCategory(dominant.subIndex),
    dominantPollutant: dominant.pollutant,
    subIndices,
    method: 'CPCB sub-index breakpoints applied to available hourly values',
    caveat:
      'Indicative only. CPCB AQI requires specified averaging periods (mostly 24h); these values are not an official CPCB AQI.',
  };
}

export const AQI_BREAKPOINT_TABLE = BREAKPOINTS;
