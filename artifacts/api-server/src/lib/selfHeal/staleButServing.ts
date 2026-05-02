interface StaleCacheEntry<T> {
  value: T;
  fetchedAt: number;
}

const staleCache = new Map<string, StaleCacheEntry<unknown>>();

export async function staleButServing<T>(opts: {
  key: string;
  fetchFn: () => Promise<T>;
}): Promise<{ value: T; stale: boolean; stalenessMs: number }> {
  try {
    const value = await opts.fetchFn();
    staleCache.set(opts.key, { value, fetchedAt: Date.now() });
    return { value, stale: false, stalenessMs: 0 };
  } catch (error) {
    const cached = staleCache.get(opts.key) as StaleCacheEntry<T> | undefined;
    if (!cached) throw error;
    return {
      value: cached.value,
      stale: true,
      stalenessMs: Date.now() - cached.fetchedAt,
    };
  }
}

