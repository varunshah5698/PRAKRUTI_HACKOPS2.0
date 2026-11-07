import { API_ORIGIN } from './api';

export interface ApiHealth {
  demoMode?: boolean;
}

const TTL_MS = 30_000;

let cached: { at: number; value: ApiHealth | null } | null = null;
let inflight: Promise<ApiHealth | null> | null = null;

/**
 * More than one surface needs /api/health. A short cache keeps a page load to a
 * single request instead of one per component, plus the duplicate React
 * StrictMode mount in development.
 */
export function fetchHealth(): Promise<ApiHealth | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.value);
  if (inflight) return inflight;
  inflight = fetch(`${API_ORIGIN}/api/health`)
    .then(async (response) => (response.ok ? ((await response.json()) as ApiHealth) : null))
    .catch(() => null)
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
