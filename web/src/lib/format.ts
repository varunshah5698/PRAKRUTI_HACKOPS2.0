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
  LOW: '#2f8f66',
  MODERATE: '#b3860f',
  HIGH: '#cf7227',
  CRITICAL: '#c94a50',
  UNKNOWN: '#728176',
  NORMAL: '#2f8f66',
  WATCH: '#b3860f',
  EARLY_WARNING: '#cf7227',
  RECOVERY: '#2f8f84',
};

export const AQI_COLORS: Record<string, string> = {
  Good: '#2f8f66',
  Satisfactory: '#6d9f45',
  Moderate: '#b3860f',
  Poor: '#cf7227',
  'Very Poor': '#c94a50',
  Severe: '#8f2f3a',
  'INSUFFICIENT DATA': '#728176',
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
  if (['CONNECTED', 'ONLINE', 'ACTIVE', 'VERIFIED', 'COMPLETED', 'DELIVERED', 'LIVE'].includes(s)) return 'text-emerald-600';
  if (['WATCH', 'STALE', 'PENDING', 'AWAITING_VERIFICATION', 'DEGRADED', 'SENT', 'IN_PROGRESS'].includes(s)) return 'text-amber-600';
  if (['CRITICAL', 'FAILED', 'OFFLINE', 'SUSPENDED', 'REJECTED', 'MISMATCH'].includes(s)) return 'text-red-600';
  if (['NOT_CONFIGURED', 'UNKNOWN', 'SIMULATED', 'UNVERIFIED'].includes(s)) return 'text-slate-500';
  return 'text-slate-600';
}

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
