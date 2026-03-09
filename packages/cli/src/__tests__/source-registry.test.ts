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

  it("every category has at least one factory", () => {
    for (const [name, factories] of Object.entries(SOURCE_CATEGORIES)) {
      expect(factories.length, `${name} should have factories`).toBeGreaterThan(0)
    }
  })

  it("structured includes wikidata and wikipedia", () => {
    const types = SOURCE_CATEGORIES.structured.map((f) => f().type)
    expect(types).toContain("wikidata")
    expect(types).toContain("wikipedia")
  })

  it("news includes AP and Guardian", () => {
    const types = SOURCE_CATEGORIES.news.map((f) => f().type)
    expect(types).toContain("ap-news")
    expect(types).toContain("guardian")
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
    expect(sources.length).toBe(SOURCE_CATEGORIES.structured.length)
    const types = sources.map((s) => s.type)
    expect(types).toContain("wikidata")
    expect(types).toContain("wikipedia")
  })

  it("combines multiple categories", () => {
    const sources = createSources(["structured", "books"])
    const expected = SOURCE_CATEGORIES.structured.length + SOURCE_CATEGORIES.books.length
    expect(sources.length).toBe(expected)
  })

  it("silently ignores unknown categories", () => {
    const sources = createSources(["structured", "nonexistent"])
    expect(sources.length).toBe(SOURCE_CATEGORIES.structured.length)
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
