export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

const RESTART_RETRY_DELAYS_MS = [500, 1000, 1500];
const NETWORK_RETRY_DELAY_MS = 500;
// Only treat a failure as a restart when the API answered us recently. A cold
// load against a stopped API must fail fast instead of waiting out the budget.
const RESTART_WINDOW_MS = 60_000;

let lastSuccessAt = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Vite's dev proxy answers 500 text/plain while the API watcher restarts. The
// API's own 500s are JSON and must not be retried blindly.
function apiRestarting(response: Response): boolean {
  if ([502, 503, 504].includes(response.status)) return true;
  return response.status === 500 && !(response.headers.get('content-type') ?? '').includes('application/json');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const retryable = (options.method ?? 'GET').toUpperCase() === 'GET';
  const retryDelays = Date.now() - lastSuccessAt < RESTART_WINDOW_MS ? RESTART_RETRY_DELAYS_MS : [];
  let response: Response | undefined;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        ...options,
        headers: {
          ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...options.headers,
        },
      });
    } catch (error) {
      // A thrown fetch means no HTTP response at all (connection refused).
      // Retry once briefly, then fail instead of hanging on a dead API.
      if (!retryable || attempt > 0) throw error;
      await sleep(NETWORK_RETRY_DELAY_MS);
      continue;
    }
    if (response.ok) lastSuccessAt = Date.now();
    const delay = retryDelays[attempt];
    if (retryable && delay !== undefined && apiRestarting(response)) {
      await sleep(delay);
      continue;
    }
    break;
  }
  if (!response) throw new Error('Request failed');
  if (!response.ok) {
    let payload: { error?: { code?: string; message?: string; details?: unknown } } = {};
    try {
      payload = await response.json();
    } catch {
      // Ignore non-JSON errors.
    }
    throw new ApiError(
      response.status,
      payload.error?.code ?? 'REQUEST_FAILED',
      payload.error?.message ?? `Request failed (${response.status})`,
      payload.error?.details,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
};

export const API_ORIGIN = API_BASE.replace(/\/api\/v1$/, '');
