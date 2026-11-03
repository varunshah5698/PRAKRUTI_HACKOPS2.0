export const CATEGORY_LABELS: Record<string, string> = {
  air: 'Air pollution',
  water: 'Water pollution',
  waste: 'Unsafe waste disposal',
  industrial: 'Industrial emissions',
};

export const CATEGORY_SHORT: Record<string, string> = {
  air: 'Air',
  water: 'Water',
  waste: 'Waste',
  industrial: 'Industrial',
};

export const RISK_COLORS: Record<string, string> = {
  LOW: '#32a879',
  MODERATE: '#d2b04c',
  HIGH: '#e88a43',
  CRITICAL: '#dc555b',
  UNKNOWN: '#788493',
  NORMAL: '#32a879',
  WATCH: '#d2b04c',
  EARLY_WARNING: '#e88a43',
  RECOVERY: '#56c1b3',
};

export const AQI_COLORS: Record<string, string> = {
  Good: '#32a879',
  Satisfactory: '#7fb069',
  Moderate: '#d2b04c',
  Poor: '#e88a43',
  'Very Poor': '#dc555b',
  Severe: '#8f2f3a',
  'INSUFFICIENT DATA': '#788493',
};

export function formatDate(value?: string | null, withTime = true): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: withTime ? undefined : 'numeric',
    hour: withTime ? '2-digit' : undefined,
    minute: withTime ? '2-digit' : undefined,
  });
}

export function timeAgo(value?: string | null): string {
  if (!value) return '—';
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return '—';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

export function number(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-IN', { maximumFractionDigits: digits });
}

export function windDirection(degrees?: number | null): string {
  if (degrees === null || degrees === undefined || !Number.isFinite(degrees)) return '—';
  const compass = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return `${compass[Math.round(degrees / 22.5) % 16]} · ${Math.round(degrees)}°`;
}

export function categoryLabel(value?: string | null): string {
  return value ? CATEGORY_LABELS[value] ?? value : '—';
}

export function statusTone(status?: string | null): string {
  const s = String(status ?? '').toUpperCase();
  if (['CONNECTED', 'ONLINE', 'ACTIVE', 'VERIFIED', 'COMPLETED', 'DELIVERED', 'LIVE'].includes(s)) return 'text-emerald-400';
  if (['WATCH', 'STALE', 'PENDING', 'AWAITING_VERIFICATION', 'DEGRADED', 'SENT', 'IN_PROGRESS'].includes(s)) return 'text-amber-400';
  if (['CRITICAL', 'FAILED', 'OFFLINE', 'SUSPENDED', 'REJECTED', 'MISMATCH'].includes(s)) return 'text-red-400';
  if (['NOT_CONFIGURED', 'NOT_TRAINED', 'UNKNOWN', 'SIMULATED', 'UNVERIFIED'].includes(s)) return 'text-slate-400';
  return 'text-slate-300';
}

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
