import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ResearchSubject, TelemetryProvider } from "debriefer"
import type { WikipediaSection, WebSearchResult } from "debriefer-sources"
import type { AIClient, AICompletionRequest, AICompletionResponse } from "../ai-client.js"
import { createAISectionFilter } from "../section-filter.js"
import { createAIConfidenceScorer } from "../confidence.js"
import { createAILinkSelector } from "../link-selector.js"
import { createAIPersonValidator } from "../person-validator.js"
import { createAIDefaults } from "../index.js"

// ============================================================================
// Mock AI Client
// ============================================================================

function mockClient(response: string): AIClient & { complete: ReturnType<typeof vi.fn> } {
  return {
    complete: vi.fn().mockResolvedValue({
      text: response,
      usage: { inputTokens: 100, outputTokens: 50 },
    } satisfies AICompletionResponse),
  }
}

function failingClient(error: string): AIClient & { complete: ReturnType<typeof vi.fn> } {
  return {
    complete: vi.fn().mockRejectedValue(new Error(error)),
  }
}

function mockTelemetry(): TelemetryProvider & {
  recordEvent: ReturnType<typeof vi.fn>
  startSpan: ReturnType<typeof vi.fn>
  recordError: ReturnType<typeof vi.fn>
} {
  return {
    recordEvent: vi.fn(),
    startSpan: vi.fn().mockReturnValue({ end: vi.fn(), setAttributes: vi.fn() }),
    recordError: vi.fn(),
  }
}

const testSubject: ResearchSubject = {
  id: 1,
  name: "Marie Curie",
  context: { birthYear: "1867", deathday: "1934-07-04", occupation: "physicist" },
}

const testSections: WikipediaSection[] = [
  { index: 0, title: "Introduction", depth: 0 },
  { index: 1, title: "Early life", depth: 0 },
  { index: 2, title: "Scientific career", depth: 0 },
  { index: 3, title: "Nobel Prizes", depth: 0 },
  { index: 4, title: "Death", depth: 0 },
  { index: 5, title: "Legacy", depth: 0 },
]

const testSearchResults: WebSearchResult[] = [
  { url: "https://example.com/a", title: "Result A", snippet: "About Marie" },
  { url: "https://example.com/b", title: "Result B", snippet: "Unrelated page" },
  { url: "https://example.com/c", title: "Result C", snippet: "Curie biography" },
]

// ============================================================================
// Section Filter
// ============================================================================

describe("createAISectionFilter", () => {
  it("returns sections selected by AI", async () => {
    const client = mockClient("[0, 3, 4]")
    const filter = createAISectionFilter({
      client,
      researchGoal: "Find death info",
      fallbackToHeuristics: true,
    })

    const result = await filter(testSections, "Full article text...")

    expect(result).toHaveLength(3)
    expect(result.map((s) => s.index)).toEqual([0, 3, 4])
    expect(client.complete).toHaveBeenCalledOnce()
  })

  it("falls back to all sections on AI failure when fallback enabled", async () => {
    const client = failingClient("API error")
    const telemetry = mockTelemetry()
    const filter = createAISectionFilter({
      client,
      fallbackToHeuristics: true,
      telemetry,
    })

    const result = await filter(testSections, "Full article text...")

    expect(result).toEqual(testSections)
    expect(telemetry.recordEvent).toHaveBeenCalledWith(
      "ai.call_failed",
      expect.objectContaining({
        callback: "sectionFilter",
        fallback: true,
      })
    )
  })

  it("returns empty on AI failure when fallback disabled", async () => {
    const client = failingClient("API error")
    const filter = createAISectionFilter({
      client,
      fallbackToHeuristics: false,
    })

    const result = await filter(testSections, "Full article text...")

    expect(result).toEqual([])
  })

  it("returns all sections when AI returns invalid JSON", async () => {
    const client = mockClient("not valid json")
    const filter = createAISectionFilter({
      client,
      fallbackToHeuristics: true,
    })

    const result = await filter(testSections, "Full article text...")

    expect(result).toEqual(testSections)
  })

  it("returns all sections when AI returns empty array", async () => {
    const client = mockClient("[]")
    const filter = createAISectionFilter({
      client,
      fallbackToHeuristics: true,
    })

    const result = await filter(testSections, "Full article text...")

    expect(result).toEqual(testSections)
  })

  it("returns empty array for empty input", async () => {
    const client = mockClient("[0]")
    const filter = createAISectionFilter({
      client,
      fallbackToHeuristics: true,
    })

    const result = await filter([], "")

    expect(result).toEqual([])
    expect(client.complete).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Confidence Scorer
// ============================================================================

describe("createAIConfidenceScorer", () => {
  it("returns AI-assessed confidence score", async () => {
    const client = mockClient("0.85")
    const scorer = createAIConfidenceScorer({
      client,
      researchGoal: "Find death info",
      fallbackToHeuristics: true,
    })

    const result = await scorer("Marie Curie died in 1934.", testSubject)

    expect(result).toBe(0.85)
    expect(client.complete).toHaveBeenCalledOnce()
  })

  it("returns 0 for empty text", async () => {
    const client = mockClient("0.85")
    const scorer = createAIConfidenceScorer({
      client,
      fallbackToHeuristics: true,
    })

    const result = await scorer("", testSubject)

    expect(result).toBe(0)
    expect(client.complete).not.toHaveBeenCalled()
  })

  it("falls back to 0.5 on AI failure when fallback enabled", async () => {
    const client = failingClient("Rate limited")
    const telemetry = mockTelemetry()
    const scorer = createAIConfidenceScorer({
      client,
      fallbackToHeuristics: true,
      telemetry,
    })

    const result = await scorer("Some text", testSubject)

    expect(result).toBe(0.5)
    expect(telemetry.recordEvent).toHaveBeenCalledWith(
      "ai.call_failed",
      expect.objectContaining({
        callback: "confidenceScorer",
      })
    )
  })

  it("returns 0 on AI failure when fallback disabled", async () => {
    const client = failingClient("Rate limited")
    const scorer = createAIConfidenceScorer({
      client,
      fallbackToHeuristics: false,
    })

    const result = await scorer("Some text", testSubject)

    expect(result).toBe(0)
  })

  it("falls back on invalid score (out of range)", async () => {
    const client = mockClient("1.5")
    const scorer = createAIConfidenceScorer({
      client,
      fallbackToHeuristics: true,
    })

    const result = await scorer("Some text", testSubject)

    expect(result).toBe(0.5) // fallback
  })

  it("falls back on non-numeric response", async () => {
    const client = mockClient("very relevant")
    const scorer = createAIConfidenceScorer({
      client,
      fallbackToHeuristics: true,
    })

    const result = await scorer("Some text", testSubject)

    expect(result).toBe(0.5) // fallback
  })
})

// ============================================================================
// Link Selector
// ============================================================================

describe("createAILinkSelector", () => {
  it("reorders results based on AI ranking", async () => {
    const client = mockClient("[2, 0, 1]")
    const selector = createAILinkSelector({
      client,
      researchGoal: "Find death info",
      fallbackToHeuristics: true,
    })

    const result = await selector(testSearchResults, testSubject)

    expect(result).toHaveLength(3)
    expect(result[0].url).toBe("https://example.com/c")
    expect(result[1].url).toBe("https://example.com/a")
    expect(result[2].url).toBe("https://example.com/b")
  })

  it("returns empty array for empty input", async () => {
    const client = mockClient("[]")
    const selector = createAILinkSelector({
      client,
      fallbackToHeuristics: true,
    })

    const result = await selector([], testSubject)

    expect(result).toEqual([])
    expect(client.complete).not.toHaveBeenCalled()
  })

  it("falls back to original order on AI failure when fallback enabled", async () => {
    const client = failingClient("API error")
    const selector = createAILinkSelector({
      client,
      fallbackToHeuristics: true,
    })

    const result = await selector(testSearchResults, testSubject)

    expect(result).toEqual(testSearchResults)
  })

  it("returns empty on AI failure when fallback disabled", async () => {
    const client = failingClient("API error")
    const selector = createAILinkSelector({
      client,
      fallbackToHeuristics: false,
    })

    const result = await selector(testSearchResults, testSubject)

    expect(result).toEqual([])
  })

  it("appends unmentioned results at the end", async () => {
    // AI only mentions index 2, remaining should be appended
    const client = mockClient("[2]")
    const selector = createAILinkSelector({
      client,
      fallbackToHeuristics: true,
    })

    const result = await selector(testSearchResults, testSubject)

    expect(result).toHaveLength(3)
    expect(result[0].url).toBe("https://example.com/c") // AI picked
    expect(result[1].url).toBe("https://example.com/a") // appended
    expect(result[2].url).toBe("https://example.com/b") // appended
  })

  it("deduplicates repeated indices from AI", async () => {
    const client = mockClient("[0, 0, 1, 1, 2]")
    const selector = createAILinkSelector({
      client,
      fallbackToHeuristics: true,
    })

    const result = await selector(testSearchResults, testSubject)

    expect(result).toHaveLength(3)
  })
})

// ============================================================================
// Person Validator
// ============================================================================

describe("createAIPersonValidator", () => {
  it("returns true when AI confirms person match", async () => {
    const client = mockClient("true")
    const validator = createAIPersonValidator({
      client,
      fallbackToHeuristics: true,
    })

    const result = await validator("Marie Curie was a physicist born in Warsaw.", testSubject)

    expect(result).toBe(true)
    expect(client.complete).toHaveBeenCalledOnce()
  })

  it("returns false when AI denies person match", async () => {
    const client = mockClient("false")
    const validator = createAIPersonValidator({
      client,
      fallbackToHeuristics: true,
    })

    const result = await validator("Pierre Curie was born in Paris.", testSubject)

    expect(result).toBe(false)
  })

  it("returns false for empty article text", async () => {
    const client = mockClient("true")
    const validator = createAIPersonValidator({
      client,
      fallbackToHeuristics: true,
    })

    const result = await validator("", testSubject)

    expect(result).toBe(false)
    expect(client.complete).not.toHaveBeenCalled()
  })

  it("falls back to true on AI failure when fallback enabled", async () => {
    const client = failingClient("Network error")
    const validator = createAIPersonValidator({
      client,
      fallbackToHeuristics: true,
    })

    const result = await validator("Some article text", testSubject)

    expect(result).toBe(true)
  })

  it("returns false on AI failure when fallback disabled", async () => {
    const client = failingClient("Network error")
    const validator = createAIPersonValidator({
      client,
      fallbackToHeuristics: false,
    })

    const result = await validator("Some article text", testSubject)

    expect(result).toBe(false)
  })

  it("includes context hints in the prompt", async () => {
    const client = mockClient("true")
    const validator = createAIPersonValidator({
      client,
      fallbackToHeuristics: true,
    })

    await validator("Some text", testSubject)

    const call = client.complete.mock.calls[0][0] as AICompletionRequest
    expect(call.user).toContain("Born: 1867")
    expect(call.user).toContain("Died: 1934-07-04")
    expect(call.user).toContain("Occupation: physicist")
  })
})

// ============================================================================
// createAIDefaults
// ============================================================================

describe("createAIDefaults", () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = originalEnv
  })

  it("creates all four callbacks with a custom client", () => {
    const client = mockClient("test")
    const ai = createAIDefaults({ client })

    expect(ai.sectionFilter).toBeTypeOf("function")
    expect(ai.confidenceScorer).toBeTypeOf("function")
    expect(ai.linkSelector).toBeTypeOf("function")
    expect(ai.personValidator).toBeTypeOf("function")
    expect(ai.isAvailable).toBe(true)
  })

  it("reports unavailable when no API key and no custom client", () => {
    delete process.env.ANTHROPIC_API_KEY
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const ai = createAIDefaults()

    expect(ai.isAvailable).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("ANTHROPIC_API_KEY not set"))

    warnSpy.mockRestore()
  })

  it("provides passthrough callbacks when unavailable", async () => {
    delete process.env.ANTHROPIC_API_KEY
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const ai = createAIDefaults()

    const sections = await ai.sectionFilter(testSections, "text")
    expect(sections).toEqual(testSections)

    const confidence = await ai.confidenceScorer("text", testSubject)
    expect(confidence).toBe(0.5)

    const links = await ai.linkSelector(testSearchResults, testSubject)
    expect(links).toEqual(testSearchResults)

    const valid = await ai.personValidator("text", testSubject)
    expect(valid).toBe(true)

    vi.restoreAllMocks()
  })

  it("reports available when API key is set", () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    const ai = createAIDefaults()

    expect(ai.isAvailable).toBe(true)
  })

  it("reports available when explicit apiKey provided", () => {
    delete process.env.ANTHROPIC_API_KEY
    const ai = createAIDefaults({ apiKey: "explicit-key" })

    expect(ai.isAvailable).toBe(true)
  })
})
