/**
 * Tests for EuropeanaSource.
 *
 * Mocks the global fetch API. sanitizeSourceText is mocked to isolate
 * source-specific logic from shared sanitization behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier } from "debriefer"

// ============================================================================
// Mocks — must be declared before importing the module under test
// ============================================================================

const mockSanitize = vi.fn()

vi.mock("../../shared/sanitize-text.js", () => ({
  sanitizeSourceText: (...args: unknown[]) => mockSanitize(...args),
}))

import { EuropeanaSource, europeana } from "../../archives/europeana.js"

// ============================================================================
// Helpers
// ============================================================================

/** Standard test subject. */
const subject = { id: 1, name: "Leonardo da Vinci" }

/** Standard abort signal for tests. */
const signal = AbortSignal.timeout(5000)

/** Build a mock Europeana API response. */
function makeEuropeanaResponse(
  items: Array<{
    title?: string[]
    dcDescription?: string[]
    dcCreator?: string[]
    edmIsShownAt?: string[]
    guid?: string
  }>
) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ items }),
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

describe("EuropeanaSource", () => {
  // ==========================================================================
  // Metadata
  // ==========================================================================

  describe("metadata", () => {
    it("has correct name, type, tier, domain, isFree, and cost", () => {
      const source = new EuropeanaSource({ apiKey: "test-key" })

      expect(source.name).toBe("Europeana")
      expect(source.type).toBe("europeana")
      expect(source.reliabilityTier).toBe(ReliabilityTier.ARCHIVAL)
      expect(source.domain).toBe("api.europeana.eu")
      expect(source.isFree).toBe(true)
      expect(source.estimatedCostPerQuery).toBe(0)
    })
  })

  // ==========================================================================
  // isAvailable
  // ==========================================================================

  describe("isAvailable", () => {
    it("returns true when apiKey is provided", () => {
      const source = new EuropeanaSource({ apiKey: "test-key" })
      expect(source.isAvailable()).toBe(true)
    })

    it("returns false when no apiKey is provided and env var is unset", () => {
      const original = process.env.EUROPEANA_API_KEY
      delete process.env.EUROPEANA_API_KEY

      const source = new EuropeanaSource()
      expect(source.isAvailable()).toBe(false)

      if (original !== undefined) {
        process.env.EUROPEANA_API_KEY = original
      }
    })
  })

  // ==========================================================================
  // API call format
  // ==========================================================================

  describe("API call format", () => {
    it("builds correct URL with API key and query params", async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeEuropeanaResponse([]))
      vi.stubGlobal("fetch", mockFetch)

      const source = new EuropeanaSource({ apiKey: "my-europeana-key" })
      await source.lookup(subject, signal)

      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [callUrl, callOptions] = mockFetch.mock.calls[0] as [string, { signal: AbortSignal }]
      const parsed = new URL(callUrl)

      expect(parsed.origin + parsed.pathname).toBe("https://api.europeana.eu/record/v2/search.json")
      expect(parsed.searchParams.get("wskey")).toBe("my-europeana-key")
      expect(parsed.searchParams.get("query")).toContain('"Leonardo da Vinci"')
      expect(parsed.searchParams.get("query")).toContain("biography")
      expect(parsed.searchParams.get("rows")).toBe("5")
      expect(callOptions.signal).toBeDefined()
    })
  })

  // ==========================================================================
  // Response parsing
  // ==========================================================================

  describe("response parsing", () => {
    it("combines title and description from items", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeEuropeanaResponse([
          {
            title: ["Portrait of Leonardo da Vinci"],
            dcDescription: ["A Renaissance polymath and painter."],
            edmIsShownAt: ["https://www.example.eu/item/123"],
          },
          {
            title: ["Da Vinci Codex"],
            dcDescription: ["Collection of scientific writings."],
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)
      mockSanitize.mockReturnValue("sanitized text about Leonardo da Vinci")

      const source = new EuropeanaSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.text).toBe("sanitized text about Leonardo da Vinci")
      expect(result!.confidence).toBe(-1)
      expect(result!.costUsd).toBe(0)
      expect(result!.url).toBe("https://www.example.eu/item/123")
      expect(result!.publication).toBe("Europeana")
      expect(result!.metadata?.title).toBe("Portrait of Leonardo da Vinci")
    })
  })

  // ==========================================================================
  // URL fallback
  // ==========================================================================

  describe("URL fallback", () => {
    it("falls back to guid when edmIsShownAt is missing", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeEuropeanaResponse([
          {
            title: ["Da Vinci sketch"],
            dcDescription: ["Anatomical study drawing."],
            guid: "https://www.europeana.eu/portal/record/456.html",
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)
      mockSanitize.mockReturnValue("sanitized text")

      const source = new EuropeanaSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.url).toBe("https://www.europeana.eu/portal/record/456.html")
    })

    it("uses edmIsShownAt over guid when both present", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeEuropeanaResponse([
          {
            title: ["Da Vinci painting"],
            dcDescription: ["The Mona Lisa."],
            edmIsShownAt: ["https://museum.example.eu/mona-lisa"],
            guid: "https://www.europeana.eu/portal/record/789.html",
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)
      mockSanitize.mockReturnValue("sanitized text")

      const source = new EuropeanaSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.url).toBe("https://museum.example.eu/mona-lisa")
    })
  })

  // ==========================================================================
  // Empty / error results
  // ==========================================================================

  describe("empty results", () => {
    it("returns null when no items in response", async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeEuropeanaResponse([]))
      vi.stubGlobal("fetch", mockFetch)

      const source = new EuropeanaSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("returns null on HTTP error (caught by base class)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: async () => ({}),
      })
      vi.stubGlobal("fetch", mockFetch)

      const source = new EuropeanaSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // Factory
  // ==========================================================================

  describe("factory", () => {
    it("returns a EuropeanaSource instance", () => {
      const source = europeana({ apiKey: "test-key" })
      expect(source).toBeInstanceOf(EuropeanaSource)
      expect(source.name).toBe("Europeana")
    })
  })
})
