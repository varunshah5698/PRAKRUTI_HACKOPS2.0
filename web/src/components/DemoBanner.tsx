import { Link } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';

export function DemoBanner({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#b5e36b]/15 bg-[#b5e36b]/[0.045] px-4 py-2 text-[10px] text-[#c6d0da] lg:px-6">
      <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.12em] text-[#b5e36b]">
        <FlaskConical className="h-3 w-3" /> Demo mode
      </span>
      <span className="text-[#8d99a6]">
        Synthetic demo records are labelled SIMULATION DATA. Weather and CAMS context are live/modelled. Check the source registry for CPCB/MPCB and other integrations.
      </span>
      {!compact ? (
        <Link to="/data-sources" className="ml-auto font-semibold text-[#b5e36b] underline-offset-2 hover:underline">
          Source status
        </Link>
      ) : null}
    </div>
  );
}
