import { useId } from 'react';
import { classNames } from '../lib/format';
import type { WeatherMood } from '../lib/weather';

interface ScenePalette {
  skyTop: string;
  skyBottom: string;
  haze: string;
  sun: string;
  sunGlow: string;
  cloud: string;
  cloudShade: string;
  farCity: string;
  nearCity: string;
  window: string;
  seaTop: string;
  seaBottom: string;
  wave: string;
  land: string;
  stone: string;
  stoneShade: string;
  rain: string;
  accent: string;
}

const CLEAR: ScenePalette = {
  skyTop: '#fff7df',
  skyBottom: '#e6f1e5',
  haze: '#ffffff',
  sun: '#f2c45b',
  sunGlow: '#f7d98b',
  cloud: '#ffffff',
  cloudShade: '#d7e4da',
  farCity: '#aec4b6',
  nearCity: '#5d7d6d',
  window: '#efd58c',
  seaTop: '#b6d9d0',
  seaBottom: '#8cc2b6',
  wave: '#e8f6f1',
  land: '#2f4a3e',
  stone: '#f7f2e3',
  stoneShade: '#d8d0bb',
  rain: '#d7e8eb',
  accent: '#b9ff66',
};

const HUMID: ScenePalette = {
  ...CLEAR,
  skyTop: '#eff8f2',
  skyBottom: '#d5e9e1',
  sun: '#f0d78e',
  sunGlow: '#f7e8ba',
  cloudShade: '#cfe1d7',
  farCity: '#a9c3b4',
  nearCity: '#55796a',
  seaTop: '#a6cec4',
  seaBottom: '#7bb5a9',
};

const RAIN: ScenePalette = {
  ...CLEAR,
  skyTop: '#dde9eb',
  skyBottom: '#c5d8dc',
  haze: '#eef6f7',
  sun: '#e8f0f1',
  sunGlow: '#eef6f7',
  cloud: '#a8bcc2',
  cloudShade: '#8aa2a9',
  farCity: '#93acb1',
  nearCity: '#4f6b70',
  window: '#e8d8a2',
  seaTop: '#9cbbc0',
  seaBottom: '#759ca2',
  wave: '#d5e8ea',
  land: '#334d52',
  stone: '#efece0',
  stoneShade: '#cbc4b4',
  rain: '#f4fbfc',
};

const NIGHT: ScenePalette = {
  skyTop: '#172a3a',
  skyBottom: '#2d4a56',
  haze: '#6d8f96',
  sun: '#f6e7b4',
  sunGlow: '#f6e7b4',
  cloud: '#3b5660',
  cloudShade: '#2a424b',
  farCity: '#203842',
  nearCity: '#12262f',
  window: '#ffd27a',
  seaTop: '#244752',
  seaBottom: '#15323c',
  wave: '#5b8b8e',
  land: '#0d1e24',
  stone: '#e9e1ca',
  stoneShade: '#c7bea5',
  rain: '#7fa6ad',
  accent: '#b9ff66',
};

const MARINE_BUILDINGS = [
  { x: 188, y: 84, w: 13, h: 28 },
  { x: 204, y: 78, w: 11, h: 34 },
  { x: 218, y: 82, w: 15, h: 30 },
  { x: 236, y: 74, w: 10, h: 38 },
  { x: 249, y: 80, w: 16, h: 32 },
  { x: 268, y: 72, w: 12, h: 40 },
  { x: 283, y: 78, w: 14, h: 34 },
  { x: 300, y: 74, w: 16, h: 38 },
];

const STARS = [
  [28, 22], [54, 42], [82, 18], [110, 34], [136, 16], [166, 40],
  [194, 24], [218, 46], [286, 20], [304, 38], [72, 58], [148, 54],
];

function Cloud({
  x,
  y,
  scale = 1,
  fill,
  shade,
  opacity = 1,
}: {
  x: number;
  y: number;
  scale?: number;
  fill: string;
  shade: string;
  opacity?: number;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>
      <ellipse cx="0" cy="0" rx="18" ry="8" fill={fill} />
      <ellipse cx="12" cy="-6" rx="12" ry="8" fill={fill} />
      <ellipse cx="-10" cy="-4" rx="10" ry="7" fill={fill} />
      <rect x="-18" y="-1" width="38" height="9" rx="4.5" fill={fill} />
      <rect x="-16" y="6" width="34" height="2" rx="1" fill={shade} opacity=".35" />
    </g>
  );
}

export function MumbaiWeatherScene({
  mood,
  night = false,
  className,
}: {
  mood: WeatherMood;
  night?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const skyId = `mumbai-sky-${uid}`;
  const seaId = `mumbai-sea-${uid}`;
  const glowId = `mumbai-glow-${uid}`;
  const hazeId = `mumbai-haze-${uid}`;
  const waveId = `mumbai-wave-${uid}`;

  const palette = night ? NIGHT : mood === 'rain' ? RAIN : mood === 'humid' ? HUMID : CLEAR;
  const rainy = mood === 'rain';
  const cloudy = rainy || mood === 'humid';
  const windy = mood === 'windy';

  return (
    <div
      className={classNames('relative overflow-hidden rounded-[18px] border border-white/60', className)}
      style={{ backgroundColor: palette.skyTop }}
    >
      <svg
        viewBox="0 0 320 140"
        preserveAspectRatio="xMidYMax meet"
        className="absolute inset-x-0 bottom-0 w-full"
        role="img"
        aria-label={`Illustrated Mumbai waterfront with ${rainy ? 'rain' : mood === 'humid' ? 'humid haze' : night ? 'a moonlit sky' : 'clear skies'}`}
      >
        <defs>
          <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.skyTop} />
            <stop offset="100%" stopColor={palette.skyBottom} />
          </linearGradient>
          <linearGradient id={seaId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.seaTop} />
            <stop offset="100%" stopColor={palette.seaBottom} />
          </linearGradient>
          <radialGradient id={glowId}>
            <stop offset="0%" stopColor={palette.sunGlow} stopOpacity=".8" />
            <stop offset="100%" stopColor={palette.sunGlow} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={hazeId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.haze} stopOpacity="0" />
            <stop offset="100%" stopColor={palette.haze} stopOpacity=".55" />
          </linearGradient>
          <pattern id={waveId} width="40" height="10" patternUnits="userSpaceOnUse">
            <path
              d="M0 5c5 0 5-2 10-2s5 2 10 2 5-2 10-2 5 2 10 2"
              fill="none"
              stroke={palette.wave}
              strokeWidth="1"
              strokeLinecap="round"
            />
          </pattern>
        </defs>

        <rect width="320" height="140" fill={`url(#${skyId})`} />

        {night ? (
          <g fill={palette.sun} opacity=".65">
            {STARS.map(([x, y], index) => (
              <circle key={index} cx={x} cy={y} r={index % 3 === 0 ? 1.2 : 0.8} />
            ))}
          </g>
        ) : null}

        {rainy ? (
          <circle cx="254" cy="38" r="34" fill={`url(#${glowId})`} opacity=".3" />
        ) : (
          <g>
            <circle cx="254" cy="38" r="34" fill={`url(#${glowId})`} />
            <circle cx="254" cy="38" r="14.5" fill={palette.sun} />
            {night ? (
              <g fill={palette.stoneShade} opacity=".3">
                <circle cx="249" cy="34" r="2.4" />
                <circle cx="258" cy="42" r="1.7" />
                <circle cx="255" cy="31" r="1.2" />
              </g>
            ) : null}
          </g>
        )}

        {cloudy ? (
          <>
            <Cloud x={72} y={34} scale={rainy ? 1.05 : 0.9} fill={palette.cloud} shade={palette.cloudShade} opacity={night ? 0.45 : 0.9} />
            <Cloud x={164} y={26} scale={rainy ? 0.8 : 0.65} fill={palette.cloud} shade={palette.cloudShade} opacity={night ? 0.35 : 0.7} />
            {rainy ? <Cloud x={238} y={30} scale={0.9} fill={palette.cloud} shade={palette.cloudShade} opacity={night ? 0.5 : 0.95} /> : null}
          </>
        ) : (
          <Cloud x={94} y={34} scale={0.65} fill={palette.cloud} shade={palette.cloudShade} opacity={night ? 0.25 : 0.65} />
        )}

        {!rainy ? (
          <g stroke={palette.nearCity} strokeWidth="1.1" fill="none" strokeLinecap="round" opacity=".45">
            <path d="M92 52c3-3 6-3 9 0M106 58c2-2 4-2 6 0" />
          </g>
        ) : null}

        {windy ? (
          <g stroke={palette.wave} strokeWidth="1.2" fill="none" strokeLinecap="round" opacity=".5">
            <path d="M26 54c14-6 26-6 40 0M18 64c18-7 34-7 52 0M40 74c10-4 20-4 30 0" />
          </g>
        ) : null}

        <g fill={palette.farCity} opacity={night ? 0.9 : 0.52}>
          <rect x="0" y="96" width="20" height="12" />
          <rect x="22" y="88" width="10" height="20" />
          <rect x="34" y="92" width="16" height="16" />
          <rect x="52" y="84" width="8" height="24" />
          <rect x="62" y="94" width="22" height="14" />
          <path d="M90 108V94a7 7 0 0 1 14 0v14Z" />
          <rect x="110" y="90" width="12" height="18" />
          <rect x="124" y="82" width="8" height="26" />
          <rect x="127" y="76" width="2" height="6" />
          <rect x="134" y="94" width="18" height="14" />
          <rect x="154" y="88" width="10" height="20" />
          <rect x="166" y="96" width="14" height="12" />
        </g>

        <rect x="0" y="96" width="320" height="14" fill={`url(#${hazeId})`} />
        <rect x="0" y="108" width="320" height="32" fill={`url(#${seaId})`} />
        <rect x="0" y="108" width="320" height="1.5" fill={palette.haze} opacity=".45" />

        <g fill={palette.sun} opacity={night ? 0.26 : 0.42}>
          <rect x="247" y="113" width="14" height="1.8" rx=".9" />
          <rect x="243" y="118" width="22" height="1.8" rx=".9" />
          <rect x="249" y="123" width="10" height="1.8" rx=".9" />
          <rect x="245" y="129" width="18" height="1.8" rx=".9" />
        </g>

        <rect x="0" y="114" width="320" height="10" fill={`url(#${waveId})`} opacity=".55" />
        <rect x="0" y="124" width="320" height="10" fill={`url(#${waveId})`} opacity=".32" transform="translate(12 0)" />

        <g transform="translate(116 112)">
          <path d="M0 10h22l-4 5H4Z" fill={palette.nearCity} opacity=".85" />
          <path d="M11 10V0l9 8Z" fill={palette.stone} opacity=".95" />
          <path d="M10 10V3L3 9Z" fill={palette.stoneShade} opacity=".9" />
        </g>
        <g transform="translate(158 122) scale(.7)">
          <path d="M0 10h22l-4 5H4Z" fill={palette.nearCity} opacity=".75" />
          <path d="M11 10V0l9 8Z" fill={palette.stone} opacity=".9" />
          <path d="M10 10V3L3 9Z" fill={palette.stoneShade} opacity=".85" />
        </g>

        <g>
          {MARINE_BUILDINGS.map((building, index) => (
            <g key={index}>
              <rect
                x={building.x}
                y={building.y}
                width={building.w}
                height={building.h}
                rx="1"
                fill={palette.nearCity}
                opacity={night ? 0.96 : 0.84}
              />
              <rect
                x={building.x + 2}
                y={building.y - 4}
                width={Math.max(3, building.w - 4)}
                height="4"
                rx=".5"
                fill={palette.nearCity}
                opacity={night ? 0.96 : 0.84}
              />
              {index === 5 ? (
                <>
                  <path d={`M${building.x + building.w / 2 - 4} ${building.y - 4}a4 4 0 0 1 8 0Z`} fill={palette.nearCity} />
                  <rect x={building.x + building.w / 2 - 0.5} y={building.y - 12} width="1" height="8" fill={palette.nearCity} />
                </>
              ) : null}
              {[0, 1].map((row) =>
                [0, 1].map((column) => (
                  <rect
                    key={`${row}-${column}`}
                    x={building.x + 3 + column * Math.max(4, building.w - 7)}
                    y={building.y + 6 + row * 10}
                    width="2"
                    height="3"
                    rx=".5"
                    fill={palette.window}
                    opacity={night ? 0.9 : 0.42}
                  />
                )),
              )}
            </g>
          ))}
        </g>

        <path
          d="M176 123C222 116 270 107 320 104"
          fill="none"
          stroke={palette.stone}
          strokeWidth="2.2"
          strokeLinecap="round"
          opacity=".9"
        />
        <path
          d="M176 125C222 118 270 109 320 106"
          fill="none"
          stroke={palette.stoneShade}
          strokeWidth="1"
          strokeLinecap="round"
          opacity=".5"
        />
        {night ? (
          <g fill={palette.window}>
            <circle cx="190" cy="120" r="1.1" />
            <circle cx="210" cy="117" r="1.1" />
            <circle cx="230" cy="114" r="1.1" />
            <circle cx="250" cy="111" r="1.1" />
            <circle cx="270" cy="108.5" r="1.1" />
            <circle cx="292" cy="106" r="1.1" />
            <circle cx="312" cy="104.5" r="1.1" />
          </g>
        ) : null}

        <g>
          <path
            d="M0 140V124c8-4 20-6 34-6 16 0 30 2 42 7 5 2 8 5 9 9v6H0Z"
            fill={palette.land}
          />
          <g fill={palette.stone}>
            <rect x="20" y="66" width="9" height="58" rx="1" />
            <rect x="61" y="66" width="9" height="58" rx="1" />
            <circle cx="24.5" cy="64" r="4.5" />
            <circle cx="65.5" cy="64" r="4.5" />
            <rect x="23" y="56" width="3" height="8" />
            <rect x="64" y="56" width="3" height="8" />
            <path
              fillRule="evenodd"
              d="M24 124V84h40v40H24Z M36 124V102a8 8 0 0 1 16 0v22H36Z"
            />
            <rect x="34" y="78" width="20" height="6" rx="1" />
            <path d="M38 78a6 6 0 0 1 12 0Z" />
          </g>
          <rect x="56" y="84" width="8" height="40" fill={palette.stoneShade} opacity=".32" />
          <g fill={palette.stoneShade} opacity=".55">
            <rect x="27" y="92" width="4" height="6" rx="1" />
            <rect x="59" y="92" width="4" height="6" rx="1" />
          </g>
          <path d="M44 72v-7" stroke={palette.stone} strokeWidth="1.2" />
          <path d="M44 65l8 3-8 3Z" fill={palette.accent} />
        </g>

        {rainy ? (
          <g stroke={palette.rain} strokeWidth="1" strokeLinecap="round" opacity=".6">
            {Array.from({ length: 22 }, (_, index) => {
              const x = (index * 47 + 13) % 320;
              const y = 18 + ((index * 29) % 92);
              return <line key={index} x1={x} y1={y} x2={x - 2.5} y2={y + 9} />;
            })}
          </g>
        ) : null}

        {night ? <ellipse cx="246" cy="108" rx="82" ry="18" fill={palette.window} opacity=".07" /> : null}
      </svg>
    </div>
  );
}
