import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Ring = number[][];
type PolygonCoords = Ring[];
interface BoundaryFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: PolygonCoords | PolygonCoords[] };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const boundaryPath = path.join(here, '../../data/mumbai-boundary.geojson');
const boundary = JSON.parse(fs.readFileSync(boundaryPath, 'utf8')) as {
  type: 'FeatureCollection';
  features: BoundaryFeature[];
  metadata: Record<string, unknown>;
};

export const MUMBAI_BOUNDARY = boundary;
export const MUMBAI_BBOX = { minLat: 18.88, minLng: 72.75, maxLat: 19.28, maxLng: 73.05 };
export const MUMBAI_CENTER = { lat: 19.076, lng: 72.8777 };

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, polygon: PolygonCoords): boolean {
  if (!polygon.length || !pointInRing(lng, lat, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i += 1) {
    if (pointInRing(lng, lat, polygon[i])) return false;
  }
  return true;
}

export function isWithinMumbai(lat: number, lng: number): boolean {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < MUMBAI_BBOX.minLat ||
    lat > MUMBAI_BBOX.maxLat ||
    lng < MUMBAI_BBOX.minLng ||
    lng > MUMBAI_BBOX.maxLng
  ) {
    return false;
  }
  for (const feature of boundary.features) {
    const geom = feature.geometry;
    if (geom.type === 'Polygon') {
      if (pointInPolygon(lng, lat, geom.coordinates as PolygonCoords)) return true;
    } else {
      for (const polygon of geom.coordinates as PolygonCoords[]) {
        if (pointInPolygon(lng, lat, polygon)) return true;
      }
    }
  }
  return false;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371.0088;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export function validateMumbaiCoordinate(lat: number, lng: number): { ok: true } | { ok: false; message: string } {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, message: 'Coordinates must be numbers.' };
  if (!isWithinMumbai(lat, lng)) {
    return {
      ok: false,
      message: 'Location is outside the Greater Mumbai boundary (Mumbai City + Mumbai Suburban districts).',
    };
  }
  return { ok: true };
}
