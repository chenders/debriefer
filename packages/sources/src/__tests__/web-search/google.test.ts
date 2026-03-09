/**
 * Tests for the Google Custom Search source.
 *
 * Mocks global fetch and the shared WebSearchBase pipeline utilities
 * (fetch-page, readability-extract) so the tests only exercise
 * Google-specific code: metadata, isAvailable, performSearch, and the factory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier } from "debriefer"

// ============================================================================
// Mocks — must be declared before importing the module under test
// ============================================================================

vi.mock("../../shared/fetch-page.js", () => ({
  fetchPage: vi.fn().mockResolvedValue({ content: "", url: "", fetchMethod: "none" }),
}))

vi.mock("../../shared/readability-extract.js", () => ({
  extractArticleContent: vi.fn().mockReturnValue(null),
}))

import { GoogleSearchSource, googleSearch } from "../../web-search/google.js"

// ============================================================================
// Helpers
// ============================================================================

const VALID_OPTIONS = { apiKey: "test-key", cx: "test-cx" } as const

function makeGoogleResponse(
  items: Array<{ title: string; link: string; snippet: string }> | null
): object {
  return items ? { items } : {}
}

function mockFetchSuccess(body: object): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve(body),
    })
  )
}

function mockFetchError(status: number, statusText: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText,
      json: () => Promise.resolve({}),
    })
  )
}

// ============================================================================
// Lifecycle
// ============================================================================

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ============================================================================
// Tests
// ============================================================================

describe("GoogleSearchSource", () => {
  // ==========================================================================
  // Metadata
  // ==========================================================================

  describe("metadata", () => {
    it("has correct name, type, reliabilityTier, isFree, and cost", () => {
      const source = new GoogleSearchSource(VALID_OPTIONS)

      expect(source.name).toBe("Google Search")
      expect(source.type).toBe("google-search")
      expect(source.reliabilityTier).toBe(ReliabilityTier.SEARCH_AGGREGATOR)
      expect(source.isFree).toBe(false)
      expect(source.estimatedCostPerQuery).toBe(0.005)
      expect(source.domain).toBe("www.googleapis.com")
    })
  })

  // ==========================================================================
  // isAvailable
  // ==========================================================================

  describe("isAvailable", () => {
    it("returns true when both apiKey and cx are provided", () => {
      const source = new GoogleSearchSource({ apiKey: "key", cx: "cx-id" })
      expect(source.isAvailable()).toBe(true)
    })

    it("returns false when apiKey is missing", () => {
      const source = new GoogleSearchSource({ cx: "cx-id" })
      expect(source.isAvailable()).toBe(false)
    })

    it("returns false when cx is missing", () => {
      const source = new GoogleSearchSource({ apiKey: "key" })
      expect(source.isAvailable()).toBe(false)
    })

    it("returns false when both apiKey and cx are missing", () => {
      const source = new GoogleSearchSource()
      expect(source.isAvailable()).toBe(false)
    })
  })

  // ==========================================================================
  // performSearch — correct API call
  // ==========================================================================

  describe("performSearch", () => {
    it("calls Google CSE API with correct URL params", async () => {
      const items = [
        { title: "Result 1", link: "https://example.com/1", snippet: "Snippet 1" },
        { title: "Result 2", link: "https://example.com/2", snippet: "Snippet 2" },
      ]
      mockFetchSuccess(makeGoogleResponse(items))

      const source = new GoogleSearchSource({
        ...VALID_OPTIONS,
        maxResults: 5,
      })

      // We call lookup which goes through the base class pipeline.
      // Since fetchPage and extractArticleContent are mocked to return nothing,
      // the result will be null — but we can still verify the fetch call.
      const signal = AbortSignal.timeout(5000)
      await source.lookup(
        { id: 1, name: "John Wayne" },
        signal
      )

      const fetchMock = vi.mocked(globalThis.fetch)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      const callUrl = new URL(fetchMock.mock.calls[0][0] as string)
      expect(callUrl.origin + callUrl.pathname).toBe(
        "https://www.googleapis.com/customsearch/v1"
      )
      expect(callUrl.searchParams.get("key")).toBe("test-key")
      expect(callUrl.searchParams.get("cx")).toBe("test-cx")
      expect(callUrl.searchParams.get("q")).toBe("John Wayne")
      expect(callUrl.searchParams.get("num")).toBe("5")

      // Verify a signal is passed through (may be wrapped by AbortSignal.any)
      const passedOptions = fetchMock.mock.calls[0][1] as { signal?: AbortSignal }
      expect(passedOptions.signal).toBeDefined()
      expect(passedOptions.signal).toBeInstanceOf(AbortSignal)
    })

    it("uses default maxResults of 10", async () => {
      mockFetchSuccess(makeGoogleResponse([]))

      const source = new GoogleSearchSource(VALID_OPTIONS)

      await source.lookup(
        { id: 1, name: "Jane Doe" },
        AbortSignal.timeout(5000)
      )

      const fetchMock = vi.mocked(globalThis.fetch)
      const callUrl = new URL(fetchMock.mock.calls[0][0] as string)
      expect(callUrl.searchParams.get("num")).toBe("10")
    })
  })

  // ==========================================================================
  // API error handling
  // ==========================================================================

  describe("API error handling", () => {
    it("returns null on non-OK HTTP response", async () => {
      mockFetchError(403, "Forbidden")

      const source = new GoogleSearchSource(VALID_OPTIONS)

      const result = await source.lookup(
        { id: 1, name: "John Wayne" },
        AbortSignal.timeout(5000)
      )

      // BaseResearchSource.lookup() catches errors and returns null
      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // Empty / no items response
  // ==========================================================================

  describe("empty results", () => {
    it("returns null when response has no items", async () => {
      mockFetchSuccess(makeGoogleResponse(null))

      const source = new GoogleSearchSource(VALID_OPTIONS)

      const result = await source.lookup(
        { id: 1, name: "Obscure Person" },
        AbortSignal.timeout(5000)
      )

      expect(result).toBeNull()
    })

    it("returns null when items array is empty", async () => {
      mockFetchSuccess(makeGoogleResponse([]))

      const source = new GoogleSearchSource(VALID_OPTIONS)

      const result = await source.lookup(
        { id: 1, name: "Obscure Person" },
        AbortSignal.timeout(5000)
      )

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // No credentials → empty results (no API call)
  // ==========================================================================

  describe("missing credentials", () => {
    it("returns null without calling fetch when credentials are missing", async () => {
      const source = new GoogleSearchSource()

      const result = await source.lookup(
        { id: 1, name: "John Wayne" },
        AbortSignal.timeout(5000)
      )

      expect(result).toBeNull()
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Factory function
  // ==========================================================================

  describe("factory function", () => {
    it("creates a GoogleSearchSource instance", () => {
      const source = googleSearch(VALID_OPTIONS)
      expect(source).toBeInstanceOf(GoogleSearchSource)
      expect(source.name).toBe("Google Search")
    })

    it("creates instance with default options when no options provided", () => {
      const source = googleSearch()
      expect(source).toBeInstanceOf(GoogleSearchSource)
      expect(source.isAvailable()).toBe(false)
    })
  })
})
