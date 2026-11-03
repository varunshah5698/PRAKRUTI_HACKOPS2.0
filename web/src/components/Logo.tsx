import { Link } from 'react-router-dom';
import { classNames } from '../lib/format';

export function LogoGlyph({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="24" cy="5.5" r="4" fill="#b9ff66" />
      <path d="M7 25V9M25 25V9" stroke="#f3f7ec" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M3 23h26" stroke="#f3f7ec" strokeWidth="2.4" strokeLinecap="round" />
      <path
        d="M7 9 3 23M7 9l4 14M7 9l9 14M25 9l4 14M25 9l-4 14M25 9l-9 14"
        stroke="#f3f7ec"
        strokeWidth=".85"
        opacity=".65"
      />
      <path
        d="M4 27.2c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1 2 1 4 1"
        fill="none"
        stroke="#5fc7b6"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M8 29.4c1.5 0 1.5-.8 3-.8s1.5.8 3 .8 1.5-.8 3-.8 1.5.8 3 .8 1.5-.8 3-.8 1.5.8 3 .8"
        fill="none"
        stroke="#5fc7b6"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity=".55"
      />
    </svg>
  );
}

export function Logo({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  return (
    <Link to="/" className={classNames('group inline-flex items-center gap-2.5', dark ? 'text-white' : 'text-ink')}>
      <span
        className={classNames(
          'relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-xl border transition-transform duration-200 group-hover:-translate-y-0.5',
          dark ? 'border-[#3b4550] bg-[#1d242c]' : 'border-ink/15 bg-ink',
        )}
      >
        <LogoGlyph />
      </span>
      {!compact ? (
        <span className="flex flex-col leading-none">
          <span className="display text-[22px] font-bold leading-none tracking-[-0.02em]">प्रकृति</span>
          <span
            className={classNames(
              'mt-0.5 text-[9px] font-semibold uppercase tracking-[0.16em]',
              dark ? 'text-[#788493]' : 'text-ink/45',
            )}
          >
            Mumbai · Environmental intelligence
          </span>
        </span>
      ) : null}
    </Link>
  );
}
