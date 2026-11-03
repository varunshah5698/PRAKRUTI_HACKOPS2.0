import { Link } from 'react-router-dom';
import { classNames } from '../lib/format';

export function Logo({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  return (
    <Link to="/" className={classNames('group inline-flex items-center gap-2.5', dark ? 'text-white' : 'text-ink')}>
      <span className={classNames('relative flex h-8 w-8 items-center justify-center rounded-xl border', dark ? 'border-[#3b4550] bg-[#1d242c]' : 'border-ink/15 bg-ink')}>
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" aria-hidden>
          <path d="M3 13h4l2-6 3.5 12 2.5-8 2 2h4" fill="none" stroke={dark ? '#b5e36b' : '#b9ff66'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {!compact ? (
        <span className="flex flex-col leading-none">
          <span className="display text-[22px] font-bold leading-none tracking-[-0.02em]">प्रकृति</span>
          <span className={classNames('mt-0.5 text-[9px] font-semibold uppercase tracking-[0.19em]', dark ? 'text-[#788493]' : 'text-ink/45')}>
            Environmental intelligence
          </span>
        </span>
      ) : null}
    </Link>
  );
}
