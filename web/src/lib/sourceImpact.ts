export interface SourceContribution {
  sourceId: string;
  sourceName: string;
  sourceType: string;
  contributionPct: number;
  estimatedContributionPm25: number;
  distanceKm: number;
  alignment: number;
  downwind: boolean;
}

export interface StationSourceAttribution {
  stationId: string;
  stationName: string;
  localityName: string | null;
  impactLevel: 'HIGH' | 'MODERATE' | 'LOW' | 'NONE';
  primarySourceId: string | null;
  primarySourceName: string | null;
  estimatedSharePct: number;
  sources: SourceContribution[];
}

export interface SourceImpactSource {
  id: string;
  name: string;
  type: string;
  localityName: string;
  lat: number;
  lng: number;
  stackHeightM: number;
  emissionIndex: number;
  primaryPollutant: string;
  isSimulated: boolean;
  note: string;
  rank: number;
  impactScore: number;
  affectedMonitors: number;
  estimatedLandKm2: number;
  plumeLengthKm: number;
  plumeBearingDeg: number;
  plume: { type: 'Polygon'; coordinates: number[][][] };
}

export interface SourceImpactWind {
  speedKmh: number;
  directionDeg: number;
  observedAt: string | null;
  source: string;
  fromLabel: string;
}

export interface SourceImpactData {
  method: string;
  status: string;
  wind: SourceImpactWind;
  sources: SourceImpactSource[];
  stationAttributions: Record<string, StationSourceAttribution>;
  landImpact: {
    impactedAreaKm2: number;
    impactedLocalities: string[];
    affectedStations: number;
    note: string;
  };
  note: string;
  disclaimer: string;
}

/** Warm palette reserved for industrial sources; station colours stay AQI-based. */
export const SOURCE_COLORS = ['#c2410c', '#b45309', '#9a3412', '#a16207', '#7c2d12', '#92400e', '#854d0e', '#78350f'];

export const sourceColor = (rank: number) => SOURCE_COLORS[(Math.max(1, rank) - 1) % SOURCE_COLORS.length];

export const IMPACT_TONES: Record<string, { color: string; background: string; border: string; label: string }> = {
  HIGH: { color: '#9a3412', background: '#fdf0e7', border: '#f0c9ae', label: 'High influence' },
  MODERATE: { color: '#a16207', background: '#fdf7e3', border: '#ecdcae', label: 'Moderate influence' },
  LOW: { color: '#4d7d40', background: '#eff8e9', border: '#cfe6c2', label: 'Low influence' },
  NONE: { color: '#66766b', background: '#f5f8f2', border: '#dfe6db', label: 'No screened influence' },
};

export const impactTone = (level?: string | null) => IMPACT_TONES[String(level ?? 'NONE').toUpperCase()] ?? IMPACT_TONES.NONE;
