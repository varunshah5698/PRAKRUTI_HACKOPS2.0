import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Map as MapLibreMap, Popup } from 'maplibre-gl';

setWorkerUrl(workerUrl);
import type { FeatureCollection } from 'geojson';
import { classNames } from '../lib/format';
import { impactTone, sourceColor, type SourceImpactSource } from '../lib/sourceImpact';

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

interface Props {
  stations?: MapStation[];
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
          emissionIndex: source.emissionIndex,
          affectedMonitors: source.affectedMonitors,
          impactScore: source.impactScore,
          landKm2: source.estimatedLandKm2,
          plumeLengthKm: source.plumeLengthKm,
          stackHeightM: source.stackHeightM,
          primaryPollutant: source.primaryPollutant,
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

export function MumbaiMap({
  stations = [],
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
  const handlersRef = useRef({ onStationSelect, onReportSelect, onIncidentSelect, onSourceSelect, onMapClick });
  handlersRef.current = { onStationSelect, onReportSelect, onIncidentSelect, onSourceSelect, onMapClick };
  const dataRef = useRef({ stations, reports, incidents, sources, sourceLinks, selectedStationId, selectedSourceId, focusPoint });
  dataRef.current = { stations, reports, incidents, sources, sourceLinks, selectedStationId, selectedSourceId, focusPoint };

  useEffect(() => {
    if (!containerRef.current) return;
    const style = styleUrl ?? (theme === 'dark' ? 'https://tiles.openfreemap.org/styles/dark' : 'https://tiles.openfreemap.org/styles/liberty');
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
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
      map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    }
    map.on('error', (event: any) => {
      const message = String((event as { error?: { message?: string } }).error?.message ?? '');
      if (message.toLowerCase().includes('style') || message.toLowerCase().includes('sprite')) {
        setError('Map tiles could not be loaded. Check network access to OpenFreeMap.');
      }
    });

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
          paint: { 'fill-color': theme === 'dark' ? '#0b0e11' : '#eef3ec', 'fill-opacity': 1 },
        });
        map.addLayer({
          id: 'mumbai-boundary-fill',
          type: 'fill',
          source: 'mumbai-boundary',
          paint: { 'fill-color': theme === 'dark' ? '#b5e36b' : '#b9ff66', 'fill-opacity': theme === 'dark' ? 0.035 : 0.08 },
        });
        map.addLayer({
          id: 'mumbai-boundary-line',
          type: 'line',
          source: 'mumbai-boundary',
          paint: { 'line-color': theme === 'dark' ? '#b5e36b' : '#557a4b', 'line-width': 1.4, 'line-opacity': 0.75 },
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
                'fill-extrusion-color': theme === 'dark' ? '#29313a' : '#d7e0d3',
                'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
                'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
                'fill-extrusion-opacity': theme === 'dark' ? 0.72 : 0.5,
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
          'circle-opacity': 0.95,
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
             <div style="margin-top:4px;font-size:10px;color:#66766b">${p.isSimulated ? 'SIMULATION DATA · ' : ''}${escapeHtml(p.health)}</div></div>`,
          )
          .addTo(map);
      };
      map.on('mousemove', 'ep-stations-observed', stationPopup);
      map.on('mousemove', 'ep-stations-predicted', stationPopup);
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
             <div style="margin-top:6px;font-size:11px"><strong>Emission index ${escapeHtml(p.emissionIndex)}/100</strong></div>
             <div style="margin-top:3px;font-size:10px;color:#7c5a45">${escapeHtml(p.affectedMonitors)} affected monitor(s) · ${escapeHtml(p.plumeLengthKm)} km plume screen</div>
             <div style="margin-top:5px;font-size:9px;color:#9a7b66">SIMULATED SOURCE · screening only</div></div>`,
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
      map.on('click', (event: any) => {
        if (event.defaultPrevented) return;
        handlersRef.current.onMapClick?.({ lng: event.lngLat.lng, lat: event.lngLat.lat });
      });
    });

    return () => {
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
  }, [stations, reports, incidents, sources, sourceLinks, selectedStationId, selectedSourceId]);

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
    if (map.getLayer('ep-source-links')) {
      map.setLayoutProperty('ep-source-links', 'visibility', showImpactLinks ? 'visible' : 'none');
    }
  }, [showImpactLinks]);

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

  return (
    <div className={classNames('relative overflow-hidden', className)}>
      <div ref={containerRef} className="absolute inset-0" />
      {!compact ? (
        <div className="absolute left-3 top-3 z-10 flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              const map = mapRef.current;
              if (map && boundaryBoundsRef.current) map.fitBounds(boundaryBoundsRef.current, { padding: 40, duration: 900, maxZoom: 11.8 });
            }}
            className="rounded-full border border-white/85 bg-white/80 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#4d5e52] shadow-pill backdrop-blur hover:bg-white hover:text-[#142016]"
          >
            Fit Mumbai
          </button>
          <button
            type="button"
            onClick={() => {
              mapRef.current?.easeTo({ center: [72.8777, 19.076], zoom: 14.1, pitch: 60, bearing: -18, duration: 1200 });
            }}
            className="rounded-full border border-[#b3df7c] bg-[#e9fbd3] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#2f5f20] shadow-pill backdrop-blur hover:bg-[#def8c4]"
          >
            3D city
          </button>
          <button
            type="button"
            onClick={() => {
              mapRef.current?.easeTo({ center: [72.8777, 19.076], zoom: 12.2, pitch: 0, bearing: 0, duration: 1000 });
            }}
            className="rounded-full border border-white/85 bg-white/80 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#4d5e52] shadow-pill backdrop-blur hover:bg-white hover:text-[#142016]"
          >
            Flat
          </button>
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
