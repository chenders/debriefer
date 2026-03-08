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
})
