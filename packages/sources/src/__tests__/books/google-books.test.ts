/**
 * Tests for GoogleBooksSource.
 *
 * Mocks the global fetch API and sanitizeSourceText to isolate
 * Google Books-specific logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier } from "debriefer"

// ============================================================================
// Mocks — must be declared before importing the module under test
// ============================================================================

const mockSanitize = vi.fn()
const mockDecodeEntities = vi.fn()

vi.mock("../../shared/sanitize-text.js", () => ({
  sanitizeSourceText: (...args: unknown[]) => mockSanitize(...args),
}))

vi.mock("../../shared/html-utils.js", () => ({
  decodeHtmlEntities: (...args: unknown[]) => mockDecodeEntities(...args),
}))

import { GoogleBooksSource, googleBooks } from "../../books/google-books.js"

// ============================================================================
// Helpers
// ============================================================================

/** Standard test subject. */
const subject = { id: 1, name: "John Wayne" }

/** Standard abort signal for tests. */
const signal = AbortSignal.timeout(5000)

/** Build a mock Google Books API response. */
function makeGoogleBooksResponse(
  items: Array<{
    volumeInfo: {
      title?: string
      description?: string
      authors?: string[]
      publishedDate?: string
      infoLink?: string
    }
    searchInfo?: { textSnippet?: string }
  }>
) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      totalItems: items.length,
      items: items.length > 0 ? items : undefined,
    }),
  }
}

/** Description long enough to pass the 100-char minimum. */
const LONG_DESCRIPTION = "A".repeat(150)

// ============================================================================
// Lifecycle
// ============================================================================

beforeEach(() => {
  mockSanitize.mockReset()
  mockDecodeEntities.mockReset()
  // Default: pass through
  mockSanitize.mockImplementation((text: string) => text)
  mockDecodeEntities.mockImplementation((text: string) => text)
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ============================================================================
// Tests
// ============================================================================

describe("GoogleBooksSource", () => {
  describe("metadata", () => {
    it("has correct name, type, tier, domain, isFree, and cost", () => {
      const source = new GoogleBooksSource({ apiKey: "test-key" })

      expect(source.name).toBe("Google Books")
      expect(source.type).toBe("google-books")
      expect(source.reliabilityTier).toBe(ReliabilityTier.SECONDARY_COMPILATION)
      expect(source.domain).toBe("googleapis.com")
      expect(source.isFree).toBe(false)
      expect(source.estimatedCostPerQuery).toBe(0)
    })
  })

  // ==========================================================================
  // isAvailable
  // ==========================================================================

  describe("isAvailable", () => {
    it("returns true when apiKey is provided", () => {
      const source = new GoogleBooksSource({ apiKey: "test-key" })
      expect(source.isAvailable()).toBe(true)
    })

    it("returns false when no apiKey is provided and env var is unset", () => {
      const original = process.env.GOOGLE_BOOKS_API_KEY
      delete process.env.GOOGLE_BOOKS_API_KEY

      const source = new GoogleBooksSource()
      expect(source.isAvailable()).toBe(false)

      if (original !== undefined) {
        process.env.GOOGLE_BOOKS_API_KEY = original
      }
    })
  })

  // ==========================================================================
  // API call format
  // ==========================================================================

  describe("API call format", () => {
    it("builds correct URL with all expected query params", async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeGoogleBooksResponse([]))
      vi.stubGlobal("fetch", mockFetch)

      const source = new GoogleBooksSource({ apiKey: "my-api-key" })
      await source.lookup(subject, signal)

      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [callUrl, callOptions] = mockFetch.mock.calls[0] as [string, { signal: AbortSignal }]
      const parsed = new URL(callUrl)

      expect(parsed.origin + parsed.pathname).toBe("https://www.googleapis.com/books/v1/volumes")
      expect(parsed.searchParams.get("key")).toBe("my-api-key")
      expect(parsed.searchParams.get("q")).toBe('"John Wayne" biography')
      expect(parsed.searchParams.get("maxResults")).toBe("5")
      expect(callOptions.signal).toBeDefined()
    })
  })

  // ==========================================================================
  // Response parsing
  // ==========================================================================

  describe("response parsing", () => {
    it("returns finding with metadata from first item with enough text", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeGoogleBooksResponse([
          {
            volumeInfo: {
              title: "John Wayne: The Life",
              description: LONG_DESCRIPTION,
              authors: ["Author One"],
              publishedDate: "2020-01-01",
              infoLink: "https://books.google.com/books?id=abc123",
            },
            searchInfo: {
              textSnippet: "A <b>bold</b> snippet about John Wayne&apos;s life.",
            },
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)

      const source = new GoogleBooksSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.publication).toBe("Google Books")
      expect(result!.confidence).toBe(-1)
      expect(result!.costUsd).toBe(0)
      expect(result!.url).toBe("https://books.google.com/books?id=abc123")
      expect(result!.metadata?.title).toBe("John Wayne: The Life")
      expect(result!.metadata?.authors).toEqual(["Author One"])
      expect(result!.metadata?.publishedDate).toBe("2020-01-01")
    })

    it("strips HTML tags from textSnippet and decodes entities", async () => {
      const snippet = "A <b>bold</b> snippet &amp; more"
      const decoded = "A bold snippet & more"

      mockDecodeEntities.mockReturnValue(decoded)

      const mockFetch = vi.fn().mockResolvedValue(
        makeGoogleBooksResponse([
          {
            volumeInfo: {
              title: "Test Book",
              description: LONG_DESCRIPTION,
              infoLink: "https://books.google.com/books?id=xyz",
            },
            searchInfo: { textSnippet: snippet },
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)

      const source = new GoogleBooksSource({ apiKey: "test-key" })
      await source.lookup(subject, signal)

      // decodeHtmlEntities should have been called with tag-stripped snippet
      expect(mockDecodeEntities).toHaveBeenCalledWith("A bold snippet &amp; more")
      // sanitizeSourceText should have been called with combined text
      expect(mockSanitize).toHaveBeenCalled()
    })

    it("skips items with combined text shorter than 100 chars", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeGoogleBooksResponse([
          {
            volumeInfo: {
              title: "Short Book",
              description: "Too short",
              infoLink: "https://books.google.com/books?id=short",
            },
          },
          {
            volumeInfo: {
              title: "Long Book",
              description: LONG_DESCRIPTION,
              infoLink: "https://books.google.com/books?id=long",
            },
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)

      const source = new GoogleBooksSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.metadata?.title).toBe("Long Book")
    })
  })

  // ==========================================================================
  // Null returns
  // ==========================================================================

  describe("null returns", () => {
    it("returns null when no items in response", async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeGoogleBooksResponse([]))
      vi.stubGlobal("fetch", mockFetch)

      const source = new GoogleBooksSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("returns null on API error (caught by base class)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: async () => ({}),
      })
      vi.stubGlobal("fetch", mockFetch)

      const source = new GoogleBooksSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // Factory function
  // ==========================================================================

  describe("factory", () => {
    it("returns a GoogleBooksSource instance", () => {
      const source = googleBooks({ apiKey: "test-key" })
      expect(source).toBeInstanceOf(GoogleBooksSource)
      expect(source.name).toBe("Google Books")
    })
  })
})
