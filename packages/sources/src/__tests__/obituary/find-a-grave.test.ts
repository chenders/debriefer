/**
 * Tests for the Find a Grave obituary source.
 *
 * Mocks shared utilities (fetchPage, extractArticleContent, sanitizeSourceText)
 * so the tests exercise only the FindAGraveSource pipeline logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { ReliabilityTier } from "@debriefer/core"

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

/**
 * Mock the search step via fetchPage. The search is now the first fetchPage call.
 * Returns a FetchPageResult-shaped object.
 */
function mockSearchFetchPage(html: string, fetchMethod: "direct" | "none" = "direct"): void {
  mockFetchPage.mockResolvedValueOnce({
    content: html,
    url: "https://www.findagrave.com/memorial/search",
    fetchMethod,
  })
}

// ============================================================================
// Lifecycle
// ============================================================================

beforeEach(() => {
  mockFetchPage.mockReset()
  mockExtractArticle.mockReset()
  mockSanitize.mockReset()
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
      mockSearchFetchPage("<html><body></body></html>")

      const source = new FindAGraveSource()
      await source.lookup(subject, signal)

      expect(mockFetchPage).toHaveBeenCalledTimes(1)
      const calledOpts = mockFetchPage.mock.calls[0][0] as { url: string }
      expect(calledOpts.url).toContain("firstname=John")
      expect(calledOpts.url).toContain("lastname=Wayne")
      expect(calledOpts.url).toContain("orderby=r")
    })
  })

  describe("memorial URL extraction", () => {
    it("extracts memorial URLs from search result HTML", async () => {
      const searchHtml = makeSearchHtml([
        "/memorial/12345/john-wayne",
        "/memorial/67890/john-wayne-gacy",
      ])
      mockSearchFetchPage(searchHtml)

      // The name-matching step will filter for "john-wayne" in URL
      // Both URLs contain "john-wayne" but first one is an exact match
      mockFetchPage.mockResolvedValueOnce({
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
      // Second fetchPage call should be for the memorial page
      expect(mockFetchPage).toHaveBeenCalledTimes(2)
      expect(mockFetchPage.mock.calls[1][0]).toEqual(
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
      mockSearchFetchPage(searchHtml)

      mockFetchPage.mockResolvedValueOnce({
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
      expect(mockFetchPage.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          url: "https://www.findagrave.com/memorial/22222/john-wayne",
        })
      )
    })
  })

  describe("null returns", () => {
    it("returns null when no matching memorials found (name mismatch)", async () => {
      const searchHtml = makeSearchHtml(["/memorial/11111/jane-smith", "/memorial/22222/bob-jones"])
      mockSearchFetchPage(searchHtml)

      const source = new FindAGraveSource()
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
      // Only the search fetchPage call should have been made
      expect(mockFetchPage).toHaveBeenCalledTimes(1)
    })

    it("returns null when search returns no results", async () => {
      const emptyHtml = '<html><body><div class="search-results"></div></body></html>'
      mockSearchFetchPage(emptyHtml)

      const source = new FindAGraveSource()
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
      expect(mockFetchPage).toHaveBeenCalledTimes(1)
    })

    it("returns null when search fetch fails", async () => {
      mockSearchFetchPage("", "none")

      const source = new FindAGraveSource()
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })
  })

  describe("bio extraction and sanitization", () => {
    it("extracts bio via Readability and sanitizes output", async () => {
      const searchHtml = makeSearchHtml(["/memorial/12345/john-wayne"])
      mockSearchFetchPage(searchHtml)

      const bioContent =
        "John Wayne (born Marion Robert Morrison; May 26, 1907 – June 11, 1979) was an American actor who became a popular icon through his leading roles in films during Hollywood's Golden Age."
      mockFetchPage.mockResolvedValueOnce({
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
      mockSearchFetchPage(searchHtml)

      const bioDivContent =
        "John Wayne was born Marion Robert Morrison on May 26, 1907. He was a famous American actor known for westerns and war films during Hollywood's Golden Age."
      const pageHtml = `<html><body><div id="bio">${bioDivContent}</div></body></html>`

      mockFetchPage.mockResolvedValueOnce({
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
