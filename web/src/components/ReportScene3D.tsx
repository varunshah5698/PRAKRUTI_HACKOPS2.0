import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
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
  columnTexture: THREE.Texture | null;
  pulseRings: THREE.Mesh[];
  wind: WindState | null;
  beacon: THREE.Object3D | null;
  beaconBaseY: number;
  dust: THREE.Points | null;
  cameraTween: CameraTween | null;
  toggleZoom: (factor: number) => void;
  frame: number;
}

const WORLD_KM = 3.2;
const GROUND_RADIUS = 10.2;
const TARGET = new THREE.Vector3(0, 0.1, 0);

const CAMERA_PRESETS: CameraPreset[] = [
  { theta: -0.55, phi: 1.05, radius: 20.0 },
  { theta: -0.92, phi: 1.03, radius: 19.4 },
  { theta: 0.32, phi: 0.99, radius: 20.3 },
  { theta: -0.08, phi: 1.12, radius: 19.0 },
  { theta: -0.68, phi: 1.02, radius: 20.3 },
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
  canvas.height = 80;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.beginPath();
  context.roundRect(10, 20, 236, 40, 20);
  context.fillStyle = 'rgba(255,255,255,0.9)';
  context.fill();
  context.strokeStyle = 'rgba(160,192,177,0.85)';
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = color;
  context.font = '600 30px "Inter Variable", Inter, system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 128, 41);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.85, 0.58, 1);
  return sprite;
}

function makeStationSprite(name: string, detail: string, tone: string): THREE.Sprite | null {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 72;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.beginPath();
  context.roundRect(4, 4, 504, 64, 32);
  context.fillStyle = 'rgba(255,255,255,0.95)';
  context.fill();
  context.strokeStyle = tone;
  context.globalAlpha = 0.45;
  context.lineWidth = 3;
  context.stroke();
  context.globalAlpha = 1;
  context.beginPath();
  context.arc(31, 36, 6.5, 0, Math.PI * 2);
  context.fillStyle = tone;
  context.fill();
  const shortName = name.length > 18 ? `${name.slice(0, 17)}…` : name;
  const shortDetail = detail.length > 26 ? `${detail.slice(0, 25)}…` : detail;
  context.fillStyle = '#24443b';
  context.font = '600 34px "Inter Variable", Inter, system-ui, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillText(`${shortName} · ${shortDetail}`, 48, 36);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.27, 0.46, 1);
  return sprite;
}

function makeColumnTexture(): THREE.Texture | null {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const gradient = context.createLinearGradient(0, 256, 0, 0);
  gradient.addColorStop(0, '#9d9d9d');
  gradient.addColorStop(0.5, '#d9d9d9');
  gradient.addColorStop(1, '#ffffff');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 16, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function disposeMaterial(
  material: THREE.Material | THREE.Material[],
  disposeMaps: boolean,
  protectedMaps?: Set<THREE.Texture>,
) {
  const materials = Array.isArray(material) ? material : [material];
  for (const item of materials) {
    if (disposeMaps) {
      const mapped = item as THREE.MeshBasicMaterial;
      if (mapped.map && !protectedMaps?.has(mapped.map)) mapped.map.dispose();
    }
    item.dispose();
  }
}

function clearGroup(group: THREE.Group, disposeMaps = false, protectedMaps?: Set<THREE.Texture>) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((object) => {
      if (!(object instanceof THREE.Sprite)) {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
      }
      const mesh = object as THREE.Mesh;
      if (mesh.material) disposeMaterial(mesh.material, disposeMaps, protectedMaps);
    });
  }
}

function addGlow(
  group: THREE.Group,
  texture: THREE.Texture | null,
  color: string,
  scale: number,
  y = 0.06,
  opacity = 0.5,
) {
  if (!texture) return;
  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scale, scale, 1);
  sprite.position.y = y;
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
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
    const initialPreset = CAMERA_PRESETS[propsRef.current.step] ?? CAMERA_PRESETS[0];
    camera.position.copy(cameraPosition(initialPreset));
    camera.lookAt(TARGET);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.domElement.style.display = 'block';
    canvasHost.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8fb6a3, 2.35));
    const keyLight = new THREE.DirectionalLight(0xfff7ea, 3.1);
    keyLight.position.set(11, 22, 10);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -18;
    keyLight.shadow.camera.right = 18;
    keyLight.shadow.camera.top = 18;
    keyLight.shadow.camera.bottom = -18;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 65;
    keyLight.shadow.bias = -0.0006;
    keyLight.shadow.normalBias = 0.035;
    scene.add(keyLight, keyLight.target);
    const fillLight = new THREE.DirectionalLight(0xbfe7d8, 1.1);
    fillLight.position.set(-12, 9, -10);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0x9ed7c4, 1.65);
    rimLight.position.set(-2, 7, -16);
    scene.add(rimLight);
    scene.fog = new THREE.Fog(0xeaf5ee, 28, 52);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.minDistance = 10.5;
    controls.maxDistance = 32;
    controls.minPolarAngle = 0.28;
    controls.maxPolarAngle = 1.42;
    controls.autoRotateSpeed = 0.45;
    controls.target.copy(TARGET);
    controls.update();

    // A shallow plinth turns the plot into a physical site model instead of a
    // flat chart lying on the page.
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(GROUND_RADIUS, GROUND_RADIUS + 0.22, 0.55, 96, 1),
      [
        new THREE.MeshStandardMaterial({ color: 0xc7ded1, roughness: 0.84, metalness: 0.04 }),
        new THREE.MeshStandardMaterial({ color: 0xeaf4ed, roughness: 0.9, metalness: 0.02 }),
        new THREE.MeshStandardMaterial({ color: 0xb7d1c3, roughness: 0.92 }),
      ],
    );
    platform.position.y = -0.275;
    platform.receiveShadow = true;
    scene.add(platform);

    const platformRim = new THREE.Mesh(
      new THREE.TorusGeometry(GROUND_RADIUS - 0.04, 0.07, 10, 128),
      new THREE.MeshStandardMaterial({ color: 0xaecdbd, roughness: 0.5, metalness: 0.16 }),
    );
    platformRim.rotation.x = Math.PI / 2;
    platformRim.position.y = -0.02;
    scene.add(platformRim);

    const polar = new THREE.PolarGridHelper(GROUND_RADIUS - 0.55, 8, 8, 96, 0x86b79f, 0xa8cbb7);
    const polarMaterial = Array.isArray(polar.material) ? polar.material : [polar.material];
    for (const material of polarMaterial) {
      material.transparent = true;
      material.opacity = 0.24;
    }
    polar.position.y = 0.012;
    scene.add(polar);

    const stationsGroup = new THREE.Group();
    const communityGroup = new THREE.Group();
    const reportGroup = new THREE.Group();
    const ringsGroup = new THREE.Group();
    const windGroup = new THREE.Group();
    scene.add(stationsGroup, communityGroup, reportGroup, ringsGroup, windGroup);

    const sweep = new THREE.Group();
    const sweepWedge = new THREE.Mesh(
      new THREE.RingGeometry(
        0.35,
        GROUND_RADIUS - 0.7,
        64,
        1,
        Math.PI * 1.5 - 0.34,
        0.68,
      ),
      new THREE.MeshBasicMaterial({
        color: propsRef.current.accent,
        transparent: true,
        opacity: 0.05,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    sweepWedge.rotation.x = -Math.PI / 2;
    sweepWedge.position.y = 0.018;
    sweep.add(sweepWedge);
    const sweepGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.032, 0),
      new THREE.Vector3(0, 0.032, GROUND_RADIUS - 0.7),
    ]);
    const sweepLine = new THREE.Line(
      sweepGeometry,
      new THREE.LineBasicMaterial({ color: propsRef.current.accent, transparent: true, opacity: 0.2 }),
    );
    sweep.add(sweepLine);
    scene.add(sweep);

    const selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.08, 64),
      new THREE.MeshBasicMaterial({ color: 0x2d7c94, transparent: true, opacity: 0.65, side: THREE.DoubleSide }),
    );
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.position.y = 0.04;
    selectionRing.visible = false;
    scene.add(selectionRing);

    const glowTexture = makeGlowTexture();
    const columnTexture = makeColumnTexture();

    const dustPositions = new Float32Array(120 * 3);
    for (let index = 0; index < 120; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 2 + Math.random() * (GROUND_RADIUS - 2.5);
      dustPositions[index * 3] = Math.cos(angle) * radius;
      dustPositions[index * 3 + 1] = 0.45 + Math.random() * 8;
      dustPositions[index * 3 + 2] = Math.sin(angle) * radius;
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const dust = new THREE.Points(
      dustGeometry,
      new THREE.PointsMaterial({
        map: glowTexture,
        color: 0x9cc5b2,
        size: 0.16,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    scene.add(dust);

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
      columnTexture,
      pulseRings: [],
      wind: null,
      beacon: null,
      beaconBaseY: 0,
      dust,
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
      else if (event.key === 'ArrowUp') spherical.phi = Math.max(0.28, spherical.phi - 0.08);
      else if (event.key === 'ArrowDown') spherical.phi = Math.min(1.42, spherical.phi + 0.08);
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
        ring.scale.setScalar(1 + phase * 1.9);
        material.opacity = 0.32 * (1 - phase);
      });

      if (ctx.beacon) {
        if (reducedMotion) {
          ctx.beacon.position.y = ctx.beaconBaseY;
        } else {
          ctx.beacon.position.y = ctx.beaconBaseY + Math.sin(now * 0.0011) * 0.12;
          ctx.beacon.rotation.y = now * 0.0005;
        }
      }
      if (ctx.dust && !reducedMotion) ctx.dust.rotation.y = now * 0.00002;

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
      columnTexture?.dispose();
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
    const protectedMaps = new Set<THREE.Texture>();
    if (ctx.glowTexture) protectedMaps.add(ctx.glowTexture);
    if (ctx.columnTexture) protectedMaps.add(ctx.columnTexture);
    clearGroup(ctx.stationsGroup, true, protectedMaps);
    clearGroup(ctx.communityGroup, true, protectedMaps);
    clearGroup(ctx.reportGroup, true, protectedMaps);
    clearGroup(ctx.ringsGroup, true);
    clearGroup(ctx.windGroup, true, protectedMaps);
    ctx.pickables = [];
    ctx.pulseRings = [];
    ctx.wind = null;
    ctx.beacon = null;
    ctx.beaconBaseY = 0;

    if (props.layers.stations) {
      for (const station of props.stations) {
        if (station.lat === null || station.lng === null) continue;
        const point = worldPoint(station.lat, station.lng, props.reportLat, props.reportLng);
        const height = 2.0 + Math.min(1, station.severity) * 4.2;
        const group = new THREE.Group();
        group.position.set(point.x, 0, point.z);

        const pick: PickData = {
          kind: 'station',
          id: station.id,
          label: station.name.replace(/ demo (air monitor|sampling point|stack monitor)/i, ''),
          detail: `${station.headline} · ${Math.round(station.distance_m)} m`,
        };

        const base = new THREE.Mesh(
          new THREE.CylinderGeometry(0.56, 0.66, 0.14, 40),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(station.tone).multiplyScalar(0.58),
            roughness: 0.5,
            metalness: 0.18,
          }),
        );
        base.position.y = 0.07;
        base.castShadow = true;
        base.receiveShadow = true;
        base.userData = pick;
        group.add(base);
        ctx.pickables.push(base);

        const columnMaterial = new THREE.MeshStandardMaterial({
          map: ctx.columnTexture,
          color: station.tone,
          emissive: station.tone,
          emissiveIntensity: 0.14,
          roughness: 0.38,
          metalness: 0.12,
        });
        const column = new THREE.Mesh(new RoundedBoxGeometry(0.52, height, 0.52, 4, 0.09), columnMaterial);
        column.position.y = 0.14 + height / 2;
        column.castShadow = true;
        column.receiveShadow = true;
        column.userData = pick;
        group.add(column);
        ctx.pickables.push(column);

        const cap = new THREE.Mesh(
          new RoundedBoxGeometry(0.64, 0.11, 0.64, 3, 0.05),
          new THREE.MeshStandardMaterial({
            color: 0xf8fffb,
            emissive: station.tone,
            emissiveIntensity: 0.5,
            roughness: 0.28,
            metalness: 0.08,
          }),
        );
        cap.position.y = 0.14 + height + 0.055;
        cap.castShadow = true;
        cap.userData = pick;
        group.add(cap);
        ctx.pickables.push(cap);

        const band = new THREE.Mesh(
          new THREE.RingGeometry(0.31, 0.4, 32),
          new THREE.MeshBasicMaterial({
            color: station.tone,
            transparent: true,
            opacity: 0.55,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        band.rotation.x = -Math.PI / 2;
        band.position.y = 0.14 + height * 0.62;
        group.add(band);

        const pad = new THREE.Mesh(
          new THREE.RingGeometry(0.38, 0.6, 32),
          new THREE.MeshBasicMaterial({ color: station.tone, transparent: true, opacity: 0.34, side: THREE.DoubleSide }),
        );
        pad.rotation.x = -Math.PI / 2;
        pad.position.y = 0.025;
        group.add(pad);
        addGlow(group, ctx.glowTexture, station.tone, 1.45);

        const selected = props.selected.kind === 'station' && props.selected.id === station.id;
        if (selected) {
          const shortDetail = station.headline.startsWith('No ')
            ? 'no recent reading'
            : station.headline.split(' ').slice(1).join(' ');
          const label = makeStationSprite(
            pick.label.replace(/\s+(air monitor|sampling point|stack monitor)$/i, ''),
            shortDetail,
            station.tone,
          );
          if (label) {
            const outward = new THREE.Vector2(point.x, point.z);
            if (outward.lengthSq() > 0.01) outward.normalize().multiplyScalar(0.6);
            const labelBottom = 0.14 + height + 0.72;
            label.position.set(outward.x, labelBottom + 0.25, outward.y);
            group.add(label);
            const leader = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0.14 + height + 0.12, 0),
                new THREE.Vector3(outward.x, labelBottom, outward.y),
              ]),
              new THREE.LineBasicMaterial({ color: station.tone, transparent: true, opacity: 0.45 }),
            );
            group.add(leader);
          }
          columnMaterial.emissiveIntensity = 0.52;
          cap.scale.set(1.15, 1, 1.15);
          (band.material as THREE.MeshBasicMaterial).opacity = 0.8;
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
          new THREE.CylinderGeometry(0.02, 0.02, 0.52, 8),
          new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.55 }),
        );
        stem.position.y = 0.26;
        stem.userData = pick;
        group.add(stem);
        ctx.pickables.push(stem);

        const beaconMaterial = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.9,
          roughness: 0.25,
          metalness: 0.15,
        });
        const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.19, 0), beaconMaterial);
        beacon.position.y = 0.61;
        beacon.scale.y = 1.25;
        beacon.castShadow = true;
        beacon.userData = pick;
        group.add(beacon);
        ctx.pickables.push(beacon);

        const pad = new THREE.Mesh(
          new THREE.RingGeometry(0.18, 0.32, 32),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
        );
        pad.rotation.x = -Math.PI / 2;
        pad.position.y = 0.025;
        group.add(pad);
        addGlow(group, ctx.glowTexture, color, 0.95, 0.61, 0.65);

        const hitTarget = new THREE.Mesh(
          new THREE.CylinderGeometry(0.32, 0.32, 1.05, 8),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        );
        hitTarget.position.y = 0.52;
        hitTarget.userData = pick;
        group.add(hitTarget);
        ctx.pickables.push(hitTarget);

        if (props.selected.kind === 'community' && props.selected.id === report.id) {
          beacon.scale.set(1.4, 1.75, 1.4);
          beaconMaterial.emissiveIntensity = 1.5;
        }
        ctx.communityGroup.add(group);
      }
    }

    // The report beacon is the scene anchor: a luminous core inside a glass
    // sleeve, so the site reads as the source rather than another data column.
    const accentColor = new THREE.Color(props.accent);
    const reportPick: PickData = {
      kind: 'report',
      id: 'report',
      label: 'Report site',
      detail: props.reportRef,
    };

    const reportBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.82, 0.94, 0.14, 64),
      new THREE.MeshStandardMaterial({
        color: accentColor.clone().multiplyScalar(0.72),
        roughness: 0.42,
        metalness: 0.2,
      }),
    );
    reportBase.position.y = 0.07;
    reportBase.castShadow = true;
    reportBase.receiveShadow = true;
    reportBase.userData = reportPick;
    ctx.reportGroup.add(reportBase);
    ctx.pickables.push(reportBase);

    const siteDisc = new THREE.Mesh(
      new THREE.CircleGeometry(2.7, 64),
      new THREE.MeshBasicMaterial({
        color: props.accent,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    siteDisc.rotation.x = -Math.PI / 2;
    siteDisc.position.y = 0.018;
    ctx.reportGroup.add(siteDisc);

    const reportGlass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.5, 3.9, 48),
      new THREE.MeshStandardMaterial({
        color: props.accent,
        emissive: props.accent,
        emissiveIntensity: 0.3,
        roughness: 0.08,
        metalness: 0.16,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    reportGlass.position.y = 2.11;
    reportGlass.userData = reportPick;
    ctx.reportGroup.add(reportGlass);
    ctx.pickables.push(reportGlass);

    const reportCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.14, 4.1, 6),
      new THREE.MeshStandardMaterial({
        color: props.accent,
        emissive: props.accent,
        emissiveIntensity: 1.2,
        roughness: 0.24,
        metalness: 0.22,
      }),
    );
    reportCore.position.y = 2.21;
    reportCore.castShadow = true;
    reportCore.userData = reportPick;
    ctx.reportGroup.add(reportCore);
    ctx.pickables.push(reportCore);

    const reportCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.1, 48),
      new THREE.MeshStandardMaterial({
        color: 0xf8fffb,
        emissive: props.accent,
        emissiveIntensity: 0.85,
        roughness: 0.2,
        metalness: 0.08,
      }),
    );
    reportCap.position.y = 4.17;
    reportCap.castShadow = true;
    reportCap.userData = reportPick;
    ctx.reportGroup.add(reportCap);
    ctx.pickables.push(reportCap);

    for (const ringY of [1.45, 2.85]) {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.43, 0.012, 8, 64),
        new THREE.MeshBasicMaterial({
          color: props.accent,
          transparent: true,
          opacity: 0.38,
          depthWrite: false,
        }),
      );
      band.rotation.x = Math.PI / 2;
      band.position.y = ringY;
      ctx.reportGroup.add(band);
    }

    const beacon = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.26, 0),
      new THREE.MeshStandardMaterial({
        color: 0xfbfffd,
        emissive: props.accent,
        emissiveIntensity: 1.6,
        roughness: 0.18,
        metalness: 0.22,
      }),
    );
    beacon.position.y = 4.85;
    beacon.scale.y = 1.3;
    beacon.userData = reportPick;
    ctx.reportGroup.add(beacon);
    ctx.pickables.push(beacon);
    ctx.beacon = beacon;
    ctx.beaconBaseY = 4.85;

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.34, 5.7, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: props.accent,
        transparent: true,
        opacity: 0.07,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    beam.position.y = 2.9;
    ctx.reportGroup.add(beam);

    const reportLight = new THREE.PointLight(new THREE.Color(props.accent), 2.4, 9);
    reportLight.position.set(0, 3.4, 0);
    ctx.reportGroup.add(reportLight);
    addGlow(ctx.reportGroup, ctx.glowTexture, props.accent, 2.8, 0.06, 0.45);
    addGlow(ctx.reportGroup, ctx.glowTexture, props.accent, 1.7, 4.85, 0.6);

    for (let index = 0; index < 3; index += 1) {
      const pulse = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 0.99, 64),
        new THREE.MeshBasicMaterial({
          color: props.accent,
          transparent: true,
          opacity: 0.28,
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
      const ringSpecs: Array<{ radius: number; label: string | null; labelAt: [number, number] | null }> = [
        { radius: 0.5 * WORLD_KM, label: null, labelAt: null },
        { radius: 1 * WORLD_KM, label: null, labelAt: null },
        { radius: 3 * WORLD_KM, label: '3 km', labelAt: [-0.95, 0.15] },
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
            opacity: spec.radius < 2 ? 0.55 : 0.42,
          }),
        );
        ctx.ringsGroup.add(line);
        if (spec.label && spec.labelAt) {
          const label = makeTextSprite(spec.label, '#45636b');
          if (label) {
            label.position.set(spec.radius * spec.labelAt[0], 0.32, spec.radius * spec.labelAt[1]);
            ctx.ringsGroup.add(label);
          }
        }
      }
    }
    ctx.sweep.visible = props.layers.rings;
    ctx.sweep.children.forEach((child) => {
      const material = (child as THREE.Mesh).material;
      if (material && 'color' in material) (material as THREE.MeshBasicMaterial).color.set(props.accent);
    });

    if (props.layers.wind && props.weather) {
      const radians = (props.weather.wind_direction_deg * Math.PI) / 180;
      const direction = new THREE.Vector3(Math.sin(radians), 0, -Math.cos(radians)).normalize();
      const perpendicular = new THREE.Vector3(-direction.z, 0, direction.x);
      const arrowOrigin = direction.clone().multiplyScalar(-8);
      arrowOrigin.y = 0.45;
      const arrow = new THREE.ArrowHelper(direction, arrowOrigin, 16, new THREE.Color(0x2d7c94), 0.9, 0.55);
      const arrowLineMaterial = arrow.line.material as THREE.LineBasicMaterial;
      arrowLineMaterial.transparent = true;
      arrowLineMaterial.opacity = 0.28;
      const arrowConeMaterial = arrow.cone.material as THREE.MeshBasicMaterial;
      arrowConeMaterial.transparent = true;
      arrowConeMaterial.opacity = 0.44;
      ctx.windGroup.add(arrow);

      const count = 110;
      const positions = new Float32Array(count * 3);
      const offsets = new Float32Array(count);
      const speeds = new Float32Array(count);
      const progress = new Float32Array(count);
      const speedScale = THREE.MathUtils.clamp(props.weather.wind_speed_kmh / 12, 0.45, 1.6);
      for (let index = 0; index < count; index += 1) {
        offsets[index] = (Math.random() - 0.5) * 2.6;
        speeds[index] = (0.055 + Math.random() * 0.06) * speedScale;
        progress[index] = Math.random();
        const along = progress[index] * 16 - 8;
        positions[index * 3] = direction.x * along + perpendicular.x * offsets[index];
        positions[index * 3 + 1] = 0.35 + Math.random() * 0.4;
        positions[index * 3 + 2] = direction.z * along + perpendicular.z * offsets[index];
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          map: ctx.glowTexture,
          color: 0x2d7c94,
          size: 0.2,
          transparent: true,
          opacity: 0.62,
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
    const selectionMaterial = ctx.selectionRing.material as THREE.MeshBasicMaterial;
    selectionMaterial.color.set(props.selected.kind === 'report' ? 0x173d4a : props.accent);
    selectionMaterial.opacity = props.selected.kind === 'report' ? 0.55 : 0.9;
    ctx.renderer.shadowMap.needsUpdate = true;
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
      aria-label="Interactive WebGL 3D site analysis. Taller columns indicate stronger monitor signals. Drag to orbit, use arrow keys to rotate, plus or minus to zoom. Click a column or pin to inspect it."
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
