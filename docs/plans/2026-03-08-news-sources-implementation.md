# News Sources Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 22 news and reference sources — 20 via a configurable `SiteSearchSource` class, 2 via direct API classes (Guardian, NYT).

**Architecture:** A single `SiteSearchSource` class handles the DDG `site:` search → pick best URL → fetch → extract pattern. Each of the 20 sources is a factory function passing different config (domain, tier, paths, query terms). Guardian and NYT are separate classes with proprietary API integrations. All sources extend `BaseResearchSource<ResearchSubject>`.

**Tech Stack:** TypeScript 5.x, Node.js 22 built-in `fetch`, vitest, existing shared utilities (`searchDuckDuckGo`, `fetchPage`, `extractArticleContent`, `sanitizeSourceText`), debriefer core (`BaseResearchSource`, `ReliabilityTier`)

**Design doc:** `docs/plans/2026-03-08-news-sources-design.md`

---

## Task 1: SiteSearchSource class + pickBestUrl helper

**Files:**

- Create: `packages/sources/src/news/site-search-source.ts`
- Test: `packages/sources/src/__tests__/news/site-search-source.test.ts`

**Step 1: Write the tests**

```typescript
// packages/sources/src/__tests__/news/site-search-source.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier, type ResearchSubject } from "debriefer"
import {
  SiteSearchSource,
  pickBestUrl,
  type SiteSearchConfig,
} from "../../news/site-search-source.js"

// ============================================================================
// Mocks
// ============================================================================

const mockSearchDDG = vi.fn()
const mockFetchPage = vi.fn()
const mockExtractArticle = vi.fn()

vi.mock("../../shared/duckduckgo-search.js", () => ({
  searchDuckDuckGo: (...args: unknown[]) => mockSearchDDG(...args),
}))
vi.mock("../../shared/fetch-page.js", () => ({
  fetchPage: (...args: unknown[]) => mockFetchPage(...args),
}))
vi.mock("../../shared/readability-extract.js", () => ({
  extractArticleContent: (...args: unknown[]) => mockExtractArticle(...args),
}))

beforeEach(() => {
  mockSearchDDG.mockReset()
  mockFetchPage.mockReset()
  mockExtractArticle.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// Helpers
// ============================================================================

const TEST_CONFIG: SiteSearchConfig = {
  name: "Test News",
  type: "test-news",
  domain: "testnews.com",
  reliabilityTier: ReliabilityTier.TIER_1_NEWS,
}

function makeSubject(overrides?: Partial<ResearchSubject>): ResearchSubject {
  return { id: 1, name: "John Wayne", ...overrides }
}

function setupSuccessfulPipeline(text: string): void {
  mockSearchDDG.mockResolvedValue([
    {
      url: "https://testnews.com/article/john-wayne",
      title: "Article",
      snippet: "About John Wayne",
    },
  ])
  mockFetchPage.mockResolvedValue({
    content: "<html><body><p>Article content</p></body></html>",
    url: "https://testnews.com/article/john-wayne",
    fetchMethod: "direct",
  })
  mockExtractArticle.mockReturnValue({
    text,
    title: "John Wayne Profile",
    author: null,
    excerpt: null,
    siteName: null,
  })
}

// ============================================================================
// pickBestUrl
// ============================================================================

describe("pickBestUrl", () => {
  it("returns the first URL when no preferences configured", () => {
    const urls = [
      { url: "https://example.com/page1", title: "", snippet: "" },
      { url: "https://example.com/page2", title: "", snippet: "" },
    ]
    expect(pickBestUrl(urls)).toBe("https://example.com/page1")
  })

  it("prefers URLs matching preferredPaths", () => {
    const urls = [
      { url: "https://example.com/news/story", title: "", snippet: "" },
      { url: "https://example.com/article/bio", title: "", snippet: "" },
    ]
    expect(pickBestUrl(urls, { preferredPaths: ["/article/"] })).toBe(
      "https://example.com/article/bio"
    )
  })

  it("avoids URLs matching avoidPaths", () => {
    const urls = [
      { url: "https://example.com/gallery/photos", title: "", snippet: "" },
      { url: "https://example.com/article/bio", title: "", snippet: "" },
    ]
    expect(pickBestUrl(urls, { avoidPaths: ["/gallery/"] })).toBe("https://example.com/article/bio")
  })

  it("preferred beats avoid when both match", () => {
    const urls = [
      { url: "https://example.com/article/gallery", title: "", snippet: "" },
      { url: "https://example.com/article/bio", title: "", snippet: "" },
    ]
    expect(pickBestUrl(urls, { preferredPaths: ["/article/"], avoidPaths: ["/gallery/"] })).toBe(
      "https://example.com/article/bio"
    )
  })

  it("returns first URL when no results match preferences", () => {
    const urls = [{ url: "https://example.com/page", title: "", snippet: "" }]
    expect(pickBestUrl(urls, { preferredPaths: ["/article/"] })).toBe("https://example.com/page")
  })

  it("returns null for empty array", () => {
    expect(pickBestUrl([])).toBeNull()
  })
})

// ============================================================================
// SiteSearchSource
// ============================================================================

describe("SiteSearchSource", () => {
  describe("metadata", () => {
    it("derives properties from config", () => {
      const source = new SiteSearchSource(TEST_CONFIG)
      expect(source.name).toBe("Test News")
      expect(source.type).toBe("test-news")
      expect(source.reliabilityTier).toBe(ReliabilityTier.TIER_1_NEWS)
      expect(source.domain).toBe("testnews.com")
      expect(source.isFree).toBe(true)
      expect(source.estimatedCostPerQuery).toBe(0)
    })
  })

  describe("full pipeline", () => {
    it("searches DDG with site: filter, fetches, extracts, and returns", async () => {
      const longText = "A ".repeat(150) // > 200 chars
      setupSuccessfulPipeline(longText)

      const source = new SiteSearchSource(TEST_CONFIG)
      const result = await source.lookup(makeSubject(), AbortSignal.timeout(5000))

      expect(result).not.toBeNull()
      expect(result!.confidence).toBe(-1)
      expect(result!.publication).toBe("Test News")

      // Verify DDG was called with site: query
      expect(mockSearchDDG).toHaveBeenCalledTimes(1)
      const searchOpts = mockSearchDDG.mock.calls[0][0]
      expect(searchOpts.query).toContain("John Wayne")
      expect(searchOpts.domainFilter).toBe("testnews.com")
    })

    it("appends queryTerms to search query", async () => {
      const longText = "A ".repeat(150)
      setupSuccessfulPipeline(longText)

      const config = { ...TEST_CONFIG, queryTerms: "biography OR profile" }
      const source = new SiteSearchSource(config)
      await source.lookup(makeSubject(), AbortSignal.timeout(5000))

      const searchOpts = mockSearchDDG.mock.calls[0][0]
      expect(searchOpts.query).toContain("biography OR profile")
    })

    it("returns null when search returns no results", async () => {
      mockSearchDDG.mockResolvedValue([])

      const source = new SiteSearchSource(TEST_CONFIG)
      const result = await source.lookup(makeSubject(), AbortSignal.timeout(5000))

      expect(result).toBeNull()
    })

    it("returns null when page fetch fails", async () => {
      mockSearchDDG.mockResolvedValue([
        { url: "https://testnews.com/page", title: "Page", snippet: "" },
      ])
      mockFetchPage.mockResolvedValue({
        content: "",
        url: "https://testnews.com/page",
        fetchMethod: "none",
      })

      const source = new SiteSearchSource(TEST_CONFIG)
      const result = await source.lookup(makeSubject(), AbortSignal.timeout(5000))

      expect(result).toBeNull()
    })

    it("returns null when extraction fails", async () => {
      mockSearchDDG.mockResolvedValue([
        { url: "https://testnews.com/page", title: "Page", snippet: "" },
      ])
      mockFetchPage.mockResolvedValue({
        content: "<html></html>",
        url: "https://testnews.com/page",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue(null)

      const source = new SiteSearchSource(TEST_CONFIG)
      const result = await source.lookup(makeSubject(), AbortSignal.timeout(5000))

      expect(result).toBeNull()
    })

    it("returns null when extracted text is below minContentLength", async () => {
      setupSuccessfulPipeline("Too short")

      const source = new SiteSearchSource(TEST_CONFIG)
      const result = await source.lookup(makeSubject(), AbortSignal.timeout(5000))

      expect(result).toBeNull()
    })

    it("uses pickBestUrl with preferredPaths from config", async () => {
      mockSearchDDG.mockResolvedValue([
        { url: "https://testnews.com/news/story", title: "News", snippet: "" },
        { url: "https://testnews.com/article/bio", title: "Bio", snippet: "" },
      ])
      mockFetchPage.mockResolvedValue({
        content: "<html><body>Content</body></html>",
        url: "https://testnews.com/article/bio",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue({
        text: "A ".repeat(150),
        title: "Bio",
        author: null,
        excerpt: null,
        siteName: null,
      })

      const config = { ...TEST_CONFIG, preferredPaths: ["/article/"] }
      const source = new SiteSearchSource(config)
      await source.lookup(makeSubject(), AbortSignal.timeout(5000))

      // Should have fetched the preferred path URL
      expect(mockFetchPage.mock.calls[0][0].url).toBe("https://testnews.com/article/bio")
    })

    it("includes metadata with source name and URL", async () => {
      const longText = "A ".repeat(150)
      setupSuccessfulPipeline(longText)

      const source = new SiteSearchSource(TEST_CONFIG)
      const result = await source.lookup(makeSubject(), AbortSignal.timeout(5000))

      expect(result!.url).toBe("https://testnews.com/article/john-wayne")
      expect(result!.publication).toBe("Test News")
    })

    it("supports additionalDomains for multi-domain sources like BBC", async () => {
      const longText = "A ".repeat(150)
      setupSuccessfulPipeline(longText)

      const config = { ...TEST_CONFIG, domain: "bbc.com", additionalDomains: ["bbc.co.uk"] }
      const source = new SiteSearchSource(config)
      await source.lookup(makeSubject(), AbortSignal.timeout(5000))

      // DDG search should still use primary domain as filter
      const searchOpts = mockSearchDDG.mock.calls[0][0]
      expect(searchOpts.domainFilter).toBe("bbc.com")
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/sources && npx vitest run src/__tests__/news/site-search-source.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// packages/sources/src/news/site-search-source.ts
/**
 * Configurable site-search source for news and reference sites.
 *
 * Searches a specific domain via DuckDuckGo's site: operator, picks the best
 * URL from results, fetches the page, extracts article content, and returns
 * a RawFinding. Handles 19 different news/reference sources with configuration
 * rather than separate classes.
 */

import {
  BaseResearchSource,
  type BaseSourceOptions,
  type ResearchSubject,
  type RawFinding,
  type ReliabilityTier,
} from "debriefer"
import { searchDuckDuckGo, type SearchResult } from "../shared/duckduckgo-search.js"
import { fetchPage } from "../shared/fetch-page.js"
import { extractArticleContent } from "../shared/readability-extract.js"
import { sanitizeSourceText } from "../shared/sanitize-text.js"

// ============================================================================
// Types
// ============================================================================

/** Configuration for a site-search source. */
export interface SiteSearchConfig {
  /** Human-readable source name (e.g., "AP News") */
  name: string
  /** Unique source type identifier (e.g., "ap-news") */
  type: string
  /** Primary domain to search (e.g., "apnews.com") */
  domain: string
  /** Additional domains to accept in results (e.g., ["bbc.co.uk"]) */
  additionalDomains?: string[]
  /** Reliability tier from Wikipedia RSP */
  reliabilityTier: ReliabilityTier
  /** Rate limit delay in ms (default: 1500) */
  rateLimitMs?: number
  /** URL path prefixes that indicate good content — results with these are preferred */
  preferredPaths?: string[]
  /** URL path prefixes to avoid — results with these are deprioritized */
  avoidPaths?: string[]
  /** Extra terms appended to query (e.g., "biography OR profile") */
  queryTerms?: string
  /** Minimum extracted text length (default: 200) */
  minContentLength?: number
}

// ============================================================================
// URL Selection
// ============================================================================

/**
 * Pick the best URL from search results using path preference/avoidance heuristics.
 *
 * Scoring: +10 for each preferredPaths match, -10 for each avoidPaths match.
 * Falls back to first result if no preferences match.
 */
export function pickBestUrl(
  results: SearchResult[],
  options?: { preferredPaths?: string[]; avoidPaths?: string[] }
): string | null {
  if (results.length === 0) return null

  const { preferredPaths = [], avoidPaths = [] } = options ?? {}

  if (preferredPaths.length === 0 && avoidPaths.length === 0) {
    return results[0].url
  }

  let bestUrl = results[0].url
  let bestScore = 0

  for (const result of results) {
    let score = 0
    const path = new URL(result.url).pathname

    for (const pref of preferredPaths) {
      if (path.includes(pref)) {
        score += 10
        break
      }
    }

    for (const avoid of avoidPaths) {
      if (path.includes(avoid)) {
        score -= 10
        break
      }
    }

    if (score > bestScore) {
      bestScore = score
      bestUrl = result.url
    }
  }

  return bestUrl
}

// ============================================================================
// SiteSearchSource
// ============================================================================

export class SiteSearchSource extends BaseResearchSource<ResearchSubject> {
  readonly name: string
  readonly type: string
  readonly reliabilityTier: ReliabilityTier
  readonly domain: string
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  private config: SiteSearchConfig

  constructor(config: SiteSearchConfig, options?: BaseSourceOptions) {
    super({ rateLimitMs: config.rateLimitMs ?? 1500, ...options })
    this.name = config.name
    this.type = config.type
    this.reliabilityTier = config.reliabilityTier
    this.domain = config.domain
    this.config = config
  }

  protected async fetchResult(
    subject: ResearchSubject,
    signal: AbortSignal
  ): Promise<RawFinding | null> {
    // 1. Build query and search
    const queryParts = [`"${subject.name}"`]
    if (this.config.queryTerms) {
      queryParts.push(this.config.queryTerms)
    }

    const results = await searchDuckDuckGo({
      query: queryParts.join(" "),
      domainFilter: this.config.domain,
      signal,
    })

    if (results.length === 0) return null

    // 2. Pick best URL
    const url = pickBestUrl(results, {
      preferredPaths: this.config.preferredPaths,
      avoidPaths: this.config.avoidPaths,
    })
    if (!url) return null

    // 3. Fetch page
    const page = await fetchPage({ url, signal })
    if (page.fetchMethod === "none" || !page.content) return null

    // 4. Extract article content
    const actualUrl = page.url || url
    const article = extractArticleContent(page.content, actualUrl)
    if (!article) return null

    // 5. Check minimum content length
    const minLength = this.config.minContentLength ?? 200
    if (article.text.length < minLength) return null

    // 6. Sanitize and return
    const text = sanitizeSourceText(article.text)
    if (text.length < minLength) return null

    return {
      text,
      confidence: -1,
      costUsd: 0,
      url: actualUrl,
      publication: this.name,
      metadata: {
        title: article.title,
        author: article.author,
        siteName: article.siteName,
        domain: this.config.domain,
      },
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/sources && npx vitest run src/__tests__/news/site-search-source.test.ts`
Expected: All ~15 tests PASS

**Step 5: Commit**

```bash
git add packages/sources/src/news/site-search-source.ts packages/sources/src/__tests__/news/site-search-source.test.ts
git commit -m "feat(sources): add SiteSearchSource class with pickBestUrl helper"
```

---

## Task 2: 19 news/reference source factory functions

**Files:**

- Create: `packages/sources/src/news/sources.ts`

No separate test file — the factory functions are tested by spot-checks in the SiteSearchSource tests (Task 1). This task is pure config wiring.

**Step 1: Write the implementation**

```typescript
// packages/sources/src/news/sources.ts
/**
 * Factory functions for 19 site-search news and reference sources.
 *
 * Each function creates a SiteSearchSource with domain-specific config.
 * All are free (no API keys) and use DDG site: search.
 */

import { ReliabilityTier, type BaseSourceOptions } from "debriefer"
import { SiteSearchSource } from "./site-search-source.js"

// ============================================================================
// TIER_1_NEWS (0.95)
// ============================================================================

export function apNews(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "AP News",
      type: "ap-news",
      domain: "apnews.com",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 1500,
      preferredPaths: ["/article/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

export function bbcNews(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "BBC News",
      type: "bbc-news",
      domain: "bbc.com",
      additionalDomains: ["bbc.co.uk"],
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 1500,
      queryTerms: "profile OR biography OR life story",
    },
    options
  )
}

export function reuters(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "Reuters",
      type: "reuters",
      domain: "reuters.com",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 2000,
      preferredPaths: ["/world/", "/lifestyle/", "/entertainment/", "/business/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

export function npr(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "NPR",
      type: "npr",
      domain: "npr.org",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 1500,
      preferredPaths: ["/sections/", "/music/", "/books/", "/movies/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

export function independent(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "The Independent",
      type: "independent",
      domain: "independent.co.uk",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 2000,
      preferredPaths: ["/arts-entertainment/", "/news/", "/life-style/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

export function telegraph(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "The Telegraph",
      type: "telegraph",
      domain: "telegraph.co.uk",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 2000,
      preferredPaths: ["/films/", "/culture/", "/obituaries/", "/news/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

export function washingtonPost(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "The Washington Post",
      type: "washington-post",
      domain: "washingtonpost.com",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 2000,
      preferredPaths: ["/entertainment/", "/obituaries/", "/style/", "/lifestyle/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

export function laTimes(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "Los Angeles Times",
      type: "la-times",
      domain: "latimes.com",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 2000,
      preferredPaths: ["/entertainment/", "/obituaries/", "/california/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

export function time(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "Time",
      type: "time",
      domain: "time.com",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 1500,
      preferredPaths: ["/entertainment/", "/culture/", "/person-of-the-year/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

export function newYorker(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "The New Yorker",
      type: "new-yorker",
      domain: "newyorker.com",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 2000,
      preferredPaths: ["/magazine/", "/culture/", "/news/", "/books/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

export function pbs(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "PBS",
      type: "pbs",
      domain: "pbs.org",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 1500,
      preferredPaths: ["/wgbh/", "/newshour/", "/frontline/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

export function britannica(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "Encyclopaedia Britannica",
      type: "britannica",
      domain: "britannica.com",
      reliabilityTier: ReliabilityTier.TIER_1_NEWS,
      rateLimitMs: 1500,
      preferredPaths: ["/biography/"],
      queryTerms: "biography",
    },
    options
  )
}

// ============================================================================
// TRADE_PRESS (0.9)
// ============================================================================

export function rollingStone(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "Rolling Stone",
      type: "rolling-stone",
      domain: "rollingstone.com",
      reliabilityTier: ReliabilityTier.TRADE_PRESS,
      rateLimitMs: 2000,
      preferredPaths: ["/music/", "/movies/", "/culture/", "/feature/"],
      queryTerms: "profile OR biography OR interview",
    },
    options
  )
}

export function smithsonian(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "Smithsonian Magazine",
      type: "smithsonian",
      domain: "smithsonianmag.com",
      reliabilityTier: ReliabilityTier.TRADE_PRESS,
      rateLimitMs: 2000,
      preferredPaths: ["/history/", "/biography/", "/people-places/"],
      queryTerms: "biography",
    },
    options
  )
}

export function nationalGeographic(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "National Geographic",
      type: "national-geographic",
      domain: "nationalgeographic.com",
      reliabilityTier: ReliabilityTier.TRADE_PRESS,
      rateLimitMs: 1500,
      preferredPaths: ["/adventure/", "/science/", "/history/"],
      queryTerms: "profile OR biography",
    },
    options
  )
}

export function historyCom(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "History.com",
      type: "history-com",
      domain: "history.com",
      reliabilityTier: ReliabilityTier.TRADE_PRESS,
      rateLimitMs: 2000,
      preferredPaths: ["/topics/", "/biographies/", "/people/"],
      queryTerms: "biography",
    },
    options
  )
}

export function tcm(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "Turner Classic Movies",
      type: "tcm",
      domain: "tcm.com",
      reliabilityTier: ReliabilityTier.TRADE_PRESS,
      rateLimitMs: 2000,
      preferredPaths: ["/tcmdb/person/"],
      queryTerms: "biography",
    },
    options
  )
}

export function allMusic(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "AllMusic",
      type: "allmusic",
      domain: "allmusic.com",
      reliabilityTier: ReliabilityTier.TRADE_PRESS,
      rateLimitMs: 2000,
      preferredPaths: ["/artist/", "/artists/"],
      queryTerms: "biography",
    },
    options
  )
}

// ============================================================================
// MARGINAL_EDITORIAL (0.65) / SECONDARY_COMPILATION (0.85)
// ============================================================================

export function people(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "People",
      type: "people",
      domain: "people.com",
      reliabilityTier: ReliabilityTier.MARGINAL_EDITORIAL,
      rateLimitMs: 1500,
      avoidPaths: ["/gallery/", "/video/", "/news/", "/shopping/", "/food/"],
      queryTerms: "profile OR personal life",
    },
    options
  )
}

export function biographyCom(options?: BaseSourceOptions): SiteSearchSource {
  return new SiteSearchSource(
    {
      name: "Biography.com",
      type: "biography-com",
      domain: "biography.com",
      reliabilityTier: ReliabilityTier.SECONDARY_COMPILATION,
      rateLimitMs: 1500,
      avoidPaths: ["/lists/", "/news/", "/video/", "/gallery/"],
      // No queryTerms — bare name search for maximum coverage
    },
    options
  )
}
```

**Step 2: Verify it compiles**

Run: `npx turbo build --filter=debriefer-sources`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/sources/src/news/sources.ts
git commit -m "feat(sources): add 19 news/reference source factory functions"
```

---

## Task 3: Guardian API source

**Files:**

- Create: `packages/sources/src/news/guardian.ts`
- Test: `packages/sources/src/__tests__/news/guardian.test.ts`

**Step 1: Write the tests**

Tests should mock global `fetch`, verify API URL/params/headers, response parsing, article selection by keyword, isAvailable, error handling, and factory function. Follow the same pattern as google.test.ts (mock fetch + pipeline utilities).

**Step 2: Write the implementation**

Guardian source:

- `GET https://content.guardianapis.com/search?api-key=KEY&q="name" AND (profile OR interview OR biography)&show-fields=bodyText,standfirst,trailText&page-size=10&order-by=relevance`
- Picks best article by biographical keyword matching in title then body
- Returns bodyText (or standfirst/trailText fallback) with `confidence: -1`
- `isAvailable()` checks for API key
- `rateLimitMs: 200`

**Step 3: Run tests, commit**

```bash
git add packages/sources/src/news/guardian.ts packages/sources/src/__tests__/news/guardian.test.ts
git commit -m "feat(sources): add Guardian API source"
```

---

## Task 4: NYT API source

**Files:**

- Create: `packages/sources/src/news/nytimes.ts`
- Test: `packages/sources/src/__tests__/news/nytimes.test.ts`

**Step 1: Write the tests**

Tests should verify API URL/params, response parsing (lead_paragraph + abstract + snippet combination), confidence cap at 0.7, isAvailable, error handling, factory function.

**Step 2: Write the implementation**

NYT source:

- `GET https://api.nytimes.com/svc/search/v2/articlesearch.json?api-key=KEY&q="name" biography OR profile OR interview&sort=relevance&fq=document_type:("article")`
- Picks best article by biographical keyword matching in headline then abstract
- Combines lead_paragraph + abstract + snippet
- Returns with confidence capped at 0.7 (partial content)
- `isAvailable()` checks for API key
- `rateLimitMs: 6000`

**Step 3: Run tests, commit**

```bash
git add packages/sources/src/news/nytimes.ts packages/sources/src/__tests__/news/nytimes.test.ts
git commit -m "feat(sources): add New York Times API source"
```

---

## Task 5: Update exports and verify full suite

**Files:**

- Modify: `packages/sources/src/index.ts`

**Step 1: Add all news source exports to index.ts**

```typescript
// News sources — site-search based
export { SiteSearchSource, pickBestUrl } from "./news/site-search-source.js"
export type { SiteSearchConfig } from "./news/site-search-source.js"
export {
  apNews,
  bbcNews,
  reuters,
  npr,
  independent,
  telegraph,
  washingtonPost,
  laTimes,
  time,
  newYorker,
  pbs,
  britannica,
  rollingStone,
  smithsonian,
  nationalGeographic,
  historyCom,
  tcm,
  allMusic,
  people,
  biographyCom,
} from "./news/sources.js"

// News sources — API based
export { GuardianSource, guardian } from "./news/guardian.js"
export type { GuardianOptions } from "./news/guardian.js"
export { NYTimesSource, nytimes } from "./news/nytimes.js"
export type { NYTimesOptions } from "./news/nytimes.js"
```

**Step 2: Run full checks**

```bash
npx turbo test lint type-check
npx prettier --check .
```

Expected: All tests PASS, lint clean, type-check clean, formatting clean

**Step 3: Commit**

```bash
git add packages/sources/src/index.ts
git commit -m "feat(sources): export all news sources"
```
