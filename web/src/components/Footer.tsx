import { Link } from 'react-router-dom';
import { Logo } from './Logo';

export function Footer() {
  return (
    <footer className="border-t border-ink/10 bg-[#f1f4ec] text-ink">
      <div className="mx-auto grid max-w-[1440px] gap-12 px-5 py-14 lg:grid-cols-[1.2fr_1fr_1fr_1fr] lg:px-10">
        <div>
          <Logo />
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-ink/55">
            Environmental intelligence, prediction and compliance workflows for Greater Mumbai. Built to separate observed
            facts, forecasts, reports and official determinations.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.1em] text-ink/45">
            <span className="rounded-full border border-ink/12 bg-white/45 px-2.5 py-1">Source-labelled data</span>
            <span className="rounded-full border border-ink/12 bg-white/45 px-2.5 py-1">No paywall</span>
          </div>
        </div>
        <div>
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#3f7d2a]">Platform</p>
          <ul className="space-y-2.5 text-sm text-ink/55">
            <li><Link to="/dashboard" className="hover:text-ink">Command centre</Link></li>
            <li><Link to="/map" className="hover:text-ink">Mumbai intelligence map</Link></li>
            <li><Link to="/intelligence/predictions" className="hover:text-ink">Predictive intelligence</Link></li>
            <li><Link to="/ai-analyst" className="hover:text-ink">AI analyst</Link></li>
            <li><Link to="/report" className="hover:text-ink">Report a concern</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#3f7d2a]">Information</p>
          <ul className="space-y-2.5 text-sm text-ink/55">
            <li><Link to="/about" className="hover:text-ink">About</Link></li>
            <li><Link to="/data-sources" className="hover:text-ink">Data sources</Link></li>
            <li><Link to="/privacy" className="hover:text-ink">Privacy</Link></li>
            <li><Link to="/terms" className="hover:text-ink">Terms</Link></li>
            <li><a href="mailto:contact@enviropulse.local" className="hover:text-ink">Contact</a></li>
          </ul>
        </div>
        <div>
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#3f7d2a]">Source attribution</p>
          <ul className="space-y-2.5 text-xs leading-relaxed text-ink/45">
            <li>OpenFreeMap · © OpenMapTiles</li>
            <li>Map data © OpenStreetMap contributors (ODbL 1.0)</li>
            <li>Weather data by Open-Meteo (CC BY 4.0)</li>
            <li>CAMS atmospheric model via Open-Meteo</li>
            <li>CPCB and MPCB: not configured in this deployment</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-ink/10">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-5 py-5 text-[11px] text-ink/35 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <p>© {new Date().getFullYear()} प्रकृति. Environmental intelligence platform.</p>
          <p>Automated assessments assist human decisions. They are not official regulatory determinations.</p>
        </div>
      </div>
    </footer>
  );
}
