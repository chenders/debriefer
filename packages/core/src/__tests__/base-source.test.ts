import { describe, it, expect, vi, beforeEach } from "vitest"
import { BaseResearchSource } from "../base-source.js"
import type { BaseSourceOptions } from "../base-source.js"
import { ReliabilityTier } from "../reliability.js"
import type {
  ResearchSubject,
  RawFinding,
  CacheProvider,
  TelemetryProvider,
  TelemetrySpan,
} from "../types.js"
import type { SourceRateLimiter } from "../rate-limiter.js"

// ============================================================================
// Test Fixtures
// ============================================================================

const testSubject: ResearchSubject = {
  id: 42,
  name: "John Wayne",
  context: { deathday: "1979-06-11" },
}

function makeFinding(overrides: Partial<RawFinding> = {}): RawFinding {
  return {
    text: "John Wayne died of stomach cancer in 1979.",
    url: "https://example.com/john-wayne",
    confidence: 0.8,
    costUsd: 0,
    ...overrides,
  }
}

function makeCache(): CacheProvider & {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
} {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

function makeRateLimiter(): { acquire: ReturnType<typeof vi.fn> } {
  return {
    acquire: vi.fn().mockResolvedValue(undefined),
  }
}

function makeSpan(): TelemetrySpan & {
  end: ReturnType<typeof vi.fn>
  setAttributes: ReturnType<typeof vi.fn>
} {
  return {
    end: vi.fn(),
    setAttributes: vi.fn(),
  }
}

function makeTelemetry(): TelemetryProvider & {
  recordEvent: ReturnType<typeof vi.fn>
  startSpan: ReturnType<typeof vi.fn>
  recordError: ReturnType<typeof vi.fn>
} {
  const span = makeSpan()
  return {
    recordEvent: vi.fn(),
    startSpan: vi.fn().mockReturnValue(span),
    recordError: vi.fn(),
  }
}

// ============================================================================
// Concrete Test Source
// ============================================================================

class TestSource extends BaseResearchSource<ResearchSubject> {
  readonly name = "TestSource"
  readonly type = "test_source"
  readonly reliabilityTier = ReliabilityTier.TIER_1_NEWS
  readonly domain = "test.example.com"
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  private fixedResult: RawFinding | null

  constructor(result: RawFinding | null = makeFinding(), options: BaseSourceOptions = {}) {
    super(options)
    this.fixedResult = result
  }

  protected async fetchResult(
    _subject: ResearchSubject,
    _signal: AbortSignal
  ): Promise<RawFinding | null> {
    return this.fixedResult
  }
}

class FailingSource extends BaseResearchSource<ResearchSubject> {
  readonly name = "FailingSource"
  readonly type = "failing_source"
  readonly reliabilityTier = ReliabilityTier.UNRELIABLE_UGC
  readonly domain = "failing.example.com"
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  protected async fetchResult(): Promise<RawFinding | null> {
    throw new Error("Source fetch failed")
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("BaseResearchSource", () => {
  let abortController: AbortController

  beforeEach(() => {
    abortController = new AbortController()
  })

  // Test 1: lookup returns the finding from fetchResult
  it("returns the finding from fetchResult", async () => {
    const finding = makeFinding()
    const source = new TestSource(finding)

    const result = await source.lookup(testSubject, abortController.signal)

    expect(result).toEqual(finding)
  })

  // Test 2: lookup checks cache first (cache hit returns cached value)
  it("returns cached value on cache hit", async () => {
    const cachedFinding = makeFinding({ text: "cached result" })
    const cache = makeCache()
    cache.get.mockResolvedValue(JSON.stringify(cachedFinding))

    const source = new TestSource(makeFinding({ text: "fresh result" }))
    source.setCache(cache)

    const result = await source.lookup(testSubject, abortController.signal)

    expect(result).toEqual(cachedFinding)
    expect(cache.get).toHaveBeenCalledWith(expect.stringContaining("debriefer:test_source:42:"))
  })

  // Test 3: lookup populates cache after successful fetch
  it("populates cache after successful fetch", async () => {
    const finding = makeFinding()
    const cache = makeCache()

    const source = new TestSource(finding)
    source.setCache(cache)

    await source.lookup(testSubject, abortController.signal)

    expect(cache.set).toHaveBeenCalledWith(
      expect.stringContaining("debriefer:test_source:42:"),
      JSON.stringify(finding),
      86400
    )
  })

  // Test 4: lookup respects ignoreCache option
  it("skips cache when ignoreCache is true", async () => {
    const cache = makeCache()
    cache.get.mockResolvedValue(JSON.stringify(makeFinding({ text: "stale" })))

    const freshFinding = makeFinding({ text: "fresh" })
    const source = new TestSource(freshFinding, { ignoreCache: true })
    source.setCache(cache)

    const result = await source.lookup(testSubject, abortController.signal)

    expect(cache.get).not.toHaveBeenCalled()
    expect(result).toEqual(freshFinding)
  })

  // Test 5: rate limiter acquire is called with correct domain and delay
  it("calls rate limiter with correct domain and delay", async () => {
    const rateLimiter = makeRateLimiter()
    const source = new TestSource(makeFinding(), { rateLimitMs: 500 })
    source.setRateLimiter(rateLimiter as unknown as SourceRateLimiter)

    await source.lookup(testSubject, abortController.signal)

    expect(rateLimiter.acquire).toHaveBeenCalledWith("test.example.com", 500)
  })

  // Test 6: telemetry span is started and ended
  it("starts and ends telemetry span", async () => {
    const telemetry = makeTelemetry()
    const source = new TestSource(makeFinding())
    source.setTelemetry(telemetry)

    await source.lookup(testSubject, abortController.signal)

    expect(telemetry.startSpan).toHaveBeenCalledWith("source:TestSource")
    const span = telemetry.startSpan.mock.results[0]?.value as TelemetrySpan
    expect(span.end).toHaveBeenCalled()
  })

  // Test 7: telemetry recordError is called on fetch failure
  it("records error via telemetry on fetch failure", async () => {
    const telemetry = makeTelemetry()
    const source = new FailingSource()
    source.setTelemetry(telemetry)

    await source.lookup(testSubject, abortController.signal)

    expect(telemetry.recordError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Source fetch failed" }),
      { source: "FailingSource", subject: "John Wayne" }
    )
  })

  // Test 8: lookup returns null on fetch error (doesn't throw)
  it("returns null on fetch error instead of throwing", async () => {
    const source = new FailingSource()

    const result = await source.lookup(testSubject, abortController.signal)

    expect(result).toBeNull()
  })

  // Test 9: isAvailable defaults to true
  it("isAvailable defaults to true", () => {
    const source = new TestSource()
    expect(source.isAvailable()).toBe(true)
  })

  // Test 10: reliabilityScore is derived from reliabilityTier
  it("derives reliabilityScore from reliabilityTier", () => {
    const source = new TestSource()
    // TIER_1_NEWS has score 0.95
    expect(source.reliabilityScore).toBe(0.95)
  })

  // Test 11: buildQuery defaults to subject.name
  it("buildQuery defaults to subject.name", () => {
    const source = new TestSource()
    expect(source.buildQuery(testSubject)).toBe("John Wayne")
  })

  // Test 12: confidence is calculated when result.confidence is -1 and keywords provided
  it("calculates confidence when result.confidence is -1 and keywords provided", async () => {
    const finding = makeFinding({
      text: "John Wayne died of stomach cancer in 1979.",
      confidence: -1,
    })
    const source = new TestSource(finding, {
      requiredKeywords: ["died", "death"],
      bonusKeywords: ["cancer", "heart attack", "accident"],
    })

    const result = await source.lookup(testSubject, abortController.signal)

    expect(result).not.toBeNull()
    // "died" is a required keyword match -> base 0.5
    // "cancer" is 1 of 3 bonus keywords -> 0.5 * (1/3) bonus
    expect(result!.confidence).toBeGreaterThan(0)
    expect(result!.confidence).not.toBe(-1)
  })

  // Test 13: timeout signal is combined with caller signal
  it("combines caller signal with timeout signal", async () => {
    // We verify that aborting the caller signal causes the lookup to
    // handle the abort. We do this by creating a source that checks
    // the combined signal.
    let receivedSignal: AbortSignal | null = null

    class SignalCapturingSource extends BaseResearchSource<ResearchSubject> {
      readonly name = "SignalCapture"
      readonly type = "signal_capture"
      readonly reliabilityTier = ReliabilityTier.TIER_1_NEWS
      readonly domain = "signal.example.com"
      readonly isFree = true
      readonly estimatedCostPerQuery = 0

      protected async fetchResult(
        _subject: ResearchSubject,
        signal: AbortSignal
      ): Promise<RawFinding | null> {
        receivedSignal = signal
        return makeFinding()
      }
    }

    const source = new SignalCapturingSource({ timeoutMs: 30000 })
    await source.lookup(testSubject, abortController.signal)

    // The received signal should NOT be the raw caller signal — it should
    // be a combined signal (AbortSignal.any creates a new signal)
    expect(receivedSignal).not.toBeNull()
    expect(receivedSignal).not.toBe(abortController.signal)
  })

  // Additional edge cases

  it("does not cache null results", async () => {
    const cache = makeCache()
    const source = new TestSource(null)
    source.setCache(cache)

    const result = await source.lookup(testSubject, abortController.signal)

    expect(result).toBeNull()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it("handles invalid cached JSON gracefully", async () => {
    const cache = makeCache()
    cache.get.mockResolvedValue("not valid json {{{")

    const freshFinding = makeFinding({ text: "fresh" })
    const source = new TestSource(freshFinding)
    source.setCache(cache)

    const result = await source.lookup(testSubject, abortController.signal)

    // Should fall through to fresh fetch
    expect(result).toEqual(freshFinding)
  })

  it("does not calculate confidence when result.confidence is not -1", async () => {
    const finding = makeFinding({
      text: "No keywords here at all",
      confidence: 0.9,
    })
    const source = new TestSource(finding, {
      requiredKeywords: ["nonexistent"],
    })

    const result = await source.lookup(testSubject, abortController.signal)

    // Confidence should remain as set, not recalculated to 0
    expect(result!.confidence).toBe(0.9)
  })

  it("uses default options when none provided", () => {
    const source = new TestSource(makeFinding())
    // Access protected options via lookup behavior — rate limiter default is 1000ms
    const rateLimiter = makeRateLimiter()
    source.setRateLimiter(rateLimiter as unknown as SourceRateLimiter)

    source.lookup(testSubject, abortController.signal)

    // Should use default rateLimitMs of 1000
    expect(rateLimiter.acquire).toHaveBeenCalledWith("test.example.com", 1000)
  })

  it("span.end is called even when fetchResult throws", async () => {
    const telemetry = makeTelemetry()
    const source = new FailingSource()
    source.setTelemetry(telemetry)

    await source.lookup(testSubject, abortController.signal)

    const span = telemetry.startSpan.mock.results[0]?.value as TelemetrySpan
    expect(span.end).toHaveBeenCalled()
  })

  it("cache key includes source type and subject id", async () => {
    const cache = makeCache()
    const source = new TestSource(makeFinding())
    source.setCache(cache)

    await source.lookup(testSubject, abortController.signal)

    const cacheKey = cache.get.mock.calls[0]?.[0] as string
    expect(cacheKey).toContain("debriefer:")
    expect(cacheKey).toContain("test_source")
    expect(cacheKey).toContain("42")
  })

  // confidenceScorer callback tests

  it("uses confidenceScorer callback when result.confidence is -1", async () => {
    const finding = makeFinding({ text: "Marie Curie won two Nobel Prizes.", confidence: -1 })
    const scorer = vi.fn().mockResolvedValue(0.92)
    const source = new TestSource(finding, { confidenceScorer: scorer })

    const result = await source.lookup(testSubject, abortController.signal)

    expect(scorer).toHaveBeenCalledWith("Marie Curie won two Nobel Prizes.", testSubject)
    expect(result!.confidence).toBe(0.92)
  })

  it("confidenceScorer takes precedence over keyword heuristics", async () => {
    const finding = makeFinding({ text: "John Wayne died in 1979.", confidence: -1 })
    const scorer = vi.fn().mockReturnValue(0.99)
    const source = new TestSource(finding, {
      confidenceScorer: scorer,
      requiredKeywords: ["died"],
      bonusKeywords: ["cancer"],
    })

    const result = await source.lookup(testSubject, abortController.signal)

    expect(scorer).toHaveBeenCalled()
    expect(result!.confidence).toBe(0.99)
  })

  it("does not call confidenceScorer when confidence is already set", async () => {
    const finding = makeFinding({ text: "Some text", confidence: 0.7 })
    const scorer = vi.fn().mockReturnValue(0.99)
    const source = new TestSource(finding, { confidenceScorer: scorer })

    const result = await source.lookup(testSubject, abortController.signal)

    expect(scorer).not.toHaveBeenCalled()
    expect(result!.confidence).toBe(0.7)
  })

  it("supports synchronous confidenceScorer", async () => {
    const finding = makeFinding({ text: "Test text", confidence: -1 })
    const scorer = vi.fn().mockReturnValue(0.75)
    const source = new TestSource(finding, { confidenceScorer: scorer })

    const result = await source.lookup(testSubject, abortController.signal)

    expect(result!.confidence).toBe(0.75)
  })

  it("falls through to keyword heuristics when confidenceScorer throws", async () => {
    const finding = makeFinding({ text: "John Wayne died in 1979.", confidence: -1 })
    const scorer = vi.fn().mockRejectedValue(new Error("Scorer failed"))
    const source = new TestSource(finding, {
      confidenceScorer: scorer,
      requiredKeywords: ["died"],
    })

    const result = await source.lookup(testSubject, abortController.signal)

    // Result is preserved, confidence set by keyword heuristics
    expect(result).not.toBeNull()
    expect(result!.confidence).toBeGreaterThan(0)
  })

  it("preserves result with confidence -1 when scorer throws and no keywords", async () => {
    const finding = makeFinding({ text: "Test text", confidence: -1 })
    const scorer = vi.fn().mockRejectedValue(new Error("Scorer failed"))
    const source = new TestSource(finding, { confidenceScorer: scorer })

    const result = await source.lookup(testSubject, abortController.signal)

    // Result preserved but confidence stays -1 (no fallback available)
    expect(result).not.toBeNull()
    expect(result!.confidence).toBe(-1)
  })
})
