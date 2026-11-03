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

export interface RetryOptions {
  retries?: number;
  onRetry?: (attempt: number, delayMs: number) => void;
}

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

// A tsx watcher restart can take a few seconds. GETs are idempotent, so wait
// through the gap instead of turning a brief restart into an error screen.
const RETRY_DELAYS = [600, 1500, 3000];
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request<T>(path: string, options: RequestInit = {}, retry: RetryOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const maxRetries = retry.retries ?? (method === 'GET' ? RETRY_DELAYS.length : 0);

  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
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
      if (attempt >= maxRetries || options.signal?.aborted) throw error;
      const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
      retry.onRetry?.(attempt + 1, delay);
      await sleep(delay);
      continue;
    }

    if (!response.ok) {
      if (attempt < maxRetries && RETRYABLE_STATUSES.has(response.status)) {
        const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
        retry.onRetry?.(attempt + 1, delay);
        await sleep(delay);
        continue;
      }

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
}

export const api = {
  get: <T>(path: string, retry?: RetryOptions) => request<T>(path, {}, retry),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
};

export const API_ORIGIN = API_BASE.replace(/\/api\/v1$/, '');
