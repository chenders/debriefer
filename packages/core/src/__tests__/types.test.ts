/**
 * Type-checking tests for the core debriefer type system.
 *
 * These tests verify that the types are structurally correct, that required
 * and optional fields behave as expected, that error classes have the right
 * properties, and that interfaces can be partially implemented.
 */
import { describe, it, expect } from "vitest"
import type {
  ResearchSubject,
  RawFinding,
  ScoredFinding,
  SynthesisOptions,
  SynthesisResult,
  Synthesizer,
  MinimalSource,
  SourcePhaseGroup,
  DebriefResult,
  ResearchConfig,
  CacheProvider,
  TelemetrySpan,
  TelemetryProvider,
  BatchProgressStats,
  BatchStats,
  LifecycleHooks,
} from "../types.js"
import {
  CostLimitExceededError,
  SourceTimeoutError,
  SourceAccessBlockedError,
} from "../types.js"

// ============================================================================
// ResearchSubject
// ============================================================================

describe("ResearchSubject", () => {
  it("accepts minimal fields (string id)", () => {
    const subject: ResearchSubject = { id: "abc-123", name: "Test Subject" }
    expect(subject.id).toBe("abc-123")
    expect(subject.name).toBe("Test Subject")
    expect(subject.context).toBeUndefined()
  })

  it("accepts minimal fields (numeric id)", () => {
    const subject: ResearchSubject = { id: 42, name: "Test Subject" }
    expect(subject.id).toBe(42)
  })

  it("accepts context with arbitrary metadata", () => {
    const subject: ResearchSubject = {
      id: 2157,
      name: "John Wayne",
      context: {
        deathday: "1979-06-11",
        tmdbId: 2157,
        genres: ["western", "war"],
        isAlive: false,
      },
    }
    expect(subject.context?.deathday).toBe("1979-06-11")
    expect(subject.context?.tmdbId).toBe(2157)
    expect(subject.context?.genres).toEqual(["western", "war"])
    expect(subject.context?.isAlive).toBe(false)
  })

  it("accepts empty context", () => {
    const subject: ResearchSubject = { id: 1, name: "X", context: {} }
    expect(subject.context).toEqual({})
  })
})

// ============================================================================
// RawFinding
// ============================================================================

describe("RawFinding", () => {
  it("has required fields", () => {
    const finding: RawFinding = {
      text: "He died of stomach cancer on June 11, 1979.",
      confidence: 0.85,
      costUsd: 0,
    }
    expect(finding.text).toContain("stomach cancer")
    expect(finding.confidence).toBe(0.85)
    expect(finding.costUsd).toBe(0)
  })

  it("optional fields are undefined when omitted", () => {
    const finding: RawFinding = {
      text: "Content",
      confidence: 0.5,
      costUsd: 0,
    }
    expect(finding.url).toBeUndefined()
    expect(finding.publication).toBeUndefined()
    expect(finding.articleTitle).toBeUndefined()
    expect(finding.metadata).toBeUndefined()
  })

  it("accepts all optional fields", () => {
    const finding: RawFinding = {
      text: "He died of stomach cancer.",
      url: "https://en.wikipedia.org/wiki/John_Wayne",
      publication: "Wikipedia",
      articleTitle: "John Wayne - Death",
      confidence: 0.95,
      costUsd: 0.001,
      metadata: { section: "Death", wordCount: 150 },
    }
    expect(finding.url).toBe("https://en.wikipedia.org/wiki/John_Wayne")
    expect(finding.publication).toBe("Wikipedia")
    expect(finding.articleTitle).toBe("John Wayne - Death")
    expect(finding.metadata?.section).toBe("Death")
  })

  it("accepts zero confidence", () => {
    const finding: RawFinding = { text: "Unrelated content", confidence: 0, costUsd: 0 }
    expect(finding.confidence).toBe(0)
  })

  it("accepts max confidence", () => {
    const finding: RawFinding = { text: "Verified death record", confidence: 1, costUsd: 0 }
    expect(finding.confidence).toBe(1)
  })
})

// ============================================================================
// ScoredFinding
// ============================================================================

describe("ScoredFinding", () => {
  it("extends RawFinding with source reliability info", () => {
    const finding: ScoredFinding = {
      text: "He died of stomach cancer.",
      confidence: 0.85,
      costUsd: 0,
      sourceType: "wikipedia",
      sourceName: "Wikipedia",
      reliabilityTier: "secondary",
      reliabilityScore: 0.85,
    }
    expect(finding.sourceType).toBe("wikipedia")
    expect(finding.sourceName).toBe("Wikipedia")
    expect(finding.reliabilityTier).toBe("secondary")
    expect(finding.reliabilityScore).toBe(0.85)
    // Inherited from RawFinding
    expect(finding.text).toContain("stomach cancer")
    expect(finding.confidence).toBe(0.85)
  })

  it("includes optional RawFinding fields", () => {
    const finding: ScoredFinding = {
      text: "Content",
      url: "https://example.com",
      publication: "The Guardian",
      articleTitle: "Obituary: John Wayne",
      confidence: 0.9,
      costUsd: 0.005,
      metadata: { author: "Jane Doe" },
      sourceType: "guardian",
      sourceName: "The Guardian",
      reliabilityTier: "tier_1_news",
      reliabilityScore: 0.95,
    }
    expect(finding.publication).toBe("The Guardian")
    expect(finding.reliabilityScore).toBe(0.95)
  })
})

// ============================================================================
// SynthesisOptions
// ============================================================================

describe("SynthesisOptions", () => {
  it("all fields are optional", () => {
    const options: SynthesisOptions = {}
    expect(options.model).toBeUndefined()
    expect(options.maxTokens).toBeUndefined()
    expect(options.systemPrompt).toBeUndefined()
    expect(options.responseSchema).toBeUndefined()
  })

  it("accepts all fields", () => {
    const options: SynthesisOptions = {
      model: "claude-sonnet-4-20250514",
      maxTokens: 4096,
      systemPrompt: "You are a research assistant.",
      responseSchema: { type: "object", properties: { summary: { type: "string" } } },
    }
    expect(options.model).toBe("claude-sonnet-4-20250514")
    expect(options.maxTokens).toBe(4096)
  })
})

// ============================================================================
// SynthesisResult
// ============================================================================

describe("SynthesisResult", () => {
  it("contains structured output and cost metadata", () => {
    interface TestOutput {
      summary: string
      confidence: string
    }

    const result: SynthesisResult<TestOutput> = {
      data: { summary: "Died of stomach cancer", confidence: "high" },
      costUsd: 0.025,
      inputTokens: 3000,
      outputTokens: 500,
      model: "claude-sonnet-4-20250514",
    }
    expect(result.data.summary).toBe("Died of stomach cancer")
    expect(result.costUsd).toBe(0.025)
    expect(result.inputTokens).toBe(3000)
    expect(result.outputTokens).toBe(500)
    expect(result.model).toBe("claude-sonnet-4-20250514")
  })
})

// ============================================================================
// Synthesizer interface
// ============================================================================

describe("Synthesizer", () => {
  it("can be implemented with custom subject and output types", async () => {
    interface MovieSubject extends ResearchSubject {
      context: { releaseYear: number }
    }
    interface MovieReport {
      summary: string
    }

    const mockSynthesizer: Synthesizer<MovieSubject, MovieReport> = {
      async synthesize(subject, findings, options) {
        return {
          data: { summary: `Report for ${subject.name} with ${findings.length} findings` },
          costUsd: 0.01,
          inputTokens: 1000,
          outputTokens: 200,
          model: options.model ?? "test-model",
        }
      },
    }

    const result = await mockSynthesizer.synthesize(
      { id: 1, name: "Test Movie", context: { releaseYear: 2020 } },
      [],
      { model: "claude-sonnet-4-20250514" }
    )
    expect(result.data.summary).toBe("Report for Test Movie with 0 findings")
    expect(result.model).toBe("claude-sonnet-4-20250514")
  })
})

// ============================================================================
// MinimalSource
// ============================================================================

describe("MinimalSource", () => {
  it("defines the contract for source phase group membership", () => {
    const source: MinimalSource<ResearchSubject> = {
      name: "wikipedia",
      type: "wikipedia",
      reliabilityTier: "secondary",
      reliabilityScore: 0.85,
      isFree: true,
      estimatedCostPerQuery: 0,
      domain: "en.wikipedia.org",
      isAvailable: () => true,
      lookup: async () => ({
        text: "Content from Wikipedia",
        confidence: 0.8,
        costUsd: 0,
      }),
    }
    expect(source.name).toBe("wikipedia")
    expect(source.isFree).toBe(true)
    expect(source.isAvailable()).toBe(true)
  })

  it("lookup can return null for no results", async () => {
    const source: MinimalSource<ResearchSubject> = {
      name: "obscure-source",
      type: "obscure",
      reliabilityTier: "unreliable_ugc",
      reliabilityScore: 0.35,
      isFree: true,
      estimatedCostPerQuery: 0,
      domain: "obscure.example.com",
      isAvailable: () => true,
      lookup: async () => null,
    }
    const result = await source.lookup(
      { id: 1, name: "Nobody" },
      AbortSignal.timeout(5000)
    )
    expect(result).toBeNull()
  })
})

// ============================================================================
// SourcePhaseGroup
// ============================================================================

describe("SourcePhaseGroup", () => {
  it("groups sources by phase with optional name", () => {
    const mockSource: MinimalSource<ResearchSubject> = {
      name: "wikidata",
      type: "wikidata",
      reliabilityTier: "structured_data",
      reliabilityScore: 1.0,
      isFree: true,
      estimatedCostPerQuery: 0,
      domain: "wikidata.org",
      isAvailable: () => true,
      lookup: async () => null,
    }

    const phase: SourcePhaseGroup<ResearchSubject> = {
      phase: 1,
      name: "Structured Data",
      sources: [mockSource],
    }
    expect(phase.phase).toBe(1)
    expect(phase.name).toBe("Structured Data")
    expect(phase.sources).toHaveLength(1)
    expect(phase.sources[0].name).toBe("wikidata")
  })

  it("name is optional", () => {
    const phase: SourcePhaseGroup<ResearchSubject> = {
      phase: 2,
      sources: [],
    }
    expect(phase.name).toBeUndefined()
    expect(phase.sources).toHaveLength(0)
  })
})

// ============================================================================
// DebriefResult
// ============================================================================

describe("DebriefResult", () => {
  it("contains all required fields for a successful debrief", () => {
    interface TestOutput {
      summary: string
    }

    const result: DebriefResult<TestOutput> = {
      subject: { id: 1, name: "John Wayne" },
      data: { summary: "Died of stomach cancer" },
      findings: [
        {
          text: "He died of stomach cancer.",
          confidence: 0.85,
          costUsd: 0,
          sourceType: "wikipedia",
          sourceName: "Wikipedia",
          reliabilityTier: "secondary",
          reliabilityScore: 0.85,
        },
      ],
      synthesisResult: {
        data: { summary: "Died of stomach cancer" },
        costUsd: 0.025,
        inputTokens: 3000,
        outputTokens: 500,
        model: "claude-sonnet-4-20250514",
      },
      totalCostUsd: 0.025,
      sourcesAttempted: 5,
      sourcesSucceeded: 3,
      stoppedAtPhase: 2,
      durationMs: 1500,
    }
    expect(result.subject.name).toBe("John Wayne")
    expect(result.data?.summary).toBe("Died of stomach cancer")
    expect(result.findings).toHaveLength(1)
    expect(result.totalCostUsd).toBe(0.025)
    expect(result.stoppedAtPhase).toBe(2)
  })

  it("data is null when synthesis fails or is skipped", () => {
    const result: DebriefResult<unknown> = {
      subject: { id: 1, name: "Unknown Person" },
      data: null,
      findings: [],
      totalCostUsd: 0,
      sourcesAttempted: 3,
      sourcesSucceeded: 0,
      durationMs: 500,
    }
    expect(result.data).toBeNull()
    expect(result.synthesisResult).toBeUndefined()
    expect(result.stoppedAtPhase).toBeUndefined()
  })
})

// ============================================================================
// ResearchConfig
// ============================================================================

describe("ResearchConfig", () => {
  it("can be constructed with no fields (all optional)", () => {
    const config: ResearchConfig = {}
    expect(config.concurrency).toBeUndefined()
    expect(config.categories).toBeUndefined()
    expect(config.costLimits).toBeUndefined()
  })

  it("can be constructed with sensible defaults", () => {
    const config: ResearchConfig = {
      concurrency: 5,
      confidenceThreshold: 0.6,
      reliabilityThreshold: 0.6,
      earlyStopThreshold: 3,
      costLimits: {
        maxCostPerSubject: 0.5,
        maxTotalCost: 50.0,
      },
    }
    expect(config.concurrency).toBe(5)
    expect(config.confidenceThreshold).toBe(0.6)
    expect(config.reliabilityThreshold).toBe(0.6)
    expect(config.earlyStopThreshold).toBe(3)
    expect(config.costLimits?.maxCostPerSubject).toBe(0.5)
    expect(config.costLimits?.maxTotalCost).toBe(50.0)
  })

  it("accepts category flags", () => {
    const config: ResearchConfig = {
      categories: {
        free: true,
        news: true,
        books: true,
        archives: false,
        ai: false,
      },
    }
    expect(config.categories?.free).toBe(true)
    expect(config.categories?.ai).toBe(false)
  })

  it("accepts synthesis options", () => {
    const config: ResearchConfig = {
      synthesis: {
        model: "claude-sonnet-4-20250514",
        maxTokens: 4096,
      },
    }
    expect(config.synthesis?.model).toBe("claude-sonnet-4-20250514")
  })

  it("accepts cache and telemetry providers", () => {
    const mockCache: CacheProvider = {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    }

    const mockTelemetry: TelemetryProvider = {
      recordEvent: () => {},
      startSpan: () => ({ end: () => {}, setAttributes: () => {} }),
      recordError: () => {},
    }

    const config: ResearchConfig = {
      cache: mockCache,
      telemetry: mockTelemetry,
    }
    expect(config.cache).toBeDefined()
    expect(config.telemetry).toBeDefined()
  })

  it("cost limits are individually optional", () => {
    const config1: ResearchConfig = {
      costLimits: { maxCostPerSubject: 1.0 },
    }
    expect(config1.costLimits?.maxCostPerSubject).toBe(1.0)
    expect(config1.costLimits?.maxTotalCost).toBeUndefined()

    const config2: ResearchConfig = {
      costLimits: { maxTotalCost: 100.0 },
    }
    expect(config2.costLimits?.maxCostPerSubject).toBeUndefined()
    expect(config2.costLimits?.maxTotalCost).toBe(100.0)
  })
})

// ============================================================================
// CacheProvider
// ============================================================================

describe("CacheProvider", () => {
  it("can be implemented with basic get/set/delete", async () => {
    const store = new Map<string, string>()
    const cache: CacheProvider = {
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => {
        store.set(key, value)
      },
      delete: async (key) => {
        store.delete(key)
      },
    }

    expect(await cache.get("missing")).toBeNull()
    await cache.set("key", "value")
    expect(await cache.get("key")).toBe("value")
    await cache.delete("key")
    expect(await cache.get("key")).toBeNull()
  })
})

// ============================================================================
// TelemetryProvider and TelemetrySpan
// ============================================================================

describe("TelemetryProvider", () => {
  it("can be implemented as a noop", () => {
    const noop: TelemetryProvider = {
      recordEvent: () => {},
      startSpan: () => ({ end: () => {}, setAttributes: () => {} }),
      recordError: () => {},
    }

    // Should not throw
    noop.recordEvent("test", { key: "value" })
    const span = noop.startSpan("operation")
    span.setAttributes({ source: "wikipedia", cost: 0.01, success: true })
    span.end()
    noop.recordError(new Error("test error"), { phase: 1 })
  })

  it("startSpan returns a TelemetrySpan with end and setAttributes", () => {
    const events: Array<{ name: string; attrs?: Record<string, string | number | boolean> }> = []
    const telemetry: TelemetryProvider = {
      recordEvent: () => {},
      startSpan: (name) => ({
        end: () => events.push({ name }),
        setAttributes: (attrs) => events.push({ name, attrs }),
      }),
      recordError: () => {},
    }

    const span = telemetry.startSpan("lookup")
    span.setAttributes({ source: "wikidata", cost: 0 })
    span.end()

    expect(events).toHaveLength(2)
    expect(events[0].attrs?.source).toBe("wikidata")
    expect(events[1].name).toBe("lookup")
  })
})

// ============================================================================
// BatchProgressStats and BatchStats
// ============================================================================

describe("BatchProgressStats", () => {
  it("tracks in-progress batch metrics", () => {
    const stats: BatchProgressStats = {
      completed: 3,
      total: 10,
      costUsd: 0.15,
      elapsedMs: 5000,
    }
    expect(stats.completed).toBe(3)
    expect(stats.total).toBe(10)
    expect(stats.costUsd).toBe(0.15)
    expect(stats.elapsedMs).toBe(5000)
  })
})

describe("BatchStats", () => {
  it("extends BatchProgressStats with final metrics", () => {
    const stats: BatchStats = {
      completed: 10,
      total: 10,
      costUsd: 0.50,
      elapsedMs: 30000,
      succeeded: 8,
      failed: 2,
      avgCostPerSubject: 0.05,
      avgDurationMs: 3000,
    }
    expect(stats.succeeded).toBe(8)
    expect(stats.failed).toBe(2)
    expect(stats.avgCostPerSubject).toBe(0.05)
    expect(stats.avgDurationMs).toBe(3000)
    // Inherited from BatchProgressStats
    expect(stats.completed).toBe(10)
    expect(stats.total).toBe(10)
  })
})

// ============================================================================
// LifecycleHooks
// ============================================================================

describe("LifecycleHooks", () => {
  it("can be partially implemented (all hooks are optional)", () => {
    const hooks: LifecycleHooks<ResearchSubject, unknown> = {
      onSubjectComplete: (subject, result) => {
        // Only care about completion
        void subject
        void result
      },
    }
    expect(hooks.onSubjectComplete).toBeDefined()
    expect(hooks.onRunStart).toBeUndefined()
    expect(hooks.onSourceAttempt).toBeUndefined()
    expect(hooks.onPhaseComplete).toBeUndefined()
    expect(hooks.onEarlyStop).toBeUndefined()
    expect(hooks.onSynthesisStart).toBeUndefined()
    expect(hooks.onSynthesisComplete).toBeUndefined()
    expect(hooks.onBatchProgress).toBeUndefined()
    expect(hooks.onCostLimitReached).toBeUndefined()
    expect(hooks.onRunComplete).toBeUndefined()
    expect(hooks.onRunFailed).toBeUndefined()
  })

  it("can be fully implemented", () => {
    const events: string[] = []

    const hooks: LifecycleHooks<ResearchSubject, unknown> = {
      onRunStart: (count) => events.push(`run-start:${count}`),
      onSubjectStart: (s, i, t) => events.push(`subject-start:${s.name}:${i}/${t}`),
      onSourceAttempt: (s, name) => events.push(`source-attempt:${name}`),
      onSourceComplete: (s, name, finding) =>
        events.push(`source-complete:${name}:${finding ? "found" : "empty"}`),
      onPhaseComplete: (s, phase, findings) =>
        events.push(`phase-complete:${phase}:${findings.length}`),
      onEarlyStop: (s, phase, reason) => events.push(`early-stop:${phase}:${reason}`),
      onSynthesisStart: (s, count) => events.push(`synthesis-start:${count}`),
      onSynthesisComplete: (s, result) => events.push(`synthesis-complete:$${result.costUsd}`),
      onSubjectComplete: (s, result) =>
        events.push(`subject-complete:${result.totalCostUsd}`),
      onBatchProgress: (stats) => events.push(`progress:${stats.completed}/${stats.total}`),
      onCostLimitReached: (s, cost, limit) =>
        events.push(`cost-limit:${cost}/${limit}`),
      onRunComplete: (stats) => events.push(`run-complete:${stats.succeeded}`),
      onRunFailed: (error) => events.push(`run-failed:${error.message}`),
    }

    // Simulate calling all hooks
    hooks.onRunStart!(10, {})
    hooks.onSubjectStart!({ id: 1, name: "Test" }, 0, 10)
    hooks.onSourceAttempt!({ id: 1, name: "Test" }, "wikipedia", 1)
    hooks.onSourceComplete!({ id: 1, name: "Test" }, "wikipedia", null, 0)
    hooks.onPhaseComplete!({ id: 1, name: "Test" }, 1, [])
    hooks.onEarlyStop!({ id: 1, name: "Test" }, 2, "3+ families")
    hooks.onSynthesisStart!({ id: 1, name: "Test" }, 5)
    hooks.onSynthesisComplete!({ id: 1, name: "Test" }, {
      data: null,
      costUsd: 0.02,
      inputTokens: 1000,
      outputTokens: 200,
      model: "test",
    })
    hooks.onSubjectComplete!({ id: 1, name: "Test" }, {
      subject: { id: 1, name: "Test" },
      data: null,
      findings: [],
      totalCostUsd: 0.02,
      sourcesAttempted: 5,
      sourcesSucceeded: 3,
      durationMs: 1000,
    })
    hooks.onBatchProgress!({ completed: 5, total: 10, costUsd: 0.1, elapsedMs: 5000 })
    hooks.onCostLimitReached!({ id: 1, name: "Test" }, 1.5, 1.0)
    hooks.onRunComplete!({
      completed: 10,
      total: 10,
      costUsd: 0.5,
      elapsedMs: 30000,
      succeeded: 8,
      failed: 2,
      avgCostPerSubject: 0.05,
      avgDurationMs: 3000,
    })
    hooks.onRunFailed!(new Error("Fatal error"))

    expect(events).toHaveLength(13)
    expect(events[0]).toBe("run-start:10")
    expect(events[events.length - 1]).toBe("run-failed:Fatal error")
  })

  it("empty object is valid (no hooks configured)", () => {
    const hooks: LifecycleHooks<ResearchSubject, unknown> = {}
    expect(Object.keys(hooks)).toHaveLength(0)
  })
})

// ============================================================================
// Error Types
// ============================================================================

describe("CostLimitExceededError", () => {
  it("has correct name and message", () => {
    const error = new CostLimitExceededError("actor-123", 1.5, 1.0)
    expect(error.name).toBe("CostLimitExceededError")
    expect(error.message).toBe(
      "Cost limit exceeded for subject actor-123: $1.5000 > $1.0000"
    )
  })

  it("exposes subjectId, costUsd, and limit properties", () => {
    const error = new CostLimitExceededError(42, 0.5123, 0.5)
    expect(error.subjectId).toBe(42)
    expect(error.costUsd).toBe(0.5123)
    expect(error.limit).toBe(0.5)
  })

  it("is an instance of Error", () => {
    const error = new CostLimitExceededError("1", 1, 0.5)
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(CostLimitExceededError)
  })

  it("accepts string subject id", () => {
    const error = new CostLimitExceededError("uuid-abc-123", 2.0, 1.0)
    expect(error.subjectId).toBe("uuid-abc-123")
  })

  it("accepts numeric subject id", () => {
    const error = new CostLimitExceededError(12345, 2.0, 1.0)
    expect(error.subjectId).toBe(12345)
  })

  it("formats small costs correctly", () => {
    const error = new CostLimitExceededError("1", 0.0001, 0.00005)
    expect(error.message).toContain("$0.0001")
    expect(error.message).toContain("$0.0001") // 0.00005 rounds to 0.0001
  })
})

describe("SourceTimeoutError", () => {
  it("has correct name and message", () => {
    const error = new SourceTimeoutError("Wikipedia", 30000)
    expect(error.name).toBe("SourceTimeoutError")
    expect(error.message).toBe("Source Wikipedia timed out after 30000ms")
  })

  it("exposes sourceName and timeoutMs properties", () => {
    const error = new SourceTimeoutError("Google Search", 15000)
    expect(error.sourceName).toBe("Google Search")
    expect(error.timeoutMs).toBe(15000)
  })

  it("is an instance of Error", () => {
    const error = new SourceTimeoutError("test", 1000)
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(SourceTimeoutError)
  })
})

describe("SourceAccessBlockedError", () => {
  it("has correct name and message for 403", () => {
    const error = new SourceAccessBlockedError("NYTimes", 403)
    expect(error.name).toBe("SourceAccessBlockedError")
    expect(error.message).toBe("Source NYTimes blocked with status 403")
  })

  it("has correct message for 429 rate limit", () => {
    const error = new SourceAccessBlockedError("Guardian", 429)
    expect(error.message).toBe("Source Guardian blocked with status 429")
  })

  it("exposes sourceName and statusCode properties", () => {
    const error = new SourceAccessBlockedError("BBC", 451)
    expect(error.sourceName).toBe("BBC")
    expect(error.statusCode).toBe(451)
  })

  it("is an instance of Error", () => {
    const error = new SourceAccessBlockedError("test", 403)
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(SourceAccessBlockedError)
  })
})

// ============================================================================
// Type Compatibility — verifies structural typing works across interfaces
// ============================================================================

describe("type compatibility", () => {
  it("ScoredFinding is assignable to RawFinding (structural subtype)", () => {
    const scored: ScoredFinding = {
      text: "Content",
      confidence: 0.5,
      costUsd: 0,
      sourceType: "test",
      sourceName: "Test",
      reliabilityTier: "secondary",
      reliabilityScore: 0.85,
    }
    // ScoredFinding extends RawFinding, so this should work
    const raw: RawFinding = scored
    expect(raw.text).toBe("Content")
    expect(raw.confidence).toBe(0.5)
  })

  it("BatchStats is assignable to BatchProgressStats (structural subtype)", () => {
    const batch: BatchStats = {
      completed: 10,
      total: 10,
      costUsd: 0.5,
      elapsedMs: 30000,
      succeeded: 8,
      failed: 2,
      avgCostPerSubject: 0.05,
      avgDurationMs: 3000,
    }
    const progress: BatchProgressStats = batch
    expect(progress.completed).toBe(10)
    expect(progress.total).toBe(10)
  })

  it("domain-specific subject extends ResearchSubject", () => {
    interface ActorSubject extends ResearchSubject {
      context: {
        birthday: string
        deathday: string | null
        tmdbId: number
      }
    }

    const actor: ActorSubject = {
      id: 2157,
      name: "John Wayne",
      context: {
        birthday: "1907-05-26",
        deathday: "1979-06-11",
        tmdbId: 2157,
      },
    }

    // Should be assignable to ResearchSubject
    const subject: ResearchSubject = actor
    expect(subject.name).toBe("John Wayne")
    expect(subject.context?.birthday).toBe("1907-05-26")
  })
})
