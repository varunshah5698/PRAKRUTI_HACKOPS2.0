import { Link } from 'react-router-dom';
import { Activity, ArrowLeft, CloudSun, MapPinned, ShieldCheck, Wind } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { PublicBadge } from '../../components/ui';

export function AuthLayout({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="grid min-h-screen bg-paper lg:grid-cols-[1.05fr_0.95fr]">
      <div className="flex flex-col px-5 py-6 sm:px-10 lg:px-16">
        <div className="flex items-center justify-between">
          <Logo />
          <Link to="/" className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink/50 hover:text-ink">
            <ArrowLeft className="h-3.5 w-3.5" /> Home
          </Link>
        </div>
        <div className="flex flex-1 items-center py-10">
          <div className="w-full max-w-[460px]">
            <PublicBadge tone="soft">प्रकृति access</PublicBadge>
            <h1 className="display mt-4 text-[38px] font-bold leading-[0.98] sm:text-[46px]">{title}</h1>
            <p className="mt-3 text-sm leading-relaxed text-ink/55">{subtitle}</p>
            <div className="mt-8">{children}</div>
          </div>
        </div>
        <p className="text-[10px] text-ink/35">
          Demonstration deployment · Station observations are simulation-labelled · CPCB not connected ·{' '}
          <Link to="/privacy" className="underline">Privacy</Link> · <Link to="/terms" className="underline">Terms</Link>
        </p>
      </div>

      <div className="relative hidden overflow-hidden border-l border-white/70 bg-[#e6eee3] lg:block">
        <div className="absolute inset-0 bg-gradient-to-br from-[#f2f7ef] via-[#e6eee3] to-[#d9e6d6]" />
        <div className="absolute -left-20 top-16 h-80 w-80 rounded-full bg-white/75 blur-[70px]" />
        <div className="absolute -right-10 bottom-10 h-96 w-96 rounded-full bg-[#cfe4c4]/70 blur-[90px]" />
        <div className="absolute left-1/3 top-1/3 h-64 w-64 rounded-full bg-white/55 blur-[80px]" />
        <div className="noise absolute inset-0 opacity-20" />

        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center justify-between">
            <PublicBadge tone="lime">Mumbai intelligence</PublicBadge>
            <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#74847a]">
              <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-[#5da341]" /> Demo environment
            </span>
          </div>

          <div className="relative">
            <svg viewBox="0 0 620 500" className="w-full" aria-hidden>
              <defs>
                <pattern id="grid" width="34" height="34" patternUnits="userSpaceOnUse">
                  <path d="M 34 0 L 0 0 0 34" fill="none" stroke="rgba(20,32,22,0.06)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="620" height="500" fill="url(#grid)" />
              <path
                d="M94 330c36-42 54-90 92-112s82-8 116-38 70-62 120-42 58 74 96 96 54 32 62 66-24 76-64 94-88 22-132 12-66-28-112-18-88 18-124-2-64-22-54-56Z"
                fill="rgba(78,155,63,0.08)"
                stroke="rgba(78,155,63,0.5)"
                strokeWidth="1.5"
              />
              <path d="M140 356c60-30 100-20 146-58s64-54 116-58 78 18 108 6" fill="none" stroke="rgba(20,32,22,0.2)" strokeWidth="1" strokeDasharray="4 5" />
              <path d="M172 260c38 14 60 8 96 30s52 44 94 42 56-22 92-20" fill="none" stroke="rgba(20,32,22,0.12)" strokeWidth="1" />
              {[
                [220, 300, '#4e9b3f', 'Worli'],
                [320, 244, '#2f8f84', 'Bandra'],
                [410, 286, '#b3860f', 'Chembur'],
                [286, 358, '#cf7227', 'Mahim'],
                [480, 350, '#c94a50', 'Powai'],
              ].map(([x, y, color, label]) => (
                <g key={String(label)}>
                  <circle cx={Number(x)} cy={Number(y)} r="18" fill={String(color)} opacity="0.14" />
                  <circle cx={Number(x)} cy={Number(y)} r="4.5" fill={String(color)} stroke="#ffffff" strokeWidth="1.5" />
                  <text x={Number(x) + 12} y={Number(y) + 4} fill="rgba(20,32,22,0.58)" fontSize="10" fontFamily="Inter, sans-serif">{String(label)}</text>
                </g>
              ))}
              <g transform="translate(90, 90)">
                <rect width="230" height="82" rx="14" fill="rgba(255,255,255,0.84)" stroke="rgba(255,255,255,0.95)" />
                <text x="16" y="25" fill="#6d7d72" fontSize="9" letterSpacing="1.4" fontFamily="Inter, sans-serif">CHEMBUR · PM2.5</text>
                <text x="16" y="52" fill="#142016" fontSize="22" fontWeight="700" fontFamily="Space Grotesk, sans-serif">69.7 µg/m³</text>
                <text x="16" y="68" fill="#b3860f" fontSize="9" fontFamily="Inter, sans-serif">SIMULATION · 24H SCREENING</text>
              </g>
              <g transform="translate(360, 92)">
                <rect width="170" height="58" rx="12" fill="rgba(253,245,223,0.9)" stroke="rgba(237,222,174,1)" />
                <text x="14" y="23" fill="#6d7d72" fontSize="9" letterSpacing="1.2" fontFamily="Inter, sans-serif">CPCB CONNECTOR</text>
                <text x="14" y="42" fill="#8a6710" fontSize="11" fontWeight="600" fontFamily="Inter, sans-serif">NOT CONFIGURED</text>
              </g>
            </svg>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              [MapPinned, 'Mumbai only', 'Validated boundary'],
              [CloudSun, 'Live weather', 'Open-Meteo'],
              [ShieldCheck, 'Audited', 'Every transition'],
            ].map(([Icon, title, copy]) => {
              const Component = Icon as typeof MapPinned;
              return (
                <div key={String(title)} className="rounded-2xl border border-white/80 bg-white/45 p-3 shadow-pill backdrop-blur">
                  <Component className="h-4 w-4 text-[#3f7d2a]" />
                  <p className="mt-2 text-[11px] font-semibold text-[#223328]">{String(title)}</p>
                  <p className="mt-0.5 text-[9px] uppercase tracking-[0.08em] text-[#74847a]">{String(copy)}</p>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-[#74847a]">
            <Wind className="h-3.5 w-3.5" /> Forecasts are decision support, not confirmed future conditions.
            <Activity className="ml-auto h-3.5 w-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
}
