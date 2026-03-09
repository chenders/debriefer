/**
 * Tests for SiteSearchSource and pickBestUrl.
 *
 * Mocks the shared utilities (searchDuckDuckGo, fetchPage,
 * extractArticleContent, sanitizeSourceText) so the tests exercise
 * only the SiteSearchSource pipeline logic and pickBestUrl scoring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier } from "debriefer"

// ============================================================================
// Mocks — must be declared before importing the module under test
// ============================================================================

const mockSearchDDG = vi.fn()
const mockFetchPage = vi.fn()
const mockExtractArticle = vi.fn()
const mockSanitize = vi.fn()

vi.mock("../../shared/duckduckgo-search.js", () => ({
  searchDuckDuckGo: (...args: unknown[]) => mockSearchDDG(...args),
}))

vi.mock("../../shared/fetch-page.js", () => ({
  fetchPage: (...args: unknown[]) => mockFetchPage(...args),
}))

vi.mock("../../shared/readability-extract.js", () => ({
  extractArticleContent: (...args: unknown[]) => mockExtractArticle(...args),
}))

vi.mock("../../shared/sanitize-text.js", () => ({
  sanitizeSourceText: (...args: unknown[]) => mockSanitize(...args),
}))

import {
  SiteSearchSource,
  pickBestUrl,
  type SiteSearchConfig,
} from "../../news/site-search-source.js"

// ============================================================================
// Helpers
// ============================================================================

/** Minimal config for most tests. */
function makeConfig(overrides?: Partial<SiteSearchConfig>): SiteSearchConfig {
  return {
    name: "AP News",
    type: "ap-news",
    domain: "apnews.com",
    reliabilityTier: ReliabilityTier.TIER_1_NEWS,
    ...overrides,
  }
}

/** Standard test subject. */
const subject = { id: 1, name: "John Wayne" }

/** Standard abort signal for tests. */
const signal = AbortSignal.timeout(5000)

// ============================================================================
// Lifecycle
// ============================================================================

beforeEach(() => {
  mockSearchDDG.mockReset()
  mockFetchPage.mockReset()
  mockExtractArticle.mockReset()
  mockSanitize.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// pickBestUrl
// ============================================================================

describe("pickBestUrl", () => {
  it("returns first URL when no preferences are set", () => {
    const results = [
      { url: "https://apnews.com/first", title: "First", snippet: "" },
      { url: "https://apnews.com/second", title: "Second", snippet: "" },
    ]
    expect(pickBestUrl(results)).toBe("https://apnews.com/first")
  })

  it("prefers URL matching preferredPaths", () => {
    const results = [
      { url: "https://apnews.com/gallery/photo-1", title: "Gallery", snippet: "" },
      { url: "https://apnews.com/article/john-wayne", title: "Article", snippet: "" },
    ]
    expect(pickBestUrl(results, { preferredPaths: ["/article/"] })).toBe(
      "https://apnews.com/article/john-wayne"
    )
  })

  it("avoids URL matching avoidPaths", () => {
    const results = [
      { url: "https://apnews.com/gallery/photo-1", title: "Gallery", snippet: "" },
      { url: "https://apnews.com/other/page", title: "Other", snippet: "" },
    ]
    expect(pickBestUrl(results, { avoidPaths: ["/gallery/"] })).toBe(
      "https://apnews.com/other/page"
    )
  })

  it("preferred beats avoid when both match different URLs", () => {
    const results = [
      { url: "https://apnews.com/gallery/photo-1", title: "Gallery", snippet: "" },
      { url: "https://apnews.com/article/john-wayne", title: "Article", snippet: "" },
    ]
    expect(pickBestUrl(results, { preferredPaths: ["/article/"], avoidPaths: ["/gallery/"] })).toBe(
      "https://apnews.com/article/john-wayne"
    )
  })

  it("returns first URL when no paths match any preferences", () => {
    const results = [
      { url: "https://apnews.com/hub/politics", title: "Hub", snippet: "" },
      { url: "https://apnews.com/hub/sports", title: "Sports", snippet: "" },
    ]
    expect(pickBestUrl(results, { preferredPaths: ["/article/"], avoidPaths: ["/gallery/"] })).toBe(
      "https://apnews.com/hub/politics"
    )
  })

  it("returns null for empty array", () => {
    expect(pickBestUrl([])).toBeNull()
  })
})

// ============================================================================
// SiteSearchSource — metadata
// ============================================================================

describe("SiteSearchSource", () => {
  describe("metadata", () => {
    it("derives all metadata from config", () => {
      const source = new SiteSearchSource(makeConfig())

      expect(source.name).toBe("AP News")
      expect(source.type).toBe("ap-news")
      expect(source.reliabilityTier).toBe(ReliabilityTier.TIER_1_NEWS)
      expect(source.domain).toBe("apnews.com")
      expect(source.isFree).toBe(true)
      expect(source.estimatedCostPerQuery).toBe(0)
    })

    it("uses custom rateLimitMs from config", () => {
      const source = new SiteSearchSource(makeConfig({ rateLimitMs: 2000 }))
      // Access the protected options through lookup behavior (rate limit is internal)
      // We verify it's set by checking the source was constructed without error
      expect(source.name).toBe("AP News")
    })
  })

  // ==========================================================================
  // buildQuery
  // ==========================================================================

  describe("buildQuery", () => {
    it("wraps subject name in quotes", () => {
      const source = new SiteSearchSource(makeConfig())
      expect(source.buildQuery(subject)).toBe('"John Wayne"')
    })

    it("appends queryTerms when configured", () => {
      const source = new SiteSearchSource(makeConfig({ queryTerms: "biography OR profile" }))
      expect(source.buildQuery(subject)).toBe('"John Wayne" biography OR profile')
    })
  })

  // ==========================================================================
  // fetchResult — full pipeline success
  // ==========================================================================

  describe("full pipeline", () => {
    it("returns a finding on successful pipeline", async () => {
      mockSearchDDG.mockResolvedValue([
        { url: "https://apnews.com/article/john-wayne", title: "AP article", snippet: "..." },
      ])
      mockFetchPage.mockResolvedValue({
        content: "<html>content</html>",
        url: "https://apnews.com/article/john-wayne",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue({
        text: "A".repeat(300),
        title: "John Wayne obituary",
        author: "AP Staff",
        excerpt: "...",
        siteName: "AP News",
      })
      mockSanitize.mockReturnValue("A".repeat(300))

      const source = new SiteSearchSource(makeConfig())
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.text).toBe("A".repeat(300))
      expect(result!.confidence).toBe(-1)
      expect(result!.costUsd).toBe(0)
      expect(result!.url).toBe("https://apnews.com/article/john-wayne")
      expect(result!.publication).toBe("AP News")
      expect(result!.metadata).toEqual({
        title: "John Wayne obituary",
        author: "AP Staff",
        siteName: "AP News",
        domain: "apnews.com",
      })
    })

    it("passes queryTerms to the DDG search query", async () => {
      mockSearchDDG.mockResolvedValue([])

      const source = new SiteSearchSource(makeConfig({ queryTerms: "obituary" }))
      await source.lookup(subject, signal)

      const callArgs = mockSearchDDG.mock.calls[0][0] as { query: string }
      expect(callArgs.query).toBe('"John Wayne" obituary')
    })

    it("passes domainFilter to searchDuckDuckGo", async () => {
      mockSearchDDG.mockResolvedValue([])

      const source = new SiteSearchSource(makeConfig())
      await source.lookup(subject, signal)

      const callArgs = mockSearchDDG.mock.calls[0][0] as { domainFilter: string }
      expect(callArgs.domainFilter).toBe("apnews.com")
    })

    it("uses preferredPaths in pickBestUrl", async () => {
      mockSearchDDG.mockResolvedValue([
        { url: "https://apnews.com/gallery/photo-1", title: "Gallery", snippet: "" },
        { url: "https://apnews.com/article/john-wayne", title: "Article", snippet: "" },
      ])
      mockFetchPage.mockResolvedValue({
        content: "<html>content</html>",
        url: "https://apnews.com/article/john-wayne",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue({
        text: "B".repeat(300),
        title: "Article",
        author: null,
        excerpt: null,
        siteName: "AP News",
      })
      mockSanitize.mockReturnValue("B".repeat(300))

      const source = new SiteSearchSource(
        makeConfig({ preferredPaths: ["/article/"], avoidPaths: ["/gallery/"] })
      )
      const result = await source.lookup(subject, signal)

      // Should have fetched the /article/ URL, not the /gallery/ one
      expect(mockFetchPage).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://apnews.com/article/john-wayne" })
      )
      expect(result).not.toBeNull()
    })

    it("includes publication and url in result metadata", async () => {
      mockSearchDDG.mockResolvedValue([
        { url: "https://apnews.com/article/test", title: "Test", snippet: "" },
      ])
      mockFetchPage.mockResolvedValue({
        content: "<html>content</html>",
        url: "https://apnews.com/article/test",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue({
        text: "C".repeat(300),
        title: "Test Article",
        author: "Author",
        excerpt: "...",
        siteName: "AP",
      })
      mockSanitize.mockReturnValue("C".repeat(300))

      const source = new SiteSearchSource(makeConfig())
      const result = await source.lookup(subject, signal)

      expect(result!.publication).toBe("AP News")
      expect(result!.url).toBe("https://apnews.com/article/test")
    })
  })

  // ==========================================================================
  // fetchResult — null returns
  // ==========================================================================

  describe("null returns", () => {
    it("returns null when search returns empty results", async () => {
      mockSearchDDG.mockResolvedValue([])

      const source = new SiteSearchSource(makeConfig())
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("returns null when fetch fails", async () => {
      mockSearchDDG.mockResolvedValue([
        { url: "https://apnews.com/article/test", title: "Test", snippet: "" },
      ])
      mockFetchPage.mockResolvedValue({
        content: "",
        url: "https://apnews.com/article/test",
        fetchMethod: "none",
        error: "HTTP 404",
      })

      const source = new SiteSearchSource(makeConfig())
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("returns null when extraction fails", async () => {
      mockSearchDDG.mockResolvedValue([
        { url: "https://apnews.com/article/test", title: "Test", snippet: "" },
      ])
      mockFetchPage.mockResolvedValue({
        content: "<html>content</html>",
        url: "https://apnews.com/article/test",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue(null)

      const source = new SiteSearchSource(makeConfig())
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
    })

    it("returns null when extracted text is too short", async () => {
      mockSearchDDG.mockResolvedValue([
        { url: "https://apnews.com/article/test", title: "Test", snippet: "" },
      ])
      mockFetchPage.mockResolvedValue({
        content: "<html>content</html>",
        url: "https://apnews.com/article/test",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue({
        text: "Short text",
        title: "Test",
        author: null,
        excerpt: null,
        siteName: null,
      })

      const source = new SiteSearchSource(makeConfig())
      const result = await source.lookup(subject, signal)

      expect(result).toBeNull()
      // sanitize should not have been called
      expect(mockSanitize).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // additionalDomains
  // ==========================================================================

  describe("additionalDomains", () => {
    it("searches all domains when additionalDomains are configured", async () => {
      mockSearchDDG.mockResolvedValue([])

      const source = new SiteSearchSource(
        makeConfig({
          name: "BBC",
          type: "bbc",
          domain: "bbc.com",
          additionalDomains: ["bbc.co.uk"],
        })
      )
      await source.lookup(subject, signal)

      // Should call searchDDG twice — once per domain
      expect(mockSearchDDG).toHaveBeenCalledTimes(2)
      expect(mockSearchDDG.mock.calls[0][0]).toEqual(
        expect.objectContaining({ domainFilter: "bbc.com" })
      )
      expect(mockSearchDDG.mock.calls[1][0]).toEqual(
        expect.objectContaining({ domainFilter: "bbc.co.uk" })
      )
    })

    it("combines results from multiple domains and picks best", async () => {
      mockSearchDDG
        .mockResolvedValueOnce([
          { url: "https://bbc.com/gallery/photo", title: "Gallery", snippet: "" },
        ])
        .mockResolvedValueOnce([
          { url: "https://bbc.co.uk/news/article-123", title: "Article", snippet: "" },
        ])
      mockFetchPage.mockResolvedValue({
        content: "<html>content</html>",
        url: "https://bbc.co.uk/news/article-123",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue({
        text: "D".repeat(300),
        title: "BBC Article",
        author: null,
        excerpt: null,
        siteName: "BBC",
      })
      mockSanitize.mockReturnValue("D".repeat(300))

      const source = new SiteSearchSource(
        makeConfig({
          name: "BBC",
          type: "bbc",
          domain: "bbc.com",
          additionalDomains: ["bbc.co.uk"],
          preferredPaths: ["/news/"],
          avoidPaths: ["/gallery/"],
        })
      )
      const result = await source.lookup(subject, signal)

      expect(result).not.toBeNull()
      // Should have picked the /news/ URL from bbc.co.uk over the /gallery/ one
      expect(mockFetchPage).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://bbc.co.uk/news/article-123" })
      )
    })
  })
})
