type BreakerState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  threshold?: number;
  cooldownMs?: number;
}

interface CircuitEntry {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
}

const circuitEntries = new Map<string, CircuitEntry>();

function getEntry(key: string): CircuitEntry {
  const existing = circuitEntries.get(key);
  if (existing) return existing;
  const created: CircuitEntry = { state: "closed", consecutiveFailures: 0, openedAt: null };
  circuitEntries.set(key, created);
  return created;
}

export async function withCircuitBreaker<T>(
  key: string,
  fn: () => Promise<T>,
  options: CircuitBreakerOptions = {},
): Promise<T> {
  const threshold = Math.max(1, options.threshold ?? 3);
  const cooldownMs = Math.max(1000, options.cooldownMs ?? 60_000);
  const entry = getEntry(key);

  if (entry.state === "open") {
    if (entry.openedAt && Date.now() - entry.openedAt >= cooldownMs) {
      entry.state = "half-open";
    } else {
      throw new Error(`Circuit breaker open for ${key}`);
    }
  }

  try {
    const value = await fn();
    entry.state = "closed";
    entry.consecutiveFailures = 0;
    entry.openedAt = null;
    return value;
  } catch (error) {
    entry.consecutiveFailures += 1;
    if (entry.consecutiveFailures >= threshold) {
      entry.state = "open";
      entry.openedAt = Date.now();
    }
    throw error;
  }
}

export function getCircuitState(key: string): BreakerState {
  return getEntry(key).state;
}

