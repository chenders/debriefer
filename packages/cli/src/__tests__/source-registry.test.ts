/**
 * Tests for the source registry.
 *
 * Verifies category mapping, source creation for individual and combined
 * categories, and graceful handling of unknown category names.
 */

import { describe, it, expect } from "vitest"
import { SOURCE_CATEGORIES, createSources } from "../source-registry.js"

// ============================================================================
// SOURCE_CATEGORIES structure
// ============================================================================

describe("SOURCE_CATEGORIES", () => {
  it("has exactly 6 categories", () => {
    expect(Object.keys(SOURCE_CATEGORIES)).toHaveLength(6)
  })

  it("contains expected category names", () => {
    const expected = ["structured", "news", "search", "books", "archives", "obituary"]
    expect(Object.keys(SOURCE_CATEGORIES).sort()).toEqual(expected.sort())
  })

  it("structured has 2 factories", () => {
    expect(SOURCE_CATEGORIES.structured).toHaveLength(2)
  })

  it("news has 22 factories", () => {
    expect(SOURCE_CATEGORIES.news).toHaveLength(22)
  })

  it("search has 4 factories", () => {
    expect(SOURCE_CATEGORIES.search).toHaveLength(4)
  })

  it("books has 2 factories", () => {
    expect(SOURCE_CATEGORIES.books).toHaveLength(2)
  })

  it("archives has 4 factories", () => {
    expect(SOURCE_CATEGORIES.archives).toHaveLength(4)
  })

  it("obituary has 2 factories", () => {
    expect(SOURCE_CATEGORIES.obituary).toHaveLength(2)
  })
})

// ============================================================================
// createSources
// ============================================================================

describe("createSources", () => {
  it("returns all sources when no categories specified", () => {
    const sources = createSources()
    const totalFactories = Object.values(SOURCE_CATEGORIES).reduce(
      (sum, arr) => sum + arr.length,
      0
    )
    expect(sources).toHaveLength(totalFactories)
  })

  it("returns only structured sources for ['structured']", () => {
    const sources = createSources(["structured"])
    expect(sources).toHaveLength(2)
    const types = sources.map((s) => s.type)
    expect(types).toContain("wikidata")
    expect(types).toContain("wikipedia")
  })

  it("combines multiple categories", () => {
    const sources = createSources(["structured", "books"])
    expect(sources).toHaveLength(4)
  })

  it("silently ignores unknown categories", () => {
    const sources = createSources(["structured", "nonexistent"])
    expect(sources).toHaveLength(2)
  })

  it("returns empty array when all categories are unknown", () => {
    const sources = createSources(["nonexistent", "also-fake"])
    expect(sources).toHaveLength(0)
  })

  it("returns source instances with expected properties", () => {
    const sources = createSources(["structured"])
    for (const source of sources) {
      expect(source).toHaveProperty("name")
      expect(source).toHaveProperty("type")
      expect(source).toHaveProperty("reliabilityTier")
    }
  })
})
