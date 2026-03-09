/**
 * Tests for CLI text formatters.
 *
 * Verifies human-readable formatting of debrief results (synthesized,
 * raw findings, null data) and source list table output.
 */

import { describe, it, expect } from "vitest"
import { ReliabilityTier, RELIABILITY_SCORES } from "debriefer"
import type { DebriefResult, ScoredFinding, ResearchSubject, BaseResearchSource } from "debriefer"
import { formatDebriefResult, formatSourceList } from "../formatters.js"

// ============================================================================
// Helpers
// ============================================================================

function makeSubject(overrides: Partial<ResearchSubject> = {}): ResearchSubject {
  return { id: 1, name: "John Wayne", ...overrides }
}

function makeScoredFinding(overrides: Partial<ScoredFinding> = {}): ScoredFinding {
  return {
    text: "John Wayne was an American actor who died on June 11, 1979.",
    url: "https://en.wikipedia.org/wiki/John_Wayne",
    publication: "Wikipedia",
    articleTitle: "John Wayne",
    confidence: 0.85,
    costUsd: 0,
    sourceType: "wikipedia",
    sourceName: "Wikipedia",
    reliabilityTier: ReliabilityTier.SECONDARY_COMPILATION,
    reliabilityScore: RELIABILITY_SCORES[ReliabilityTier.SECONDARY_COMPILATION],
    ...overrides,
  }
}

/**
 * Creates a minimal mock source object with required BaseResearchSource properties.
 * We use a plain object cast since we only need the readonly properties for formatting.
 */
function makeMockSource(
  overrides: Partial<{
    name: string
    type: string
    reliabilityTier: ReliabilityTier
    isFree: boolean
    domain: string
    estimatedCostPerQuery: number
    isAvailable: () => boolean
  }> = {}
): BaseResearchSource<ResearchSubject> {
  const defaults = {
    name: "Wikipedia",
    type: "wikipedia",
    reliabilityTier: ReliabilityTier.SECONDARY_COMPILATION,
    reliabilityScore: RELIABILITY_SCORES[ReliabilityTier.SECONDARY_COMPILATION],
    isFree: true,
    domain: "en.wikipedia.org",
    estimatedCostPerQuery: 0,
    isAvailable: () => true,
  }
  return { ...defaults, ...overrides } as unknown as BaseResearchSource<ResearchSubject>
}

// ============================================================================
// formatDebriefResult — synthesized output (string data)
// ============================================================================

describe("formatDebriefResult", () => {
  it("formats synthesized string data with header and synthesis section", () => {
    const result: DebriefResult<string> = {
      subject: makeSubject(),
      data: "John Wayne was a legendary American actor known for Western films.",
      findings: [makeScoredFinding()],
      totalCostUsd: 0.0012,
      sourcesAttempted: 5,
      sourcesSucceeded: 3,
      durationMs: 2500,
    }

    const output = formatDebriefResult(result)

    // Header info
    expect(output).toContain("John Wayne")
    expect(output).toContain("3/5")
    expect(output).toContain("$0.0012")
    expect(output).toContain("2.5s")

    // Synthesis section
    expect(output).toContain("--- Synthesis ---")
    expect(output).toContain("legendary American actor")
  })

  it("shows stoppedAtPhase when set", () => {
    const result: DebriefResult<string> = {
      subject: makeSubject(),
      data: "Some synthesis.",
      findings: [makeScoredFinding()],
      totalCostUsd: 0,
      sourcesAttempted: 3,
      sourcesSucceeded: 2,
      stoppedAtPhase: 2,
      durationMs: 1000,
    }

    const output = formatDebriefResult(result)
    expect(output).toContain("Stopped at phase 2")
  })

  // ============================================================================
  // formatDebriefResult — raw findings (array data)
  // ============================================================================

  it("formats raw findings array with source details", () => {
    const findings: ScoredFinding[] = [
      makeScoredFinding({
        text: "Finding from Wikipedia about John Wayne.",
        sourceName: "Wikipedia",
        reliabilityTier: ReliabilityTier.SECONDARY_COMPILATION,
        confidence: 0.85,
        url: "https://en.wikipedia.org/wiki/John_Wayne",
      }),
      makeScoredFinding({
        text: "AP News reported on his passing.",
        sourceName: "AP News",
        sourceType: "ap_news",
        reliabilityTier: ReliabilityTier.TIER_1_NEWS,
        reliabilityScore: RELIABILITY_SCORES[ReliabilityTier.TIER_1_NEWS],
        confidence: 0.9,
        url: "https://apnews.com/article/john-wayne",
      }),
    ]

    const result: DebriefResult<ScoredFinding[]> = {
      subject: makeSubject(),
      data: findings,
      findings,
      totalCostUsd: 0.0005,
      sourcesAttempted: 4,
      sourcesSucceeded: 2,
      durationMs: 1800,
    }

    const output = formatDebriefResult(result)

    // Should show each finding
    expect(output).toContain("Wikipedia")
    expect(output).toContain("AP News")
    expect(output).toContain("secondary")
    expect(output).toContain("tier_1_news")
    expect(output).toContain("0.85")
    expect(output).toContain("0.90")
    expect(output).toContain("https://en.wikipedia.org/wiki/John_Wayne")
    expect(output).toContain("https://apnews.com/article/john-wayne")
  })

  it("truncates finding text to 300 characters", () => {
    const longText = "A".repeat(500)
    const findings: ScoredFinding[] = [makeScoredFinding({ text: longText })]

    const result: DebriefResult<ScoredFinding[]> = {
      subject: makeSubject(),
      data: findings,
      findings,
      totalCostUsd: 0,
      sourcesAttempted: 1,
      sourcesSucceeded: 1,
      durationMs: 500,
    }

    const output = formatDebriefResult(result)

    // Should contain truncated text with ellipsis, not the full 500 chars
    expect(output).toContain("A".repeat(300) + "...")
    expect(output).not.toContain("A".repeat(301))
  })

  // ============================================================================
  // formatDebriefResult — null data
  // ============================================================================

  it("shows 'No findings collected.' when data is null", () => {
    const result: DebriefResult<string> = {
      subject: makeSubject(),
      data: null,
      findings: [],
      totalCostUsd: 0,
      sourcesAttempted: 3,
      sourcesSucceeded: 0,
      durationMs: 1200,
    }

    const output = formatDebriefResult(result)

    expect(output).toContain("No findings collected.")
    expect(output).toContain("0/3")
  })

  // ============================================================================
  // formatDebriefResult — structured (object) data
  // ============================================================================

  it("JSON-stringifies structured object data", () => {
    const structuredData = { occupation: "Actor", birthYear: 1907 }

    const result: DebriefResult<{ occupation: string; birthYear: number }> = {
      subject: makeSubject(),
      data: structuredData,
      findings: [makeScoredFinding()],
      totalCostUsd: 0.003,
      sourcesAttempted: 6,
      sourcesSucceeded: 4,
      durationMs: 3000,
    }

    const output = formatDebriefResult(result)

    expect(output).toContain('"occupation"')
    expect(output).toContain('"Actor"')
    expect(output).toContain("1907")
  })
})

// ============================================================================
// formatSourceList
// ============================================================================

describe("formatSourceList", () => {
  it("produces a table with source info and header", () => {
    const sources = [
      makeMockSource({
        name: "Wikipedia",
        type: "wikipedia",
        reliabilityTier: ReliabilityTier.SECONDARY_COMPILATION,
        isFree: true,
        isAvailable: () => true,
      }),
      makeMockSource({
        name: "Google Search",
        type: "google_search",
        reliabilityTier: ReliabilityTier.SEARCH_AGGREGATOR,
        isFree: false,
        isAvailable: () => false,
      }),
    ]

    const output = formatSourceList(sources)

    // Header
    expect(output).toContain("All available sources")

    // Column headers
    expect(output).toContain("Name")
    expect(output).toContain("Type")
    expect(output).toContain("Tier")
    expect(output).toContain("Free")
    expect(output).toContain("Available")

    // Separator line
    expect(output).toContain("---")

    // Source rows
    expect(output).toContain("Wikipedia")
    expect(output).toContain("Google Search")
    expect(output).toContain("secondary")
    expect(output).toContain("search_aggregator")

    // Free column values
    expect(output).toMatch(/Yes/)
    expect(output).toMatch(/No/)

    // Footer
    expect(output).toContain("1 of 2 sources available")
  })

  it("shows category filter in header when provided", () => {
    const sources = [makeMockSource({ name: "Wikipedia" })]

    const output = formatSourceList(sources, "structured")

    expect(output).toContain("structured")
    expect(output).not.toContain("All available sources")
  })

  it("shows correct available count in footer", () => {
    const sources = [
      makeMockSource({ name: "Source A", isAvailable: () => true }),
      makeMockSource({ name: "Source B", isAvailable: () => true }),
      makeMockSource({ name: "Source C", isAvailable: () => false }),
    ]

    const output = formatSourceList(sources)

    expect(output).toContain("2 of 3 sources available")
  })

  it("handles empty source list", () => {
    const output = formatSourceList([])

    expect(output).toContain("0 of 0 sources available")
  })
})
