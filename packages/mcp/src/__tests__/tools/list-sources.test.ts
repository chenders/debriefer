/**
 * Tests for the list_sources tool handler.
 *
 * Verifies that source metadata is returned as JSON, supports
 * category filtering, and returns empty for unknown categories.
 */

import { describe, it, expect } from "vitest"
import { listSourcesHandler } from "../../tools/list-sources.js"

// ============================================================================
// All sources
// ============================================================================

describe("listSourcesHandler — all sources", () => {
  it("returns all sources with expected properties", () => {
    const result = listSourcesHandler({})
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")

    const data = JSON.parse((result.content[0] as { type: "text"; text: string }).text)
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)

    for (const source of data) {
      expect(source).toHaveProperty("name")
      expect(source).toHaveProperty("type")
      expect(source).toHaveProperty("category")
      expect(source).toHaveProperty("reliabilityTier")
      expect(source).toHaveProperty("reliabilityScore")
      expect(source).toHaveProperty("domain")
      expect(source).toHaveProperty("isFree")
      expect(source).toHaveProperty("estimatedCostPerQuery")
      expect(source).toHaveProperty("available")
    }
  })
})

// ============================================================================
// Category filtering
// ============================================================================

describe("listSourcesHandler — category filter", () => {
  it("filters by category", () => {
    const result = listSourcesHandler({ category: "structured" })
    const data = JSON.parse((result.content[0] as { type: "text"; text: string }).text)
    expect(data.length).toBeGreaterThan(0)
    for (const source of data) {
      expect(source.category).toBe("structured")
    }
  })

  it("returns empty array for unknown category", () => {
    const result = listSourcesHandler({ category: "nonexistent" })
    const data = JSON.parse((result.content[0] as { type: "text"; text: string }).text)
    expect(data).toEqual([])
  })
})
