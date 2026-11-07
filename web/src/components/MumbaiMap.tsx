import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Map as MapLibreMap, Popup, RasterTileSource } from 'maplibre-gl';
import { CloudRain, Pause, Play } from 'lucide-react';

setWorkerUrl(workerUrl);
import type { FeatureCollection } from 'geojson';
import { classNames } from '../lib/format';
import { api } from '../lib/api';
import { impactTone, sourceColor, type SourceImpactSource } from '../lib/sourceImpact';
import { ErrorBoundary } from './ErrorBoundary';

export interface MapStation {
  id: string;
  name: string;
  code?: string;
  localityName?: string | null;
  locality?: string | null;
  lat: number;
  lng: number;
  color?: string;
  valueLabel?: string;
  markerKind?: 'OBSERVED' | 'PREDICTED';
  isSimulated?: boolean;
  isStale?: boolean;
  aqi?: number | null;
  aqiCategory?: string;
  forecast?: { predictedValue: number; lowerBound: number; upperBound: number; method: string } | null;
  latestObservedAt?: string | null;
  healthStatus?: string;
  impactSharePct?: number;
  impactLevel?: string;
  primarySourceName?: string | null;
}

export interface MapModelled {
  localityId: string;
  localityName: string;
  lat: number;
  lng: number;
  pm25: number | null;
  pm10: number | null;
  observedAt: string;
  sourceId: string;
}

export interface MapSourceLink {
  id: string;
  sourceId: string;
  stationId: string;
  from: [number, number];
  to: [number, number];
  sharePct: number;
  color: string;
  sourceName: string;
  stationName: string;
}

export interface MapReport {
  id: string;
  public_ref?: string;
  category: string;
  lat: number;
  lng: number;
  status?: string;
  verification_state?: string;
  is_simulated?: boolean;
}

export interface MapIncident {
  id: string;
  public_ref?: string;
  title?: string;
  category: string;
  lat: number;
  lng: number;
  status?: string;
  risk_level?: string;
}

interface RadarPayload {
  host: string;
  maxZoom: number;
  frames: Array<{ time: number; path: string; kind: 'past' }>;
  attribution: string;
  note: string;
}

function radarTileUrl(host: string, path: string): string {
  return `${host}${path}/256/{z}/{x}/{y}/2/1_1.png`;
}

interface Props {
  stations?: MapStation[];
  modelled?: MapModelled[];
  reports?: MapReport[];
  incidents?: MapIncident[];
  sources?: SourceImpactSource[];
  sourceLinks?: MapSourceLink[];
  onStationSelect?: (id: string) => void;
  onReportSelect?: (id: string) => void;
  onIncidentSelect?: (id: string) => void;
  onSourceSelect?: (id: string) => void;
  onMapClick?: (lngLat: { lng: number; lat: number }) => void;
  selectedStationId?: string | null;
  selectedSourceId?: string | null;
  focusPoint?: { lat: number; lng: number } | null;
  showSources?: boolean;
  showPlumes?: boolean;
  showImpactLinks?: boolean;
  showModelled?: boolean;
  showRadar?: boolean;
  className?: string;
  compact?: boolean;
  theme?: 'dark' | 'light';
  showBuildings?: boolean;
  styleUrl?: string;
  initialZoom?: number;
  initialPitch?: number;
  overlayLabel?: string;
  interactive?: boolean;
  autoFit?: boolean;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CATEGORY_COLORS: Record<string, string> = {
  air: '#e88a43',
  water: '#56c1b3',
  waste: '#d2b04c',
  industrial: '#dc555b',
};

const BOUNDARY_URL = '/geo/mumbai-boundary.geojson';
let boundaryPromise: Promise<FeatureCollection> | null = null;

// shortcut: OpenFreeMap's three US shield layers compare a nullable
// `ref_length`. Guard them here until the upstream style is fixed.
const SHIELD_LAYER_IDS = new Set(['highway-shield-non-us', 'highway-shield-us-interstate', 'road_shield_us']);

function ringArea(ring: number[][]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return area / 2;
}

function boundaryMask(boundary: FeatureCollection): FeatureCollection {
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  const holes: number[][][] = [];
  for (const feature of boundary.features) {
    const geometry = feature.geometry as unknown as { type: string; coordinates: unknown };
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons as number[][][][]) {
      const outer = polygon[0];
      holes.push(ringArea(outer) > 0 ? [...outer].reverse() : outer);
    }
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [world, ...holes] },
      },
    ],
  };
}

function loadBoundary() {
  if (!boundaryPromise) {
    boundaryPromise = fetch(BOUNDARY_URL).then((res) => {
      if (!res.ok) throw new Error('Boundary unavailable');
      return res.json();
    });
  }
  return boundaryPromise;
}

function stationFeatures(stations: MapStation[], selectedStationId?: string | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: stations
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: {
          id: s.id,
          label: s.name.replace(' demo air monitor', '').replace(' demo sampling point', ''),
          name: s.name,
          locality: s.localityName ?? s.locality ?? '',
          color: s.color ?? '#b5e36b',
          valueLabel: s.valueLabel ?? '',
          markerKind: s.markerKind ?? 'OBSERVED',
          isSimulated: Boolean(s.isSimulated),
          isStale: Boolean(s.isStale),
          aqi: s.aqi ?? null,
          aqiCategory: s.aqiCategory ?? '',
          health: s.healthStatus ?? '',
          selected: s.id === selectedStationId,
          forecastLower: s.forecast?.lowerBound ?? null,
          forecastUpper: s.forecast?.upperBound ?? null,
          forecastMethod: s.forecast?.method ?? '',
          observedAt: s.latestObservedAt ?? '',
          impactSharePct: s.impactSharePct ?? 0,
          impactLevel: s.impactLevel ?? 'NONE',
          impactColor: impactTone(s.impactLevel).color,
          primarySource: s.primarySourceName ?? '',
        },
      })),
  };
}

function modelledFeatures(modelled: MapModelled[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: modelled
      .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng) && (item.pm25 !== null || item.pm10 !== null))
      .map((item) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [item.lng, item.lat] },
        properties: {
          id: item.localityId,
          label: item.localityName,
          pm25: item.pm25,
          pm10: item.pm10,
          pollutant: item.pm25 !== null ? 'PM2.5' : 'PM10',
          valueLabel: `${item.pm25 ?? item.pm10} µg/m³`,
          observedAt: item.observedAt,
          sourceId: item.sourceId,
        },
      })),
  };
}

function reportFeatures(reports: MapReport[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: reports
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
      .map((r) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: {
          id: r.id,
          ref: r.public_ref ?? '',
          category: r.category,
          color: CATEGORY_COLORS[r.category] ?? '#d2b04c',
          status: r.status ?? '',
          verification: r.verification_state ?? '',
          isSimulated: Boolean(r.is_simulated),
        },
      })),
  };
}

function incidentFeatures(incidents: MapIncident[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: incidents
      .filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lng))
      .map((i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [i.lng, i.lat] },
        properties: {
          id: i.id,
          ref: i.public_ref ?? '',
          title: i.title ?? '',
          category: i.category,
          status: i.status ?? '',
          risk: i.risk_level ?? '',
        },
      })),
  };
}

function sourceFeatures(sources: SourceImpactSource[], selectedSourceId?: string | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: sources
      .filter((source) => Number.isFinite(source.lat) && Number.isFinite(source.lng))
      .map((source) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [source.lng, source.lat] },
        properties: {
          id: source.id,
          label: source.name,
          type: source.type,
          locality: source.localityName,
          rank: source.rank,
          color: sourceColor(source.rank),
          capacityMW: source.capacityMW ?? null,
          affectedMonitors: source.affectedMonitors,
          impactScore: source.impactScore,
          landKm2: source.estimatedLandKm2,
          plumeLengthKm: source.plumeLengthKm,
          primaryPollutant: source.primaryPollutant ?? '',
          osmId: source.osmId ?? null,
          source: source.source ?? 'OpenStreetMap',
          selected: source.id === selectedSourceId,
          note: source.note,
        },
      })),
  };
}

function plumeFeatures(sources: SourceImpactSource[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: sources
      .filter((source) => source.plume?.coordinates?.length)
      .map((source) => ({
        type: 'Feature',
        geometry: source.plume,
        properties: {
          id: source.id,
          label: source.name,
          color: sourceColor(source.rank),
          rank: source.rank,
          affectedMonitors: source.affectedMonitors,
        },
      })),
  };
}

function focusFeatures(point?: { lat: number; lng: number } | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features:
      point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [point.lng, point.lat] } }]
        : [],
  };
}

function sourceLinkFeatures(links: MapSourceLink[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: links.map((link) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [link.from, link.to] },
      properties: {
        id: link.id,
        sourceId: link.sourceId,
        stationId: link.stationId,
        sharePct: link.sharePct,
        color: link.color,
        sourceName: link.sourceName,
        stationName: link.stationName,
      },
    })),
  };
}

/**
 * A small comet travelling from the factory to the monitor. The trailing dots
 * make the direction of the effect readable even when the line itself is thin.
 */
function flowFeatures(links: MapSourceLink[], progress: number): FeatureCollection {
  const features: FeatureCollection['features'] = [];
  links.forEach((link, index) => {
    const phase = (progress + index * 0.19) % 1;
    for (let trail = 0; trail < 3; trail += 1) {
      const t = (phase - trail * 0.06 + 1) % 1;
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [link.from[0] + (link.to[0] - link.from[0]) * t, link.from[1] + (link.to[1] - link.from[1]) * t],
        },
        properties: {
          color: link.color,
          radius: trail === 0 ? 4.4 : 3.4 - trail * 0.75,
          opacity: trail === 0 ? 0.95 : 0.5 - trail * 0.12,
        },
      });
    }
  });
  return { type: 'FeatureCollection', features };
}

function MumbaiMapInner({
  stations = [],
  modelled = [],
  reports = [],
  incidents = [],
  sources = [],
  sourceLinks = [],
  onStationSelect,
  onReportSelect,
  onIncidentSelect,
  onSourceSelect,
  onMapClick,
  selectedStationId,
  selectedSourceId,
  focusPoint,
  showSources = true,
  showPlumes = true,
  showImpactLinks = true,
  showModelled = true,
  showRadar = false,
  className,
  compact = false,
  theme = 'light',
  showBuildings = true,
  styleUrl,
  initialZoom,
  initialPitch,
  overlayLabel = 'Demo stations',
  interactive,
  autoFit = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  const popupRef = useRef<Popup | null>(null);
  const boundaryBoundsRef = useRef<[[number, number], [number, number]] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [radar, setRadar] = useState<RadarPayload | null>(null);
  const [radarError, setRadarError] = useState<string | null>(null);
  const [radarIndex, setRadarIndex] = useState(0);
  const [radarPlaying, setRadarPlaying] = useState(true);
  const [viewMode, setViewMode] = useState<'3d' | 'flat'>(compact ? 'flat' : '3d');
  const handlersRef = useRef({ onStationSelect, onReportSelect, onIncidentSelect, onSourceSelect, onMapClick });
  handlersRef.current = { onStationSelect, onReportSelect, onIncidentSelect, onSourceSelect, onMapClick };
  const dataRef = useRef({ stations, modelled, reports, incidents, sources, sourceLinks, selectedStationId, selectedSourceId, focusPoint, showImpactLinks, showModelled });
  dataRef.current = { stations, modelled, reports, incidents, sources, sourceLinks, selectedStationId, selectedSourceId, focusPoint, showImpactLinks, showModelled };

  useEffect(() => {
    if (!containerRef.current) return;
    const style = styleUrl ?? (theme === 'dark' ? 'https://tiles.openfreemap.org/styles/dark' : 'https://tiles.openfreemap.org/styles/liberty');
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      transformStyle: (_previousStyle, nextStyle) => ({
        ...nextStyle,
        layers: nextStyle.layers.map((layer) =>
          SHIELD_LAYER_IDS.has(layer.id)
            ? ({
                ...layer,
                filter: [
                  'all',
                  ['has', 'ref_length'],
                  ...((layer as { filter?: unknown }).filter ? [(layer as { filter?: unknown }).filter] : []),
                ],
              } as never)
            : layer,
        ),
      }),
      center: [72.8777, 19.076],
      zoom: initialZoom ?? (compact ? 11.1 : 12.2),
      pitch: initialPitch ?? (compact ? 32 : 55),
      bearing: compact ? 0 : -18,
      interactive: interactive ?? !compact,
      attributionControl: compact ? false : { compact: true },
      maxBounds: [
        [72.55, 18.75],
        [73.18, 19.38],
      ],
    });
    mapRef.current = map;
    // OpenFreeMap's dark style references a `wood-pattern` sprite it does not
    // ship. Resolve that one to a transparent pixel so rendering stays quiet.
    map.setMissingStyleImageResolver((id) => {
      if (id === 'wood-pattern') {
        map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
      }
    });
    if (!compact) {
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
      map.addControl(new maplibregl.FullscreenControl(), 'top-right');
      map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    }
    map.on('error', (event: any) => {
      const message = String((event as { error?: { message?: string } }).error?.message ?? '');
      if (message.toLowerCase().includes('style') || message.toLowerCase().includes('sprite')) {
        setError('Map tiles could not be loaded. Check network access to OpenFreeMap.');
      }
    });

    let flowFrame: number | null = null;

    map.on('load', async () => {
      loadedRef.current = true;
      try {
        const boundary = await loadBoundary();
        map.addSource('mumbai-boundary', { type: 'geojson', data: boundary });
        map.addSource('mumbai-outside-mask', { type: 'geojson', data: boundaryMask(boundary) });
        map.addLayer({
          id: 'mumbai-outside-mask',
          type: 'fill',
          source: 'mumbai-outside-mask',
          paint: { 'fill-color': theme === 'dark' ? '#0b0e11' : '#f3f5f1', 'fill-opacity': 1 },
        });
        map.addLayer({
          id: 'mumbai-boundary-fill',
          type: 'fill',
          source: 'mumbai-boundary',
          paint: { 'fill-color': theme === 'dark' ? '#b5e36b' : '#dfe8db', 'fill-opacity': theme === 'dark' ? 0.035 : 0.25 },
        });
        map.addLayer({
          id: 'mumbai-boundary-line',
          type: 'line',
          source: 'mumbai-boundary',
          paint: { 'line-color': theme === 'dark' ? '#b5e36b' : '#7d8b7b', 'line-width': 1.2, 'line-opacity': 0.55 },
        });
        const bbox = boundary.features.flatMap((feature) => {
          const coords: number[][] = [];
          const walk = (value: unknown) => {
            if (Array.isArray(value) && typeof value[0] === 'number') coords.push(value as number[]);
            else if (Array.isArray(value)) value.forEach(walk);
          };
          walk((feature.geometry as unknown as { coordinates?: unknown }).coordinates);
          return coords;
        });
        if (bbox.length) {
          const lngs = bbox.map((c: number[]) => c[0]);
          const lats = bbox.map((c: number[]) => c[1]);
          boundaryBoundsRef.current = [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ];
          if (autoFit) {
            map.fitBounds(boundaryBoundsRef.current, {
              padding: compact ? 12 : { top: 50, bottom: 50, left: 50, right: 50 },
              duration: 0,
              maxZoom: compact ? 11.4 : 11.8,
            });
          }
        }
      } catch {
        setError('Mumbai boundary could not be loaded.');
      }

      if (showBuildings && map.getSource('openmaptiles')) {
        try {
          const beforeId = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
          map.addLayer(
            {
              id: 'ep-buildings-3d',
              type: 'fill-extrusion',
              source: 'openmaptiles',
              'source-layer': 'building',
              minzoom: 12.2,
              paint: {
                'fill-extrusion-color': theme === 'dark' ? '#29313a' : '#e2e6df',
                'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
                'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
                'fill-extrusion-opacity': theme === 'dark' ? 0.72 : 0.45,
              },
            },
            beforeId,
          );
        } catch {
          // 3D extrusion is optional; map remains usable.
        }
      }

      map.addSource('ep-source-plumes', { type: 'geojson', data: plumeFeatures(dataRef.current.sources) });
      map.addLayer({
        id: 'ep-source-plumes-fill',
        type: 'fill',
        source: 'ep-source-plumes',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.11,
        },
      });
      map.addLayer({
        id: 'ep-source-plumes-line',
        type: 'line',
        source: 'ep-source-plumes',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 1.3,
          'line-opacity': 0.55,
          'line-dasharray': [2, 2],
        },
      });

      map.addSource('ep-source-links', { type: 'geojson', data: sourceLinkFeatures(dataRef.current.sourceLinks) });
      map.addLayer({
        id: 'ep-source-links',
        type: 'line',
        source: 'ep-source-links',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['get', 'sharePct'], 8, 0.7, 45, 2.4],
          'line-opacity': 0.5,
          'line-dasharray': [2, 2],
        },
      });

      map.addSource('ep-source-flow', {
        type: 'geojson',
        data: flowFeatures(dataRef.current.sourceLinks, 0.25),
      });
      map.addLayer({
        id: 'ep-source-flow',
        type: 'circle',
        source: 'ep-source-flow',
        paint: {
          'circle-radius': ['get', 'radius'],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['get', 'opacity'],
          'circle-blur': 0.35,
        },
      });

      map.addSource('ep-sources', { type: 'geojson', data: sourceFeatures(dataRef.current.sources, dataRef.current.selectedSourceId) });
      map.addLayer({
        id: 'ep-source-halo',
        type: 'circle',
        source: 'ep-sources',
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 28, 21],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['case', ['get', 'selected'], 0.28, 0.12],
          'circle-blur': 1,
        },
      });
      map.addLayer({
        id: 'ep-sources',
        type: 'circle',
        source: 'ep-sources',
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 10, 7.5],
          'circle-color': ['get', 'color'],
          'circle-stroke-width': ['case', ['get', 'selected'], 3, 2],
          'circle-stroke-color': theme === 'dark' ? '#101317' : '#ffffff',
          'circle-opacity': 0.98,
        },
      });
      map.addLayer({
        id: 'ep-source-labels',
        type: 'symbol',
        source: 'ep-sources',
        minzoom: 11.6,
        layout: {
          'text-field': ['concat', '#', ['to-string', ['get', 'rank']], ' ', ['get', 'label']],
          'text-size': 9.5,
          'text-font': ['Noto Sans Regular'],
          'text-offset': [0, 1.6],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': theme === 'dark' ? '#f5d7c2' : '#7c2d12',
          'text-halo-color': theme === 'dark' ? '#101317' : '#fff7f0',
          'text-halo-width': 2.2,
        },
      });

      map.addSource('ep-stations', { type: 'geojson', data: stationFeatures(dataRef.current.stations, dataRef.current.selectedStationId) });
      map.addLayer({
        id: 'ep-station-halo',
        type: 'circle',
        source: 'ep-stations',
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 22, 16],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['case', ['get', 'selected'], 0.25, 0.12],
        },
      });
      map.addLayer({
        id: 'ep-stations-observed',
        type: 'circle',
        source: 'ep-stations',
        filter: ['!=', ['get', 'markerKind'], 'PREDICTED'],
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 9, 6.5],
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': theme === 'dark' ? '#101317' : '#ffffff',
          'circle-opacity': ['case', ['get', 'isStale'], 0.5, 0.95],
        },
      });
      map.addLayer({
        id: 'ep-station-stale-ring',
        type: 'circle',
        source: 'ep-stations',
        filter: ['==', ['get', 'isStale'], true],
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 14, 11],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 1.4,
          'circle-stroke-color': '#b3860f',
          'circle-stroke-opacity': 0.8,
        },
      });
      map.addLayer({
        id: 'ep-stations-predicted',
        type: 'circle',
        source: 'ep-stations',
        filter: ['==', ['get', 'markerKind'], 'PREDICTED'],
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 10, 7.5],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 2,
          'circle-stroke-color': ['get', 'color'],
          'circle-opacity': 1,
        },
      });
      map.addLayer({
        id: 'ep-station-labels',
        type: 'symbol',
        source: 'ep-stations',
        minzoom: compact ? 12 : 11.4,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 10,
          'text-font': ['Noto Sans Regular'],
          'text-offset': [0, 1.7],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': theme === 'dark' ? '#e6edf3' : '#111310',
          'text-halo-color': theme === 'dark' ? '#101317' : '#f7faf4',
          'text-halo-width': 2,
        },
      });
      map.addLayer({
        id: 'ep-station-impact-ring',
        type: 'circle',
        source: 'ep-stations',
        filter: ['>', ['get', 'impactSharePct'], 0],
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 16, 13],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 1.4,
          'circle-stroke-color': ['get', 'impactColor'],
          'circle-stroke-opacity': 0.78,
        },
      });
      map.addSource('ep-modelled', { type: 'geojson', data: modelledFeatures(dataRef.current.modelled) });
      map.addLayer({
        id: 'ep-modelled-halo',
        type: 'circle',
        source: 'ep-modelled',
        paint: {
          'circle-radius': 14,
          'circle-color': '#2f8f84',
          'circle-opacity': 0.1,
          'circle-blur': 1,
        },
      });
      map.addLayer({
        id: 'ep-modelled',
        type: 'circle',
        source: 'ep-modelled',
        paint: {
          'circle-radius': 4,
          'circle-color': '#2f8f84',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': theme === 'dark' ? '#101317' : '#ffffff',
          'circle-opacity': 0.95,
        },
      });
      map.addLayer({
        id: 'ep-modelled-labels',
        type: 'symbol',
        source: 'ep-modelled',
        minzoom: 12.8,
        layout: {
          'text-field': ['get', 'valueLabel'],
          'text-size': 8.5,
          'text-font': ['Noto Sans Regular'],
          'text-offset': [0, 1.4],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': theme === 'dark' ? '#9fe0d6' : '#1f766d',
          'text-halo-color': theme === 'dark' ? '#101317' : '#ffffff',
          'text-halo-width': 2,
        },
      });
      for (const layer of ['ep-modelled-halo', 'ep-modelled', 'ep-modelled-labels']) {
        if (map.getLayer(layer) && map.getLayer('ep-station-halo')) map.moveLayer(layer, 'ep-station-halo');
      }
      map.addSource('ep-reports', { type: 'geojson', data: reportFeatures(dataRef.current.reports) });
      map.addLayer({
        id: 'ep-reports',
        type: 'circle',
        source: 'ep-reports',
        paint: {
          'circle-radius': 5,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': theme === 'dark' ? '#101317' : '#ffffff',
          'circle-opacity': 0.9,
        },
      });
      map.addSource('ep-incidents', { type: 'geojson', data: incidentFeatures(dataRef.current.incidents) });
      map.addLayer({
        id: 'ep-incidents',
        type: 'circle',
        source: 'ep-incidents',
        paint: {
          'circle-radius': 9,
          'circle-color': 'rgba(220,85,91,0.12)',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#dc555b',
        },
      });

      map.addSource('ep-focus', { type: 'geojson', data: focusFeatures(dataRef.current.focusPoint) });
      map.addLayer({
        id: 'ep-focus-halo',
        type: 'circle',
        source: 'ep-focus',
        paint: {
          'circle-radius': 30,
          'circle-color': '#2f8f84',
          'circle-opacity': 0.14,
        },
      });
      map.addLayer({
        id: 'ep-focus-ring',
        type: 'circle',
        source: 'ep-focus',
        paint: {
          'circle-radius': 15,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#2f8f84',
          'circle-stroke-opacity': 0.8,
        },
      });
      map.addLayer({
        id: 'ep-focus-dot',
        type: 'circle',
        source: 'ep-focus',
        paint: {
          'circle-radius': 5,
          'circle-color': '#2f8f84',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });

      const clickStation = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature) return;
        event.preventDefault();
        const id = String(feature.properties?.id ?? '');
        if (id) handlersRef.current.onStationSelect?.(id);
      };
      map.on('click', 'ep-stations-observed', clickStation);
      map.on('click', 'ep-stations-predicted', clickStation);
      map.on('click', 'ep-sources', (event: any) => {
        const feature = event.features?.[0];
        if (!feature) return;
        event.preventDefault();
        const id = String(feature.properties?.id ?? '');
        if (id) handlersRef.current.onSourceSelect?.(id);
      });
      map.on('click', 'ep-reports', (event: any) => {
        const feature = event.features?.[0];
        const id = String(feature?.properties?.id ?? '');
        if (id) {
          event.preventDefault();
          handlersRef.current.onReportSelect?.(id);
        }
      });
      map.on('click', 'ep-incidents', (event: any) => {
        const feature = event.features?.[0];
        const id = String(feature?.properties?.id ?? '');
        if (id) {
          event.preventDefault();
          handlersRef.current.onIncidentSelect?.(id);
        }
      });
      for (const layer of ['ep-stations-observed', 'ep-stations-predicted', 'ep-reports', 'ep-incidents', 'ep-sources'] as string[]) {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = '';
        });
      }
      const stationPopup = (event: any) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const p = feature.properties ?? {};
        const impact = Number(p.impactSharePct) > 0
          ? `<div style="margin-top:6px;border-top:1px solid #f0e2d5;padding-top:5px;font-size:10px;color:#9a3412">Industry screen: <strong>${escapeHtml(p.impactSharePct)}%</strong> from ${escapeHtml(p.primarySource)}</div>`
          : '';
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'ep-map-popup' })
          .setLngLat(event.lngLat)
          .setHTML(
            `<div style="min-width:170px"><div style="font-weight:700;margin-bottom:4px">${escapeHtml(p.name)}</div>
             <div style="color:#5f7065;font-size:11px">${escapeHtml(p.locality)}</div>
             <div style="margin-top:6px;font-size:12px"><strong>${escapeHtml(p.valueLabel)}</strong></div>
             ${impact}
             <div style="margin-top:4px;font-size:10px;color:${p.isStale ? '#b3860f' : '#66766b'}">${p.isStale ? 'STALE · last observed ' : ''}${p.observedAt ? escapeHtml(new Date(String(p.observedAt)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })) : escapeHtml(p.health)}</div></div>`,
          )
          .addTo(map);
      };
      map.on('mousemove', 'ep-stations-observed', stationPopup);
      map.on('mousemove', 'ep-stations-predicted', stationPopup);
      map.on('mousemove', 'ep-modelled', (event: any) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const p = feature.properties ?? {};
        const observed = p.observedAt
          ? new Date(String(p.observedAt)).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
          : '—';
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'ep-map-popup' })
          .setLngLat(event.lngLat)
          .setHTML(
            `<div style="min-width:180px"><div style="font-weight:700">${escapeHtml(p.label)}</div>
             <div style="color:#5f7065;font-size:10px">CAMS modelled · ${escapeHtml(observed)} IST</div>
             <div style="margin-top:6px;font-size:12px"><strong>PM2.5 ${p.pm25 === null ? '—' : escapeHtml(p.pm25)} µg/m³</strong></div>
             <div style="font-size:10px;color:#5f7065">PM10 ${p.pm10 === null ? '—' : escapeHtml(p.pm10)} µg/m³</div>
             <div style="margin-top:5px;font-size:9px;color:#66766b">MODELLED CONTEXT · not a station measurement</div></div>`,
          )
          .addTo(map);
      });
      map.on('mousemove', 'ep-sources', (event: any) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const p = feature.properties ?? {};
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: 'ep-map-popup' })
          .setLngLat(event.lngLat)
          .setHTML(
            `<div style="min-width:190px"><div style="display:flex;align-items:center;gap:6px"><span style="display:inline-flex;height:18px;width:18px;align-items:center;justify-content:center;border-radius:50%;background:${escapeHtml(p.color)};color:#fff;font-size:9px;font-weight:700">${escapeHtml(p.rank)}</span><span style="font-weight:700">${escapeHtml(p.label)}</span></div>
             <div style="color:#8a5a3b;font-size:10px;margin-top:3px">${escapeHtml(p.type)} · ${escapeHtml(p.locality)}</div>
             <div style="margin-top:6px;font-size:11px"><strong>${p.capacityMW ? `Capacity ${escapeHtml(p.capacityMW)} MW` : 'Capacity not published'}</strong></div>
             <div style="margin-top:3px;font-size:10px;color:#7c5a45">${escapeHtml(p.affectedMonitors)} monitor(s) in wind screen · ${escapeHtml(p.plumeLengthKm)} km corridor</div>
             <div style="margin-top:5px;font-size:9px;color:#9a7b66">OPENSTREETMAP FACILITY · screening only</div></div>`,
          )
          .addTo(map);
      });
      map.on('mouseleave', 'ep-stations-observed', () => {
        popupRef.current?.remove();
      });
      map.on('mouseleave', 'ep-stations-predicted', () => {
        popupRef.current?.remove();
      });
      map.on('mouseleave', 'ep-sources', () => {
        popupRef.current?.remove();
      });
      map.on('mouseleave', 'ep-modelled', () => {
        popupRef.current?.remove();
      });
      map.on('click', (event: any) => {
        if (event.defaultPrevented) return;
        handlersRef.current.onMapClick?.({ lng: event.lngLat.lng, lat: event.lngLat.lat });
      });

      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reducedMotion && !compact) {
        let lastPaint = 0;
        const animateFlow = (time: number) => {
          flowFrame = requestAnimationFrame(animateFlow);
          if (!dataRef.current.showImpactLinks || !dataRef.current.sourceLinks.length) return;
          if (time - lastPaint < 60) return;
          lastPaint = time;
          const flowSource = map.getSource('ep-source-flow') as maplibregl.GeoJSONSource | undefined;
          flowSource?.setData(flowFeatures(dataRef.current.sourceLinks, (time / 4_200) % 1));
          if (map.getLayer('ep-source-plumes-fill')) {
            map.setPaintProperty('ep-source-plumes-fill', 'fill-opacity', 0.09 + (Math.sin(time / 1_300) + 1) * 0.012);
          }
        };
        flowFrame = requestAnimationFrame(animateFlow);
      }
      setMapReady(true);
    });

    return () => {
      if (flowFrame !== null) cancelAnimationFrame(flowFrame);
      loadedRef.current = false;
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
    // The map is initialised once; subsequent data updates use setData.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource('ep-stations') as maplibregl.GeoJSONSource | undefined;
    source?.setData(stationFeatures(stations, selectedStationId));
    const modelledSource = map.getSource('ep-modelled') as maplibregl.GeoJSONSource | undefined;
    modelledSource?.setData(modelledFeatures(modelled));
    const reportsSource = map.getSource('ep-reports') as maplibregl.GeoJSONSource | undefined;
    reportsSource?.setData(reportFeatures(reports));
    const incidentsSource = map.getSource('ep-incidents') as maplibregl.GeoJSONSource | undefined;
    incidentsSource?.setData(incidentFeatures(incidents));
    const sourcesSource = map.getSource('ep-sources') as maplibregl.GeoJSONSource | undefined;
    sourcesSource?.setData(sourceFeatures(sources, selectedSourceId));
    const plumesSource = map.getSource('ep-source-plumes') as maplibregl.GeoJSONSource | undefined;
    plumesSource?.setData(plumeFeatures(sources));
    const linksSource = map.getSource('ep-source-links') as maplibregl.GeoJSONSource | undefined;
    linksSource?.setData(sourceLinkFeatures(sourceLinks));
    const flowSource = map.getSource('ep-source-flow') as maplibregl.GeoJSONSource | undefined;
    flowSource?.setData(flowFeatures(sourceLinks, 0.25));
  }, [stations, modelled, reports, incidents, sources, sourceLinks, selectedStationId, selectedSourceId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource('ep-focus') as maplibregl.GeoJSONSource | undefined;
    source?.setData(focusFeatures(focusPoint));
  }, [focusPoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !map.getLayer('ep-buildings-3d')) return;
    map.setLayoutProperty('ep-buildings-3d', 'visibility', showBuildings ? 'visible' : 'none');
  }, [showBuildings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    for (const layer of ['ep-sources', 'ep-source-halo', 'ep-source-labels']) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', showSources ? 'visible' : 'none');
    }
  }, [showSources]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    for (const layer of ['ep-source-plumes-fill', 'ep-source-plumes-line']) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', showPlumes ? 'visible' : 'none');
    }
  }, [showPlumes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    for (const layer of ['ep-source-links', 'ep-source-flow']) {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, 'visibility', showImpactLinks ? 'visible' : 'none');
      }
    }
  }, [showImpactLinks]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    for (const layer of ['ep-modelled-halo', 'ep-modelled', 'ep-modelled-labels']) {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, 'visibility', showModelled ? 'visible' : 'none');
      }
    }
  }, [showModelled]);

  useEffect(() => {
    if (!showRadar) return;
    let cancelled = false;
    setRadarError(null);
    api.get<RadarPayload>('/public/radar')
      .then((payload) => {
        if (cancelled) return;
        setRadar(payload);
        setRadarIndex(0);
        setRadarPlaying(true);
      })
      .catch((err) => {
        if (!cancelled) setRadarError(err instanceof Error ? err.message : 'Rain radar unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [showRadar]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const layerId = 'ep-rain-radar';
    if (!showRadar) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none');
      return;
    }
    if (!radar || radar.frames.length === 0) return;
    const frame = radar.frames[Math.min(radarIndex, radar.frames.length - 1)];
    const tiles = [radarTileUrl(radar.host, frame.path)];
    const source = map.getSource(layerId) as RasterTileSource | undefined;
    if (source) {
      source.setTiles(tiles);
      map.setLayoutProperty(layerId, 'visibility', 'visible');
    } else {
      map.addSource(layerId, {
        type: 'raster',
        tiles,
        tileSize: 256,
        minzoom: 0,
        maxzoom: radar.maxZoom,
        attribution: radar.attribution,
      });
      const beforeId = map.getLayer('ep-station-halo') ? 'ep-station-halo' : undefined;
      map.addLayer(
        {
          id: layerId,
          type: 'raster',
          source: layerId,
          paint: {
            'raster-opacity': 0.52,
            'raster-fade-duration': 0,
            'raster-resampling': 'linear',
          },
        },
        beforeId,
      );
    }
  }, [mapReady, showRadar, radar, radarIndex]);

  useEffect(() => {
    if (!showRadar || !radar || radar.frames.length < 2 || !radarPlaying) return;
    const timer = window.setInterval(() => {
      setRadarIndex((index) => (index + 1) % radar.frames.length);
    }, 700);
    return () => window.clearInterval(timer);
  }, [showRadar, radar, radarPlaying]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !selectedSourceId) return;
    const source = dataRef.current.sources.find((item) => item.id === selectedSourceId);
    if (!source) return;
    map.flyTo({
      center: [source.lng, source.lat],
      zoom: Math.max(12.4, map.getZoom()),
      pitch: Math.max(35, map.getPitch()),
      bearing: map.getBearing(),
      duration: 950,
      essential: true,
    });
    // Only react to a new selection, not to timeline data refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSourceId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !selectedStationId) return;
    const station = dataRef.current.stations.find((item) => item.id === selectedStationId);
    if (!station) return;
    map.flyTo({
      center: [station.lng, station.lat],
      zoom: Math.max(13, map.getZoom()),
      pitch: Math.max(35, map.getPitch()),
      bearing: map.getBearing(),
      duration: 850,
      essential: true,
    });
    // Only react to a new selection, not to timeline data refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStationId]);

  const radarFrame = radar?.frames[Math.min(radarIndex, radar.frames.length - 1)] ?? null;

  return (
    <div className={classNames('relative overflow-hidden', className)}>
      <div ref={containerRef} className="absolute inset-0" />
      {!compact ? (
        <div className="absolute left-3 top-3 z-10 flex items-center gap-0.5 rounded-full border border-white/85 bg-white/85 p-1 shadow-[0_18px_36px_-28px_rgba(23,42,29,.55)] backdrop-blur-xl">
          <button
            type="button"
            onClick={() => {
              const map = mapRef.current;
              if (map && boundaryBoundsRef.current) map.fitBounds(boundaryBoundsRef.current, { padding: 40, duration: 900, maxZoom: 11.8 });
            }}
            className="rounded-full px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#4d5e52] transition hover:bg-white hover:text-[#142016]"
          >
            Fit Mumbai
          </button>
          <button
            type="button"
            onClick={() => {
              setViewMode('3d');
              mapRef.current?.easeTo({ center: [72.8777, 19.076], zoom: 14.1, pitch: 60, bearing: -18, duration: 1200 });
            }}
            aria-pressed={viewMode === '3d'}
            className={classNames(
              'rounded-full px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] transition',
              viewMode === '3d' ? 'bg-[#eef7e8] text-[#3f6b2d]' : 'text-[#4d5e52] hover:bg-white hover:text-[#142016]',
            )}
          >
            3D city
          </button>
          <button
            type="button"
            onClick={() => {
              setViewMode('flat');
              mapRef.current?.easeTo({ center: [72.8777, 19.076], zoom: 12.2, pitch: 0, bearing: 0, duration: 1000 });
            }}
            aria-pressed={viewMode === 'flat'}
            className={classNames(
              'rounded-full px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] transition',
              viewMode === 'flat' ? 'bg-[#eef7e8] text-[#3f6b2d]' : 'text-[#4d5e52] hover:bg-white hover:text-[#142016]',
            )}
          >
            Flat
          </button>
        </div>
      ) : null}
      {showRadar && !compact ? (
        <div className="absolute left-1/2 top-3 z-20 w-[min(330px,calc(100%-24px))] -translate-x-1/2 rounded-2xl border border-white/90 bg-white/90 p-2.5 shadow-[0_18px_38px_-26px_rgba(23,42,29,.55)] backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#e9f3f6] text-[#4f7f94]">
              <CloudRain className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#557480]">Rain radar · past 2h</p>
              <p className="truncate text-[9px] text-[#78919a]">
                {radarFrame
                  ? `${new Date(radarFrame.time * 1000).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST`
                  : radarError ?? 'Loading radar frames…'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRadarPlaying((value) => !value)}
              disabled={!radar || radar.frames.length < 2}
              aria-label={radarPlaying ? 'Pause rain radar' : 'Play rain radar'}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[#557480] transition hover:bg-[#eef7f9] hover:text-[#173d4a] disabled:opacity-40"
            >
              {radarPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, (radar?.frames.length ?? 1) - 1)}
            value={radarIndex}
            onChange={(event) => {
              setRadarIndex(Number(event.target.value));
              setRadarPlaying(false);
            }}
            disabled={!radar || radar.frames.length < 2}
            aria-label="Rain radar frame"
            className="mt-2 h-1 w-full cursor-pointer appearance-none rounded-full bg-[#dce5d8] accent-[#4f7f94] disabled:opacity-40"
          />
          <div className="mt-1 flex items-center justify-between gap-2 text-[8px] text-[#8a938b]">
            <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer" className="underline underline-offset-2">RainViewer</a>
            <span>Regional · 10-min frames · not street-level nowcast</span>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-x-4 bottom-12 z-10 rounded-xl border border-amber-500/30 bg-white/95 px-3 py-2 text-[11px] text-amber-700 shadow-lg">
          {error}
        </div>
      ) : null}
      {compact && overlayLabel ? (
        <div className="pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full border border-white/85 bg-white/80 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#34463a] shadow-pill backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-[#5da341]" />
          {overlayLabel}
        </div>
      ) : null}
    </div>
  );
}

export function MumbaiMap(props: Parameters<typeof MumbaiMapInner>[0]) {
  return (
    <ErrorBoundary
      label="mumbai-map"
      fallback={
        <div className={classNames('flex flex-col items-center justify-center gap-2 rounded-[24px] border border-amber-500/25 bg-[#fdf8e9] px-5 text-center', props.className)}>
          <span className="text-[11px] font-semibold text-amber-800">Map unavailable in this browser</span>
          <span className="max-w-xs text-[10px] leading-relaxed text-amber-700/75">
            WebGL or the map renderer could not start. The station and alert lists on this page remain usable.
          </span>
        </div>
      }
    >
      <MumbaiMapInner {...props} />
    </ErrorBoundary>
  );
}
