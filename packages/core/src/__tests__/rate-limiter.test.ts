import { describe, it, expect, beforeEach } from "vitest"
import { SourceRateLimiter } from "../rate-limiter.js"

describe("SourceRateLimiter", () => {
  let limiter: SourceRateLimiter

  beforeEach(() => {
    limiter = new SourceRateLimiter()
  })

  it("allows first request immediately", async () => {
    const start = Date.now()
    await limiter.acquire("example.com", 1000)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(50) // should be nearly instant
  })

  it("delays second request to same domain", async () => {
    await limiter.acquire("example.com", 100)
    const start = Date.now()
    await limiter.acquire("example.com", 100)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(80) // allow some timer variance
    expect(elapsed).toBeLessThan(200)
  })

  it("allows parallel requests to different domains", async () => {
    const start = Date.now()
    await Promise.all([
      limiter.acquire("domain-a.com", 100),
      limiter.acquire("domain-b.com", 100),
      limiter.acquire("domain-c.com", 100),
    ])
    const elapsed = Date.now() - start
    // All three should resolve nearly immediately (first request per domain)
    expect(elapsed).toBeLessThan(50)
  })

  it("serializes multiple requests to same domain", async () => {
    const order: number[] = []

    const p1 = limiter.acquire("example.com", 50).then(() => order.push(1))
    const p2 = limiter.acquire("example.com", 50).then(() => order.push(2))
    const p3 = limiter.acquire("example.com", 50).then(() => order.push(3))

    await Promise.all([p1, p2, p3])
    expect(order).toEqual([1, 2, 3])
  })

  it("tracks stats per domain", async () => {
    await limiter.acquire("a.com", 10)
    await limiter.acquire("a.com", 10)
    await limiter.acquire("b.com", 10)

    const stats = limiter.getStats()
    expect(stats.get("a.com")?.totalRequests).toBe(2)
    expect(stats.get("b.com")?.totalRequests).toBe(1)
  })

  it("tracks wait time in stats", async () => {
    await limiter.acquire("slow.com", 100)
    await limiter.acquire("slow.com", 100)

    const stats = limiter.getStats()
    const slowStats = stats.get("slow.com")!
    expect(slowStats.totalRequests).toBe(2)
    expect(slowStats.totalWaitMs).toBeGreaterThan(0)
  })

  it("returns empty stats when no requests made", () => {
    const stats = limiter.getStats()
    expect(stats.size).toBe(0)
  })

  it("respects different delays per domain", async () => {
    // First requests are instant
    await limiter.acquire("fast.com", 10)
    await limiter.acquire("slow.com", 200)

    const fastStart = Date.now()
    await limiter.acquire("fast.com", 10)
    const fastElapsed = Date.now() - fastStart

    // Fast domain should have short delay
    expect(fastElapsed).toBeLessThan(50)
  })

  it("reset clears all state", async () => {
    await limiter.acquire("example.com", 10)
    expect(limiter.getStats().size).toBe(1)

    limiter.reset()
    expect(limiter.getStats().size).toBe(0)

    // After reset, first request should be immediate again
    const start = Date.now()
    await limiter.acquire("example.com", 1000)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(50)
  })
})
