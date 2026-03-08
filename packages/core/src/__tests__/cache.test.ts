import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { InMemoryCache } from "../cache/in-memory.js"

describe("InMemoryCache", () => {
  let cache: InMemoryCache

  beforeEach(() => {
    cache = new InMemoryCache()
  })

  it("returns null for missing key", async () => {
    const result = await cache.get("nonexistent")
    expect(result).toBeNull()
  })

  it("set/get roundtrip works", async () => {
    await cache.set("key1", "value1")
    const result = await cache.get("key1")
    expect(result).toBe("value1")
  })

  it("delete removes entry", async () => {
    await cache.set("key1", "value1")
    await cache.delete("key1")
    const result = await cache.get("key1")
    expect(result).toBeNull()
  })

  describe("TTL expiration", () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it("returns value before TTL expires", async () => {
      await cache.set("key1", "value1", 60)
      vi.advanceTimersByTime(59_000)
      const result = await cache.get("key1")
      expect(result).toBe("value1")
    })

    it("returns null after TTL expires", async () => {
      await cache.set("key1", "value1", 60)
      vi.advanceTimersByTime(61_000)
      const result = await cache.get("key1")
      expect(result).toBeNull()
    })

    it("evicts expired entry on get", async () => {
      await cache.set("key1", "value1", 1)
      expect(cache.size).toBe(1)
      vi.advanceTimersByTime(2_000)
      await cache.get("key1")
      expect(cache.size).toBe(0)
    })
  })

  it("no TTL means no expiration", async () => {
    vi.useFakeTimers()
    await cache.set("key1", "value1")
    vi.advanceTimersByTime(1_000_000_000)
    const result = await cache.get("key1")
    expect(result).toBe("value1")
    vi.useRealTimers()
  })

  it("overwrites existing key", async () => {
    await cache.set("key1", "original")
    await cache.set("key1", "updated")
    const result = await cache.get("key1")
    expect(result).toBe("updated")
  })

  it("size property reflects entry count", async () => {
    expect(cache.size).toBe(0)
    await cache.set("a", "1")
    expect(cache.size).toBe(1)
    await cache.set("b", "2")
    expect(cache.size).toBe(2)
    await cache.delete("a")
    expect(cache.size).toBe(1)
  })

  it("clear removes all entries", async () => {
    await cache.set("a", "1")
    await cache.set("b", "2")
    await cache.set("c", "3")
    expect(cache.size).toBe(3)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(await cache.get("a")).toBeNull()
    expect(await cache.get("b")).toBeNull()
    expect(await cache.get("c")).toBeNull()
  })

  describe("maxSize eviction", () => {
    it("evicts oldest entry when maxSize exceeded", async () => {
      const bounded = new InMemoryCache({ maxSize: 2 })
      await bounded.set("a", "1")
      await bounded.set("b", "2")
      await bounded.set("c", "3") // should evict "a"
      expect(bounded.size).toBe(2)
      expect(await bounded.get("a")).toBeNull()
      expect(await bounded.get("b")).toBe("2")
      expect(await bounded.get("c")).toBe("3")
    })

    it("overwriting existing key does not trigger eviction", async () => {
      const bounded = new InMemoryCache({ maxSize: 2 })
      await bounded.set("a", "1")
      await bounded.set("b", "2")
      await bounded.set("a", "updated") // overwrite, not new entry
      expect(bounded.size).toBe(2)
      expect(await bounded.get("a")).toBe("updated")
      expect(await bounded.get("b")).toBe("2")
    })

    it("evicts in FIFO order", async () => {
      const bounded = new InMemoryCache({ maxSize: 3 })
      await bounded.set("a", "1")
      await bounded.set("b", "2")
      await bounded.set("c", "3")
      await bounded.set("d", "4") // evicts "a"
      await bounded.set("e", "5") // evicts "b"
      expect(await bounded.get("a")).toBeNull()
      expect(await bounded.get("b")).toBeNull()
      expect(await bounded.get("c")).toBe("3")
      expect(await bounded.get("d")).toBe("4")
      expect(await bounded.get("e")).toBe("5")
    })

    it("unlimited by default", async () => {
      const unlimited = new InMemoryCache()
      for (let i = 0; i < 100; i++) {
        await unlimited.set(`key-${i}`, `value-${i}`)
      }
      expect(unlimited.size).toBe(100)
      expect(await unlimited.get("key-0")).toBe("value-0")
    })
  })
})
