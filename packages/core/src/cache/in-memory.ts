import type { CacheProvider } from "../types.js"

interface CacheEntry {
  value: string
  expiresAt: number | null // null = no expiry
}

/**
 * Simple in-memory cache with optional TTL expiration.
 *
 * Suitable for development, testing, and small batch jobs. For large batches
 * (10,000+ subjects), use RedisCache or call `clear()` between batches to
 * prevent unbounded memory growth — entries are only evicted lazily on read.
 *
 * @param maxSize - Optional maximum number of entries. When exceeded, oldest
 *   entries are evicted (FIFO). Defaults to unlimited.
 */
export class InMemoryCache implements CacheProvider {
  private store = new Map<string, CacheEntry>()
  private maxSize: number

  constructor(options?: { maxSize?: number }) {
    this.maxSize = options?.maxSize ?? Infinity
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return null
    }
    return entry.value
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    // Evict oldest entry if at capacity (FIFO via Map insertion order)
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) this.store.delete(oldest)
    }

    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    })
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  /** Number of entries (including expired but not yet evicted) */
  get size(): number {
    return this.store.size
  }

  /** Clear all entries */
  clear(): void {
    this.store.clear()
  }
}
