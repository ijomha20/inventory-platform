export interface RetryOptions {
  retries: number;
  baseDelayMs?: number;
  jitterMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(opts: RetryOptions, fn: (attempt: number) => Promise<T>): Promise<T> {
  const retries = Math.max(0, opts.retries);
  const baseDelayMs = Math.max(1, opts.baseDelayMs ?? 500);
  const jitterMs = Math.max(0, opts.jitterMs ?? 200);
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      if (opts.shouldRetry && !opts.shouldRetry(error, attempt)) break;
      const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
      const delay = baseDelayMs * (2 ** attempt) + jitter;
      await wait(delay);
    }
  }
  throw lastError;
}

