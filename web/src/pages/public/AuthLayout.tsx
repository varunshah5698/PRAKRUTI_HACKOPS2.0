import { Link } from 'react-router-dom';
import { ArrowLeft, Droplets, Eye, MapPin, Sun, Wind } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { PublicBadge } from '../../components/ui';

const AQI = 132;
const AQI_MAX = 300;
const markerAngle = Math.PI - (AQI / AQI_MAX) * Math.PI;
const marker = { x: 112 + 88 * Math.cos(markerAngle), y: 112 - 88 * Math.sin(markerAngle) };

const pollutants = [
  { label: 'PM2.5', value: '69.7', unit: 'µg/m³', width: '72%' },
  { label: 'NO₂', value: '41', unit: 'ppb', width: '38%' },
  { label: 'O₃', value: '0.064', unit: 'ppm', width: '48%' },
];

const conditions = [
  { icon: Droplets, label: 'Humidity', value: '74%' },
  { icon: Wind, label: 'Wind', value: '12 km/h' },
  { icon: Eye, label: 'Visibility', value: '5 km' },
];

export function AuthLayout({ children, title, subtitle }: { children: React.ReactNode; title: React.ReactNode; subtitle: string }) {
  return (
    <div className="auth-sky relative flex min-h-screen flex-col overflow-hidden">
      <header className="relative z-20 mx-auto flex w-full max-w-[1320px] items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <Link
          to="/"
          className="glass-pill inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-[11px] font-semibold text-ink/60 transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back<span className="hidden sm:inline"> to home</span>
        </Link>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[1320px] flex-1 items-center px-4 pb-6 pt-2 sm:px-8 lg:pb-10">
        <div className="grid w-full overflow-hidden rounded-[30px] border border-white/80 bg-white/45 shadow-frame backdrop-blur-2xl lg:grid-cols-[1.02fr_0.98fr] lg:rounded-[36px]">
          <section className="relative flex min-w-0 flex-col bg-[#fbfcf8]/95 px-6 py-8 sm:px-10 lg:px-14 lg:py-10">
            <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center">
              <PublicBadge tone="soft" className="self-start">प्रकृति access</PublicBadge>
              <h1 className="display mt-5 text-[clamp(26px,9.2vw,42px)] font-bold leading-[0.98]">{title}</h1>
              <p className="mt-3.5 text-[13px] leading-relaxed text-ink/50 sm:text-sm">{subtitle}</p>
              <div className="mt-7">{children}</div>
            </div>
            <p className="mx-auto mt-7 w-full max-w-[440px] text-[10px] leading-relaxed text-ink/35">
              Demonstration deployment · Station observations are simulation-labelled · CPCB not connected ·{' '}
              <Link to="/privacy" className="underline underline-offset-2 hover:text-ink/60">Privacy</Link> ·{' '}
              <Link to="/terms" className="underline underline-offset-2 hover:text-ink/60">Terms</Link>
            </p>
          </section>

          <section className="auth-scene relative hidden min-w-0 overflow-hidden px-8 py-8 lg:flex lg:flex-col xl:px-10 xl:py-10">
            <div className="relative z-10 flex h-full flex-col">
              <div className="flex items-center justify-between">
                <PublicBadge tone="lime">Mumbai intelligence</PublicBadge>
                <span className="inline-flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#5f7065]">
                  <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-[#5da341]" /> Demo environment
                </span>
              </div>

              <div className="mt-9 flex flex-1 flex-col justify-center gap-4">
                <div className="rounded-[26px] border border-white/80 bg-white/65 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_28px_60px_-44px_rgba(23,42,29,.6)] backdrop-blur-xl">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink/35">Current conditions</p>
                      <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-ink/70">
                        <MapPin className="h-3.5 w-3.5 text-ink/35" /> Bandra, Mumbai
                      </p>
                    </div>
                    <span className="rounded-full border border-white/90 bg-white/70 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-ink/40">
                      Simulation
                    </span>
                  </div>
                  <div className="mt-6 flex items-end justify-between gap-4">
                    <div>
                      <p className="display text-[62px] font-bold leading-[0.82] tracking-[-0.05em] text-ink">
                        29<span className="align-top text-[28px]">°</span>
                      </p>
                      <p className="mt-2.5 text-[11px] text-ink/45">Partly cloudy · H 32° L 25°</p>
                    </div>
                    <Sun
                      className="mb-1 h-14 w-14 shrink-0 text-[#e0b02a] drop-shadow-[0_0_22px_rgba(255,214,110,.55)]"
                      strokeWidth={1.25}
                      aria-hidden
                    />
                  </div>
                </div>

                <div className="rounded-[26px] border border-white/80 bg-white/65 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_28px_60px_-44px_rgba(23,42,29,.6)] backdrop-blur-xl">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink/35">Air quality</p>
                      <p className="mt-1.5 text-xs font-semibold text-ink/70">CPCB index · 24h screening</p>
                    </div>
                    <span className="rounded-full border border-[#eddeae] bg-[#fdf5df] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-[#8a6710]">
                      Moderate
                    </span>
                  </div>

                  <svg viewBox="0 0 224 132" className="mx-auto mt-3 w-full max-w-[264px]" role="img" aria-label={`CPCB air quality index ${AQI}, moderate`}>
                    <defs>
                      <linearGradient id="auth-aqi" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#4da42a" />
                        <stop offset="44%" stopColor="#c6c02a" />
                        <stop offset="73%" stopColor="#cf7227" />
                        <stop offset="100%" stopColor="#c94a50" />
                      </linearGradient>
                    </defs>
                    <path d="M24 112 A88 88 0 0 1 200 112" fill="none" stroke="#dfe7da" strokeWidth="10" strokeLinecap="round" />
                    <path d="M24 112 A88 88 0 0 1 200 112" fill="none" stroke="url(#auth-aqi)" strokeWidth="10" strokeLinecap="round" opacity="0.9" />
                    <circle cx={marker.x} cy={marker.y} r="7" fill="#111310" stroke="#ffffff" strokeWidth="3" />
                    <text x="112" y="94" textAnchor="middle" fill="#111310" fontFamily="'Space Grotesk Variable', Inter, sans-serif" fontSize="34" fontWeight="700" letterSpacing="-1">132</text>
                    <text x="112" y="110" textAnchor="middle" fill="#8a6710" fontFamily="Inter, sans-serif" fontSize="8.5" fontWeight="700" letterSpacing="1.4">MODERATE</text>
                    <text x="24" y="127" textAnchor="middle" fill="#728176" fontFamily="Inter, sans-serif" fontSize="8">0</text>
                    <text x="200" y="127" textAnchor="middle" fill="#728176" fontFamily="Inter, sans-serif" fontSize="8">300+</text>
                  </svg>

                  <div className="mt-1 grid gap-2.5">
                    {pollutants.map((pollutant) => (
                      <div key={pollutant.label}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[10px] font-semibold text-ink/60">{pollutant.label}</span>
                          <span className="font-mono text-[10px] text-ink/40">
                            {pollutant.value} <span className="text-[8px] tracking-[0.04em]">{pollutant.unit}</span>
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#68a93a] via-[#c6c02a] to-[#d08535]"
                            style={{ width: pollutant.width }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2.5">
                {conditions.map(({ icon: Icon, label, value }) => (
                  <div key={label} className="rounded-2xl border border-white/70 bg-white/45 px-3 py-3 backdrop-blur">
                    <Icon className="h-3.5 w-3.5 text-[#4e8a3b]" aria-hidden />
                    <p className="mt-2 display text-[17px] font-semibold leading-none text-ink">{value}</p>
                    <p className="mt-1 text-[9px] uppercase tracking-[0.1em] text-ink/35">{label}</p>
                  </div>
                ))}
              </div>

              <p className="mt-4 text-[9px] leading-relaxed text-ink/35">
                Simulation-labelled observations · Forecasts are decision support, not confirmed future conditions.
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
