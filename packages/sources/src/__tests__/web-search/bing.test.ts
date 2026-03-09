/**
 * Tests for BingSearchSource.
 *
 * Mocks global fetch to simulate Bing Search API v7 responses.
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

import { BingSearchSource, bingSearch } from "../../web-search/bing.js"

// ============================================================================
// Helpers
// ============================================================================

const ORIGINAL_ENV = process.env.BING_SEARCH_API_KEY

function makeBingResponse(options?: {
  webPages?: Array<{ name: string; url: string; snippet: string }>
  news?: Array<{ name: string; url: string; description: string }>
}): object {
  const result: Record<string, unknown> = {}
  if (options?.webPages) {
    result.webPages = { value: options.webPages }
  }
  if (options?.news) {
    result.news = { value: options.news }
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
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status, statusText }))
}

beforeEach(() => {
  delete process.env.BING_SEARCH_API_KEY
})

afterEach(() => {
  vi.restoreAllMocks()
  if (ORIGINAL_ENV !== undefined) {
    process.env.BING_SEARCH_API_KEY = ORIGINAL_ENV
  } else {
    delete process.env.BING_SEARCH_API_KEY
  }
})

// ============================================================================
// Tests
// ============================================================================

describe("BingSearchSource", () => {
  // ==========================================================================
  // Metadata
  // ==========================================================================

  describe("metadata", () => {
    it("has correct name, type, reliabilityTier, isFree, and estimatedCostPerQuery", () => {
      const source = new BingSearchSource({ apiKey: "test-key" })

      expect(source.name).toBe("Bing Search")
      expect(source.type).toBe("bing-search")
      expect(source.reliabilityTier).toBe(ReliabilityTier.SEARCH_AGGREGATOR)
      expect(source.domain).toBe("api.bing.microsoft.com")
      expect(source.isFree).toBe(false)
      expect(source.estimatedCostPerQuery).toBe(0.003)
    })
  })

  // ==========================================================================
  // isAvailable
  // ==========================================================================

  describe("isAvailable", () => {
    it("returns true when apiKey is provided via constructor", () => {
      const source = new BingSearchSource({ apiKey: "test-key" })
      expect(source.isAvailable()).toBe(true)
    })

    it("returns true when BING_SEARCH_API_KEY env var is set", () => {
      process.env.BING_SEARCH_API_KEY = "env-key"
      const source = new BingSearchSource()
      expect(source.isAvailable()).toBe(true)
    })

    it("returns false when no apiKey is provided and env var is unset", () => {
      const source = new BingSearchSource()
      expect(source.isAvailable()).toBe(false)
    })
  })

  // ==========================================================================
  // Request format — URL, query params, headers
  // ==========================================================================

  describe("request format", () => {
    it("sends correct URL, query params, and Ocp-Apim-Subscription-Key header", async () => {
      const source = new BingSearchSource({ apiKey: "my-api-key", maxResults: 10 })

      mockFetchOk(
        makeBingResponse({
          webPages: [{ name: "Result", url: "https://example.com", snippet: "A result" }],
        })
      )

      const signal = AbortSignal.timeout(5000)
      // Access performSearch via lookup which calls fetchResult which calls performSearch
      // We need to call the source's lookup method to trigger the pipeline
      await source.lookup({ id: 1, name: "test query" }, signal)

      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      const [calledUrl, calledOptions] = vi.mocked(globalThis.fetch).mock.calls[0]

      // Verify URL structure
      const parsedUrl = new URL(calledUrl as string)
      expect(parsedUrl.origin + parsedUrl.pathname).toBe(
        "https://api.bing.microsoft.com/v7.0/search"
      )
      expect(parsedUrl.searchParams.get("q")).toBe("test query")
      expect(parsedUrl.searchParams.get("count")).toBe("10")
      expect(parsedUrl.searchParams.get("mkt")).toBe("en-US")
      expect(parsedUrl.searchParams.get("responseFilter")).toBe("Webpages,News")

      // Verify subscription key header
      const headers = (calledOptions as RequestInit).headers as Record<string, string>
      expect(headers["Ocp-Apim-Subscription-Key"]).toBe("my-api-key")
    })
  })

  // ==========================================================================
  // Merges webPages and news, deduplicates by URL
  // ==========================================================================

  describe("result merging and deduplication", () => {
    it("correctly deduplicates URLs across webPages and news", async () => {
      // Create a subclass that exposes performSearch for direct testing
      class TestBingSource extends BingSearchSource {
        async testPerformSearch(query: string, signal: AbortSignal) {
          return this.performSearch(query, signal)
        }
      }

      const source = new TestBingSource({ apiKey: "test-key" })

      const duplicateUrl = "https://example.com/shared"

      mockFetchOk(
        makeBingResponse({
          webPages: [
            { name: "Web Result 1", url: "https://example.com/web1", snippet: "Web snippet 1" },
            { name: "Web Duplicate", url: duplicateUrl, snippet: "Web version of duplicate" },
          ],
          news: [
            { name: "News Duplicate", url: duplicateUrl, description: "News version of duplicate" },
            {
              name: "News Result 1",
              url: "https://example.com/news1",
              description: "News snippet",
            },
          ],
        })
      )

      const results = await source.testPerformSearch("test", AbortSignal.timeout(5000))

      // Should have 3 results: web1, shared (from webPages), news1
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
        snippet: "News snippet",
      })
    })

    it("handles response with only webPages (no news)", async () => {
      class TestBingSource extends BingSearchSource {
        async testPerformSearch(query: string, signal: AbortSignal) {
          return this.performSearch(query, signal)
        }
      }

      const source = new TestBingSource({ apiKey: "test-key" })

      mockFetchOk(
        makeBingResponse({
          webPages: [{ name: "Only Web", url: "https://example.com/web", snippet: "Web only" }],
        })
      )

      const results = await source.testPerformSearch("test", AbortSignal.timeout(5000))

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe("Only Web")
    })

    it("handles response with only news (no webPages)", async () => {
      class TestBingSource extends BingSearchSource {
        async testPerformSearch(query: string, signal: AbortSignal) {
          return this.performSearch(query, signal)
        }
      }

      const source = new TestBingSource({ apiKey: "test-key" })

      mockFetchOk(
        makeBingResponse({
          news: [{ name: "Only News", url: "https://example.com/news", description: "News only" }],
        })
      )

      const results = await source.testPerformSearch("test", AbortSignal.timeout(5000))

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe("Only News")
      expect(results[0].snippet).toBe("News only")
    })

    it("handles empty response (no webPages, no news)", async () => {
      class TestBingSource extends BingSearchSource {
        async testPerformSearch(query: string, signal: AbortSignal) {
          return this.performSearch(query, signal)
        }
      }

      const source = new TestBingSource({ apiKey: "test-key" })

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
      const source = new BingSearchSource({ apiKey: "test-key" })

      mockFetchError(403, "Forbidden")

      // BaseResearchSource.lookup() catches errors from fetchResult and returns null
      const result = await source.lookup({ id: 1, name: "test query" }, AbortSignal.timeout(5000))

      expect(result).toBeNull()
    })

    it("throws an error with status details when API returns non-OK response", async () => {
      class TestBingSource extends BingSearchSource {
        async testPerformSearch(query: string, signal: AbortSignal) {
          return this.performSearch(query, signal)
        }
      }

      const source = new TestBingSource({ apiKey: "test-key" })

      mockFetchError(429, "Too Many Requests")

      await expect(source.testPerformSearch("test", AbortSignal.timeout(5000))).rejects.toThrow(
        "Bing Search error: HTTP 429 Too Many Requests"
      )
    })
  })

  // ==========================================================================
  // No API key → empty results
  // ==========================================================================

  describe("no API key", () => {
    it("returns empty array from performSearch when no API key is set", async () => {
      class TestBingSource extends BingSearchSource {
        async testPerformSearch(query: string, signal: AbortSignal) {
          return this.performSearch(query, signal)
        }
      }

      const source = new TestBingSource() // no apiKey
      const fetchSpy = vi.spyOn(globalThis, "fetch")

      const results = await source.testPerformSearch("test", AbortSignal.timeout(5000))

      expect(results).toEqual([])
      // fetch should never have been called
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Factory function
  // ==========================================================================

  describe("factory function", () => {
    it("bingSearch() creates a BingSearchSource instance", () => {
      const source = bingSearch({ apiKey: "factory-key" })

      expect(source).toBeInstanceOf(BingSearchSource)
      expect(source.name).toBe("Bing Search")
      expect(source.isAvailable()).toBe(true)
    })

    it("bingSearch() with no options creates instance (unavailable without key)", () => {
      const source = bingSearch()

      expect(source).toBeInstanceOf(BingSearchSource)
      expect(source.isAvailable()).toBe(false)
    })
  })

  // ==========================================================================
  // Default maxResults
  // ==========================================================================

  describe("default maxResults", () => {
    it("uses maxResults=20 by default", async () => {
      const source = new BingSearchSource({ apiKey: "test-key" })

      mockFetchOk(makeBingResponse())

      await source.lookup({ id: 1, name: "test" }, AbortSignal.timeout(5000))

      const [calledUrl] = vi.mocked(globalThis.fetch).mock.calls[0]
      const parsedUrl = new URL(calledUrl as string)
      expect(parsedUrl.searchParams.get("count")).toBe("20")
    })
  })
})
