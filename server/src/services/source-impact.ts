import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../db/pool.js';

/**
 * Screening-level industrial source impact.
 *
 * This is deliberately not a regulatory dispersion model and not a measured
 * source apportionment. It applies a Gaussian-style distance and wind-alignment
 * weight to a simulated source catalogue so the map can show which monitors and
 * land areas could be downwind of an industrial source.
 */

export interface IndustrialSource {
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
}

export interface ImpactStation {
  id: string;
  name: string;
  localityName: string | null;
  lat: number;
  lng: number;
  pm25: number | null;
}

export interface ScreenWind {
  speedKmh: number;
  directionDeg: number;
  observedAt: string | null;
  source: string;
}

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

export interface StationAttribution {
  stationId: string;
  stationName: string;
  localityName: string | null;
  impactLevel: 'HIGH' | 'MODERATE' | 'LOW' | 'NONE';
  primarySourceId: string | null;
  primarySourceName: string | null;
  estimatedSharePct: number;
  sources: SourceContribution[];
}

export interface SourceImpactRanking extends IndustrialSource {
  rank: number;
  impactScore: number;
  affectedMonitors: number;
  estimatedLandKm2: number;
  plumeLengthKm: number;
  plumeBearingDeg: number;
  plume: { type: 'Polygon'; coordinates: number[][][] };
}

export interface SourceImpactResult {
  method: 'GAUSSIAN_DISTANCE_WIND_SCREEN_V1';
  status: 'SCREENING_ESTIMATE';
  wind: ScreenWind & { fromLabel: string };
  sources: SourceImpactRanking[];
  stationAttributions: Record<string, StationAttribution>;
  landImpact: {
    impactedAreaKm2: number;
    impactedLocalities: string[];
    affectedStations: number;
    note: string;
  };
  note: string;
  disclaimer: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

function loadCatalogue(): IndustrialSource[] {
  try {
    const raw = fs.readFileSync(path.join(here, '../../data/industrial-sources.json'), 'utf8');
    return JSON.parse(raw) as IndustrialSource[];
  } catch {
    return [];
  }
}

export const INDUSTRIAL_SOURCES = loadCatalogue();

const EARTH_RADIUS_M = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingDegrees(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = toRadians(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRadians(lat2));
  const x =
    Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
    Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(dLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function destinationPoint(lat: number, lng: number, bearing: number, distanceM: number) {
  const angular = distanceM / EARTH_RADIUS_M;
  const theta = toRadians(bearing);
  const phi1 = toRadians(lat);
  const lambda1 = toRadians(lng);
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(angular) + Math.cos(phi1) * Math.sin(angular) * Math.cos(theta));
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(angular) * Math.cos(phi1),
      Math.cos(angular) - Math.sin(phi1) * Math.sin(phi2),
    );
  return { lat: toDegrees(phi2), lng: ((toDegrees(lambda2) + 540) % 360) - 180 };
}

function angleDifference(a: number, b: number): number {
  const diff = Math.abs(((a - b + 540) % 360) - 180);
  return diff;
}

export function buildPlumePolygon(source: IndustrialSource, wind: ScreenWind) {
  const lengthM = clamp(1_100 + source.emissionIndex * 38 + wind.speedKmh * 70, 1_600, 6_200);
  const halfWidthM = lengthM * 0.22;
  const downwind = (wind.directionDeg + 180) % 360;
  const steps = 12;
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const center = destinationPoint(source.lat, source.lng, downwind, t * lengthM);
    const width = 120 + t * halfWidthM;
    const leftPoint = destinationPoint(center.lat, center.lng, (downwind - 90 + 360) % 360, width);
    const rightPoint = destinationPoint(center.lat, center.lng, (downwind + 90) % 360, width);
    left.push([leftPoint.lng, leftPoint.lat]);
    right.push([rightPoint.lng, rightPoint.lat]);
  }

  const ring = [...left, ...right.reverse()];
  ring.push(ring[0]);
  return {
    type: 'Polygon' as const,
    coordinates: [ring],
    lengthM,
    halfWidthM,
    areaKm2: (lengthM * (120 + halfWidthM)) / 1_000_000,
  };
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compassLabel(degrees: number): string {
  return COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16] ?? 'N';
}

export async function getWindAt(at: Date): Promise<ScreenWind> {
  const rows = await query<{ observed_at: string; speed: number; direction: number }>(
    `SELECT observed_at, wind_speed_kmh::float8 AS speed, wind_direction_deg::float8 AS direction
     FROM weather_observations
     WHERE kind='OBSERVATION' AND wind_direction_deg IS NOT NULL AND wind_speed_kmh IS NOT NULL
       AND observed_at <= $1
     ORDER BY observed_at DESC LIMIT 1`,
    [at.toISOString()],
  );
  if (rows[0]) {
    return {
      speedKmh: Number(rows[0].speed),
      directionDeg: Number(rows[0].direction),
      observedAt: rows[0].observed_at,
      source: 'OPEN_METEO_WEATHER',
    };
  }
  const fallback = await query<{ observed_at: string; speed: number; direction: number }>(
    `SELECT observed_at, wind_speed_kmh::float8 AS speed, wind_direction_deg::float8 AS direction
     FROM weather_observations
     WHERE kind='OBSERVATION' AND wind_direction_deg IS NOT NULL AND wind_speed_kmh IS NOT NULL
     ORDER BY observed_at DESC LIMIT 1`,
  );
  if (fallback[0]) {
    return {
      speedKmh: Number(fallback[0].speed),
      directionDeg: Number(fallback[0].direction),
      observedAt: fallback[0].observed_at,
      source: 'OPEN_METEO_WEATHER_LATEST',
    };
  }
  return { speedKmh: 12, directionDeg: 240, observedAt: null, source: 'FALLBACK_SCREEN_WIND' };
}

export function computeSourceImpact(
  stations: ImpactStation[],
  wind: ScreenWind,
  sources: IndustrialSource[] = INDUSTRIAL_SOURCES,
): SourceImpactResult {
  const stationAttributions: Record<string, StationAttribution> = {};
  const sourceTotals = new Map<string, { score: number; affected: number }>();
  for (const source of sources) sourceTotals.set(source.id, { score: 0, affected: 0 });

  for (const station of stations) {
    if (!Number.isFinite(station.lat) || !Number.isFinite(station.lng)) continue;
    const raw = sources.map((source) => {
      const distanceM = haversineMeters(source.lat, source.lng, station.lat, station.lng);
      const reachM = 1_700 + source.emissionIndex * 32 + source.stackHeightM * 6;
      const decay = Math.exp(-((distanceM / reachM) ** 2));
      const stationBearing = bearingDegrees(source.lat, source.lng, station.lat, station.lng);
      const downwindBearing = (wind.directionDeg + 180) % 360;
      const alignment = Math.max(0, Math.cos(toRadians(angleDifference(stationBearing, downwindBearing))));
      const stability = clamp(1.65 - wind.speedKmh / 36, 0.55, 1.65);
      const directional = alignment < 0.1 ? 0 : 0.04 + 0.96 * alignment;
      return {
        source,
        distanceM,
        alignment,
        rawWeight: (source.emissionIndex / 100) * decay * directional * stability,
      };
    });

    // A very small absolute weight means the source is too far or too
    // crosswind to support an attribution. Without this floor, normalising a
    // handful of near-zero weights would still name a "primary source".
    const relevant = raw.filter((row) => row.rawWeight >= 0.02);
    const totalWeight = relevant.reduce((sum, row) => sum + row.rawWeight, 0);
    const visible = relevant.filter((row) => totalWeight > 0 && row.rawWeight / totalWeight >= 0.04);
    const visibleWeight = visible.reduce((sum, row) => sum + row.rawWeight, 0);
    const sourcesForStation: SourceContribution[] = visible
      .map((row) => {
        // Never claim the whole monitor footprint for the industrial screen;
        // traffic, dust, sea salt and other sources are not in this catalogue.
        const attributionCeilingPct = 90;
        const contributionPct = visibleWeight > 0 ? (row.rawWeight / visibleWeight) * attributionCeilingPct : 0;
        return {
          sourceId: row.source.id,
          sourceName: row.source.name,
          sourceType: row.source.type,
          contributionPct: round(contributionPct),
          estimatedContributionPm25:
            station.pm25 !== null ? round((station.pm25 * contributionPct) / 100) : round(row.rawWeight * 22),
          distanceKm: round(row.distanceM / 1_000, 2),
          alignment: round(row.alignment, 2),
          downwind: row.alignment >= 0.4,
        };
      })
      .sort((a, b) => b.contributionPct - a.contributionPct)
      .slice(0, 4);

    const primary = sourcesForStation[0];
    const estimatedSharePct = primary?.contributionPct ?? 0;
    const impactLevel: StationAttribution['impactLevel'] =
      !primary || estimatedSharePct < 8
        ? 'NONE'
        : estimatedSharePct >= 30 && primary.estimatedContributionPm25 >= 6
          ? 'HIGH'
          : estimatedSharePct >= 18
            ? 'MODERATE'
            : 'LOW';

    stationAttributions[station.id] = {
      stationId: station.id,
      stationName: station.name,
      localityName: station.localityName,
      impactLevel,
      primarySourceId: primary?.sourceId ?? null,
      primarySourceName: primary?.sourceName ?? null,
      estimatedSharePct,
      sources: sourcesForStation,
    };

    if (impactLevel !== 'NONE') {
      for (const contribution of sourcesForStation) {
        if (contribution.contributionPct < 8) continue;
        const total = sourceTotals.get(contribution.sourceId);
        if (!total) continue;
        total.score += contribution.estimatedContributionPm25;
        total.affected += 1;
      }
    }
  }

  const ranked = sources
    .map((source) => {
      const total = sourceTotals.get(source.id) ?? { score: 0, affected: 0 };
      const plume = buildPlumePolygon(source, wind);
      return {
        ...source,
        rank: 0,
        // A source still matters when the wind carries its plume over land but
        // no monitor sits directly inside it. The score therefore keeps a small
        // emission and land component alongside the monitor contribution.
        impactScore: round(total.score + source.emissionIndex * 0.5 + plume.areaKm2 * 0.75),
        affectedMonitors: total.affected,
        estimatedLandKm2: round(plume.areaKm2),
        plumeLengthKm: round(plume.lengthM / 1_000, 1),
        plumeBearingDeg: round((wind.directionDeg + 180) % 360, 0),
        plume: { type: 'Polygon' as const, coordinates: plume.coordinates },
      };
    })
    .sort((a, b) => b.impactScore - a.impactScore || b.emissionIndex - a.emissionIndex)
    .map((source, index) => ({ ...source, rank: index + 1 }));

  const impacted = Object.values(stationAttributions).filter((row) => row.impactLevel !== 'NONE');
  const impactedLocalities = [...new Set(impacted.map((row) => row.localityName).filter((value): value is string => Boolean(value)))];
  const impactedAreaKm2 = ranked.reduce((sum, source) => sum + source.estimatedLandKm2, 0);

  return {
    method: 'GAUSSIAN_DISTANCE_WIND_SCREEN_V1',
    status: 'SCREENING_ESTIMATE',
    wind: { ...wind, fromLabel: compassLabel(wind.directionDeg) },
    sources: ranked,
    stationAttributions,
    landImpact: {
      impactedAreaKm2: round(impactedAreaKm2),
      impactedLocalities,
      affectedStations: impacted.length,
      note: 'Plume footprints are screening geometry derived from simulated sources and the latest wind. They are not a measured pollution surface or a regulatory impact zone.',
    },
    note:
      'Source shares are a distance-and-wind screening estimate applied to simulated industrial sources. Future frames use the available PM2.5 forecast where present. They show which monitors could be in a source plume, not a measured apportionment.',
    disclaimer:
      'SIMULATED SOURCES · SCREENING ONLY. No real facility is identified, no legal threshold is applied, and this is not a regulatory determination.',
  };
}

export async function computeSourceImpactAt(stations: ImpactStation[], at: Date): Promise<SourceImpactResult> {
  const wind = await getWindAt(at);
  return computeSourceImpact(stations, wind);
}
