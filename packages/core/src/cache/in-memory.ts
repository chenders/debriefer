import type { CacheProvider } from "../types.js"

interface CacheEntry {
  value: string
  expiresAt: number | null // null = no expiry
}

export class InMemoryCache implements CacheProvider {
  private store = new Map<string, CacheEntry>()

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
