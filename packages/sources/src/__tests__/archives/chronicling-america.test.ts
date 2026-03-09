/**
 * Tests for ChroniclingAmericaSource.
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

import { ChroniclingAmericaSource, chroniclingAmerica } from "../../archives/chronicling-america.js"

// ============================================================================
// Helpers
// ============================================================================

/** Standard test subject. */
const subject = { id: 1, name: "John Wayne" }

/** Standard abort signal for tests. */
const signal = AbortSignal.timeout(5000)

/** Build a mock LOC API response. */
function makeLocResponse(
  results: Array<{
    title?: string
    description?: string[]
    date?: string
    url?: string
  }>
) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ results }),
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

describe("ChroniclingAmericaSource", () => {
  // ==========================================================================
  // Metadata
  // ==========================================================================

  describe("metadata", () => {
    it("has correct name, type, tier, domain, isFree, and cost", () => {
      const source = new ChroniclingAmericaSource()

      expect(source.name).toBe("Chronicling America")
      expect(source.type).toBe("chronicling-america")
      expect(source.reliabilityTier).toBe(ReliabilityTier.ARCHIVAL)
      expect(source.domain).toBe("www.loc.gov")
      expect(source.isFree).toBe(true)
      expect(source.estimatedCostPerQuery).toBe(0)
    })
  })

  // ==========================================================================
  // API call format
  // ==========================================================================

  describe("API call format", () => {
    it("builds correct URL with all expected query params", async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeLocResponse([]))
      vi.stubGlobal("fetch", mockFetch)

      const source = new ChroniclingAmericaSource()
      await source.lookup(subject, signal)

      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [callUrl, callOptions] = mockFetch.mock.calls[0] as [string, { signal: AbortSignal }]
      const parsed = new URL(callUrl)

      expect(parsed.origin + parsed.pathname).toBe(
        "https://www.loc.gov/collections/chronicling-america/"
      )
      expect(parsed.searchParams.get("q")).toBe('"John Wayne"')
      expect(parsed.searchParams.get("fo")).toBe("json")
      expect(parsed.searchParams.get("c")).toBe("5")
      expect(callOptions.signal).toBeDefined()
    })
  })

  // ==========================================================================
  // Response parsing
  // ==========================================================================

  describe("response parsing", () => {
    it("combines title and description text from results", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeLocResponse([
          {
            title: "John Wayne obituary",
            description: ["Famous actor known for westerns"],
            url: "https://www.loc.gov/item/123",
          },
          {
            title: "Wayne interview 1960",
            description: ["Rare interview from the archives"],
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)
      mockSanitize.mockReturnValue("sanitized text about John Wayne")

      const source = new ChroniclingAmericaSource()
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.text).toBe("sanitized text about John Wayne")
      expect(result!.confidence).toBe(-1)
      expect(result!.costUsd).toBe(0)
      expect(result!.url).toBe("https://www.loc.gov/item/123")
      expect(result!.publication).toBe("Chronicling America (Library of Congress)")
      expect(result!.metadata?.title).toBe("John Wayne obituary")

      // sanitize was called with combined text
      expect(mockSanitize).toHaveBeenCalledTimes(1)
      const sanitizeArg = mockSanitize.mock.calls[0][0] as string
      expect(sanitizeArg).toContain("John Wayne obituary")
      expect(sanitizeArg).toContain("Famous actor known for westerns")
      expect(sanitizeArg).toContain("Wayne interview 1960")
    })
  })

  // ==========================================================================
  // Empty results
  // ==========================================================================

  describe("empty results", () => {
    it("returns null when API returns no results", async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeLocResponse([]))
      vi.stubGlobal("fetch", mockFetch)

      const source = new ChroniclingAmericaSource()
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("returns null on HTTP error (caught by base class)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({}),
      })
      vi.stubGlobal("fetch", mockFetch)

      const source = new ChroniclingAmericaSource()
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // Factory
  // ==========================================================================

  describe("factory", () => {
    it("returns a ChroniclingAmericaSource instance", () => {
      const source = chroniclingAmerica()
      expect(source).toBeInstanceOf(ChroniclingAmericaSource)
      expect(source.name).toBe("Chronicling America")
    })
  })
})
