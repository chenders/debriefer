/**
 * Tests for DuckDuckGoSearchSource.
 *
 * Mocks the shared searchDuckDuckGo utility and the WebSearchBase pipeline
 * utilities (fetchPage, extractArticleContent) so the tests only exercise
 * DuckDuckGo-specific code: metadata, isAvailable, performSearch delegation,
 * and the factory function.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier } from "debriefer"

// ============================================================================
// Mocks — must be declared before importing the module under test
// ============================================================================

const mockSearchDDG = vi.fn()
vi.mock("../../shared/duckduckgo-search.js", () => ({
  searchDuckDuckGo: (...args: unknown[]) => mockSearchDDG(...args),
}))
vi.mock("../../shared/fetch-page.js", () => ({
  fetchPage: vi.fn().mockResolvedValue({ content: "", url: "", fetchMethod: "none" }),
}))
vi.mock("../../shared/readability-extract.js", () => ({
  extractArticleContent: vi.fn().mockReturnValue(null),
}))

import { DuckDuckGoSearchSource, duckduckgoSearch } from "../../web-search/duckduckgo.js"

// ============================================================================
// Lifecycle
// ============================================================================

beforeEach(() => {
  mockSearchDDG.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// Tests
// ============================================================================

describe("DuckDuckGoSearchSource", () => {
  // ==========================================================================
  // Metadata
  // ==========================================================================

  describe("metadata", () => {
    it("has correct name, type, reliabilityTier, domain, isFree, and estimatedCostPerQuery", () => {
      const source = new DuckDuckGoSearchSource()

      expect(source.name).toBe("DuckDuckGo")
      expect(source.type).toBe("duckduckgo-search")
      expect(source.reliabilityTier).toBe(ReliabilityTier.SEARCH_AGGREGATOR)
      expect(source.domain).toBe("html.duckduckgo.com")
      expect(source.isFree).toBe(true)
      expect(source.estimatedCostPerQuery).toBe(0)
    })
  })

  // ==========================================================================
  // isAvailable — always true (no API key needed)
  // ==========================================================================

  describe("isAvailable", () => {
    it("always returns true since no API key is required", () => {
      const source = new DuckDuckGoSearchSource()
      expect(source.isAvailable()).toBe(true)
    })
  })

  // ==========================================================================
  // performSearch — delegates to shared searchDuckDuckGo
  // ==========================================================================

  describe("performSearch", () => {
    it("delegates to shared searchDuckDuckGo with correct query", async () => {
      const mockResults = [
        { url: "https://example.com/1", title: "Result 1", snippet: "Snippet 1" },
        { url: "https://example.com/2", title: "Result 2", snippet: "Snippet 2" },
      ]
      mockSearchDDG.mockResolvedValue(mockResults)

      const source = new DuckDuckGoSearchSource()
      const signal = AbortSignal.timeout(5000)

      await source.lookup({ id: 1, name: "test query" }, signal)

      expect(mockSearchDDG).toHaveBeenCalledTimes(1)

      // Verify query was passed through
      const callArgs = mockSearchDDG.mock.calls[0][0] as { query: string; signal: AbortSignal }
      expect(callArgs.query).toBe("test query")
    })

    it("passes signal to searchDuckDuckGo", async () => {
      mockSearchDDG.mockResolvedValue([])

      const source = new DuckDuckGoSearchSource()
      const signal = AbortSignal.timeout(5000)

      await source.lookup({ id: 1, name: "test" }, signal)

      expect(mockSearchDDG).toHaveBeenCalledTimes(1)

      // Verify a signal was passed (may be wrapped by AbortSignal.any in base class)
      const callArgs = mockSearchDDG.mock.calls[0][0] as { query: string; signal: AbortSignal }
      expect(callArgs.signal).toBeDefined()
      expect(callArgs.signal).toBeInstanceOf(AbortSignal)
    })
  })

  // ==========================================================================
  // Factory function
  // ==========================================================================

  describe("factory function", () => {
    it("duckduckgoSearch() creates a DuckDuckGoSearchSource instance", () => {
      const source = duckduckgoSearch()

      expect(source).toBeInstanceOf(DuckDuckGoSearchSource)
      expect(source.name).toBe("DuckDuckGo")
      expect(source.isAvailable()).toBe(true)
    })

    it("duckduckgoSearch() passes options through to the constructor", () => {
      const source = duckduckgoSearch({ maxLinksToFollow: 5 })

      expect(source).toBeInstanceOf(DuckDuckGoSearchSource)
    })
  })
})
