import { Badge } from './ui';
import { classNames, timeAgo } from '../lib/format';
import { useNow } from '../lib/liveFeed';

export type FreshnessStatus = 'LIVE' | 'STALE' | 'UNAVAILABLE' | 'DEMO';

const TONE: Record<FreshnessStatus, 'green' | 'amber' | 'red' | 'teal' | 'neutral'> = {
  LIVE: 'green',
  STALE: 'amber',
  UNAVAILABLE: 'red',
  DEMO: 'teal',
};

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  // Open-Meteo and MET Norway send Mumbai wall-clock strings without an offset.
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value) ? `${value}+05:30` : value;
}

export function FreshnessPill({
  status,
  observedAt,
  provider,
  sourceId,
  className,
}: {
  status: FreshnessStatus;
  observedAt?: string | null;
  provider?: string | null;
  sourceId?: string | null;
  className?: string;
}) {
  const now = useNow(60_000);
  const stamp = normalize(observedAt);
  const source = provider ?? sourceId ?? null;
  const age = stamp ? timeAgo(stamp, now) : null;
  const state = status === 'LIVE' ? 'LIVE' : status === 'DEMO' ? 'DEMO' : status === 'STALE' ? 'STALE' : 'UNAVAILABLE';
  const text = [
    state,
    source,
    stamp ? age : null,
  ].filter(Boolean).join(' · ');

  return (
    <Badge
      tone={TONE[status]}
      dot
      className={classNames('whitespace-nowrap normal-case tracking-[0.02em]', className)}
      title={stamp ? `Observed ${new Date(stamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST${source ? ` · ${source}` : ''}` : undefined}
    >
      {text}
    </Badge>
  );
}
