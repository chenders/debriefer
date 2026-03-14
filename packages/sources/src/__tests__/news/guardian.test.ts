/**
 * Tests for GuardianSource.
 *
 * Mocks the global fetch API. Does NOT mock pipeline utilities
 * (Guardian uses its own API, not fetchPage/extractArticleContent).
 * sanitizeSourceText is mocked to isolate Guardian-specific logic.
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

import { GuardianSource, guardian } from "../../news/guardian.js"

// ============================================================================
// Helpers
// ============================================================================

/** Standard test subject. */
const subject = { id: 1, name: "John Wayne" }

/** Standard abort signal for tests. */
const signal = AbortSignal.timeout(5000)

/** Build a mock Guardian API response. */
function makeGuardianResponse(
  results: Array<{
    webTitle: string
    webUrl: string
    fields?: { bodyText?: string; standfirst?: string; trailText?: string }
  }>
) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      response: {
        status: "ok",
        results,
      },
    }),
  }
}

/** Body text long enough to pass the 200-char minimum. */
const LONG_TEXT = "A".repeat(300)

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
// Metadata
// ============================================================================

describe("GuardianSource", () => {
  describe("metadata", () => {
    it("has correct name, type, tier, domain, isFree, and cost", () => {
      const source = new GuardianSource({ apiKey: "test-key" })

      expect(source.name).toBe("The Guardian")
      expect(source.type).toBe("guardian")
      expect(source.reliabilityTier).toBe(ReliabilityTier.TIER_1_NEWS)
      expect(source.domain).toBe("content.guardianapis.com")
      expect(source.isFree).toBe(true)
      expect(source.estimatedCostPerQuery).toBe(0)
    })
  })

  // ==========================================================================
  // isAvailable
  // ==========================================================================

  describe("isAvailable", () => {
    it("returns true when apiKey is provided", () => {
      const source = new GuardianSource({ apiKey: "test-key" })
      expect(source.isAvailable()).toBe(true)
    })

    it("returns false when no apiKey is provided and env var is unset", () => {
      const original = process.env.GUARDIAN_API_KEY
      delete process.env.GUARDIAN_API_KEY

      const source = new GuardianSource()
      expect(source.isAvailable()).toBe(false)

      // Restore
      if (original !== undefined) {
        process.env.GUARDIAN_API_KEY = original
      }
    })
  })

  // ==========================================================================
  // API call format
  // ==========================================================================

  describe("API call format", () => {
    it("builds correct URL with all expected query params", async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeGuardianResponse([]))
      vi.stubGlobal("fetch", mockFetch)

      const source = new GuardianSource({ apiKey: "my-api-key" })
      await source.lookup(subject, signal)

      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [callUrl, callOptions] = mockFetch.mock.calls[0] as [string, { signal: AbortSignal }]
      const parsed = new URL(callUrl)

      expect(parsed.origin + parsed.pathname).toBe("https://content.guardianapis.com/search")
      expect(parsed.searchParams.get("api-key")).toBe("my-api-key")
      expect(parsed.searchParams.get("q")).toContain('"John Wayne"')
      expect(parsed.searchParams.get("show-fields")).toBe("bodyText,standfirst,trailText")
      expect(parsed.searchParams.get("page-size")).toBe("10")
      expect(parsed.searchParams.get("order-by")).toBe("relevance")
      expect(callOptions.signal).toBeDefined()
    })
  })

  // ==========================================================================
  // Response parsing — article selection
  // ==========================================================================

  describe("article selection", () => {
    it("picks article with bio keyword in title", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeGuardianResponse([
          {
            webTitle: "John Wayne filmography roundup",
            webUrl: "https://theguardian.com/film/roundup",
            fields: { bodyText: LONG_TEXT },
          },
          {
            webTitle: "John Wayne profile: the man behind the legend",
            webUrl: "https://theguardian.com/film/profile",
            fields: { bodyText: LONG_TEXT },
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)
      mockSanitize.mockReturnValue(LONG_TEXT)

      const source = new GuardianSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.url).toBe("https://theguardian.com/film/profile")
      expect(result!.metadata?.title).toBe("John Wayne profile: the man behind the legend")
    })

    it("falls back to first result when no keyword match", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeGuardianResponse([
          {
            webTitle: "John Wayne in new film role",
            webUrl: "https://theguardian.com/film/new-role",
            fields: { bodyText: LONG_TEXT },
          },
          {
            webTitle: "John Wayne at the Oscars",
            webUrl: "https://theguardian.com/film/oscars",
            fields: { bodyText: LONG_TEXT },
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)
      mockSanitize.mockReturnValue(LONG_TEXT)

      const source = new GuardianSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.url).toBe("https://theguardian.com/film/new-role")
    })
  })

  // ==========================================================================
  // Response parsing — body text
  // ==========================================================================

  describe("body text extraction", () => {
    it("returns bodyText as source text", async () => {
      const bodyText = "B".repeat(300)
      const mockFetch = vi.fn().mockResolvedValue(
        makeGuardianResponse([
          {
            webTitle: "John Wayne profile",
            webUrl: "https://theguardian.com/film/profile",
            fields: { bodyText },
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)
      mockSanitize.mockReturnValue(bodyText)

      const source = new GuardianSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.text).toBe(bodyText)
      expect(result!.confidence).toBe(-1)
      expect(result!.costUsd).toBe(0)
      expect(result!.publication).toBe("The Guardian")
      expect(mockSanitize).toHaveBeenCalledWith(bodyText)
    })
  })

  // ==========================================================================
  // Null returns
  // ==========================================================================

  describe("null returns", () => {
    it("returns null when no results", async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeGuardianResponse([]))
      vi.stubGlobal("fetch", mockFetch)

      const source = new GuardianSource({ apiKey: "test-key" })
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

      const source = new GuardianSource({ apiKey: "test-key" })
      // BaseResearchSource.lookup() catches errors from fetchResult and returns null
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("returns null when apiKey is missing", async () => {
      const original = process.env.GUARDIAN_API_KEY
      delete process.env.GUARDIAN_API_KEY

      const source = new GuardianSource()
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()

      if (original !== undefined) {
        process.env.GUARDIAN_API_KEY = original
      }
    })
  })

  // ==========================================================================
  // Factory function
  // ==========================================================================

  describe("factory", () => {
    it("returns a GuardianSource instance", () => {
      const source = guardian({ apiKey: "test-key" })
      expect(source).toBeInstanceOf(GuardianSource)
      expect(source.name).toBe("The Guardian")
    })
  })
})
