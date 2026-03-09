/**
 * Tests for the Find a Grave obituary source.
 *
 * Mocks global fetch (for search requests) and shared utilities
 * (fetchPage, extractArticleContent, sanitizeSourceText) so the tests
 * exercise only the FindAGraveSource pipeline logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier } from "debriefer"

// ============================================================================
// Mocks — must be declared before importing the module under test
// ============================================================================

const mockFetchPage = vi.fn()
const mockExtractArticle = vi.fn()
const mockSanitize = vi.fn()

vi.mock("../../shared/fetch-page.js", () => ({
  fetchPage: (...args: unknown[]) => mockFetchPage(...args),
}))

vi.mock("../../shared/readability-extract.js", () => ({
  extractArticleContent: (...args: unknown[]) => mockExtractArticle(...args),
}))

vi.mock("../../shared/sanitize-text.js", () => ({
  sanitizeSourceText: (...args: unknown[]) => mockSanitize(...args),
}))

import { FindAGraveSource, findAGrave } from "../../obituary/find-a-grave.js"

// ============================================================================
// Helpers
// ============================================================================

/** Standard test subject. */
const subject = { id: 1, name: "John Wayne" }

/** Standard abort signal for tests. */
const signal = AbortSignal.timeout(5000)

/**
 * Build search results HTML containing memorial links.
 * Each entry is a path like "/memorial/12345/john-wayne"
 */
function makeSearchHtml(memorialPaths: string[]): string {
  const links = memorialPaths
    .map((path) => `<a href="${path}" class="memorial-link">Memorial</a>`)
    .join("\n")
  return `<html><body><div class="search-results">${links}</div></body></html>`
}

/** Mock a successful global fetch response for search. */
function mockSearchResponse(html: string, ok = true, status = 200): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(html, {
      status,
      statusText: ok ? "OK" : "Error",
      headers: { "Content-Type": "text/html" },
    })
  )
}

// ============================================================================
// Lifecycle
// ============================================================================

beforeEach(() => {
  mockFetchPage.mockReset()
  mockExtractArticle.mockReset()
  mockSanitize.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// Tests
// ============================================================================

describe("FindAGraveSource", () => {
  describe("metadata", () => {
    it("has correct name, type, reliability tier, isFree, and cost", () => {
      const source = new FindAGraveSource()

      expect(source.name).toBe("Find a Grave")
      expect(source.type).toBe("find-a-grave")
      expect(source.reliabilityTier).toBe(ReliabilityTier.UNRELIABLE_UGC)
      expect(source.domain).toBe("www.findagrave.com")
      expect(source.isFree).toBe(true)
      expect(source.estimatedCostPerQuery).toBe(0)
    })

    it("always reports as available (no API key needed)", () => {
      const source = new FindAGraveSource()
      expect(source.isAvailable()).toBe(true)
    })
  })

  describe("search URL construction", () => {
    it("builds search URL with first and last name from subject", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("<html><body></body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
      )

      const source = new FindAGraveSource()
      await source.lookup(subject, signal)

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const calledUrl = fetchSpy.mock.calls[0][0] as string
      expect(calledUrl).toContain("firstname=John")
      expect(calledUrl).toContain("lastname=Wayne")
      expect(calledUrl).toContain("orderby=r")
    })
  })

  describe("memorial URL extraction", () => {
    it("extracts memorial URLs from search result HTML", async () => {
      const searchHtml = makeSearchHtml([
        "/memorial/12345/john-wayne",
        "/memorial/67890/john-wayne-gacy",
      ])
      mockSearchResponse(searchHtml)

      // The name-matching step will filter for "john-wayne" in URL
      // Both URLs contain "john-wayne" but first one is an exact match
      mockFetchPage.mockResolvedValue({
        content: '<html><body><div id="bio">Bio content here</div></body></html>',
        url: "https://www.findagrave.com/memorial/12345/john-wayne",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue({
        text: "A".repeat(150),
        title: "John Wayne",
        author: null,
        excerpt: null,
        siteName: "Find a Grave",
      })
      mockSanitize.mockReturnValue("A".repeat(150))

      const source = new FindAGraveSource()
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      // fetchPage should have been called with the first matching memorial URL
      expect(mockFetchPage).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://www.findagrave.com/memorial/12345/john-wayne",
        })
      )
    })
  })

  describe("name matching in memorial URLs", () => {
    it("filters memorial URLs to those containing the subject name (normalized)", async () => {
      const searchHtml = makeSearchHtml([
        "/memorial/11111/jane-smith",
        "/memorial/22222/john-wayne",
      ])
      mockSearchResponse(searchHtml)

      mockFetchPage.mockResolvedValue({
        content: "<html><body>content</body></html>",
        url: "https://www.findagrave.com/memorial/22222/john-wayne",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue({
        text: "B".repeat(150),
        title: "John Wayne",
        author: null,
        excerpt: null,
        siteName: "Find a Grave",
      })
      mockSanitize.mockReturnValue("B".repeat(150))

      const source = new FindAGraveSource()
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      // Should have fetched the john-wayne URL, not jane-smith
      expect(mockFetchPage).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://www.findagrave.com/memorial/22222/john-wayne",
        })
      )
    })
  })

  describe("null returns", () => {
    it("returns null when no matching memorials found (name mismatch)", async () => {
      const searchHtml = makeSearchHtml(["/memorial/11111/jane-smith", "/memorial/22222/bob-jones"])
      mockSearchResponse(searchHtml)

      const source = new FindAGraveSource()
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
      // fetchPage should never have been called since no URLs matched the name
      expect(mockFetchPage).not.toHaveBeenCalled()
    })

    it("returns null when search returns no results", async () => {
      const emptyHtml = '<html><body><div class="search-results"></div></body></html>'
      mockSearchResponse(emptyHtml)

      const source = new FindAGraveSource()
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
      expect(mockFetchPage).not.toHaveBeenCalled()
    })

    it("returns null when search HTTP request fails", async () => {
      mockSearchResponse("", false, 500)

      const source = new FindAGraveSource()
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })
  })

  describe("bio extraction and sanitization", () => {
    it("extracts bio via Readability and sanitizes output", async () => {
      const searchHtml = makeSearchHtml(["/memorial/12345/john-wayne"])
      mockSearchResponse(searchHtml)

      const bioContent =
        "John Wayne (born Marion Robert Morrison; May 26, 1907 – June 11, 1979) was an American actor who became a popular icon through his leading roles in films during Hollywood's Golden Age."
      mockFetchPage.mockResolvedValue({
        content: `<html><body><article>${bioContent}</article></body></html>`,
        url: "https://www.findagrave.com/memorial/12345/john-wayne",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue({
        text: bioContent,
        title: "John Wayne",
        author: null,
        excerpt: null,
        siteName: "Find a Grave",
      })
      mockSanitize.mockReturnValue(bioContent)

      const source = new FindAGraveSource()
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.text).toBe(bioContent)
      expect(result!.confidence).toBe(-1)
      expect(result!.costUsd).toBe(0)
      expect(result!.url).toBe("https://www.findagrave.com/memorial/12345/john-wayne")
      expect(result!.publication).toBe("Find a Grave")
      expect(mockSanitize).toHaveBeenCalledWith(bioContent)
    })

    it("falls back to regex when Readability extraction fails", async () => {
      const searchHtml = makeSearchHtml(["/memorial/12345/john-wayne"])
      mockSearchResponse(searchHtml)

      const bioDivContent =
        "John Wayne was born Marion Robert Morrison on May 26, 1907. He was a famous American actor known for westerns and war films during Hollywood's Golden Age."
      const pageHtml = `<html><body><div id="bio">${bioDivContent}</div></body></html>`

      mockFetchPage.mockResolvedValue({
        content: pageHtml,
        url: "https://www.findagrave.com/memorial/12345/john-wayne",
        fetchMethod: "direct",
      })
      // Readability returns null
      mockExtractArticle.mockReturnValue(null)
      mockSanitize.mockReturnValue(bioDivContent)

      const source = new FindAGraveSource()
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(mockSanitize).toHaveBeenCalled()
      expect(result!.text).toBe(bioDivContent)
    })
  })
})

// ============================================================================
// Factory Function
// ============================================================================

describe("findAGrave factory", () => {
  it("creates a FindAGraveSource instance", () => {
    const source = findAGrave()
    expect(source).toBeInstanceOf(FindAGraveSource)
    expect(source.name).toBe("Find a Grave")
    expect(source.type).toBe("find-a-grave")
  })
})
