import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  categoryOf,
  type RawNearbyReport,
  type RawWeather,
  type StationInsight,
} from '../lib/report-analysis';

export type SceneSelection =
  | { kind: 'report' }
  | { kind: 'station'; id: string }
  | { kind: 'community'; id: string };

export interface ReportSceneHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

interface Props {
  reportLat: number;
  reportLng: number;
  reportRef: string;
  accent: string;
  stations: StationInsight[];
  community: RawNearbyReport[];
  selected: SceneSelection;
  layers: { stations: boolean; community: boolean; wind: boolean; rings: boolean };
  step: number;
  autoOrbit: boolean;
  weather: RawWeather | null;
  onUserInteract: () => void;
  onSelectStation: (id: string) => void;
  onSelectCommunity: (id: string) => void;
  onSelectReport: () => void;
}

interface CameraPreset {
  theta: number;
  phi: number;
  radius: number;
}

interface CameraTween {
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  duration: number;
}

interface PickData {
  kind: 'report' | 'station' | 'community';
  id: string;
  label: string;
  detail: string;
}

interface WindState {
  points: THREE.Points;
  positions: Float32Array;
  offsets: Float32Array;
  speeds: Float32Array;
  progress: Float32Array;
  direction: THREE.Vector3;
  perpendicular: THREE.Vector3;
}

interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  stationsGroup: THREE.Group;
  communityGroup: THREE.Group;
  reportGroup: THREE.Group;
  ringsGroup: THREE.Group;
  windGroup: THREE.Group;
  sweep: THREE.Group;
  selectionRing: THREE.Mesh;
  pickables: THREE.Object3D[];
  glowTexture: THREE.Texture | null;
  pulseRings: THREE.Mesh[];
  wind: WindState | null;
  cameraTween: CameraTween | null;
  toggleZoom: (factor: number) => void;
  frame: number;
}

const WORLD_KM = 4.4;
const GROUND_RADIUS = 15.5;
const TARGET = new THREE.Vector3(0, 1.25, 0);

const CAMERA_PRESETS: CameraPreset[] = [
  { theta: -0.55, phi: 1.02, radius: 18 },
  { theta: -0.92, phi: 1.0, radius: 16 },
  { theta: 0.32, phi: 0.94, radius: 17 },
  { theta: -0.08, phi: 1.12, radius: 15.5 },
  { theta: -0.68, phi: 0.98, radius: 18.5 },
];

const COMMUNITY_COLORS: Record<string, string> = {
  air: '#2d7c94',
  water: '#2f8f84',
  waste: '#b3860f',
  industrial: '#c97445',
};

function cameraPosition(preset: CameraPreset): THREE.Vector3 {
  return new THREE.Vector3(
    TARGET.x + preset.radius * Math.sin(preset.phi) * Math.sin(preset.theta),
    TARGET.y + preset.radius * Math.cos(preset.phi),
    TARGET.z + preset.radius * Math.sin(preset.phi) * Math.cos(preset.theta),
  );
}

function worldPoint(lat: number, lng: number, centerLat: number, centerLng: number) {
  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.32 * Math.cos((centerLat * Math.PI) / 180);
  const dxKm = (lng - centerLng) * kmPerDegLng;
  const dyKm = (lat - centerLat) * kmPerDegLat;
  return { x: dxKm * WORLD_KM, z: -dyKm * WORLD_KM };
}

function makeGlowTexture(): THREE.Texture | null {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,0.92)');
  gradient.addColorStop(0.28, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeTextSprite(text: string, color: string): THREE.Sprite | null {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = 'rgba(255,255,255,0.82)';
  context.fillRect(8, 14, 240, 36);
  context.strokeStyle = 'rgba(173,199,187,0.75)';
  context.lineWidth = 2;
  context.strokeRect(8, 14, 240, 36);
  context.fillStyle = color;
  context.font = '600 26px Inter, system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 128, 33);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.65, 0.41, 1);
  return sprite;
}

function disposeMaterial(material: THREE.Material | THREE.Material[], disposeMaps: boolean) {
  const materials = Array.isArray(material) ? material : [material];
  for (const item of materials) {
    if (disposeMaps) {
      const mapped = item as THREE.MeshBasicMaterial;
      mapped.map?.dispose();
    }
    item.dispose();
  }
}

function clearGroup(group: THREE.Group, disposeMaps = false) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((object) => {
      if (!(object instanceof THREE.Sprite)) {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
      }
      const mesh = object as THREE.Mesh;
      if (mesh.material) disposeMaterial(mesh.material, disposeMaps);
    });
  }
}

function addGlow(group: THREE.Group, texture: THREE.Texture | null, color: string, scale: number) {
  if (!texture) return;
  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scale, scale, 1);
  sprite.position.y = 0.06;
  group.add(sprite);
}

export const ReportScene3D = forwardRef<ReportSceneHandle, Props>(function ReportScene3D(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneContext | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [hover, setHover] = useState<{ label: string; detail: string; x: number; y: number } | null>(null);
  const [fallback, setFallback] = useState(false);

  const startCameraTween = (ctx: SceneContext, index: number) => {
    const preset = CAMERA_PRESETS[index] ?? CAMERA_PRESETS[0];
    ctx.cameraTween = {
      from: ctx.camera.position.clone(),
      to: cameraPosition(preset),
      start: performance.now(),
      duration: 760,
    };
  };

  useEffect(() => {
    const container = containerRef.current;
    const canvasHost = canvasHostRef.current;
    if (!container || !canvasHost) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (error) {
      console.warn('ReportScene3D could not start WebGL', error);
      setFallback(true);
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
    const initialPreset = CAMERA_PRESETS[propsRef.current.step] ?? CAMERA_PRESETS[0];
    camera.position.copy(cameraPosition(initialPreset));
    camera.lookAt(TARGET);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.display = 'block';
    canvasHost.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x9bbaaa, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(9, 18, 12);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xbfe7d8, 1.15);
    fillLight.position.set(-10, 8, -9);
    scene.add(fillLight);
    scene.fog = new THREE.Fog(0xeaf5ee, 24, 48);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.minDistance = 8.5;
    controls.maxDistance = 30;
    controls.minPolarAngle = 0.32;
    controls.maxPolarAngle = 1.36;
    controls.autoRotateSpeed = 0.55;
    controls.target.copy(TARGET);
    controls.update();

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(GROUND_RADIUS, 96),
      new THREE.MeshStandardMaterial({
        color: 0xedf7f1,
        roughness: 0.96,
        metalness: 0.02,
        transparent: true,
        opacity: 0.92,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const polar = new THREE.PolarGridHelper(GROUND_RADIUS, 12, 6, 96, 0x9fc6b5, 0xc9dfd5);
    const polarMaterial = Array.isArray(polar.material) ? polar.material : [polar.material];
    for (const material of polarMaterial) {
      material.transparent = true;
      material.opacity = 0.28;
    }
    polar.position.y = 0.015;
    scene.add(polar);

    const stationsGroup = new THREE.Group();
    const communityGroup = new THREE.Group();
    const reportGroup = new THREE.Group();
    const ringsGroup = new THREE.Group();
    const windGroup = new THREE.Group();
    scene.add(stationsGroup, communityGroup, reportGroup, ringsGroup, windGroup);

    const sweep = new THREE.Group();
    const sweepGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.035, 0),
      new THREE.Vector3(0, 0.035, 3 * WORLD_KM),
    ]);
    const sweepLine = new THREE.Line(
      sweepGeometry,
      new THREE.LineBasicMaterial({ color: propsRef.current.accent, transparent: true, opacity: 0.22 }),
    );
    sweep.add(sweepLine);
    scene.add(sweep);

    const selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.05, 64),
      new THREE.MeshBasicMaterial({ color: 0x173d4a, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.position.y = 0.04;
    selectionRing.visible = false;
    scene.add(selectionRing);

    const glowTexture = makeGlowTexture();

    const ctx: SceneContext = {
      scene,
      camera,
      renderer,
      controls,
      stationsGroup,
      communityGroup,
      reportGroup,
      ringsGroup,
      windGroup,
      sweep,
      selectionRing,
      pickables: [],
      glowTexture,
      pulseRings: [],
      wind: null,
      cameraTween: null,
      toggleZoom: () => undefined,
      frame: 0,
    };
    sceneRef.current = ctx;

    const resize = () => {
      if (!container) return;
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    let pointerDown = { x: 0, y: 0 };
    let hoverId = '';

    const pickAt = (event: PointerEvent): PickData | null => {
      const rect = container.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(ctx.pickables, false)[0];
      return (hit?.object.userData as PickData | undefined) ?? null;
    };

    const handlePointerMove = (event: PointerEvent) => {
      const hit = pickAt(event);
      const rect = container.getBoundingClientRect();
      if (!hit) {
        hoverId = '';
        setHover(null);
        container.style.cursor = 'grab';
        return;
      }
      const id = `${hit.kind}:${hit.id}`;
      container.style.cursor = 'pointer';
      if (id !== hoverId) {
        hoverId = id;
        setHover({
          label: hit.label,
          detail: hit.detail,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      pointerDown = { x: event.clientX, y: event.clientY };
      container.style.cursor = 'grabbing';
    };

    const handlePointerUp = () => {
      container.style.cursor = 'grab';
    };

    const handleClick = (event: MouseEvent) => {
      if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) return;
      const rect = container.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(ctx.pickables, false)[0]?.object.userData as PickData | undefined;
      if (!hit) return;
      propsRef.current.onUserInteract();
      if (hit.kind === 'station') propsRef.current.onSelectStation(hit.id);
      else if (hit.kind === 'community') propsRef.current.onSelectCommunity(hit.id);
      else propsRef.current.onSelectReport();
    };

    const handlePointerLeave = () => {
      hoverId = '';
      setHover(null);
      container.style.cursor = 'grab';
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target !== container) return;
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      if (event.key === 'ArrowLeft') spherical.theta -= 0.12;
      else if (event.key === 'ArrowRight') spherical.theta += 0.12;
      else if (event.key === 'ArrowUp') spherical.phi = Math.max(0.32, spherical.phi - 0.08);
      else if (event.key === 'ArrowDown') spherical.phi = Math.min(1.36, spherical.phi + 0.08);
      else if (event.key === '+' || event.key === '=') ctx.toggleZoom(0.84);
      else if (event.key === '-') ctx.toggleZoom(1.19);
      else if (event.key === '0') startCameraTween(ctx, propsRef.current.step);
      else return;
      if (event.key.startsWith('Arrow')) {
        offset.setFromSpherical(spherical);
        camera.position.copy(controls.target).add(offset);
        ctx.cameraTween = null;
        controls.update();
        propsRef.current.onUserInteract();
      }
      event.preventDefault();
    };

    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointerup', handlePointerUp);
    container.addEventListener('pointerleave', handlePointerLeave);
    container.addEventListener('click', handleClick);
    container.addEventListener('keydown', handleKeyDown);

    const onControlStart = () => {
      ctx.cameraTween = null;
      propsRef.current.onUserInteract();
    };
    controls.addEventListener('start', onControlStart);

    ctx.toggleZoom = (factor: number) => {
      const offset = camera.position.clone().sub(controls.target);
      const distance = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
      offset.setLength(distance);
      camera.position.copy(controls.target).add(offset);
      ctx.cameraTween = null;
      controls.update();
    };

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let previous = performance.now();

    const animate = (now: number) => {
      const delta = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      controls.autoRotate = propsRef.current.autoOrbit && !reducedMotion;
      if (ctx.cameraTween) {
        const tween = ctx.cameraTween;
        const progress = Math.min(1, (now - tween.start) / tween.duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        camera.position.lerpVectors(tween.from, tween.to, eased);
        if (progress >= 1) ctx.cameraTween = null;
      }
      controls.update();

      if (ctx.wind && !reducedMotion) {
        const wind = ctx.wind;
        for (let index = 0; index < wind.progress.length; index += 1) {
          wind.progress[index] = (wind.progress[index] + delta * wind.speeds[index]) % 1;
          const along = wind.progress[index] * 16 - 8;
          wind.positions[index * 3] = wind.direction.x * along + wind.perpendicular.x * wind.offsets[index];
          wind.positions[index * 3 + 1] = 0.35 + Math.sin(now * 0.0015 + index) * 0.16;
          wind.positions[index * 3 + 2] = wind.direction.z * along + wind.perpendicular.z * wind.offsets[index];
        }
        wind.points.geometry.attributes.position.needsUpdate = true;
      }

      ctx.pulseRings.forEach((ring, index) => {
        const material = ring.material as THREE.MeshBasicMaterial;
        if (reducedMotion) {
          ring.scale.setScalar(1.05 + index * 0.22);
          material.opacity = 0.18;
          return;
        }
        const phase = (now * 0.00028 + index * 0.28) % 1;
        ring.scale.setScalar(1 + phase * 1.8);
        material.opacity = 0.3 * (1 - phase);
      });

      if (ctx.sweep.visible && !reducedMotion) ctx.sweep.rotation.y = now * 0.00014;
      renderer.render(scene, camera);
      ctx.frame = requestAnimationFrame(animate);
    };
    ctx.frame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(ctx.frame);
      resizeObserver.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.dispose();
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointerup', handlePointerUp);
      container.removeEventListener('pointerleave', handlePointerLeave);
      container.removeEventListener('click', handleClick);
      container.removeEventListener('keydown', handleKeyDown);
      scene.traverse((object) => {
        if (!(object instanceof THREE.Sprite)) {
          const mesh = object as THREE.Mesh;
          mesh.geometry?.dispose();
        }
        const mesh = object as THREE.Mesh;
        if (mesh.material) disposeMaterial(mesh.material, true);
      });
      glowTexture?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === canvasHost) canvasHost.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
    // The scene is intentionally created once; later effects update its data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    clearGroup(ctx.stationsGroup);
    clearGroup(ctx.communityGroup);
    clearGroup(ctx.reportGroup);
    clearGroup(ctx.ringsGroup, true);
    clearGroup(ctx.windGroup);
    ctx.pickables = [];
    ctx.pulseRings = [];
    ctx.wind = null;

    if (props.layers.stations) {
      for (const station of props.stations) {
        if (station.lat === null || station.lng === null) continue;
        const point = worldPoint(station.lat, station.lng, props.reportLat, props.reportLng);
        const height = 0.6 + Math.min(1, station.severity) * 4.4;
        const group = new THREE.Group();
        group.position.set(point.x, 0, point.z);

        const columnMaterial = new THREE.MeshStandardMaterial({
          color: station.tone,
          emissive: station.tone,
          emissiveIntensity: 0.2,
          roughness: 0.34,
          metalness: 0.08,
          transparent: true,
          opacity: 0.94,
        });
        const column = new THREE.Mesh(new THREE.BoxGeometry(0.48, height, 0.48), columnMaterial);
        column.position.y = height / 2;
        const pick: PickData = {
          kind: 'station',
          id: station.id,
          label: station.name.replace(/ demo (air monitor|sampling point|stack monitor)/i, ''),
          detail: `${station.headline} · ${Math.round(station.distance_m)} m`,
        };
        column.userData = pick;
        group.add(column);
        ctx.pickables.push(column);

        const cap = new THREE.Mesh(
          new THREE.BoxGeometry(0.66, 0.1, 0.66),
          new THREE.MeshStandardMaterial({
            color: 0xf8fffb,
            emissive: station.tone,
            emissiveIntensity: 0.42,
            roughness: 0.3,
          }),
        );
        cap.position.y = height + 0.05;
        cap.userData = pick;
        group.add(cap);
        ctx.pickables.push(cap);

        const pad = new THREE.Mesh(
          new THREE.RingGeometry(0.38, 0.58, 32),
          new THREE.MeshBasicMaterial({ color: station.tone, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
        );
        pad.rotation.x = -Math.PI / 2;
        pad.position.y = 0.025;
        group.add(pad);
        addGlow(group, ctx.glowTexture, station.tone, 1.35);

        const selected = props.selected.kind === 'station' && props.selected.id === station.id;
        if (selected) {
          columnMaterial.emissiveIntensity = 0.8;
          cap.scale.set(1.18, 1, 1.18);
        }
        ctx.stationsGroup.add(group);
      }
    }

    if (props.layers.community) {
      for (const report of props.community) {
        if (typeof report.lat !== 'number' || typeof report.lng !== 'number') continue;
        const point = worldPoint(report.lat, report.lng, props.reportLat, props.reportLng);
        const color = COMMUNITY_COLORS[categoryOf(report.category)] ?? props.accent;
        const group = new THREE.Group();
        group.position.set(point.x, 0, point.z);
        const pick: PickData = {
          kind: 'community',
          id: report.id,
          label: report.public_ref,
          detail: `${report.incident_type.replace(/_/g, ' ')} · ${Math.round(report.distance_m)} m`,
        };

        const stem = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, 0.34, 8),
          new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.6 }),
        );
        stem.position.y = 0.17;
        stem.userData = pick;
        group.add(stem);
        ctx.pickables.push(stem);

        const beacon = new THREE.Mesh(
          new THREE.SphereGeometry(0.15, 16, 16),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.75, roughness: 0.3 }),
        );
        beacon.position.y = 0.4;
        beacon.userData = pick;
        group.add(beacon);
        ctx.pickables.push(beacon);

        const pad = new THREE.Mesh(
          new THREE.RingGeometry(0.2, 0.34, 32),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
        );
        pad.rotation.x = -Math.PI / 2;
        pad.position.y = 0.025;
        group.add(pad);

        const hitTarget = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        );
        hitTarget.position.y = 0.45;
        hitTarget.userData = pick;
        group.add(hitTarget);
        ctx.pickables.push(hitTarget);

        if (props.selected.kind === 'community' && props.selected.id === report.id) {
          beacon.scale.setScalar(1.5);
          beacon.material.emissiveIntensity = 1.2;
        }
        ctx.communityGroup.add(group);
      }
    }

    // The report beacon is a fixed anchor, not a measurement column.
    const reportBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.72, 3.2, 32),
      new THREE.MeshStandardMaterial({
        color: props.accent,
        emissive: props.accent,
        emissiveIntensity: 0.35,
        roughness: 0.26,
        metalness: 0.1,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
      }),
    );
    reportBody.position.y = 1.6;
    const reportPick: PickData = {
      kind: 'report',
      id: 'report',
      label: 'Report site',
      detail: props.reportRef,
    };
    reportBody.userData = reportPick;
    ctx.reportGroup.add(reportBody);
    ctx.pickables.push(reportBody);

    const reportCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.74, 0.74, 0.14, 32),
      new THREE.MeshStandardMaterial({
        color: 0xf8fffb,
        emissive: props.accent,
        emissiveIntensity: 0.75,
        roughness: 0.25,
      }),
    );
    reportCap.position.y = 3.27;
    reportCap.userData = reportPick;
    ctx.reportGroup.add(reportCap);
    ctx.pickables.push(reportCap);

    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 1.6, 12),
      new THREE.MeshStandardMaterial({ color: props.accent, emissive: props.accent, emissiveIntensity: 1.1 }),
    );
    spire.position.y = 4.18;
    spire.userData = reportPick;
    ctx.reportGroup.add(spire);
    ctx.pickables.push(spire);

    const siteDisc = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 64),
      new THREE.MeshBasicMaterial({ color: props.accent, transparent: true, opacity: 0.07, depthWrite: false }),
    );
    siteDisc.rotation.x = -Math.PI / 2;
    siteDisc.position.y = 0.018;
    ctx.reportGroup.add(siteDisc);

    const reportLight = new THREE.PointLight(new THREE.Color(props.accent), 2.2, 8);
    reportLight.position.set(0, 3.3, 0);
    ctx.reportGroup.add(reportLight);
    addGlow(ctx.reportGroup, ctx.glowTexture, props.accent, 2.5);

    for (let index = 0; index < 3; index += 1) {
      const pulse = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 0.98, 64),
        new THREE.MeshBasicMaterial({
          color: props.accent,
          transparent: true,
          opacity: 0.25,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      pulse.rotation.x = -Math.PI / 2;
      pulse.position.y = 0.03 + index * 0.002;
      ctx.reportGroup.add(pulse);
      ctx.pulseRings.push(pulse);
    }

    if (props.layers.rings) {
      const ringSpecs = [
        { radius: 0.5 * WORLD_KM, label: null },
        { radius: 1 * WORLD_KM, label: '1 km' },
        { radius: 3 * WORLD_KM, label: '3 km' },
      ];
      for (const spec of ringSpecs) {
        const points = Array.from({ length: 129 }, (_, index) => {
          const angle = (index / 128) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(angle) * spec.radius, 0.025, Math.sin(angle) * spec.radius);
        });
        const line = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({
            color: props.accent,
            transparent: true,
            opacity: spec.radius < 2 ? 0.45 : 0.3,
          }),
        );
        ctx.ringsGroup.add(line);
        if (spec.label) {
          const label = makeTextSprite(spec.label, '#557480');
          if (label) {
            label.position.set(0, 0.07, spec.radius);
            ctx.ringsGroup.add(label);
          }
        }
      }
    }
    ctx.sweep.visible = props.layers.rings;
    const sweepLineMaterial = (ctx.sweep.children[0] as THREE.Line)?.material as THREE.LineBasicMaterial | undefined;
    sweepLineMaterial?.color.set(props.accent);

    if (props.layers.wind && props.weather) {
      const radians = (props.weather.wind_direction_deg * Math.PI) / 180;
      const direction = new THREE.Vector3(Math.sin(radians), 0, -Math.cos(radians)).normalize();
      const perpendicular = new THREE.Vector3(-direction.z, 0, direction.x);
      const arrowOrigin = direction.clone().multiplyScalar(-8);
      arrowOrigin.y = 0.45;
      const arrow = new THREE.ArrowHelper(direction, arrowOrigin, 16, new THREE.Color(0x2d7c94), 0.9, 0.55);
      const arrowLineMaterial = arrow.line.material as THREE.LineBasicMaterial;
      arrowLineMaterial.transparent = true;
      arrowLineMaterial.opacity = 0.32;
      const arrowConeMaterial = arrow.cone.material as THREE.MeshBasicMaterial;
      arrowConeMaterial.transparent = true;
      arrowConeMaterial.opacity = 0.48;
      ctx.windGroup.add(arrow);

      const count = 64;
      const positions = new Float32Array(count * 3);
      const offsets = new Float32Array(count);
      const speeds = new Float32Array(count);
      const progress = new Float32Array(count);
      const speedScale = THREE.MathUtils.clamp(props.weather.wind_speed_kmh / 12, 0.45, 1.6);
      for (let index = 0; index < count; index += 1) {
        offsets[index] = (Math.random() - 0.5) * 3.4;
        speeds[index] = (0.055 + Math.random() * 0.06) * speedScale;
        progress[index] = Math.random();
        const along = progress[index] * 16 - 8;
        positions[index * 3] = direction.x * along + perpendicular.x * offsets[index];
        positions[index * 3 + 1] = 0.35 + Math.random() * 0.35;
        positions[index * 3 + 2] = direction.z * along + perpendicular.z * offsets[index];
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: 0x2d7c94,
          size: 0.12,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          sizeAttenuation: true,
        }),
      );
      ctx.windGroup.add(points);
      ctx.wind = { points, positions, offsets, speeds, progress, direction, perpendicular };
    }

    // Keep the basemap glow behind the site; the 500 m ring is drawn above it.
    const selected = props.selected;
    const selectedPosition = (() => {
      if (selected.kind === 'station') {
        const station = props.stations.find((row) => row.id === selected.id);
        if (!station || station.lat === null || station.lng === null) return null;
        return { ...worldPoint(station.lat, station.lng, props.reportLat, props.reportLng), scale: 0.72 };
      }
      if (selected.kind === 'community') {
        const report = props.community.find((row) => row.id === selected.id);
        if (!report || typeof report.lat !== 'number' || typeof report.lng !== 'number') return null;
        return { ...worldPoint(report.lat, report.lng, props.reportLat, props.reportLng), scale: 0.48 };
      }
      return { x: 0, z: 0, scale: 1.35 };
    })();
    if (selectedPosition) {
      ctx.selectionRing.position.set(selectedPosition.x, 0.045, selectedPosition.z);
      ctx.selectionRing.scale.setScalar(selectedPosition.scale);
      ctx.selectionRing.visible = true;
    } else {
      ctx.selectionRing.visible = false;
    }
    // A selected report keeps a clear, dark anchor ring around the beacon.
    (ctx.selectionRing.material as THREE.MeshBasicMaterial).color.set(props.selected.kind === 'report' ? 0x173d4a : 0xffffff);
    (ctx.selectionRing.material as THREE.MeshBasicMaterial).opacity = props.selected.kind === 'report' ? 0.55 : 0.9;
  }, [props.stations, props.community, props.selected, props.layers, props.accent, props.weather, props.reportLat, props.reportLng, props.reportRef]);

  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    startCameraTween(ctx, props.step);
    // Presets intentionally only follow the guided step, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.step]);

  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    ctx.controls.autoRotate = props.autoOrbit;
  }, [props.autoOrbit]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => sceneRef.current?.toggleZoom(0.84),
    zoomOut: () => sceneRef.current?.toggleZoom(1.19),
    reset: () => {
      const ctx = sceneRef.current;
      if (ctx) startCameraTween(ctx, propsRef.current.step);
    },
  }), []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8fc47a]"
      tabIndex={0}
      role="group"
      aria-label="Interactive WebGL 3D site analysis. Drag to orbit, use arrow keys to rotate, plus or minus to zoom. Click a column or pin to inspect it."
    >
      <div ref={canvasHostRef} className="absolute inset-0" aria-hidden />
      {fallback ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#eef7f2]/80 px-6 text-center">
          <p className="text-[12px] font-semibold text-[#26362a]">3D view unavailable</p>
          <p className="max-w-sm text-[10px] leading-relaxed text-[#66766b]">
            This browser could not start WebGL. The report dossier and the nearby records remain available in the panel.
          </p>
        </div>
      ) : null}
      {hover ? (
        <div
          className="pointer-events-none absolute z-20 max-w-[230px] rounded-xl border border-white/90 bg-white/95 px-2.5 py-2 text-left shadow-[0_16px_34px_-22px_rgba(20,70,85,.65)]"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          <p className="text-[10px] font-semibold text-[#1b2a1f]">{hover.label}</p>
          <p className="mt-0.5 text-[8px] leading-relaxed text-[#66766b]">{hover.detail}</p>
        </div>
      ) : null}
    </div>
  );
});
