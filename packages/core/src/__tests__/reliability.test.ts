/**
 * Tests for the Wikipedia RSP-based reliability scoring system.
 *
 * Verifies that all tiers exist, scores are correctly assigned, ordering
 * is maintained, and utility functions behave as expected.
 */
import { describe, it, expect } from "vitest"
import {
  ReliabilityTier,
  RELIABILITY_SCORES,
  getReliabilityScore,
  meetsReliabilityThreshold,
} from "../reliability.js"

// ============================================================================
// ReliabilityTier enum
// ============================================================================

describe("ReliabilityTier", () => {
  const allTiers = Object.values(ReliabilityTier)

  it("has exactly 12 tiers", () => {
    expect(allTiers).toHaveLength(12)
  })

  it("contains all expected tier values", () => {
    const expected = [
      "structured_data",
      "tier_1_news",
      "trade_press",
      "archival",
      "secondary",
      "search_aggregator",
      "archive_mirror",
      "marginal_editorial",
      "marginal_mixed",
      "ai_model",
      "unreliable_fast",
      "unreliable_ugc",
    ]
    expect(allTiers.sort()).toEqual(expected.sort())
  })

  it("all enum values are lowercase_snake_case strings", () => {
    for (const tier of allTiers) {
      expect(tier).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/) // eslint-disable-line security/detect-unsafe-regex
    }
  })

  it("enum keys map to expected string values", () => {
    expect(ReliabilityTier.STRUCTURED_DATA).toBe("structured_data")
    expect(ReliabilityTier.TIER_1_NEWS).toBe("tier_1_news")
    expect(ReliabilityTier.TRADE_PRESS).toBe("trade_press")
    expect(ReliabilityTier.ARCHIVAL).toBe("archival")
    expect(ReliabilityTier.SECONDARY_COMPILATION).toBe("secondary")
    expect(ReliabilityTier.SEARCH_AGGREGATOR).toBe("search_aggregator")
    expect(ReliabilityTier.ARCHIVE_MIRROR).toBe("archive_mirror")
    expect(ReliabilityTier.MARGINAL_EDITORIAL).toBe("marginal_editorial")
    expect(ReliabilityTier.MARGINAL_MIXED).toBe("marginal_mixed")
    expect(ReliabilityTier.AI_MODEL).toBe("ai_model")
    expect(ReliabilityTier.UNRELIABLE_FAST).toBe("unreliable_fast")
    expect(ReliabilityTier.UNRELIABLE_UGC).toBe("unreliable_ugc")
  })
})

// ============================================================================
// RELIABILITY_SCORES
// ============================================================================

describe("RELIABILITY_SCORES", () => {
  it("has a score for every tier in the enum", () => {
    const allTiers = Object.values(ReliabilityTier)
    for (const tier of allTiers) {
      expect(RELIABILITY_SCORES[tier]).toBeDefined()
      expect(typeof RELIABILITY_SCORES[tier]).toBe("number")
    }
  })

  it("has no extra entries beyond the enum values", () => {
    const scoreKeys = Object.keys(RELIABILITY_SCORES)
    const tierValues = Object.values(ReliabilityTier)
    expect(scoreKeys).toHaveLength(tierValues.length)
  })

  it("all scores are between 0 and 1 inclusive", () => {
    for (const [_tier, score] of Object.entries(RELIABILITY_SCORES)) {
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
  })

  it("matches expected scores for each tier", () => {
    expect(RELIABILITY_SCORES[ReliabilityTier.STRUCTURED_DATA]).toBe(1.0)
    expect(RELIABILITY_SCORES[ReliabilityTier.TIER_1_NEWS]).toBe(0.95)
    expect(RELIABILITY_SCORES[ReliabilityTier.TRADE_PRESS]).toBe(0.9)
    expect(RELIABILITY_SCORES[ReliabilityTier.ARCHIVAL]).toBe(0.9)
    expect(RELIABILITY_SCORES[ReliabilityTier.SECONDARY_COMPILATION]).toBe(0.85)
    expect(RELIABILITY_SCORES[ReliabilityTier.SEARCH_AGGREGATOR]).toBe(0.7)
    expect(RELIABILITY_SCORES[ReliabilityTier.ARCHIVE_MIRROR]).toBe(0.7)
    expect(RELIABILITY_SCORES[ReliabilityTier.MARGINAL_EDITORIAL]).toBe(0.65)
    expect(RELIABILITY_SCORES[ReliabilityTier.MARGINAL_MIXED]).toBe(0.6)
    expect(RELIABILITY_SCORES[ReliabilityTier.AI_MODEL]).toBe(0.55)
    expect(RELIABILITY_SCORES[ReliabilityTier.UNRELIABLE_FAST]).toBe(0.5)
    expect(RELIABILITY_SCORES[ReliabilityTier.UNRELIABLE_UGC]).toBe(0.35)
  })

  it("scores are in descending order from STRUCTURED_DATA to UNRELIABLE_UGC", () => {
    const orderedTiers = [
      ReliabilityTier.STRUCTURED_DATA,
      ReliabilityTier.TIER_1_NEWS,
      ReliabilityTier.TRADE_PRESS,
      // ARCHIVAL ties with TRADE_PRESS at 0.9
      ReliabilityTier.ARCHIVAL,
      ReliabilityTier.SECONDARY_COMPILATION,
      ReliabilityTier.SEARCH_AGGREGATOR,
      // ARCHIVE_MIRROR ties with SEARCH_AGGREGATOR at 0.7
      ReliabilityTier.ARCHIVE_MIRROR,
      ReliabilityTier.MARGINAL_EDITORIAL,
      ReliabilityTier.MARGINAL_MIXED,
      ReliabilityTier.AI_MODEL,
      ReliabilityTier.UNRELIABLE_FAST,
      ReliabilityTier.UNRELIABLE_UGC,
    ]

    for (let i = 0; i < orderedTiers.length - 1; i++) {
      const currentScore = RELIABILITY_SCORES[orderedTiers[i]]
      const nextScore = RELIABILITY_SCORES[orderedTiers[i + 1]]
      expect(currentScore).toBeGreaterThanOrEqual(nextScore)
    }
  })

  it("STRUCTURED_DATA has the highest score (1.0)", () => {
    const maxScore = Math.max(...Object.values(RELIABILITY_SCORES))
    expect(RELIABILITY_SCORES[ReliabilityTier.STRUCTURED_DATA]).toBe(maxScore)
    expect(maxScore).toBe(1.0)
  })

  it("UNRELIABLE_UGC has the lowest score (0.35)", () => {
    const minScore = Math.min(...Object.values(RELIABILITY_SCORES))
    expect(RELIABILITY_SCORES[ReliabilityTier.UNRELIABLE_UGC]).toBe(minScore)
    expect(minScore).toBe(0.35)
  })

  it("ARCHIVAL and TRADE_PRESS share the same score (0.9)", () => {
    expect(RELIABILITY_SCORES[ReliabilityTier.ARCHIVAL]).toBe(
      RELIABILITY_SCORES[ReliabilityTier.TRADE_PRESS]
    )
    expect(RELIABILITY_SCORES[ReliabilityTier.ARCHIVAL]).toBe(0.9)
  })

  it("SEARCH_AGGREGATOR and ARCHIVE_MIRROR share the same score (0.7)", () => {
    expect(RELIABILITY_SCORES[ReliabilityTier.SEARCH_AGGREGATOR]).toBe(
      RELIABILITY_SCORES[ReliabilityTier.ARCHIVE_MIRROR]
    )
    expect(RELIABILITY_SCORES[ReliabilityTier.SEARCH_AGGREGATOR]).toBe(0.7)
  })
})

// ============================================================================
// getReliabilityScore
// ============================================================================

describe("getReliabilityScore", () => {
  it("returns the correct score for each tier", () => {
    expect(getReliabilityScore(ReliabilityTier.STRUCTURED_DATA)).toBe(1.0)
    expect(getReliabilityScore(ReliabilityTier.TIER_1_NEWS)).toBe(0.95)
    expect(getReliabilityScore(ReliabilityTier.TRADE_PRESS)).toBe(0.9)
    expect(getReliabilityScore(ReliabilityTier.ARCHIVAL)).toBe(0.9)
    expect(getReliabilityScore(ReliabilityTier.SECONDARY_COMPILATION)).toBe(0.85)
    expect(getReliabilityScore(ReliabilityTier.SEARCH_AGGREGATOR)).toBe(0.7)
    expect(getReliabilityScore(ReliabilityTier.ARCHIVE_MIRROR)).toBe(0.7)
    expect(getReliabilityScore(ReliabilityTier.MARGINAL_EDITORIAL)).toBe(0.65)
    expect(getReliabilityScore(ReliabilityTier.MARGINAL_MIXED)).toBe(0.6)
    expect(getReliabilityScore(ReliabilityTier.AI_MODEL)).toBe(0.55)
    expect(getReliabilityScore(ReliabilityTier.UNRELIABLE_FAST)).toBe(0.5)
    expect(getReliabilityScore(ReliabilityTier.UNRELIABLE_UGC)).toBe(0.35)
  })

  it("returns the same value as direct RELIABILITY_SCORES lookup", () => {
    for (const tier of Object.values(ReliabilityTier)) {
      expect(getReliabilityScore(tier)).toBe(RELIABILITY_SCORES[tier])
    }
  })
})

// ============================================================================
// meetsReliabilityThreshold
// ============================================================================

describe("meetsReliabilityThreshold", () => {
  it("returns true when score equals the threshold", () => {
    expect(meetsReliabilityThreshold(ReliabilityTier.TIER_1_NEWS, 0.95)).toBe(true)
    expect(meetsReliabilityThreshold(ReliabilityTier.UNRELIABLE_UGC, 0.35)).toBe(true)
  })

  it("returns true when score exceeds the threshold", () => {
    expect(meetsReliabilityThreshold(ReliabilityTier.STRUCTURED_DATA, 0.5)).toBe(true)
    expect(meetsReliabilityThreshold(ReliabilityTier.TIER_1_NEWS, 0.6)).toBe(true)
    expect(meetsReliabilityThreshold(ReliabilityTier.TRADE_PRESS, 0.8)).toBe(true)
  })

  it("returns false when score is below the threshold", () => {
    expect(meetsReliabilityThreshold(ReliabilityTier.UNRELIABLE_UGC, 0.5)).toBe(false)
    expect(meetsReliabilityThreshold(ReliabilityTier.AI_MODEL, 0.6)).toBe(false)
    expect(meetsReliabilityThreshold(ReliabilityTier.UNRELIABLE_FAST, 0.95)).toBe(false)
  })

  it("all tiers meet a threshold of 0", () => {
    for (const tier of Object.values(ReliabilityTier)) {
      expect(meetsReliabilityThreshold(tier, 0)).toBe(true)
    }
  })

  it("only STRUCTURED_DATA meets a threshold of 1.0", () => {
    for (const tier of Object.values(ReliabilityTier)) {
      if (tier === ReliabilityTier.STRUCTURED_DATA) {
        expect(meetsReliabilityThreshold(tier, 1.0)).toBe(true)
      } else {
        expect(meetsReliabilityThreshold(tier, 1.0)).toBe(false)
      }
    }
  })

  it("works with the default 0.6 threshold used by the orchestrator", () => {
    const threshold = 0.6
    // Should pass
    expect(meetsReliabilityThreshold(ReliabilityTier.STRUCTURED_DATA, threshold)).toBe(true)
    expect(meetsReliabilityThreshold(ReliabilityTier.TIER_1_NEWS, threshold)).toBe(true)
    expect(meetsReliabilityThreshold(ReliabilityTier.TRADE_PRESS, threshold)).toBe(true)
    expect(meetsReliabilityThreshold(ReliabilityTier.ARCHIVAL, threshold)).toBe(true)
    expect(meetsReliabilityThreshold(ReliabilityTier.SECONDARY_COMPILATION, threshold)).toBe(true)
    expect(meetsReliabilityThreshold(ReliabilityTier.SEARCH_AGGREGATOR, threshold)).toBe(true)
    expect(meetsReliabilityThreshold(ReliabilityTier.ARCHIVE_MIRROR, threshold)).toBe(true)
    expect(meetsReliabilityThreshold(ReliabilityTier.MARGINAL_EDITORIAL, threshold)).toBe(true)
    expect(meetsReliabilityThreshold(ReliabilityTier.MARGINAL_MIXED, threshold)).toBe(true)
    // Should fail
    expect(meetsReliabilityThreshold(ReliabilityTier.AI_MODEL, threshold)).toBe(false)
    expect(meetsReliabilityThreshold(ReliabilityTier.UNRELIABLE_FAST, threshold)).toBe(false)
    expect(meetsReliabilityThreshold(ReliabilityTier.UNRELIABLE_UGC, threshold)).toBe(false)
  })
})
