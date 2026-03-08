import { describe, it, expect, vi, beforeEach } from "vitest"
import { ResearchOrchestrator } from "../orchestrator.js"
import type { BaseResearchSource } from "../base-source.js"
import { ReliabilityTier } from "../reliability.js"
import type {
  ResearchSubject,
  RawFinding,
  ScoredFinding,
  SynthesisResult,
  Synthesizer,
  SourcePhaseGroup,
  LifecycleHooks,
  DebriefResult,
} from "../types.js"

// ============================================================================
// Test Fixtures
// ============================================================================

const makeSubject = (
  overrides: Partial<ResearchSubject> = {}
): ResearchSubject => ({
  id: 1,
  name: "Test Subject",
  ...overrides,
})

function makeFinding(overrides: Partial<RawFinding> = {}): RawFinding {
  return {
    text: "Some relevant text about the subject.",
    url: "https://example.com/article",
    confidence: 0.8,
    costUsd: 0.001,
    ...overrides,
  }
}

// ============================================================================
// Mock Source Factory
// ============================================================================

/**
 * Create a mock source that implements the MinimalSource interface
 * and the injection methods that the orchestrator calls.
 */
function createMockSource(
  overrides: {
    name?: string
    type?: string
    reliabilityTier?: ReliabilityTier
    reliabilityScore?: number
    domain?: string
    isFree?: boolean
    estimatedCostPerQuery?: number
    isAvailable?: boolean
    finding?: RawFinding | null
    lookupDelay?: number
    shouldThrow?: boolean
    onLookup?: () => void
  } = {}
): BaseResearchSource<ResearchSubject> {
  const tier = overrides.reliabilityTier ?? ReliabilityTier.TIER_1_NEWS
  const finding =
    overrides.finding !== undefined ? overrides.finding : makeFinding()

  const source = {
    name: overrides.name ?? "MockSource",
    type: overrides.type ?? "mock_source",
    reliabilityTier: tier,
    reliabilityScore: overrides.reliabilityScore ?? 0.95,
    domain: overrides.domain ?? "mock.example.com",
    isFree: overrides.isFree ?? true,
    estimatedCostPerQuery: overrides.estimatedCostPerQuery ?? 0,
    isAvailable: vi.fn().mockReturnValue(overrides.isAvailable ?? true),
    lookup: vi.fn().mockImplementation(async () => {
      overrides.onLookup?.()
      if (overrides.shouldThrow) {
        throw new Error(`Source ${overrides.name ?? "MockSource"} failed`)
      }
      if (overrides.lookupDelay) {
        await new Promise((r) => setTimeout(r, overrides.lookupDelay))
      }
      return finding
    }),
    setRateLimiter: vi.fn(),
    setCache: vi.fn(),
    setTelemetry: vi.fn(),
    buildQuery: vi.fn().mockReturnValue("test query"),
  }

  return source as unknown as BaseResearchSource<ResearchSubject>
}

// ============================================================================
// Mock Synthesizer
// ============================================================================

function createMockSynthesizer(): Synthesizer<ResearchSubject, { result: string }> & {
  synthesize: ReturnType<typeof vi.fn>
} {
  return {
    synthesize: vi.fn().mockResolvedValue({
      data: { result: "synthesized" },
      costUsd: 0.01,
      inputTokens: 100,
      outputTokens: 50,
      model: "test-model",
    } satisfies SynthesisResult<{ result: string }>),
  }
}

// ============================================================================
// Helper: create phase groups
// ============================================================================

function makePhase(
  phase: number,
  sources: BaseResearchSource<ResearchSubject>[],
  name?: string
): SourcePhaseGroup<ResearchSubject> {
  return { phase, sources, name }
}

// ============================================================================
// Tests
// ============================================================================

describe("ResearchOrchestrator", () => {
  describe("debrief", () => {
    // Test 1: Executes phases sequentially
    it("executes phases sequentially — phase 0 before phase 1", async () => {
      const callOrder: string[] = []

      const sourceA = createMockSource({
        name: "PhaseZeroSource",
        type: "phase_zero",
        onLookup: () => callOrder.push("phase0"),
      })
      const sourceB = createMockSource({
        name: "PhaseOneSource",
        type: "phase_one",
        onLookup: () => callOrder.push("phase1"),
        // Use a different tier so early stop doesn't trigger
        reliabilityTier: ReliabilityTier.UNRELIABLE_UGC,
        reliabilityScore: 0.35,
      })

      const synthesizer = createMockSynthesizer()
      const orchestrator = new ResearchOrchestrator(
        [makePhase(0, [sourceA]), makePhase(1, [sourceB])],
        synthesizer,
        { earlyStopThreshold: 10 }
      )

      await orchestrator.debrief(makeSubject())

      expect(callOrder).toEqual(["phase0", "phase1"])
    })

    // Test 2: Sources within a phase run concurrently
    it("sources within a phase run concurrently", async () => {
      let concurrentCount = 0
      let maxConcurrent = 0

      const makeTimedSource = (name: string) =>
        createMockSource({
          name,
          type: name,
          reliabilityTier: ReliabilityTier.UNRELIABLE_UGC,
          reliabilityScore: 0.35,
          lookupDelay: 50,
          onLookup: () => {
            concurrentCount++
            maxConcurrent = Math.max(maxConcurrent, concurrentCount)
            // Decrement happens after the delay in the lookup mock,
            // but we need to track it differently since onLookup fires
            // before the delay. Let's use a different approach.
          },
        })

      // Override: track concurrency via a shared counter that includes the delay
      let inFlight = 0
      let peakInFlight = 0

      const makeParallelSource = (name: string) => {
        const source = createMockSource({ name, type: name })
        ;(source.lookup as ReturnType<typeof vi.fn>).mockImplementation(
          async () => {
            inFlight++
            peakInFlight = Math.max(peakInFlight, inFlight)
            await new Promise((r) => setTimeout(r, 50))
            inFlight--
            return makeFinding()
          }
        )
        return source
      }

      const s1 = makeParallelSource("src1")
      const s2 = makeParallelSource("src2")
      const s3 = makeParallelSource("src3")

      const synthesizer = createMockSynthesizer()
      const orchestrator = new ResearchOrchestrator(
        [makePhase(0, [s1, s2, s3])],
        synthesizer,
        { earlyStopThreshold: 10 }
      )

      await orchestrator.debrief(makeSubject())

      // All 3 should have been in flight simultaneously
      expect(peakInFlight).toBe(3)
    })

    // Test 3: Accumulates findings from all sources across phases
    it("accumulates findings from all sources across phases", async () => {
      const source1 = createMockSource({
        name: "S1",
        type: "s1",
        finding: makeFinding({ text: "finding 1" }),
        reliabilityTier: ReliabilityTier.UNRELIABLE_UGC,
        reliabilityScore: 0.35,
      })
      const source2 = createMockSource({
        name: "S2",
        type: "s2",
        finding: makeFinding({ text: "finding 2" }),
        reliabilityTier: ReliabilityTier.UNRELIABLE_FAST,
        reliabilityScore: 0.5,
      })
      const source3 = createMockSource({
        name: "S3",
        type: "s3",
        finding: makeFinding({ text: "finding 3" }),
        reliabilityTier: ReliabilityTier.AI_MODEL,
        reliabilityScore: 0.55,
      })

      const synthesizer = createMockSynthesizer()
      const orchestrator = new ResearchOrchestrator(
        [makePhase(0, [source1]), makePhase(1, [source2, source3])],
        synthesizer,
        { earlyStopThreshold: 10 }
      )

      const result = await orchestrator.debrief(makeSubject())

      expect(result.findings).toHaveLength(3)
      expect(result.findings.map((f) => f.text)).toEqual([
        "finding 1",
        "finding 2",
        "finding 3",
      ])
    })

    // Test 4: Passes all findings to synthesizer
    it("passes all findings to synthesizer", async () => {
      const source1 = createMockSource({
        name: "S1",
        type: "s1",
        reliabilityTier: ReliabilityTier.UNRELIABLE_UGC,
        reliabilityScore: 0.35,
      })
      const source2 = createMockSource({
        name: "S2",
        type: "s2",
        reliabilityTier: ReliabilityTier.UNRELIABLE_FAST,
        reliabilityScore: 0.5,
      })

      const synthesizer = createMockSynthesizer()
      const orchestrator = new ResearchOrchestrator(
        [makePhase(0, [source1, source2])],
        synthesizer,
        { earlyStopThreshold: 10 }
      )

      const subject = makeSubject()
      await orchestrator.debrief(subject)

      expect(synthesizer.synthesize).toHaveBeenCalledTimes(1)
      const [passedSubject, passedFindings] =
        synthesizer.synthesize.mock.calls[0]!
      expect(passedSubject).toBe(subject)
      expect(passedFindings).toHaveLength(2)
      expect(passedFindings[0]).toHaveProperty("sourceType", "s1")
      expect(passedFindings[1]).toHaveProperty("sourceType", "s2")
    })

    // Test 5: Returns DebriefResult with correct fields
    it("returns DebriefResult with correct fields", async () => {
      const source = createMockSource({
        finding: makeFinding({ costUsd: 0.005 }),
      })
      const synthesizer = createMockSynthesizer()
      const orchestrator = new ResearchOrchestrator(
        [makePhase(0, [source])],
        synthesizer
      )

      const subject = makeSubject({ id: 42, name: "John Wayne" })
      const result = await orchestrator.debrief(subject)

      expect(result.subject).toBe(subject)
      expect(result.data).toEqual({ result: "synthesized" })
      expect(result.findings).toHaveLength(1)
      expect(result.synthesisResult).toBeDefined()
      expect(result.synthesisResult!.model).toBe("test-model")
      // totalCostUsd = source cost (0.005) + synthesis cost (0.01)
      expect(result.totalCostUsd).toBeCloseTo(0.015, 5)
      expect(result.sourcesAttempted).toBe(1)
      expect(result.sourcesSucceeded).toBe(1)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    // Test 6: Early stops when high-quality family threshold is met
    it("early stops when earlyStopThreshold is met", async () => {
      // Create 3 sources in phase 0 with different reliability tiers
      // that all exceed both confidence and reliability thresholds
      const source1 = createMockSource({
        name: "S1",
        type: "s1",
        reliabilityTier: ReliabilityTier.TIER_1_NEWS,
        reliabilityScore: 0.95,
        finding: makeFinding({ confidence: 0.9 }),
      })
      const source2 = createMockSource({
        name: "S2",
        type: "s2",
        reliabilityTier: ReliabilityTier.TRADE_PRESS,
        reliabilityScore: 0.9,
        finding: makeFinding({ confidence: 0.8 }),
      })
      const source3 = createMockSource({
        name: "S3",
        type: "s3",
        reliabilityTier: ReliabilityTier.ARCHIVAL,
        reliabilityScore: 0.9,
        finding: makeFinding({ confidence: 0.7 }),
      })

      // Phase 1 source should never be called
      const phase1Source = createMockSource({
        name: "NeverCalled",
        type: "never_called",
      })

      const synthesizer = createMockSynthesizer()
      const orchestrator = new ResearchOrchestrator(
        [makePhase(0, [source1, source2, source3]), makePhase(1, [phase1Source])],
        synthesizer,
        { earlyStopThreshold: 3, confidenceThreshold: 0.6, reliabilityThreshold: 0.6 }
      )

      const result = await orchestrator.debrief(makeSubject())

      // Phase 1 source should not have been called
      expect(phase1Source.lookup).not.toHaveBeenCalled()
      expect(result.stoppedAtPhase).toBe(0)
      expect(result.findings).toHaveLength(3)
    })

    // Test 7: Continues when threshold NOT met
    it("continues to next phase when threshold is NOT met", async () => {
      // Only 1 high-quality source in phase 0 (threshold is 3)
      const source1 = createMockSource({
        name: "S1",
        type: "s1",
        reliabilityTier: ReliabilityTier.TIER_1_NEWS,
        reliabilityScore: 0.95,
        finding: makeFinding({ confidence: 0.9 }),
      })

      const phase1Source = createMockSource({
        name: "P1Source",
        type: "p1_source",
        reliabilityTier: ReliabilityTier.UNRELIABLE_UGC,
        reliabilityScore: 0.35,
        finding: makeFinding({ confidence: 0.3 }),
      })

      const synthesizer = createMockSynthesizer()
      const orchestrator = new ResearchOrchestrator(
        [makePhase(0, [source1]), makePhase(1, [phase1Source])],
        synthesizer,
        { earlyStopThreshold: 3 }
      )

      const result = await orchestrator.debrief(makeSubject())

      // Phase 1 source SHOULD have been called
      expect(phase1Source.lookup).toHaveBeenCalled()
      expect(result.stoppedAtPhase).toBeUndefined()
      expect(result.findings).toHaveLength(2)
    })

    // Test 8: Respects per-subject cost limit
    it("respects per-subject cost limit", async () => {
      const expensiveSource = createMockSource({
        name: "Expensive",
        type: "expensive",
        finding: makeFinding({ costUsd: 0.50 }),
        reliabilityTier: ReliabilityTier.UNRELIABLE_UGC,
        reliabilityScore: 0.35,
      })

      const phase1Source = createMockSource({
        name: "CheapSource",
        type: "cheap",
      })

      const synthesizer = createMockSynthesizer()
      const orchestrator = new ResearchOrchestrator(
        [makePhase(0, [expensiveSource]), makePhase(1, [phase1Source])],
        synthesizer,
        {
          earlyStopThreshold: 10,
          costLimits: { maxCostPerSubject: 0.25 },
        }
      )

      const result = await orchestrator.debrief(makeSubject())

      // Phase 1 should not have been called — cost limit hit after phase 0
      expect(phase1Source.lookup).not.toHaveBeenCalled()
      expect(result.stoppedAtPhase).toBe(0)
    })

    // Test 9: Handles source errors gracefully
    it("handles source errors gracefully — other sources still run", async () => {
      const failingSource = createMockSource({
        name: "Failing",
        type: "failing",
        shouldThrow: true,
      })
      const workingSource = createMockSource({
        name: "Working",
        type: "working",
        finding: makeFinding({ text: "good data" }),
      })

      const synthesizer = createMockSynthesizer()
      const orchestrator = new ResearchOrchestrator(
        [makePhase(0, [failingSource, workingSource])],
        synthesizer,
        { earlyStopThreshold: 10 }
      )

      const result = await orchestrator.debrief(makeSubject())

      // The working source's finding should be collected
      expect(result.findings).toHaveLength(1)
      expect(result.findings[0]!.text).toBe("good data")
      expect(result.sourcesAttempted).toBe(2)
      expect(result.sourcesSucceeded).toBe(1)
    })

    // Test 10: Returns null data when no findings
    it("returns null data when no findings — synthesis not called", async () => {
      const emptySource = createMockSource({
        name: "Empty",
        type: "empty",
        finding: null,
      })

      const synthesizer = createMockSynthesizer()
      const orchestrator = new ResearchOrchestrator(
        [makePhase(0, [emptySource])],
        synthesizer
      )

      const result = await orchestrator.debrief(makeSubject())

      expect(result.data).toBeNull()
      expect(result.findings).toHaveLength(0)
      expect(result.synthesisResult).toBeUndefined()
      expect(synthesizer.synthesize).not.toHaveBeenCalled()
    })

    // Test 11: Skips unavailable sources
    it("skips unavailable sources — never calls lookup", async () => {
      const unavailableSource = createMockSource({
        name: "Unavailable",
        type: "unavailable",
        isAvailable: false,
      })
      const availableSource = createMockSource({
        name: "Available",
        type: "available",
        finding: makeFinding({ text: "available data" }),
      })

      const synthesizer = createMockSynthesizer()
      const orchestrator = new ResearchOrchestrator(
        [makePhase(0, [unavailableSource, availableSource])],
        synthesizer,
        { earlyStopThreshold: 10 }
      )

      const result = await orchestrator.debrief(makeSubject())

      expect(unavailableSource.lookup).not.toHaveBeenCalled()
      expect(result.findings).toHaveLength(1)
      expect(result.sourcesAttempted).toBe(1)
    })
  })

  describe("debriefBatch", () => {
    // Test 12: Processes multiple subjects
    it("processes multiple subjects and returns results in map", async () => {
      const source = createMockSource({ name: "BatchSource", type: "batch" })
      const synthesizer = createMockSynthesizer()
      const orchestrator = new ResearchOrchestrator(
        [makePhase(0, [source])],
        synthesizer,
        { earlyStopThreshold: 10 }
      )

      const subjects = [
        makeSubject({ id: "s1", name: "Subject 1" }),
        makeSubject({ id: "s2", name: "Subject 2" }),
        makeSubject({ id: "s3", name: "Subject 3" }),
      ]

      const results = await orchestrator.debriefBatch(subjects)

      expect(results.size).toBe(3)
      expect(results.has("s1")).toBe(true)
      expect(results.has("s2")).toBe(true)
      expect(results.has("s3")).toBe(true)
      expect(results.get("s1")!.data).toEqual({ result: "synthesized" })
    })

    // Test 13: Fires lifecycle hooks
    it("fires lifecycle hooks in correct order", async () => {
      const source = createMockSource({ name: "HookSource", type: "hook" })
      const synthesizer = createMockSynthesizer()
      const orchestrator = new ResearchOrchestrator(
        [makePhase(0, [source])],
        synthesizer,
        { concurrency: 1, earlyStopThreshold: 10 }
      )

      const hooks: LifecycleHooks<ResearchSubject, { result: string }> = {
        onRunStart: vi.fn(),
        onSubjectStart: vi.fn(),
        onSubjectComplete: vi.fn(),
        onBatchProgress: vi.fn(),
        onRunComplete: vi.fn(),
      }

      const subjects = [
        makeSubject({ id: "a", name: "A" }),
        makeSubject({ id: "b", name: "B" }),
      ]

      await orchestrator.debriefBatch(subjects, hooks)

      // onRunStart called once with subject count
      expect(hooks.onRunStart).toHaveBeenCalledTimes(1)
      expect(hooks.onRunStart).toHaveBeenCalledWith(2, expect.any(Object))

      // onSubjectStart called for each subject
      expect(hooks.onSubjectStart).toHaveBeenCalledTimes(2)

      // onSubjectComplete called for each subject
      expect(hooks.onSubjectComplete).toHaveBeenCalledTimes(2)

      // onBatchProgress called for each subject
      expect(hooks.onBatchProgress).toHaveBeenCalledTimes(2)
      expect(hooks.onBatchProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          completed: expect.any(Number),
          total: 2,
          costUsd: expect.any(Number),
          elapsedMs: expect.any(Number),
        })
      )

      // onRunComplete called once with batch stats
      expect(hooks.onRunComplete).toHaveBeenCalledTimes(1)
      expect(hooks.onRunComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          completed: 2,
          total: 2,
          succeeded: 2,
          failed: 0,
          costUsd: expect.any(Number),
          elapsedMs: expect.any(Number),
          avgCostPerSubject: expect.any(Number),
          avgDurationMs: expect.any(Number),
        })
      )
    })

    // Test 14: Respects total cost limit
    it("respects total cost limit — remaining subjects get empty results", async () => {
      // Each source returns a finding costing $0.50 + synthesis costs $0.01
      const source = createMockSource({
        name: "CostlySource",
        type: "costly",
        finding: makeFinding({ costUsd: 0.50 }),
      })

      const synthesizer = createMockSynthesizer()
      const orchestrator = new ResearchOrchestrator(
        [makePhase(0, [source])],
        synthesizer,
        {
          concurrency: 1,
          earlyStopThreshold: 10,
          costLimits: { maxTotalCost: 0.60 },
        }
      )

      const subjects = [
        makeSubject({ id: "s1", name: "Subject 1" }),
        makeSubject({ id: "s2", name: "Subject 2" }),
        makeSubject({ id: "s3", name: "Subject 3" }),
      ]

      const results = await orchestrator.debriefBatch(subjects)

      // First subject should succeed (cost ~$0.51)
      const s1Result = results.get("s1")
      expect(s1Result).toBeDefined()
      expect(s1Result!.data).toEqual({ result: "synthesized" })

      // After first subject, total cost exceeds $0.60 limit.
      // Remaining subjects should get empty results.
      const emptyResults = Array.from(results.values()).filter(
        (r) => r.data === null
      )
      expect(emptyResults.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("infrastructure injection", () => {
    it("injects rate limiter into all sources", () => {
      const source = createMockSource({ name: "InjSource" })
      const synthesizer = createMockSynthesizer()

      new ResearchOrchestrator(
        [makePhase(0, [source])],
        synthesizer
      )

      expect(source.setRateLimiter).toHaveBeenCalledTimes(1)
    })

    it("injects cache when provided in config", () => {
      const source = createMockSource({ name: "CacheSource" })
      const synthesizer = createMockSynthesizer()
      const cache = {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
      }

      new ResearchOrchestrator(
        [makePhase(0, [source])],
        synthesizer,
        { cache }
      )

      expect(source.setCache).toHaveBeenCalledWith(cache)
    })

    it("injects telemetry into all sources", () => {
      const source = createMockSource({ name: "TelSource" })
      const synthesizer = createMockSynthesizer()

      new ResearchOrchestrator(
        [makePhase(0, [source])],
        synthesizer
      )

      expect(source.setTelemetry).toHaveBeenCalledTimes(1)
    })
  })

  describe("synthesis error handling", () => {
    it("returns null data when synthesis throws", async () => {
      const source = createMockSource({ name: "GoodSource" })
      const synthesizer = createMockSynthesizer()
      synthesizer.synthesize.mockRejectedValue(new Error("Synthesis failed"))

      const orchestrator = new ResearchOrchestrator(
        [makePhase(0, [source])],
        synthesizer,
        { earlyStopThreshold: 10 }
      )

      const result = await orchestrator.debrief(makeSubject())

      expect(result.data).toBeNull()
      expect(result.findings).toHaveLength(1) // Finding still collected
      expect(result.synthesisResult).toBeUndefined()
    })
  })
})
