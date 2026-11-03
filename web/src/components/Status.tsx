import { Badge, StatusDot } from './ui';
import { RISK_COLORS, classNames, statusTone } from '../lib/format';

export function RiskBadge({ level, className }: { level?: string | null; className?: string }) {
  const value = String(level ?? 'UNKNOWN').toUpperCase();
  const tone = value === 'CRITICAL' ? 'red' : value === 'HIGH' || value === 'EARLY_WARNING' ? 'amber' : value === 'MODERATE' || value === 'WATCH' ? 'amber' : value === 'LOW' || value === 'NORMAL' ? 'green' : value === 'RECOVERY' ? 'teal' : 'neutral';
  return (
    <Badge tone={tone} dot className={className}>
      {value.replace(/_/g, ' ')}
    </Badge>
  );
}

export function SourceBadge({
  status,
  label,
  notes,
  className,
}: {
  status: string;
  label?: string;
  notes?: string;
  className?: string;
}) {
  return (
    <span className={classNames('inline-flex items-center gap-1.5 text-[11px]', statusTone(status), className)} title={notes}>
      <StatusDot status={status} />
      <span className="font-semibold uppercase tracking-[0.06em]">{label ?? status.replace(/_/g, ' ')}</span>
    </span>
  );
}

export function RiskDot({ level }: { level?: string | null }) {
  return <span className="inline-block h-2 w-2 rounded-full" style={{ background: RISK_COLORS[String(level ?? 'UNKNOWN').toUpperCase()] ?? '#788493' }} />;
}
