/**
 * Tests for WebSearchBase abstract class.
 *
 * Uses a concrete TestSearchSource subclass with configurable search results.
 * Mocks fetchPage and extractArticleContent to avoid real HTTP calls.
 * Tests the full pipeline: search → score/rank → fetch → extract → combine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier, type ResearchSubject } from "debriefer"
import { WebSearchBase, type WebSearchResult } from "../../web-search/base.js"

// ============================================================================
// Mocks
// ============================================================================

vi.mock("../../shared/fetch-page.js", () => ({
  fetchPage: vi.fn(),
}))

vi.mock("../../shared/readability-extract.js", () => ({
  extractArticleContent: vi.fn(),
}))

// Import mocked modules after vi.mock declarations
import { fetchPage } from "../../shared/fetch-page.js"
import { extractArticleContent } from "../../shared/readability-extract.js"

const mockFetchPage = vi.mocked(fetchPage)
const mockExtract = vi.mocked(extractArticleContent)

beforeEach(() => {
  mockFetchPage.mockReset()
  mockExtract.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// Test Subclass
// ============================================================================

class TestSearchSource extends WebSearchBase {
  readonly name = "Test Search"
  readonly type = "test-search"
  readonly reliabilityTier = ReliabilityTier.SEARCH_AGGREGATOR
  readonly domain = "test.example.com"
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  searchResults: WebSearchResult[] = []

  protected async performSearch(): Promise<WebSearchResult[]> {
    return this.searchResults
  }

  /** Expose protected isDomainBlocked for testing. */
  testIsDomainBlocked(url: string): boolean {
    return this.isDomainBlocked(url)
  }

  /** Expose protected fetchResult for testing. */
  async doFetch(
    subject: ResearchSubject,
    signal: AbortSignal
  ): Promise<import("debriefer").RawFinding | null> {
    return this.fetchResult(subject, signal)
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Pad text to exceed the default minContentLength (200 chars).
 * Appends filler to ensure the text is long enough for pipeline filtering.
 */
function longText(prefix: string): string {
  const filler =
    " — this additional text is padding to ensure the extracted content exceeds the default minimum content length threshold of 200 characters that the WebSearchBase pipeline enforces during extraction."
  return prefix + filler
}

function makeSubject(overrides?: Partial<ResearchSubject>): ResearchSubject {
  return {
    id: 1,
    name: "John Wayne",
    ...overrides,
  }
}

function makeSearchResult(overrides?: Partial<WebSearchResult>): WebSearchResult {
  return {
    url: "https://example.com/page",
    title: "Example Page",
    snippet: "A page about the topic",
    ...overrides,
  }
}

/** Set up fetchPage and extractArticleContent to return content for each URL. */
function setupPageExtraction(
  pages: Array<{
    url: string
    html?: string
    title?: string
    text?: string
    fetchFailed?: boolean
    extractFailed?: boolean
  }>
): void {
  mockFetchPage.mockImplementation(async (options) => {
    const page = pages.find((p) => p.url === options.url)
    if (!page || page.fetchFailed) {
      return {
        content: "",
        url: options.url,
        fetchMethod: "none" as const,
        error: "Fetch failed",
      }
    }
    return {
      content: page.html ?? `<html><body>${page.text ?? "content"}</body></html>`,
      url: page.url,
      fetchMethod: "direct" as const,
    }
  })

  mockExtract.mockImplementation((_html: string, url?: string) => {
    const page = pages.find((p) => p.url === url)
    if (!page || page.extractFailed) {
      return null
    }
    return {
      text: page.text ?? longText("Default extracted content"),
      title: page.title ?? "Page Title",
      author: null,
      excerpt: null,
      siteName: null,
    }
  })
}

// ============================================================================
// Tests
// ============================================================================

describe("WebSearchBase", () => {
  // ==========================================================================
  // Full pipeline
  // ==========================================================================

  describe("full pipeline", () => {
    it("search → fetch → extract → combine returns a RawFinding", async () => {
      const source = new TestSearchSource()
      source.searchResults = [
        makeSearchResult({ url: "https://example.com/article", title: "Great Article" }),
      ]

      setupPageExtraction([
        {
          url: "https://example.com/article",
          title: "Great Article",
          text: longText("This is the extracted article content about John Wayne"),
        },
      ])

      const subject = makeSubject()
      const signal = AbortSignal.timeout(5000)
      const result = await source.doFetch(subject, signal)

      expect(result).not.toBeNull()
      expect(result!.text).toContain("This is the extracted article content")
      expect(result!.url).toBe("https://example.com/article")
      expect(result!.costUsd).toBe(0)
    })
  })

  // ==========================================================================
  // Empty search results → null
  // ==========================================================================

  describe("empty search results", () => {
    it("returns null when performSearch returns no results", async () => {
      const source = new TestSearchSource()
      source.searchResults = []

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // All pages fail extraction → null
  // ==========================================================================

  describe("all pages fail extraction", () => {
    it("returns null when all fetched pages fail extraction", async () => {
      const source = new TestSearchSource()
      source.searchResults = [
        makeSearchResult({ url: "https://example.com/page1" }),
        makeSearchResult({ url: "https://example.com/page2" }),
      ]

      setupPageExtraction([
        { url: "https://example.com/page1", extractFailed: true },
        { url: "https://example.com/page2", extractFailed: true },
      ])

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // All pages below minContentLength → null
  // ==========================================================================

  describe("all pages below minContentLength", () => {
    it("returns null when all extracted content is too short", async () => {
      const source = new TestSearchSource({ minContentLength: 200 })
      source.searchResults = [makeSearchResult({ url: "https://example.com/short" })]

      setupPageExtraction([
        {
          url: "https://example.com/short",
          text: "Short text",
        },
      ])

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // maxLinksToFollow limits fetches
  // ==========================================================================

  describe("maxLinksToFollow", () => {
    it("only fetches up to maxLinksToFollow pages", async () => {
      const source = new TestSearchSource({ maxLinksToFollow: 2 })
      source.searchResults = [
        makeSearchResult({ url: "https://example.com/page1", title: "Page 1" }),
        makeSearchResult({ url: "https://example.com/page2", title: "Page 2" }),
        makeSearchResult({ url: "https://example.com/page3", title: "Page 3" }),
        makeSearchResult({ url: "https://example.com/page4", title: "Page 4" }),
      ]

      setupPageExtraction([
        { url: "https://example.com/page1", text: longText("Content from page one") },
        { url: "https://example.com/page2", text: longText("Content from page two") },
        { url: "https://example.com/page3", text: longText("Content from page three") },
        { url: "https://example.com/page4", text: longText("Content from page four") },
      ])

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).not.toBeNull()
      // Only 2 pages should have been fetched
      expect(mockFetchPage).toHaveBeenCalledTimes(2)
    })
  })

  // ==========================================================================
  // domainScores affects link ordering
  // ==========================================================================

  describe("domainScores", () => {
    it("preferred domain is fetched first due to higher score", async () => {
      const source = new TestSearchSource({
        maxLinksToFollow: 1,
        domainScores: { "preferred.com": 100 },
      })
      source.searchResults = [
        makeSearchResult({ url: "https://example.com/page", title: "Normal Page" }),
        makeSearchResult({ url: "https://preferred.com/page", title: "Preferred Page" }),
      ]

      setupPageExtraction([
        { url: "https://example.com/page", text: longText("Normal content") },
        { url: "https://preferred.com/page", text: longText("Preferred content") },
      ])

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).not.toBeNull()
      // With maxLinksToFollow=1, only the preferred page should be fetched
      expect(mockFetchPage).toHaveBeenCalledTimes(1)
      expect(mockFetchPage).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://preferred.com/page" })
      )
    })
  })

  // ==========================================================================
  // boostKeywords affect link ordering
  // ==========================================================================

  describe("boostKeywords", () => {
    it("result with boost keyword in title is ranked higher", async () => {
      const source = new TestSearchSource({
        maxLinksToFollow: 1,
        boostKeywords: [{ keyword: "obituary", boost: 100 }],
      })
      source.searchResults = [
        makeSearchResult({ url: "https://example.com/bio", title: "Biography" }),
        makeSearchResult({ url: "https://example.com/obit", title: "Obituary for John Wayne" }),
      ]

      setupPageExtraction([
        { url: "https://example.com/bio", text: longText("Biography content") },
        { url: "https://example.com/obit", text: longText("Obituary content") },
      ])

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).not.toBeNull()
      expect(mockFetchPage).toHaveBeenCalledTimes(1)
      expect(mockFetchPage).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://example.com/obit" })
      )
    })
  })

  // ==========================================================================
  // penaltyKeywords affect link ordering
  // ==========================================================================

  describe("penaltyKeywords", () => {
    it("result with penalty keyword in snippet is ranked lower", async () => {
      const source = new TestSearchSource({
        maxLinksToFollow: 1,
        penaltyKeywords: [{ keyword: "login", penalty: 100 }],
      })
      source.searchResults = [
        makeSearchResult({
          url: "https://example.com/login-page",
          title: "Page",
          snippet: "Please login to continue",
        }),
        makeSearchResult({
          url: "https://example.com/article",
          title: "Article",
          snippet: "Real article content",
        }),
      ]

      setupPageExtraction([
        { url: "https://example.com/login-page", text: longText("Login page content") },
        { url: "https://example.com/article", text: longText("Real article content") },
      ])

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).not.toBeNull()
      expect(mockFetchPage).toHaveBeenCalledTimes(1)
      expect(mockFetchPage).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://example.com/article" })
      )
    })
  })

  // ==========================================================================
  // blockedDomains filters links
  // ==========================================================================

  describe("blockedDomains", () => {
    it("filters out results from blocked domains", async () => {
      const source = new TestSearchSource({
        blockedDomains: ["blocked.com"],
      })
      source.searchResults = [
        makeSearchResult({ url: "https://blocked.com/page", title: "Blocked" }),
        makeSearchResult({ url: "https://sub.blocked.com/page", title: "Also Blocked" }),
        makeSearchResult({ url: "https://allowed.com/page", title: "Allowed" }),
      ]

      setupPageExtraction([
        { url: "https://blocked.com/page", text: longText("Should not be fetched") },
        { url: "https://sub.blocked.com/page", text: longText("Should not be fetched either") },
        { url: "https://allowed.com/page", text: longText("Allowed content") },
      ])

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).not.toBeNull()
      // Only the allowed page should have been fetched
      expect(mockFetchPage).toHaveBeenCalledTimes(1)
      expect(mockFetchPage).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://allowed.com/page" })
      )
    })

    it("returns null when all results are from blocked domains", async () => {
      const source = new TestSearchSource({
        blockedDomains: ["blocked.com"],
      })
      source.searchResults = [
        makeSearchResult({ url: "https://blocked.com/page1" }),
        makeSearchResult({ url: "https://www.blocked.com/page2" }),
      ]

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).toBeNull()
      expect(mockFetchPage).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Multiple pages combine with attribution
  // ==========================================================================

  describe("multiple pages combine with attribution", () => {
    it("combines text from multiple pages with title attribution and separators", async () => {
      const source = new TestSearchSource({ maxLinksToFollow: 3 })
      source.searchResults = [
        makeSearchResult({ url: "https://example.com/page1", title: "First Article" }),
        makeSearchResult({ url: "https://example.com/page2", title: "Second Article" }),
      ]

      setupPageExtraction([
        {
          url: "https://example.com/page1",
          title: "First Article",
          text: longText("Content from the first article"),
        },
        {
          url: "https://example.com/page2",
          title: "Second Article",
          text: longText("Content from the second article"),
        },
      ])

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).not.toBeNull()
      // Should have title attributions
      expect(result!.text).toContain("First Article")
      expect(result!.text).toContain("Second Article")
      // Should have separator between pages
      expect(result!.text).toContain("---")
      // Should have content from both pages
      expect(result!.text).toContain("Content from the first article")
      expect(result!.text).toContain("Content from the second article")
    })
  })

  // ==========================================================================
  // Metadata includes expected fields
  // ==========================================================================

  describe("metadata", () => {
    it("includes searchEngine, linksFollowed, pagesExtracted, and urls", async () => {
      const source = new TestSearchSource()
      source.searchResults = [
        makeSearchResult({ url: "https://example.com/page1" }),
        makeSearchResult({ url: "https://example.com/page2" }),
      ]

      setupPageExtraction([
        {
          url: "https://example.com/page1",
          title: "Page 1",
          text: longText("Content from page 1"),
        },
        {
          url: "https://example.com/page2",
          extractFailed: true,
        },
      ])

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).not.toBeNull()
      expect(result!.metadata).toBeDefined()
      expect(result!.metadata!.searchEngine).toBe("Test Search")
      expect(result!.metadata!.linksFollowed).toBe(2)
      expect(result!.metadata!.pagesExtracted).toBe(1)
      expect(result!.metadata!.urls).toEqual(["https://example.com/page1"])
    })
  })

  // ==========================================================================
  // Confidence is -1 (delegation to base class)
  // ==========================================================================

  describe("confidence delegation", () => {
    it("returns confidence of -1 to delegate to base class keyword scoring", async () => {
      const source = new TestSearchSource()
      source.searchResults = [makeSearchResult({ url: "https://example.com/page" })]

      setupPageExtraction([
        {
          url: "https://example.com/page",
          text: longText("Extracted article content"),
        },
      ])

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).not.toBeNull()
      expect(result!.confidence).toBe(-1)
    })
  })

  // ==========================================================================
  // Fetch failures for some pages still returns others
  // ==========================================================================

  describe("partial fetch failures", () => {
    it("returns content from pages that succeed even when some fail", async () => {
      const source = new TestSearchSource()
      source.searchResults = [
        makeSearchResult({ url: "https://example.com/fail" }),
        makeSearchResult({ url: "https://example.com/succeed" }),
      ]

      setupPageExtraction([
        { url: "https://example.com/fail", fetchFailed: true },
        {
          url: "https://example.com/succeed",
          text: longText("Successful page content"),
        },
      ])

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).not.toBeNull()
      expect(result!.text).toContain("Successful page content")
    })
  })

  // ==========================================================================
  // SSRF prevention
  // ==========================================================================

  describe("SSRF prevention (isDomainBlocked)", () => {
    const source = new TestSearchSource()

    it("allows normal http URLs", () => {
      expect(source.testIsDomainBlocked("https://example.com/page")).toBe(false)
      expect(source.testIsDomainBlocked("http://example.com/page")).toBe(false)
    })

    it("blocks non-http schemes", () => {
      expect(source.testIsDomainBlocked("file:///etc/passwd")).toBe(true)
      expect(source.testIsDomainBlocked("ftp://internal/file")).toBe(true)
      expect(source.testIsDomainBlocked("javascript:alert(1)")).toBe(true)
    })

    it("blocks localhost", () => {
      expect(source.testIsDomainBlocked("http://localhost/admin")).toBe(true)
      expect(source.testIsDomainBlocked("http://localhost:8080/")).toBe(true)
    })

    it("blocks 127.0.0.0/8 loopback range", () => {
      expect(source.testIsDomainBlocked("http://127.0.0.1/")).toBe(true)
      expect(source.testIsDomainBlocked("http://127.1.2.3/")).toBe(true)
      expect(source.testIsDomainBlocked("http://127.255.255.255/")).toBe(true)
    })

    it("blocks IPv6 loopback", () => {
      expect(source.testIsDomainBlocked("http://[::1]/")).toBe(true)
    })

    it("blocks RFC 1918 private IPs", () => {
      expect(source.testIsDomainBlocked("http://10.0.0.1/")).toBe(true)
      expect(source.testIsDomainBlocked("http://10.255.255.255/")).toBe(true)
      expect(source.testIsDomainBlocked("http://192.168.1.1/")).toBe(true)
      expect(source.testIsDomainBlocked("http://172.16.0.1/")).toBe(true)
      expect(source.testIsDomainBlocked("http://172.31.255.255/")).toBe(true)
    })

    it("allows non-private 172.x IPs", () => {
      expect(source.testIsDomainBlocked("http://172.64.0.1/")).toBe(false) // Cloudflare
      expect(source.testIsDomainBlocked("http://172.15.0.1/")).toBe(false)
      expect(source.testIsDomainBlocked("http://172.32.0.1/")).toBe(false)
    })

    it("blocks cloud metadata endpoint", () => {
      expect(source.testIsDomainBlocked("http://169.254.169.254/latest/meta-data/")).toBe(true)
      expect(source.testIsDomainBlocked("http://169.254.0.1/")).toBe(true)
    })

    it("blocks 0.0.0.0", () => {
      expect(source.testIsDomainBlocked("http://0.0.0.0/")).toBe(true)
    })

    it("blocks .local domains", () => {
      expect(source.testIsDomainBlocked("http://myserver.local/")).toBe(true)
    })

    it("blocks unparseable URLs", () => {
      expect(source.testIsDomainBlocked("not-a-url")).toBe(true)
    })

    it("does not false-positive on domains starting with fc/fd/fe80", () => {
      expect(source.testIsDomainBlocked("https://fcnews.com/article")).toBe(false)
      expect(source.testIsDomainBlocked("https://fdic.gov/")).toBe(false)
      expect(source.testIsDomainBlocked("https://fe80news.com/")).toBe(false)
    })
  })

  // ==========================================================================
  // linkSelector callback
  // ==========================================================================

  describe("linkSelector", () => {
    it("filters results via linkSelector before fetching", async () => {
      const source = new TestSearchSource({
        linkSelector: async (results) => results.filter((r) => r.url.includes("chosen")),
      })
      source.searchResults = [
        makeSearchResult({ url: "https://example.com/skipped", title: "Skipped" }),
        makeSearchResult({ url: "https://example.com/chosen", title: "Chosen" }),
      ]

      setupPageExtraction([
        { url: "https://example.com/skipped", text: longText("Should not be fetched") },
        { url: "https://example.com/chosen", text: longText("Chosen content") },
      ])

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).not.toBeNull()
      expect(mockFetchPage).toHaveBeenCalledTimes(1)
      expect(mockFetchPage).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://example.com/chosen" })
      )
    })

    it("receives the subject for context-aware selection", async () => {
      const selectorSpy = vi.fn().mockImplementation((results: WebSearchResult[]) => results)
      const source = new TestSearchSource({ linkSelector: selectorSpy })
      source.searchResults = [makeSearchResult({ url: "https://example.com/page" })]

      setupPageExtraction([{ url: "https://example.com/page", text: longText("Content") }])

      const subject = makeSubject({ name: "Test Actor" })
      await source.doFetch(subject, AbortSignal.timeout(5000))

      expect(selectorSpy).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ name: "Test Actor" })
      )
    })
  })

  // ==========================================================================
  // maxLinkCost budget
  // ==========================================================================

  describe("maxLinkCost", () => {
    it("stops following links when cost budget is zero", async () => {
      const source = new TestSearchSource({
        maxLinkCost: 0,
      })
      source.searchResults = [
        makeSearchResult({ url: "https://example.com/page1" }),
        makeSearchResult({ url: "https://example.com/page2" }),
      ]

      setupPageExtraction([
        { url: "https://example.com/page1", text: longText("Content 1") },
        { url: "https://example.com/page2", text: longText("Content 2") },
      ])

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).toBeNull()
      expect(mockFetchPage).not.toHaveBeenCalled()
    })

    it("stops after budget is exhausted mid-way through links (custom fetch)", async () => {
      const customFetch = vi.fn().mockResolvedValue(longText("Fetched content"))
      // Budget of 0.001 with estimatedCostPerQuery=0 (TestSearchSource).
      // customFetchPage path uses estimatedCostPerQuery for cost tracking,
      // but TestSearchSource has cost=0, so each fetch adds $0. Use a
      // PaidTestSearchSource instead.
      const source = new TestSearchSource({
        maxLinkCost: 0.001,
        fetchPage: customFetch,
      })
      // Override estimatedCostPerQuery for this test
      Object.defineProperty(source, "estimatedCostPerQuery", { value: 0.001 })

      source.searchResults = [
        makeSearchResult({ url: "https://example.com/page1" }),
        makeSearchResult({ url: "https://example.com/page2" }),
        makeSearchResult({ url: "https://example.com/page3" }),
      ]

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).not.toBeNull()
      // Budget allows exactly 1 fetch ($0.001), then exhausted before 2nd
      expect(customFetch).toHaveBeenCalledTimes(1)
    })

    it("enforces budget in default fetch path", async () => {
      const source = new TestSearchSource({ maxLinkCost: 0.001 })
      Object.defineProperty(source, "estimatedCostPerQuery", { value: 0.001 })

      source.searchResults = [
        makeSearchResult({ url: "https://example.com/page1" }),
        makeSearchResult({ url: "https://example.com/page2" }),
        makeSearchResult({ url: "https://example.com/page3" }),
      ]

      setupPageExtraction([
        { url: "https://example.com/page1", text: longText("Content 1") },
        { url: "https://example.com/page2", text: longText("Content 2") },
        { url: "https://example.com/page3", text: longText("Content 3") },
      ])

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).not.toBeNull()
      // Budget allows 1 successful fetch, then exhausted
      expect(mockFetchPage).toHaveBeenCalledTimes(1)
    })
  })

  // ==========================================================================
  // custom fetchPage callback
  // ==========================================================================

  describe("custom fetchPage", () => {
    it("uses custom fetchPage instead of default pipeline", async () => {
      const customFetch = vi.fn().mockResolvedValue(longText("Custom fetched content"))
      const source = new TestSearchSource({ fetchPage: customFetch })
      source.searchResults = [
        makeSearchResult({ url: "https://example.com/page", title: "Custom Page" }),
      ]

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).not.toBeNull()
      expect(result!.text).toContain("Custom fetched content")
      // Default fetchPage should NOT have been called
      expect(mockFetchPage).not.toHaveBeenCalled()
      // Custom fetch should have been called with the URL
      expect(customFetch).toHaveBeenCalledWith("https://example.com/page", expect.any(AbortSignal))
    })

    it("skips pages where custom fetchPage returns null", async () => {
      const customFetch = vi
        .fn()
        .mockResolvedValueOnce(null) // First page fails
        .mockResolvedValueOnce(longText("Second page content"))
      const source = new TestSearchSource({ fetchPage: customFetch })
      source.searchResults = [
        makeSearchResult({ url: "https://example.com/fail", title: "Fail" }),
        makeSearchResult({ url: "https://example.com/succeed", title: "Succeed" }),
      ]

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).not.toBeNull()
      expect(result!.text).toContain("Second page content")
      expect(customFetch).toHaveBeenCalledTimes(2)
    })

    it("respects minContentLength with custom fetchPage", async () => {
      const customFetch = vi.fn().mockResolvedValue("Short")
      const source = new TestSearchSource({ fetchPage: customFetch, minContentLength: 200 })
      source.searchResults = [makeSearchResult({ url: "https://example.com/short" })]

      const result = await source.doFetch(makeSubject(), AbortSignal.timeout(5000))

      expect(result).toBeNull()
    })
  })
})
