/**
 * Collects keys requested within a short window and resolves them with a
 * single fetch, so a screen full of components asking for one thing each
 * becomes one request instead of dozens.
 */
export interface BatchLoader<K, V> {
  load(key: K): Promise<V>;
}

interface Pending<K, V> {
  key: K;
  resolve: (value: V) => void;
  reject: (error: unknown) => void;
}

export interface BatchLoaderOptions<K, V> {
  /** Runs one fetch for the collected keys and returns a key/value map. */
  fetch(keys: K[]): Promise<Map<K, V>>;
  /** Value handed back for keys the fetch didn't resolve. */
  emptyValue: () => V;
  /** How long to wait for more keys before firing. */
  windowMs?: number;
  /** Upper bound on keys per fetch, so filters stay within relay limits. */
  maxBatchSize?: number;
}

export function createBatchLoader<K, V>({
  fetch,
  emptyValue,
  windowMs = 60,
  maxBatchSize = 200,
}: BatchLoaderOptions<K, V>): BatchLoader<K, V> {
  let queue: Pending<K, V>[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    timer = null;
    const batch = queue;
    queue = [];
    if (!batch.length) return;

    // Distinct keys only; several components often want the same one
    const keys = [...new Set(batch.map((entry) => entry.key))];

    for (let i = 0; i < keys.length; i += maxBatchSize) {
      const slice = keys.slice(i, i + maxBatchSize);
      const waiting = batch.filter((entry) => slice.includes(entry.key));

      try {
        const results = await fetch(slice);
        for (const entry of waiting) {
          entry.resolve(results.get(entry.key) ?? emptyValue());
        }
      } catch (error) {
        for (const entry of waiting) {
          entry.reject(error);
        }
      }
    }
  };

  return {
    load(key: K) {
      return new Promise<V>((resolve, reject) => {
        queue.push({ key, resolve, reject });
        if (!timer) timer = setTimeout(flush, windowMs);
      });
    },
  };
}
