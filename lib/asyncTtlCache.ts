type AsyncTtlCacheOptions = {
  ttlMs: number;
  maxEntries?: number;
  now?: () => number;
};

type CacheEntry<Value> = {
  expiresAt: number;
  value: Promise<Value>;
};

/**
 * Small per-process cache for request-independent, derived server context.
 * Rejected loaders are never retained, and concurrent callers share one load.
 */
export function createAsyncTtlCache<Key, Value>({
  ttlMs,
  maxEntries = 500,
  now = Date.now,
}: AsyncTtlCacheOptions) {
  const entries = new Map<Key, CacheEntry<Value>>();

  function removeExpired(currentTime: number) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(key);
    }
  }

  function makeRoom(currentTime: number) {
    removeExpired(currentTime);
    while (entries.size >= maxEntries) {
      const oldestKey = entries.keys().next().value as Key | undefined;
      if (oldestKey === undefined) break;
      entries.delete(oldestKey);
    }
  }

  return {
    clear() {
      entries.clear();
    },

    delete(key: Key) {
      entries.delete(key);
    },

    get(key: Key, loader: () => Promise<Value>): Promise<Value> {
      const currentTime = now();
      const cached = entries.get(key);
      if (cached && cached.expiresAt > currentTime) {
        // Refresh insertion order so eviction favours recently used context.
        entries.delete(key);
        entries.set(key, cached);
        return cached.value;
      }

      if (cached) entries.delete(key);
      makeRoom(currentTime);

      const value = loader();
      const entry = { expiresAt: currentTime + ttlMs, value };
      entries.set(key, entry);
      void value.catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
      return value;
    },
  };
}
