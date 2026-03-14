/**
 * Tests for InternetArchiveSource.
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

import { InternetArchiveSource, internetArchive } from "../../archives/internet-archive.js"

// ============================================================================
// Helpers
// ============================================================================

/** Standard test subject. */
const subject = { id: 1, name: "Mark Twain" }

/** Standard abort signal for tests. */
const signal = AbortSignal.timeout(5000)

/** Build a mock Internet Archive API response. */
function makeIAResponse(
  docs: Array<{
    identifier?: string
    title?: string
    description?: string
    creator?: string
  }>
) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      response: { docs },
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

describe("InternetArchiveSource", () => {
  // ==========================================================================
  // Metadata
  // ==========================================================================

  describe("metadata", () => {
    it("has correct name, type, tier, domain, isFree, and cost", () => {
      const source = new InternetArchiveSource()

      expect(source.name).toBe("Internet Archive")
      expect(source.type).toBe("internet-archive")
      expect(source.reliabilityTier).toBe(ReliabilityTier.ARCHIVE_MIRROR)
      expect(source.domain).toBe("archive.org")
      expect(source.isFree).toBe(true)
      expect(source.estimatedCostPerQuery).toBe(0)
    })
  })

  // ==========================================================================
  // API call format
  // ==========================================================================

  describe("API call format", () => {
    it("builds correct URL with all expected query params", async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeIAResponse([]))
      vi.stubGlobal("fetch", mockFetch)

      const source = new InternetArchiveSource()
      await source.lookup(subject, signal)

      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [callUrl, callOptions] = mockFetch.mock.calls[0] as [string, { signal: AbortSignal }]
      const parsed = new URL(callUrl)

      expect(parsed.origin + parsed.pathname).toBe("https://archive.org/advancedsearch.php")
      expect(parsed.searchParams.get("q")).toContain('"Mark Twain"')
      expect(parsed.searchParams.get("q")).toContain("biography OR memoir")
      expect(parsed.searchParams.getAll("fl[]")).toEqual(
        expect.arrayContaining(["identifier", "title", "description", "creator"])
      )
      expect(parsed.searchParams.get("rows")).toBe("5")
      expect(parsed.searchParams.get("output")).toBe("json")
      expect(callOptions.signal).toBeDefined()
    })
  })

  // ==========================================================================
  // Response parsing
  // ==========================================================================

  describe("response parsing", () => {
    it("combines title and description from docs", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeIAResponse([
          {
            identifier: "mark-twain-biography",
            title: "Mark Twain: A Life",
            description: "A comprehensive biography of the American author.",
            creator: "Ron Powers",
          },
          {
            identifier: "twain-collected-letters",
            title: "Collected Letters of Mark Twain",
            description: "Personal correspondence from 1860-1910.",
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)
      mockSanitize.mockReturnValue("sanitized text about Mark Twain")

      const source = new InternetArchiveSource()
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.text).toBe("sanitized text about Mark Twain")
      expect(result!.confidence).toBe(-1)
      expect(result!.costUsd).toBe(0)
      expect(result!.publication).toBe("Internet Archive")
      expect(result!.metadata?.title).toBe("Mark Twain: A Life")

      // sanitize was called with combined text
      expect(mockSanitize).toHaveBeenCalledTimes(1)
      const sanitizeArg = mockSanitize.mock.calls[0][0] as string
      expect(sanitizeArg).toContain("Mark Twain: A Life")
      expect(sanitizeArg).toContain("A comprehensive biography")
    })
  })

  // ==========================================================================
  // URL construction
  // ==========================================================================

  describe("URL construction", () => {
    it("builds URL from identifier using archive.org/details/{id}", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeIAResponse([
          {
            identifier: "mark-twain-bio-2005",
            title: "Mark Twain Biography",
            description: "A biography.",
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)
      mockSanitize.mockReturnValue("sanitized text")

      const source = new InternetArchiveSource()
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.url).toBe("https://archive.org/details/mark-twain-bio-2005")
    })

    it("returns undefined URL when identifier is missing", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeIAResponse([
          {
            title: "Mark Twain Book",
            description: "A book about Twain.",
          },
        ])
      )
      vi.stubGlobal("fetch", mockFetch)
      mockSanitize.mockReturnValue("sanitized text")

      const source = new InternetArchiveSource()
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.url).toBeUndefined()
    })
  })

  // ==========================================================================
  // Empty / error results
  // ==========================================================================

  describe("empty results", () => {
    it("returns null when no docs in response", async () => {
      const mockFetch = vi.fn().mockResolvedValue(makeIAResponse([]))
      vi.stubGlobal("fetch", mockFetch)

      const source = new InternetArchiveSource()
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("returns null on HTTP error (caught by base class)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({}),
      })
      vi.stubGlobal("fetch", mockFetch)

      const source = new InternetArchiveSource()
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // Factory
  // ==========================================================================

  describe("factory", () => {
    it("returns an InternetArchiveSource instance", () => {
      const source = internetArchive()
      expect(source).toBeInstanceOf(InternetArchiveSource)
      expect(source.name).toBe("Internet Archive")
    })
  })
})
