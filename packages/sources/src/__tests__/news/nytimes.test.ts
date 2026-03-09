/**
 * Tests for NYTimesSource.
 *
 * Mocks global fetch (NYT uses its own API, not fetchPage/extractArticleContent)
 * and sanitizeSourceText. Tests exercise metadata, availability, API call format,
 * response parsing, article selection, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier } from "debriefer"

// ============================================================================
// Mocks
// ============================================================================

const mockSanitize = vi.fn()

vi.mock("../../shared/sanitize-text.js", () => ({
  sanitizeSourceText: (...args: unknown[]) => mockSanitize(...args),
}))

import { NYTimesSource, nytimes } from "../../news/nytimes.js"

// ============================================================================
// Helpers
// ============================================================================

/** Standard test subject. */
const subject = { id: 1, name: "John Wayne" }

/** Standard abort signal for tests. */
const signal = AbortSignal.timeout(5000)

/** Build a mock NYT API response with customizable docs. */
function makeNytResponse(
  docs: Array<{
    web_url?: string
    headline?: { main: string }
    lead_paragraph?: string
    abstract?: string
    snippet?: string
  }> = []
) {
  return {
    status: "OK",
    response: {
      docs: docs.map((d) => ({
        web_url: d.web_url ?? "https://www.nytimes.com/article/test",
        headline: d.headline ?? { main: "Test Article" },
        lead_paragraph: d.lead_paragraph ?? "",
        abstract: d.abstract ?? "",
        snippet: d.snippet ?? "",
      })),
    },
  }
}

/** Create text of a given length. */
function textOfLength(n: number): string {
  return "A".repeat(n)
}

// ============================================================================
// Lifecycle
// ============================================================================

let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
  mockSanitize.mockReset()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

// ============================================================================
// Metadata
// ============================================================================

describe("NYTimesSource", () => {
  describe("metadata", () => {
    it("has correct name, type, tier, domain, isFree, and cost", () => {
      const source = new NYTimesSource({ apiKey: "test-key" })

      expect(source.name).toBe("The New York Times")
      expect(source.type).toBe("nytimes")
      expect(source.reliabilityTier).toBe(ReliabilityTier.TIER_1_NEWS)
      expect(source.domain).toBe("api.nytimes.com")
      expect(source.isFree).toBe(false)
      expect(source.estimatedCostPerQuery).toBe(0)
    })
  })

  // ==========================================================================
  // isAvailable
  // ==========================================================================

  describe("isAvailable", () => {
    it("returns true when apiKey is provided", () => {
      const source = new NYTimesSource({ apiKey: "test-key" })
      expect(source.isAvailable()).toBe(true)
    })

    it("returns false when no apiKey and no env var", () => {
      const original = process.env.NYTIMES_API_KEY
      delete process.env.NYTIMES_API_KEY

      const source = new NYTimesSource()
      expect(source.isAvailable()).toBe(false)

      if (original !== undefined) process.env.NYTIMES_API_KEY = original
    })
  })

  // ==========================================================================
  // API call format
  // ==========================================================================

  describe("API call format", () => {
    it("builds correct URL with required params", async () => {
      let capturedUrl = ""
      globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
        capturedUrl = typeof input === "string" ? input : input.toString()
        return new Response(JSON.stringify(makeNytResponse()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      })

      const source = new NYTimesSource({ apiKey: "my-api-key" })
      await source.lookup(subject, signal)

      const parsed = new URL(capturedUrl)
      expect(parsed.origin + parsed.pathname).toBe(
        "https://api.nytimes.com/svc/search/v2/articlesearch.json"
      )
      expect(parsed.searchParams.get("api-key")).toBe("my-api-key")
      expect(parsed.searchParams.get("q")).toBe('"John Wayne" (biography OR profile OR interview)')
      expect(parsed.searchParams.get("sort")).toBe("relevance")
      expect(parsed.searchParams.get("fq")).toBe('document_type:("article")')
    })
  })

  // ==========================================================================
  // Response parsing
  // ==========================================================================

  describe("response parsing", () => {
    it("combines lead_paragraph, abstract, and snippet into text", async () => {
      const lead = textOfLength(50)
      const abstract = textOfLength(30)
      const snippet = textOfLength(30)
      const combined = `${lead}\n\n${abstract}\n\n${snippet}`

      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify(
            makeNytResponse([
              {
                lead_paragraph: lead,
                abstract,
                snippet,
                web_url: "https://www.nytimes.com/article/test",
                headline: { main: "Test Article" },
              },
            ])
          ),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      })
      mockSanitize.mockReturnValue(combined)

      const source = new NYTimesSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(mockSanitize).toHaveBeenCalledWith(combined)
      expect(result).not.toBeNull()
      expect(result!.text).toBe(combined)
      expect(result!.url).toBe("https://www.nytimes.com/article/test")
      expect(result!.publication).toBe("The New York Times")
      expect(result!.metadata).toEqual({ title: "Test Article" })
    })

    it("returns confidence of 0.7 (not -1)", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify(
            makeNytResponse([
              {
                lead_paragraph: textOfLength(120),
                web_url: "https://www.nytimes.com/article/test",
              },
            ])
          ),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      })
      mockSanitize.mockReturnValue(textOfLength(120))

      const source = new NYTimesSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.confidence).toBe(0.7)
    })
  })

  // ==========================================================================
  // Article selection
  // ==========================================================================

  describe("article selection", () => {
    it("picks article with bio keyword in headline over others", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify(
            makeNytResponse([
              {
                headline: { main: "John Wayne Wins Award" },
                lead_paragraph: textOfLength(120),
                web_url: "https://www.nytimes.com/article/award",
              },
              {
                headline: { main: "A Profile of John Wayne" },
                lead_paragraph: textOfLength(120),
                web_url: "https://www.nytimes.com/article/profile",
              },
            ])
          ),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      })
      mockSanitize.mockImplementation((t: string) => t)

      const source = new NYTimesSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.url).toBe("https://www.nytimes.com/article/profile")
    })

    it("falls back to abstract/snippet keyword match when headline has none", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify(
            makeNytResponse([
              {
                headline: { main: "John Wayne Wins Award" },
                abstract: "He received a medal.",
                lead_paragraph: textOfLength(120),
                web_url: "https://www.nytimes.com/article/award",
              },
              {
                headline: { main: "John Wayne in Film" },
                abstract: "An interview with the legendary actor.",
                lead_paragraph: textOfLength(120),
                web_url: "https://www.nytimes.com/article/interview",
              },
            ])
          ),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      })
      mockSanitize.mockImplementation((t: string) => t)

      const source = new NYTimesSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.url).toBe("https://www.nytimes.com/article/interview")
    })
  })

  // ==========================================================================
  // Null returns
  // ==========================================================================

  describe("null returns", () => {
    it("returns null when API returns no docs", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(JSON.stringify(makeNytResponse([])), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      })

      const source = new NYTimesSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("returns null when combined text is too short (< 100 chars)", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify(
            makeNytResponse([
              {
                lead_paragraph: "Short.",
                abstract: "Brief.",
                snippet: "Tiny.",
              },
            ])
          ),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      })

      const source = new NYTimesSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
      expect(mockSanitize).not.toHaveBeenCalled()
    })

    it("returns null when sanitized text is too short (< 100 chars)", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify(
            makeNytResponse([
              {
                lead_paragraph: textOfLength(120),
              },
            ])
          ),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      })
      // Sanitize strips it below threshold
      mockSanitize.mockReturnValue("Too short after sanitize")

      const source = new NYTimesSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("returns null on API HTTP error (caught by base class)", async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response("Rate limited", { status: 429, statusText: "Too Many Requests" })
      })

      const source = new NYTimesSource({ apiKey: "test-key" })
      const result = await source.lookup(subject, signal)

      // Base class catches the thrown error and returns null
      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // Factory function
  // ==========================================================================

  describe("factory", () => {
    it("nytimes() returns a NYTimesSource instance", () => {
      const source = nytimes({ apiKey: "test-key" })
      expect(source).toBeInstanceOf(NYTimesSource)
      expect(source.name).toBe("The New York Times")
    })
  })
})
