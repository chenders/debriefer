/**
 * Tests for TroveSource.
 *
 * Mocks the global fetch API. sanitizeSourceText is mocked to isolate
 * source-specific logic from shared sanitization behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier } from "@debriefer/core"

// ============================================================================
// Mocks — must be declared before importing the module under test
// ============================================================================

const mockSanitize = vi.fn()

vi.mock("../../shared/sanitize-text.js", () => ({
  sanitizeSourceText: (...args: unknown[]) => mockSanitize(...args),
}))

import { TroveSource, trove } from "../../archives/trove.js"

// ============================================================================
// Helpers
// ============================================================================

/** Standard test subject. */
const subject = { id: 1, name: "Nellie Melba" }

/** Standard abort signal for tests. */
const signal = AbortSignal.timeout(5000)

/** Build a mock Trove API response. */
function makeTroveResponse(
  articles: Array<{
    heading?: string
    snippet?: string
    date?: string
    troveUrl?: string
  }>
) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      category: [
        {
          records: {
            article: articles,
          },
        },
      ],
    }),
  }
}

// ============================================================================
// Lifecycle
// ============================================================================

beforeEach(() => {
  mockSanitize.mockReset()
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ============================================================================
// Tests
// ============================================================================

describe("TroveSource", () => {
  // ==========================================================================
  // Metadata
  // ==========================================================================

  describe("metadata", () => {
    it("has correct name, type, tier, domain, isFree, and cost", () => {
      const source = new TroveSource({ apiKey: "test-key" })

      expect(source.name).toBe("Trove")
      expect(source.type).toBe("trove")
      expect(source.reliabilityTier).toBe(ReliabilityTier.ARCHIVAL)
      expect(source.domain).toBe("api.trove.nla.gov.au")
      expect(source.isFree).toBe(true)
      expect(source.estimatedCostPerQuery).toBe(0)
    })
  })

  // ==========================================================================
  // isAvailable
  // ==========================================================================

  describe("isAvailable", () => {
    it("returns true when apiKey is provided", () => {
      const source = new TroveSource({ apiKey: "test-key" })
      expect(source.isAvailable()).toBe(true)
    })

    it("returns false when no apiKey is provided and env var is unset", () => {
      const original = process.env.TROVE_API_KEY
      delete process.env.TROVE_API_KEY

      const source = new TroveSource()
      expect(source.isAvailable()).toBe(false)

      if (original !== undefined) {
        process.env.TROVE_API_KEY = original
      }
    })
  })

  // ==========================================================================
  // API call format
  // ==========================================================================

  describe("API call format", () => {
    it("builds correct URL with API key and query params", async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeTroveResponse([]))
      vi.stubGlobal("fetch", mockFetch)

      const source = new TroveSource({ apiKey: "my-trove-key" })
      await source.lookup(subject, signal)

      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [callUrl, callOptions] = mockFetch.mock.calls[0] as [string, { signal: AbortSignal }]
      const parsed = new URL(callUrl)

      expect(parsed.origin + parsed.pathname).toBe("https://api.trove.nla.gov.au/v3/result")
      expect(parsed.searchParams.get("key")).toBe("my-trove-key")
      expect(parsed.searchParams.get("q")).toContain('"Nellie Melba"')
      expect(parsed.searchParams.get("q")).toContain("biography")
      expect(parsed.searchParams.get("category")).toBe("newspaper")
      expect(parsed.searchParams.get("encoding")).toBe("json")
      expect(parsed.searchParams.get("n")).toBe("5")
      expect(callOptions.signal).toBeDefined()
    })
  })

  // ==========================================================================
  // Response parsing
  // ==========================================================================

  describe("response parsing", () => {
    it("combines heading and snippet from articles", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeTroveResponse([
          {
            heading: "Nellie Melba performs at the Opera House",
            snippet: "A fine performance by the celebrated soprano.",
            troveUrl: "https://trove.nla.gov.au/article/123",
          },
          {
            heading: "Melba returns to Melbourne",
            snippet: "The famous singer returns home.",
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)
      mockSanitize.mockReturnValue("sanitized text about Nellie Melba")

      const source = new TroveSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.text).toBe("sanitized text about Nellie Melba")
      expect(result!.confidence).toBe(-1)
      expect(result!.costUsd).toBe(0)
      expect(result!.url).toBe("https://trove.nla.gov.au/article/123")
      expect(result!.publication).toBe("Trove (National Library of Australia)")
      expect(result!.metadata?.title).toBe("Nellie Melba performs at the Opera House")
    })
  })

  // ==========================================================================
  // Snippet HTML cleaning
  // ==========================================================================

  describe("snippet HTML cleaning", () => {
    it("strips HTML tags from snippets before sanitization", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeTroveResponse([
          {
            heading: "Melba biography",
            snippet:
              '<b>Nellie</b> <em>Melba</em> was born <span class="highlight">in Melbourne</span>.',
            troveUrl: "https://trove.nla.gov.au/article/456",
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)
      mockSanitize.mockImplementation((text: string) => text)

      const source = new TroveSource({ apiKey: "test-key" })
      await source.lookup(subject, signal)

      expect(mockSanitize).toHaveBeenCalledTimes(1)
      const sanitizeArg = mockSanitize.mock.calls[0][0] as string
      // HTML tags should be stripped
      expect(sanitizeArg).not.toContain("<b>")
      expect(sanitizeArg).not.toContain("</b>")
      expect(sanitizeArg).not.toContain("<em>")
      expect(sanitizeArg).not.toContain("<span")
      expect(sanitizeArg).toContain("Nellie")
      expect(sanitizeArg).toContain("Melba")
      expect(sanitizeArg).toContain("in Melbourne")
    })
  })

  // ==========================================================================
  // Empty / error results
  // ==========================================================================

  describe("empty results", () => {
    it("returns null when no articles in response", async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeTroveResponse([]))
      vi.stubGlobal("fetch", mockFetch)

      const source = new TroveSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("returns null on HTTP error (caught by base class)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: async () => ({}),
      })
      vi.stubGlobal("fetch", mockFetch)

      const source = new TroveSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // Factory
  // ==========================================================================

  describe("factory", () => {
    it("returns a TroveSource instance", () => {
      const source = trove({ apiKey: "test-key" })
      expect(source).toBeInstanceOf(TroveSource)
      expect(source.name).toBe("Trove")
    })
  })
})
