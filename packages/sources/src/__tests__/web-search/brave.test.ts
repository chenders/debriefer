/**
 * Tests for BraveSearchSource.
 *
 * Mocks global fetch to simulate Brave Search API v1 responses.
 * Also mocks shared utilities (fetchPage, extractArticleContent) since
 * WebSearchBase uses them in the full pipeline, but we only test
 * performSearch() behavior here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier } from "debriefer"

// ============================================================================
// Mocks — must come before imports of the module under test
// ============================================================================

vi.mock("../../shared/fetch-page.js", () => ({
  fetchPage: vi.fn().mockResolvedValue({ content: "", url: "", fetchMethod: "none" }),
}))
vi.mock("../../shared/readability-extract.js", () => ({
  extractArticleContent: vi.fn().mockReturnValue(null),
}))

import { BraveSearchSource, braveSearch } from "../../web-search/brave.js"

// ============================================================================
// Helpers
// ============================================================================

const ORIGINAL_ENV = process.env.BRAVE_SEARCH_API_KEY

function makeBraveResponse(options?: {
  web?: Array<{ title: string; url: string; description: string }>
  news?: Array<{ title: string; url: string; description: string }>
}): object {
  const result: Record<string, unknown> = {}
  if (options?.web) {
    result.web = { results: options.web }
  }
  if (options?.news) {
    result.news = { results: options.news }
  }
  return result
}

function mockFetchOk(body: object): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  )
}

function mockFetchError(status: number, statusText: string): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(null, { status, statusText })
  )
}

beforeEach(() => {
  delete process.env.BRAVE_SEARCH_API_KEY
})

afterEach(() => {
  vi.restoreAllMocks()
  if (ORIGINAL_ENV !== undefined) {
    process.env.BRAVE_SEARCH_API_KEY = ORIGINAL_ENV
  } else {
    delete process.env.BRAVE_SEARCH_API_KEY
  }
})

// ============================================================================
// Tests
// ============================================================================

describe("BraveSearchSource", () => {
  // ==========================================================================
  // Metadata
  // ==========================================================================

  describe("metadata", () => {
    it("has correct name, type, reliabilityTier, isFree, and estimatedCostPerQuery", () => {
      const source = new BraveSearchSource({ apiKey: "test-key" })

      expect(source.name).toBe("Brave Search")
      expect(source.type).toBe("brave-search")
      expect(source.reliabilityTier).toBe(ReliabilityTier.SEARCH_AGGREGATOR)
      expect(source.domain).toBe("api.search.brave.com")
      expect(source.isFree).toBe(false)
      expect(source.estimatedCostPerQuery).toBe(0.005)
    })
  })

  // ==========================================================================
  // isAvailable
  // ==========================================================================

  describe("isAvailable", () => {
    it("returns true when apiKey is provided via constructor", () => {
      const source = new BraveSearchSource({ apiKey: "test-key" })
      expect(source.isAvailable()).toBe(true)
    })

    it("returns true when BRAVE_SEARCH_API_KEY env var is set", () => {
      process.env.BRAVE_SEARCH_API_KEY = "env-key"
      const source = new BraveSearchSource()
      expect(source.isAvailable()).toBe(true)
    })

    it("returns false when no apiKey is provided and env var is unset", () => {
      const source = new BraveSearchSource()
      expect(source.isAvailable()).toBe(false)
    })
  })

  // ==========================================================================
  // Request format — URL, query params, headers
  // ==========================================================================

  describe("request format", () => {
    it("sends correct URL, query params, X-Subscription-Token header, and Accept header", async () => {
      const source = new BraveSearchSource({ apiKey: "my-api-key", maxResults: 10 })

      mockFetchOk(makeBraveResponse({
        web: [{ title: "Result", url: "https://example.com", description: "A result" }],
      }))

      const signal = AbortSignal.timeout(5000)
      await source.lookup({ id: 1, name: "test query" }, signal)

      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      const [calledUrl, calledOptions] = vi.mocked(globalThis.fetch).mock.calls[0]

      // Verify URL structure
      const parsedUrl = new URL(calledUrl as string)
      expect(parsedUrl.origin + parsedUrl.pathname).toBe(
        "https://api.search.brave.com/res/v1/web/search"
      )
      expect(parsedUrl.searchParams.get("q")).toBe("test query")
      expect(parsedUrl.searchParams.get("count")).toBe("10")
      expect(parsedUrl.searchParams.get("search_lang")).toBe("en")

      // Verify headers
      const headers = (calledOptions as RequestInit).headers as Record<string, string>
      expect(headers["X-Subscription-Token"]).toBe("my-api-key")
      expect(headers["Accept"]).toBe("application/json")
    })
  })

  // ==========================================================================
  // Merges web and news results, deduplicates by URL
  // ==========================================================================

  describe("result merging and deduplication", () => {
    it("correctly deduplicates URLs across web and news results", async () => {
      class TestBraveSource extends BraveSearchSource {
        async testPerformSearch(query: string, signal: AbortSignal) {
          return this.performSearch(query, signal)
        }
      }

      const source = new TestBraveSource({ apiKey: "test-key" })

      const duplicateUrl = "https://example.com/shared"

      mockFetchOk(makeBraveResponse({
        web: [
          { title: "Web Result 1", url: "https://example.com/web1", description: "Web snippet 1" },
          { title: "Web Duplicate", url: duplicateUrl, description: "Web version of duplicate" },
        ],
        news: [
          { title: "News Duplicate", url: duplicateUrl, description: "News version of duplicate" },
          { title: "News Result 1", url: "https://example.com/news1", description: "News snippet 1" },
        ],
      }))

      const results = await source.testPerformSearch("test", AbortSignal.timeout(5000))

      // Should have 3 results: web1, shared (from web), news1
      // The news duplicate of "shared" should be excluded
      expect(results).toHaveLength(3)

      expect(results[0]).toEqual({
        url: "https://example.com/web1",
        title: "Web Result 1",
        snippet: "Web snippet 1",
      })
      expect(results[1]).toEqual({
        url: duplicateUrl,
        title: "Web Duplicate",
        snippet: "Web version of duplicate",
      })
      expect(results[2]).toEqual({
        url: "https://example.com/news1",
        title: "News Result 1",
        snippet: "News snippet 1",
      })
    })

    it("handles response with only web results (no news)", async () => {
      class TestBraveSource extends BraveSearchSource {
        async testPerformSearch(query: string, signal: AbortSignal) {
          return this.performSearch(query, signal)
        }
      }

      const source = new TestBraveSource({ apiKey: "test-key" })

      mockFetchOk(makeBraveResponse({
        web: [
          { title: "Only Web", url: "https://example.com/web", description: "Web only" },
        ],
      }))

      const results = await source.testPerformSearch("test", AbortSignal.timeout(5000))

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe("Only Web")
    })

    it("handles response with only news results (no web)", async () => {
      class TestBraveSource extends BraveSearchSource {
        async testPerformSearch(query: string, signal: AbortSignal) {
          return this.performSearch(query, signal)
        }
      }

      const source = new TestBraveSource({ apiKey: "test-key" })

      mockFetchOk(makeBraveResponse({
        news: [
          { title: "Only News", url: "https://example.com/news", description: "News only" },
        ],
      }))

      const results = await source.testPerformSearch("test", AbortSignal.timeout(5000))

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe("Only News")
      expect(results[0].snippet).toBe("News only")
    })

    it("handles empty response (no web, no news)", async () => {
      class TestBraveSource extends BraveSearchSource {
        async testPerformSearch(query: string, signal: AbortSignal) {
          return this.performSearch(query, signal)
        }
      }

      const source = new TestBraveSource({ apiKey: "test-key" })

      mockFetchOk({})

      const results = await source.testPerformSearch("test", AbortSignal.timeout(5000))

      expect(results).toHaveLength(0)
    })
  })

  // ==========================================================================
  // API error handling
  // ==========================================================================

  describe("API error handling", () => {
    it("returns null from lookup when API returns an HTTP error", async () => {
      const source = new BraveSearchSource({ apiKey: "test-key" })

      mockFetchError(403, "Forbidden")

      // BaseResearchSource.lookup() catches errors from fetchResult and returns null
      const result = await source.lookup(
        { id: 1, name: "test query" },
        AbortSignal.timeout(5000)
      )

      expect(result).toBeNull()
    })

    it("throws an error with status details when API returns non-OK response", async () => {
      class TestBraveSource extends BraveSearchSource {
        async testPerformSearch(query: string, signal: AbortSignal) {
          return this.performSearch(query, signal)
        }
      }

      const source = new TestBraveSource({ apiKey: "test-key" })

      mockFetchError(429, "Too Many Requests")

      await expect(
        source.testPerformSearch("test", AbortSignal.timeout(5000))
      ).rejects.toThrow("Brave Search error: HTTP 429 Too Many Requests")
    })
  })

  // ==========================================================================
  // Factory function
  // ==========================================================================

  describe("factory function", () => {
    it("braveSearch() creates a BraveSearchSource instance", () => {
      const source = braveSearch({ apiKey: "factory-key" })

      expect(source).toBeInstanceOf(BraveSearchSource)
      expect(source.name).toBe("Brave Search")
      expect(source.isAvailable()).toBe(true)
    })

    it("braveSearch() with no options creates instance (unavailable without key)", () => {
      const source = braveSearch()

      expect(source).toBeInstanceOf(BraveSearchSource)
      expect(source.isAvailable()).toBe(false)
    })
  })

  // ==========================================================================
  // Default maxResults
  // ==========================================================================

  describe("default maxResults", () => {
    it("uses maxResults=20 by default", async () => {
      const source = new BraveSearchSource({ apiKey: "test-key" })

      mockFetchOk(makeBraveResponse())

      await source.lookup({ id: 1, name: "test" }, AbortSignal.timeout(5000))

      const [calledUrl] = vi.mocked(globalThis.fetch).mock.calls[0]
      const parsedUrl = new URL(calledUrl as string)
      expect(parsedUrl.searchParams.get("count")).toBe("20")
    })
  })
})
