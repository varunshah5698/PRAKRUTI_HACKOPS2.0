import { Link } from 'react-router-dom';
import { classNames } from '../lib/format';

export function Logo({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  return (
    <Link to="/" className={classNames('group inline-flex items-center gap-2.5', dark ? 'text-white' : 'text-ink')}>
      <span
        className={classNames(
          'relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-xl border transition-transform duration-200 group-hover:-translate-y-0.5',
          dark ? 'border-[#3b4550] bg-[#1d242c]' : 'border-ink/15 bg-ink',
        )}
      >
        <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden>
          <circle cx="23.4" cy="9.2" r="4.1" fill="#b9ff66" />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M7.2 24.4v-8.2c0-.5.2-.9.5-1.3l1.4-1.8c.3-.4.7-.6 1.2-.6h1.6v-2.1c0-.5.4-.9.9-.9h1.2c.5 0 .9.4.9.9v2.1h1.9v-2.1c0-.5.4-.9.9-.9h1.2c.5 0 .9.4.9.9v2.1h1.6c.5 0 .9.2 1.2.6l1.4 1.8c.3.4.5.8.5 1.3v8.2h-3.4v-4.9c0-1.9-1.5-3.4-3.4-3.4s-3.4 1.5-3.4 3.4v4.9H7.2Z M13.2 24.4v-4.9a3 3 0 0 1 6 0v4.9h-6Z"
            fill="#f3f7ec"
          />
          <path
            d="M4 27c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1 2 1 4 1"
            fill="none"
            stroke="#5fc7b6"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M8 29.2c1.5 0 1.5-.8 3-.8s1.5.8 3 .8 1.5-.8 3-.8 1.5.8 3 .8 1.5-.8 3-.8 1.5.8 3 .8"
            fill="none"
            stroke="#5fc7b6"
            strokeWidth="1.3"
            strokeLinecap="round"
            opacity=".55"
          />
        </svg>
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
