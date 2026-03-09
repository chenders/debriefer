/**
 * Tests for OpenLibrarySource.
 *
 * Mocks the global fetch API. Open Library requires no API key
 * and returns structured JSON — no HTML parsing needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier } from "debriefer"

import { OpenLibrarySource, openLibrary } from "../../books/open-library.js"

// ============================================================================
// Helpers
// ============================================================================

/** Standard test subject. */
const subject = { id: 1, name: "John Wayne" }

/** Standard abort signal for tests. */
const signal = AbortSignal.timeout(5000)

/** Build a mock Open Library search response. */
function makeOpenLibraryResponse(
  docs: Array<{
    key?: string
    title?: string
    author_name?: string[]
    first_publish_year?: number
    ia?: string[]
  }>
) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      numFound: docs.length,
      docs,
    }),
  }
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

describe("OpenLibrarySource", () => {
  describe("metadata", () => {
    it("has correct name, type, tier, domain, isFree, and cost", () => {
      const source = new OpenLibrarySource()

      expect(source.name).toBe("Open Library")
      expect(source.type).toBe("open-library")
      expect(source.reliabilityTier).toBe(ReliabilityTier.SECONDARY_COMPILATION)
      expect(source.domain).toBe("openlibrary.org")
      expect(source.isFree).toBe(true)
      expect(source.estimatedCostPerQuery).toBe(0)
    })
  })

  // ==========================================================================
  // isAvailable
  // ==========================================================================

  describe("isAvailable", () => {
    it("returns true always (no API key required)", () => {
      const source = new OpenLibrarySource()
      expect(source.isAvailable()).toBe(true)
    })
  })

  // ==========================================================================
  // API call format
  // ==========================================================================

  describe("API call format", () => {
    it("builds correct URL with expected query params", async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeOpenLibraryResponse([]))
      vi.stubGlobal("fetch", mockFetch)

      const source = new OpenLibrarySource()
      await source.lookup(subject, signal)

      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [callUrl, callOptions] = mockFetch.mock.calls[0] as [string, { signal: AbortSignal }]
      const parsed = new URL(callUrl)

      expect(parsed.origin + parsed.pathname).toBe("https://openlibrary.org/search.json")
      expect(parsed.searchParams.get("q")).toBe('"John Wayne" biography')
      expect(parsed.searchParams.get("limit")).toBe("5")
      expect(callOptions.signal).toBeDefined()
    })
  })

  // ==========================================================================
  // Response parsing
  // ==========================================================================

  describe("response parsing", () => {
    it("returns finding with metadata from first doc with a title", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeOpenLibraryResponse([
          {
            key: "/works/OL12345W",
            title: "John Wayne: American Legend",
            author_name: ["Jane Smith"],
            first_publish_year: 1998,
            ia: ["johnwaynelegend00smit"],
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)

      const source = new OpenLibrarySource()
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.text).toBe("John Wayne: American Legend by Jane Smith (1998)")
      expect(result!.publication).toBe("Open Library")
      expect(result!.confidence).toBe(-1)
      expect(result!.costUsd).toBe(0)
      expect(result!.url).toBe("https://openlibrary.org/works/OL12345W")
      expect(result!.metadata?.title).toBe("John Wayne: American Legend")
      expect(result!.metadata?.authors).toEqual(["Jane Smith"])
      expect(result!.metadata?.firstPublishYear).toBe(1998)
    })

    it("handles docs with multiple authors", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeOpenLibraryResponse([
          {
            key: "/works/OL999W",
            title: "Dual Authors Book",
            author_name: ["Author A", "Author B"],
            first_publish_year: 2005,
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)

      const source = new OpenLibrarySource()
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.text).toBe("Dual Authors Book by Author A, Author B (2005)")
    })
  })

  // ==========================================================================
  // Null returns
  // ==========================================================================

  describe("null returns", () => {
    it("returns null when no docs in response", async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeOpenLibraryResponse([]))
      vi.stubGlobal("fetch", mockFetch)

      const source = new OpenLibrarySource()
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("returns null on API error (caught by base class)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({}),
      })
      vi.stubGlobal("fetch", mockFetch)

      const source = new OpenLibrarySource()
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // Factory function
  // ==========================================================================

  describe("factory", () => {
    it("returns an OpenLibrarySource instance", () => {
      const source = openLibrary()
      expect(source).toBeInstanceOf(OpenLibrarySource)
      expect(source.name).toBe("Open Library")
    })
  })
})
