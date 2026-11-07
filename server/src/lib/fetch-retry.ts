/**
 * Upstream providers occasionally drop a connection or answer 5xx on the first
 * attempt. A transient failure should not be recorded as a broken data source,
 * so idempotent requests get a short retry with a fresh timeout per attempt.
 */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchWithRetry(
  input: URL | string,
  options: { attempts?: number; timeoutMs?: number; init?: RequestInit } = {},
): Promise<Response> {
  const { attempts = 3, timeoutMs = 20_000, init = {} } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === attempts) return response;
      lastError = new Error(`Upstream responded ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await sleep(400 * attempt);
  }

  throw lastError instanceof Error ? lastError : new Error('Upstream request failed');
}
