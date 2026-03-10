/**
 * Tests for the MCP source registry.
 *
 * Verifies category mapping, source creation with category tagging,
 * category filtering, and graceful handling of unknown category names.
 */

import { describe, it, expect } from "vitest"
import {
  SOURCE_CATEGORIES,
  VALID_CATEGORIES,
  createSourcesWithCategory,
} from "../source-registry.js"

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

  it("VALID_CATEGORIES matches SOURCE_CATEGORIES keys", () => {
    expect(VALID_CATEGORIES.sort()).toEqual(Object.keys(SOURCE_CATEGORIES).sort())
  })

  it("every category has at least one factory", () => {
    for (const [name, factories] of Object.entries(SOURCE_CATEGORIES)) {
      expect(factories.length, `${name} should have factories`).toBeGreaterThan(0)
    }
  })
})

// ============================================================================
// createSourcesWithCategory
// ============================================================================

describe("createSourcesWithCategory", () => {
  it("returns all sources when no categories specified", () => {
    const results = createSourcesWithCategory()
    const totalFactories = Object.values(SOURCE_CATEGORIES).reduce(
      (sum, arr) => sum + arr.length,
      0
    )
    expect(results).toHaveLength(totalFactories)
  })

  it("filters by category", () => {
    const results = createSourcesWithCategory(["structured"])
    expect(results).toHaveLength(SOURCE_CATEGORIES.structured.length)
    for (const r of results) {
      expect(r.category).toBe("structured")
    }
  })

  it("ignores unknown categories", () => {
    const results = createSourcesWithCategory(["structured", "nonexistent"])
    expect(results).toHaveLength(SOURCE_CATEGORIES.structured.length)
  })

  it("returns empty array when all categories are unknown", () => {
    const results = createSourcesWithCategory(["nonexistent", "also-fake"])
    expect(results).toHaveLength(0)
  })
})
