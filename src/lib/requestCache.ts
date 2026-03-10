export type RequestCacheOptions = {
  /** Default TTL for entries when no ttlMs is passed to get(). */
  defaultTtlMs?: number
  /** Maximum number of entries to keep (best-effort). */
  maxEntries?: number
}

type CacheEntry<T> = {
  value?: T
  expiresAt: number
  inflight?: Promise<T>
  touchedAt: number
}

/**
 * Tiny in-memory cache with TTL + in-flight deduplication.
 * Intended to reduce duplicate expensive RPC/bridge calls inside a single session.
 */
export function createRequestCache<T>(options?: RequestCacheOptions) {
  const defaultTtlMs = Math.max(0, Math.trunc(options?.defaultTtlMs ?? 0))
  const maxEntries = Math.max(0, Math.trunc(options?.maxEntries ?? 500))
  const store = new Map<string, CacheEntry<T>>()

  const evictIfNeeded = () => {
    if (maxEntries <= 0) return
    if (store.size <= maxEntries) return
    // Evict least-recently-touched entries.
    const entries = [...store.entries()]
    entries.sort((a, b) => a[1].touchedAt - b[1].touchedAt)
    const toDrop = Math.max(0, store.size - maxEntries)
    for (let i = 0; i < toDrop; i += 1) {
      store.delete(entries[i][0])
    }
  }

  const get = async (key: string, loader: () => Promise<T>, ttlMs?: number, opts?: { force?: boolean }): Promise<T> => {
    const now = Date.now()
    const ttl = Math.max(0, Math.trunc(ttlMs ?? defaultTtlMs))
    const force = opts?.force === true

    const existing = store.get(key)
    if (existing) {
      existing.touchedAt = now
      if (!force) {
        if (existing.value !== undefined && now < existing.expiresAt) return existing.value
        if (existing.inflight) return existing.inflight
      }
    }

    const inflight = (async () => {
      const value = await loader()
      const entry: CacheEntry<T> = {
        value,
        inflight: undefined,
        expiresAt: ttl > 0 ? (Date.now() + ttl) : Date.now(),
        touchedAt: Date.now()
      }
      store.set(key, entry)
      evictIfNeeded()
      return value
    })()

    store.set(key, {
      value: existing?.value,
      inflight,
      expiresAt: existing?.expiresAt ?? 0,
      touchedAt: now
    })

    try {
      return await inflight
    } catch (err) {
      // Do not poison cache on failure.
      const entry = store.get(key)
      if (entry?.inflight === inflight) {
        store.delete(key)
      }
      throw err
    }
  }

  const peek = (key: string): T | undefined => {
    const entry = store.get(key)
    if (!entry) return undefined
    const now = Date.now()
    if (entry.value === undefined) return undefined
    if (now >= entry.expiresAt) return undefined
    return entry.value
  }

  const invalidate = (key: string) => {
    store.delete(key)
  }

  const invalidatePrefix = (prefix: string) => {
    const p = String(prefix || '')
    for (const key of store.keys()) {
      if (key.startsWith(p)) store.delete(key)
    }
  }

  const clear = () => {
    store.clear()
  }

  return { get, peek, invalidate, invalidatePrefix, clear }
}

