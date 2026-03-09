# Web Search Sources Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the web search infrastructure layer — shared utilities (fetch-page, DDG search), abstract WebSearchBase pipeline, and 4 search engine sources (Google, Bing, Brave, DuckDuckGo).

**Architecture:** Two shared utilities provide the fetch and search primitives. An abstract `WebSearchBase` class implements the template method pattern (search → score links → fetch pages → extract → combine). Four concrete sources each implement only `performSearch()`. Link selection is consumer-configurable via `domainScores`, `boostKeywords`, and `penaltyKeywords` options.

**Tech Stack:** TypeScript 5.x, Node.js 22 built-in `fetch`, vitest, existing shared utilities (`extractArticleContent`, `sanitizeSourceText`, `htmlToText`), debriefer core (`BaseResearchSource`, `ReliabilityTier`)

**Design doc:** `docs/plans/2026-03-08-web-search-sources-design.md`

**Reference code:** `/Users/chris/Source/deadonfilm/server/src/lib/shared/fetch-page-with-fallbacks.ts`, `/Users/chris/Source/deadonfilm/server/src/lib/shared/duckduckgo-search.ts`, `/Users/chris/Source/deadonfilm/server/src/lib/biography-sources/sources/web-search-base.ts`

---

## Task 1: Shared fetch-page utility

**Files:**

- Create: `packages/sources/src/shared/fetch-page.ts`
- Test: `packages/sources/src/__tests__/shared/fetch-page.test.ts`

**Step 1: Write the tests**

```typescript
// packages/sources/src/__tests__/shared/fetch-page.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fetchPage } from "../../shared/fetch-page.js"

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal("fetch", mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("fetchPage", () => {
  it("returns HTML content on successful direct fetch", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<html><body><p>Article content here</p></body></html>",
    })

    const result = await fetchPage({ url: "https://example.com/article" })

    expect(result.fetchMethod).toBe("direct")
    expect(result.content).toContain("Article content")
    expect(result.url).toBe("https://example.com/article")
    expect(result.error).toBeUndefined()
  })

  it("sends browser-like headers", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<html><body>OK</body></html>",
    })

    await fetchPage({ url: "https://example.com" })

    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>
    expect(headers["User-Agent"]).toContain("Mozilla/5.0")
    expect(headers["Accept"]).toContain("text/html")
  })

  it("allows custom User-Agent", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<html><body>OK</body></html>",
    })

    await fetchPage({ url: "https://example.com", userAgent: "custom/1.0" })

    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>
    expect(headers["User-Agent"]).toBe("custom/1.0")
  })

  it("detects hard block (403) and falls back to archive.org", async () => {
    // Direct fetch returns 403
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    })
    // archive.org fetch succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<html><body><p>Archived content</p></body></html>",
    })

    const result = await fetchPage({ url: "https://blocked-site.com/article" })

    expect(result.fetchMethod).toBe("archive.org")
    expect(result.content).toContain("Archived content")
    expect(result.url).toContain("web.archive.org")
  })

  it("detects hard block (429) and falls back to archive.org", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<html><body>Archived</body></html>",
    })

    const result = await fetchPage({ url: "https://example.com" })
    expect(result.fetchMethod).toBe("archive.org")
  })

  it("detects soft block (CAPTCHA in body) and falls back to archive.org", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        '<html><body><div class="captcha">Please verify you are human</div></body></html>',
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<html><body>Real content from archive</body></html>",
    })

    const result = await fetchPage({ url: "https://example.com" })
    expect(result.fetchMethod).toBe("archive.org")
  })

  it("does not trigger soft block on large pages", async () => {
    // Large page with "captcha" somewhere in it — should NOT be treated as blocked
    const largeContent = "x".repeat(60000) + " captcha "
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => `<html><body>${largeContent}</body></html>`,
    })

    const result = await fetchPage({ url: "https://example.com" })
    expect(result.fetchMethod).toBe("direct")
  })

  it("returns none when direct fetch and archive both fail", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    })
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    })

    const result = await fetchPage({ url: "https://example.com" })
    expect(result.fetchMethod).toBe("none")
    expect(result.error).toBeDefined()
  })

  it("skips archive fallback when archiveFallback is false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    })

    const result = await fetchPage({
      url: "https://example.com",
      archiveFallback: false,
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.fetchMethod).toBe("none")
  })

  it("returns none on non-blocking HTTP error (404/500) without archive fallback", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    })

    const result = await fetchPage({ url: "https://example.com" })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.fetchMethod).toBe("none")
    expect(result.error).toContain("404")
  })

  it("passes abort signal to fetch", async () => {
    const controller = new AbortController()
    mockFetch.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"))

    const result = await fetchPage({
      url: "https://example.com",
      signal: controller.signal,
    })

    expect(result.fetchMethod).toBe("none")
  })

  it("returns none when direct fetch throws network error and archive fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"))
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    })

    const result = await fetchPage({ url: "https://example.com" })
    expect(result.fetchMethod).toBe("none")
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/sources && npx vitest run src/__tests__/shared/fetch-page.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// packages/sources/src/shared/fetch-page.ts
/**
 * Page fetching utility with archive.org fallback.
 *
 * Fetches a URL with browser-like headers. If the page is blocked
 * (403, 429, CAPTCHA, etc.), automatically tries the Wayback Machine.
 *
 * Used by web search sources when following links from search results,
 * and available for custom sources that need to fetch web pages.
 */

/** HTTP status codes that indicate blocking/access denial */
const BLOCKED_STATUS_CODES = new Set([401, 403, 429, 451])

/** Soft-block detection patterns in HTML body */
const SOFT_BLOCK_PATTERNS = [
  "captcha",
  "please verify you are human",
  "access denied",
  "bot detection",
  "unusual traffic",
  "automated access",
  "cloudflare",
  "ddos protection",
  "just a moment",
  "recaptcha",
  "hcaptcha",
]

/** Pages larger than this are unlikely to be block pages */
const SOFT_BLOCK_SIZE_THRESHOLD = 50_000

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
}

export interface FetchPageOptions {
  /** URL to fetch */
  url: string
  /** AbortSignal for cancellation */
  signal?: AbortSignal
  /** Timeout in milliseconds (default: 15000) */
  timeoutMs?: number
  /** Custom User-Agent header */
  userAgent?: string
  /** Whether to try archive.org on block (default: true) */
  archiveFallback?: boolean
}

export interface FetchPageResult {
  /** Raw HTML content */
  content: string
  /** Final URL (may differ from input if archive was used) */
  url: string
  /** Which fetch method succeeded */
  fetchMethod: "direct" | "archive.org" | "none"
  /** Error message if all methods failed */
  error?: string
}

/**
 * Check if a response indicates the page is blocked.
 */
function isBlocked(status: number, body?: string): boolean {
  if (BLOCKED_STATUS_CODES.has(status)) return true

  if (body && status === 200 && body.length < SOFT_BLOCK_SIZE_THRESHOLD) {
    const lower = body.toLowerCase()
    return SOFT_BLOCK_PATTERNS.some((p) => lower.includes(p))
  }

  return false
}

/**
 * Fetch a page with optional archive.org fallback when blocked.
 *
 * Fallback chain:
 * 1. Direct fetch with browser-like headers
 * 2. archive.org Wayback Machine (if direct is blocked and archiveFallback enabled)
 */
export async function fetchPage(options: FetchPageOptions): Promise<FetchPageResult> {
  const { url, signal, timeoutMs = 15000, userAgent, archiveFallback = true } = options

  const headers: Record<string, string> = {
    ...BROWSER_HEADERS,
    ...(userAgent ? { "User-Agent": userAgent } : {}),
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

  // Step 1: Direct fetch
  let blocked = false
  try {
    const response = await fetch(url, { headers, signal: combinedSignal })

    if (response.ok) {
      const html = await response.text()
      if (!isBlocked(response.status, html)) {
        return { content: html, url, fetchMethod: "direct" }
      }
      blocked = true
    } else if (BLOCKED_STATUS_CODES.has(response.status)) {
      blocked = true
    } else {
      // Non-blocking HTTP error (404, 500, etc.) — don't try archives
      return {
        content: "",
        url,
        fetchMethod: "none",
        error: `HTTP ${response.status} ${response.statusText}`,
      }
    }
  } catch {
    // Network error — try archive
    blocked = true
  }

  // Step 2: archive.org fallback
  if (blocked && archiveFallback) {
    if (signal?.aborted) {
      return { content: "", url, fetchMethod: "none", error: "Aborted" }
    }

    try {
      const archiveUrl = `https://web.archive.org/web/${url}`
      const archiveResponse = await fetch(archiveUrl, {
        headers,
        signal: combinedSignal,
      })

      if (archiveResponse.ok) {
        const html = await archiveResponse.text()
        return { content: html, url: archiveUrl, fetchMethod: "archive.org" }
      }
    } catch {
      // Archive fetch failed
    }
  }

  return {
    content: "",
    url,
    fetchMethod: "none",
    error: blocked ? "Page blocked and archive fallback failed" : "Fetch failed",
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/sources && npx vitest run src/__tests__/shared/fetch-page.test.ts`
Expected: All 10 tests PASS

**Step 5: Commit**

```bash
git add packages/sources/src/shared/fetch-page.ts packages/sources/src/__tests__/shared/fetch-page.test.ts
git commit -m "feat(sources): add fetch-page utility with archive.org fallback"
```

---

## Task 2: Shared DuckDuckGo search utility

**Files:**

- Create: `packages/sources/src/shared/duckduckgo-search.ts`
- Test: `packages/sources/src/__tests__/shared/duckduckgo-search.test.ts`

**Step 1: Write the tests**

```typescript
// packages/sources/src/__tests__/shared/duckduckgo-search.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  searchDuckDuckGo,
  isDuckDuckGoCaptcha,
  extractUrlsFromDuckDuckGoHtml,
  cleanDuckDuckGoUrl,
} from "../../shared/duckduckgo-search.js"

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal("fetch", mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("isDuckDuckGoCaptcha", () => {
  it("detects anomaly-modal", () => {
    expect(isDuckDuckGoCaptcha('<div class="anomaly-modal">Blocked</div>')).toBe(true)
  })

  it("detects bots message", () => {
    expect(isDuckDuckGoCaptcha("bots use DuckDuckGo too")).toBe(true)
  })

  it("returns false for normal HTML", () => {
    expect(isDuckDuckGoCaptcha("<html><body>Normal search results</body></html>")).toBe(false)
  })
})

describe("cleanDuckDuckGoUrl", () => {
  it("decodes DDG redirect URLs", () => {
    const ddgUrl = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Farticle&rut=abc"
    expect(cleanDuckDuckGoUrl(ddgUrl)).toBe("https://example.com/article")
  })

  it("adds https to protocol-relative URLs", () => {
    expect(cleanDuckDuckGoUrl("//example.com/page")).toBe("https://example.com/page")
  })

  it("returns normal URLs unchanged", () => {
    expect(cleanDuckDuckGoUrl("https://example.com/page")).toBe("https://example.com/page")
  })
})

describe("extractUrlsFromDuckDuckGoHtml", () => {
  const makeHtml = (links: { url: string; title?: string; snippet?: string }[]) => {
    const results = links.map(
      (l) =>
        `<div class="result">` +
        `<a class="result__url" href="${l.url}">Link</a>` +
        `<a class="result__a" href="${l.url}">${l.title ?? "Title"}</a>` +
        `<a class="result__snippet">${l.snippet ?? "Snippet text"}</a>` +
        `</div>`
    )
    return `<html><body>${results.join("")}</body></html>`
  }

  it("extracts URLs from result__url elements", () => {
    const html = makeHtml([{ url: "https://example.com/1" }, { url: "https://example.com/2" }])
    const results = extractUrlsFromDuckDuckGoHtml(html)
    expect(results).toHaveLength(2)
    expect(results[0].url).toBe("https://example.com/1")
    expect(results[1].url).toBe("https://example.com/2")
  })

  it("extracts titles and snippets", () => {
    const html = makeHtml([
      { url: "https://example.com/1", title: "Article Title", snippet: "A description" },
    ])
    const results = extractUrlsFromDuckDuckGoHtml(html)
    expect(results[0].title).toBe("Article Title")
    expect(results[0].snippet).toBe("A description")
  })

  it("filters by domain when domainFilter is provided", () => {
    const html = makeHtml([
      { url: "https://example.com/1" },
      { url: "https://other.com/2" },
      { url: "https://sub.example.com/3" },
    ])
    const results = extractUrlsFromDuckDuckGoHtml(html, "example.com")
    expect(results).toHaveLength(2)
    expect(results[0].url).toBe("https://example.com/1")
    expect(results[1].url).toBe("https://sub.example.com/3")
  })

  it("cleans DDG redirect URLs in results", () => {
    const html = makeHtml([
      { url: "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Farticle&rut=abc" },
    ])
    const results = extractUrlsFromDuckDuckGoHtml(html)
    expect(results[0].url).toBe("https://example.com/article")
  })

  it("returns empty array for HTML with no results", () => {
    const results = extractUrlsFromDuckDuckGoHtml("<html><body>No results</body></html>")
    expect(results).toHaveLength(0)
  })
})

describe("searchDuckDuckGo", () => {
  it("fetches DDG HTML endpoint and parses results", async () => {
    const html = `<html><body>
      <div class="result">
        <a class="result__url" href="https://example.com/article">example.com</a>
        <a class="result__a" href="https://example.com/article">Article Title</a>
        <a class="result__snippet">Some snippet text</a>
      </div>
    </body></html>`

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => html,
    })

    const results = await searchDuckDuckGo({ query: "test query" })

    expect(results).toHaveLength(1)
    expect(results[0].url).toBe("https://example.com/article")
    expect(mockFetch.mock.calls[0][0]).toContain("html.duckduckgo.com")
    expect(mockFetch.mock.calls[0][0]).toContain("test+query")
  })

  it("applies domain filter via site: prefix", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "<html><body></body></html>",
    })

    await searchDuckDuckGo({
      query: "test",
      domainFilter: "example.com",
    })

    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain("site%3Aexample.com")
  })

  it("returns empty array on CAPTCHA", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><body><div class="anomaly-modal">CAPTCHA</div></body></html>',
    })

    const results = await searchDuckDuckGo({ query: "test" })
    expect(results).toHaveLength(0)
  })

  it("returns empty array on fetch error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"))

    const results = await searchDuckDuckGo({ query: "test" })
    expect(results).toHaveLength(0)
  })

  it("returns empty array on non-OK response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

    const results = await searchDuckDuckGo({ query: "test" })
    expect(results).toHaveLength(0)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/sources && npx vitest run src/__tests__/shared/duckduckgo-search.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// packages/sources/src/shared/duckduckgo-search.ts
/**
 * DuckDuckGo HTML search utility.
 *
 * Searches DuckDuckGo's HTML endpoint (no API key required) and extracts
 * URLs, titles, and snippets from the results. Handles DDG's redirect
 * URL encoding and CAPTCHA detection.
 *
 * Used by DuckDuckGoSearchSource and by news/reference sources for
 * site-specific searches (e.g., site:nytimes.com "John Wayne").
 */

import { decodeHtmlEntities } from "./html-utils.js"

const DUCKDUCKGO_HTML_URL = "https://html.duckduckgo.com/html/"

export interface DuckDuckGoSearchOptions {
  /** Search query string */
  query: string
  /** Filter results to this domain (prepended as site: to query) */
  domainFilter?: string
  /** Maximum results to return (default: 10) */
  maxResults?: number
  /** AbortSignal for cancellation */
  signal?: AbortSignal
  /** Timeout in milliseconds (default: 15000) */
  timeoutMs?: number
}

export interface SearchResult {
  url: string
  title: string
  snippet: string
}

/**
 * Check if a URL's hostname matches a domain, including subdomains.
 * Uses URL parsing to prevent substring spoofing.
 */
function urlMatchesDomain(urlStr: string, domain: string): boolean {
  try {
    const hostname = new URL(urlStr).hostname
    return hostname === domain || hostname.endsWith("." + domain)
  } catch {
    return urlStr.includes(domain)
  }
}

/**
 * Check if DDG HTML response contains a CAPTCHA/anomaly modal.
 */
export function isDuckDuckGoCaptcha(html: string): boolean {
  return html.includes("anomaly-modal") || html.includes("bots use DuckDuckGo too")
}

/**
 * Clean a DuckDuckGo URL — decode redirects and fix protocol-relative URLs.
 */
export function cleanDuckDuckGoUrl(url: string): string {
  // Handle DDG redirect: //duckduckgo.com/l/?uddg=ENCODED_URL&...
  if (url.includes("duckduckgo.com/l/")) {
    const uddgMatch = url.match(/uddg=([^&]+)/)
    if (uddgMatch) {
      try {
        return decodeURIComponent(decodeHtmlEntities(uddgMatch[1]))
      } catch {
        // Fall through
      }
    }
  }

  // Handle protocol-relative URLs
  if (url.startsWith("//")) {
    return "https:" + url
  }

  return url
}

/**
 * Extract search results from DuckDuckGo HTML.
 * Parses result__url, result__a (title), and result__snippet elements.
 */
export function extractUrlsFromDuckDuckGoHtml(html: string, domainFilter?: string): SearchResult[] {
  const results: SearchResult[] = []

  // Extract result blocks — each has a URL, title, and snippet
  // DDG HTML format: class="result__url" href="...", class="result__a" href="...">title</a>,
  // class="result__snippet">snippet text</a>
  const urlRegex = /class="result__url"[^>]*href="([^"]+)"/g
  const titleRegex = /class="result__a"[^>]*href="[^"]*">([^<]*)</g
  const snippetRegex = /class="result__snippet"[^>]*>([^<]*)</g

  const urls: string[] = []
  const titles: string[] = []
  const snippets: string[] = []

  let match
  while ((match = urlRegex.exec(html)) !== null) {
    urls.push(cleanDuckDuckGoUrl(match[1]))
  }
  while ((match = titleRegex.exec(html)) !== null) {
    titles.push(decodeHtmlEntities(match[1].trim()))
  }
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(decodeHtmlEntities(match[1].trim()))
  }

  // If no result__url matches, try result__a as fallback
  if (urls.length === 0) {
    const linkRegex = /class="result__a"[^>]*href="([^"]+)"/g
    while ((match = linkRegex.exec(html)) !== null) {
      urls.push(cleanDuckDuckGoUrl(match[1]))
    }
  }

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]

    if (domainFilter && !urlMatchesDomain(url, domainFilter)) {
      continue
    }

    results.push({
      url,
      title: titles[i] ?? "",
      snippet: snippets[i] ?? "",
    })
  }

  return results
}

/**
 * Search DuckDuckGo via the HTML endpoint (no API key required).
 *
 * This is fetch-based only — no browser fallback. Returns empty array
 * on CAPTCHA, network error, or non-OK response.
 *
 * @param options - Search options
 * @returns Array of search results (may be empty)
 */
export async function searchDuckDuckGo(options: DuckDuckGoSearchOptions): Promise<SearchResult[]> {
  const { query, domainFilter, maxResults = 10, signal, timeoutMs = 15000 } = options

  const fullQuery = domainFilter ? `site:${domainFilter} ${query}` : query
  const url = `${DUCKDUCKGO_HTML_URL}?q=${encodeURIComponent(fullQuery)}`

  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      },
      signal: combinedSignal,
    })

    if (!response.ok) return []

    const html = await response.text()
    if (isDuckDuckGoCaptcha(html)) return []

    const results = extractUrlsFromDuckDuckGoHtml(html, domainFilter)
    return results.slice(0, maxResults)
  } catch {
    return []
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/sources && npx vitest run src/__tests__/shared/duckduckgo-search.test.ts`
Expected: All 13 tests PASS

**Step 5: Commit**

```bash
git add packages/sources/src/shared/duckduckgo-search.ts packages/sources/src/__tests__/shared/duckduckgo-search.test.ts
git commit -m "feat(sources): add DuckDuckGo HTML search utility"
```

---

## Task 3: WebSearchBase abstract class

**Files:**

- Create: `packages/sources/src/web-search/base.ts`
- Test: `packages/sources/src/__tests__/web-search/base.test.ts`

This is the most complex task. The base class implements the full pipeline: search → score links → fetch pages → extract content → combine.

**Step 1: Write the tests**

```typescript
// packages/sources/src/__tests__/web-search/base.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier, type ResearchSubject, type RawFinding } from "debriefer"
import { WebSearchBase, type WebSearchResult } from "../../web-search/base.js"

// ============================================================================
// Mock shared utilities
// ============================================================================

const mockFetchPage = vi.fn()
const mockExtractArticle = vi.fn()

vi.mock("../../shared/fetch-page.js", () => ({
  fetchPage: (...args: unknown[]) => mockFetchPage(...args),
}))

vi.mock("../../shared/readability-extract.js", () => ({
  extractArticleContent: (...args: unknown[]) => mockExtractArticle(...args),
}))

beforeEach(() => {
  mockFetchPage.mockReset()
  mockExtractArticle.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// Concrete test subclass
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
}

// ============================================================================
// Helpers
// ============================================================================

function makeSubject(overrides?: Partial<ResearchSubject>): ResearchSubject {
  return { id: 1, name: "John Wayne", ...overrides }
}

// ============================================================================
// Tests
// ============================================================================

describe("WebSearchBase", () => {
  describe("full pipeline", () => {
    it("searches, fetches pages, extracts content, and returns combined text", async () => {
      const source = new TestSearchSource()
      source.searchResults = [
        { url: "https://example.com/article1", title: "Article 1", snippet: "About John Wayne" },
        { url: "https://example.com/article2", title: "Article 2", snippet: "More info" },
      ]

      mockFetchPage.mockResolvedValue({
        content: "<html><body><p>Some article content about John Wayne.</p></body></html>",
        url: "https://example.com/article1",
        fetchMethod: "direct",
      })

      mockExtractArticle.mockReturnValue({
        text: "Some article content about John Wayne. This is a detailed biography with enough text to pass the minimum length filter.",
        title: "Article 1",
        author: null,
        excerpt: null,
        siteName: null,
      })

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(makeSubject(), signal)

      expect(result).not.toBeNull()
      expect(result!.text).toContain("John Wayne")
      expect(result!.confidence).toBe(-1) // Delegated to base class
      expect(result!.metadata).toBeDefined()
      expect(result!.metadata!.searchEngine).toBe("Test Search")
    })

    it("returns null when search returns no results", async () => {
      const source = new TestSearchSource()
      source.searchResults = []

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(makeSubject(), signal)

      expect(result).toBeNull()
    })

    it("returns null when all pages fail extraction", async () => {
      const source = new TestSearchSource()
      source.searchResults = [{ url: "https://example.com/1", title: "Page", snippet: "Text" }]

      mockFetchPage.mockResolvedValue({
        content: "<html></html>",
        url: "https://example.com/1",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue(null)

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(makeSubject(), signal)

      expect(result).toBeNull()
    })

    it("returns null when all fetched pages are below minContentLength", async () => {
      const source = new TestSearchSource({ minContentLength: 500 })
      source.searchResults = [{ url: "https://example.com/1", title: "Page", snippet: "Text" }]

      mockFetchPage.mockResolvedValue({
        content: "<html><body>Short</body></html>",
        url: "https://example.com/1",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue({
        text: "Too short",
        title: null,
        author: null,
        excerpt: null,
        siteName: null,
      })

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(makeSubject(), signal)

      expect(result).toBeNull()
    })
  })

  describe("link selection", () => {
    it("respects maxLinksToFollow", async () => {
      const source = new TestSearchSource({ maxLinksToFollow: 2 })
      source.searchResults = [
        { url: "https://a.com/1", title: "A", snippet: "" },
        { url: "https://b.com/2", title: "B", snippet: "" },
        { url: "https://c.com/3", title: "C", snippet: "" },
      ]

      mockFetchPage.mockResolvedValue({
        content: "<html></html>",
        url: "https://a.com/1",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue(null)

      const signal = AbortSignal.timeout(5000)
      await source.lookup(makeSubject(), signal)

      expect(mockFetchPage).toHaveBeenCalledTimes(2)
    })

    it("scores links by domainScores", async () => {
      const source = new TestSearchSource({
        domainScores: { "preferred.com": 90, "other.com": 10 },
        maxLinksToFollow: 1,
      })
      source.searchResults = [
        { url: "https://other.com/1", title: "Other", snippet: "" },
        { url: "https://preferred.com/2", title: "Preferred", snippet: "" },
      ]

      mockFetchPage.mockResolvedValue({
        content: "<html><body>Content</body></html>",
        url: "https://preferred.com/2",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue({
        text: "Enough content here to pass the minimum length filter for this test case.",
        title: null,
        author: null,
        excerpt: null,
        siteName: null,
      })

      const signal = AbortSignal.timeout(5000)
      await source.lookup(makeSubject(), signal)

      // Should fetch the preferred domain first (higher score)
      expect(mockFetchPage.mock.calls[0][0].url).toBe("https://preferred.com/2")
    })

    it("boosts links by keyword matches in title/snippet", async () => {
      const source = new TestSearchSource({
        boostKeywords: [{ keyword: "biography", boost: 50 }],
        maxLinksToFollow: 1,
      })
      source.searchResults = [
        { url: "https://a.com/1", title: "Awards list", snippet: "Career highlights" },
        { url: "https://b.com/2", title: "Full biography", snippet: "Early life and career" },
      ]

      mockFetchPage.mockResolvedValue({
        content: "<html><body>Content</body></html>",
        url: "https://b.com/2",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue({
        text: "Enough content to pass the length check for the biography page test.",
        title: null,
        author: null,
        excerpt: null,
        siteName: null,
      })

      const signal = AbortSignal.timeout(5000)
      await source.lookup(makeSubject(), signal)

      expect(mockFetchPage.mock.calls[0][0].url).toBe("https://b.com/2")
    })

    it("penalizes links by penalty keywords", async () => {
      const source = new TestSearchSource({
        penaltyKeywords: [{ keyword: "filmography", penalty: 50 }],
        maxLinksToFollow: 1,
      })
      source.searchResults = [
        { url: "https://a.com/1", title: "Complete filmography", snippet: "All movies" },
        { url: "https://b.com/2", title: "Profile", snippet: "Life story" },
      ]

      mockFetchPage.mockResolvedValue({
        content: "<html><body>Content</body></html>",
        url: "https://b.com/2",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue({
        text: "Profile content with enough text to pass the minimum length filter check.",
        title: null,
        author: null,
        excerpt: null,
        siteName: null,
      })

      const signal = AbortSignal.timeout(5000)
      await source.lookup(makeSubject(), signal)

      expect(mockFetchPage.mock.calls[0][0].url).toBe("https://b.com/2")
    })

    it("filters out blocked domains", async () => {
      const source = new TestSearchSource({
        blockedDomains: ["pinterest.com", "amazon.com"],
      })
      source.searchResults = [
        { url: "https://pinterest.com/pin/123", title: "Pin", snippet: "" },
        { url: "https://amazon.com/book/123", title: "Book", snippet: "" },
        { url: "https://example.com/article", title: "Article", snippet: "" },
      ]

      mockFetchPage.mockResolvedValue({
        content: "<html><body>Content</body></html>",
        url: "https://example.com/article",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue({
        text: "Article content with enough text to pass the minimum length filter test.",
        title: null,
        author: null,
        excerpt: null,
        siteName: null,
      })

      const signal = AbortSignal.timeout(5000)
      await source.lookup(makeSubject(), signal)

      // Should only fetch the non-blocked domain
      expect(mockFetchPage).toHaveBeenCalledTimes(1)
      expect(mockFetchPage.mock.calls[0][0].url).toBe("https://example.com/article")
    })
  })

  describe("content combination", () => {
    it("combines text from multiple pages with source attribution", async () => {
      const source = new TestSearchSource({ maxLinksToFollow: 2 })
      source.searchResults = [
        { url: "https://a.com/1", title: "Source A", snippet: "" },
        { url: "https://b.com/2", title: "Source B", snippet: "" },
      ]

      let callCount = 0
      mockFetchPage.mockImplementation(async (opts: { url: string }) => ({
        content: "<html><body>Content</body></html>",
        url: opts.url,
        fetchMethod: "direct",
      }))
      mockExtractArticle.mockImplementation(() => {
        callCount++
        return {
          text: `Content from page ${callCount} with enough text to pass the minimum length.`,
          title: `Page ${callCount}`,
          author: null,
          excerpt: null,
          siteName: null,
        }
      })

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(makeSubject(), signal)

      expect(result).not.toBeNull()
      expect(result!.text).toContain("Content from page 1")
      expect(result!.text).toContain("Content from page 2")
      expect(result!.metadata!.pagesExtracted).toBe(2)
    })
  })

  describe("metadata", () => {
    it("includes searchEngine, linksFollowed, pagesExtracted, and urls", async () => {
      const source = new TestSearchSource()
      source.searchResults = [{ url: "https://example.com/1", title: "Page", snippet: "" }]

      mockFetchPage.mockResolvedValue({
        content: "<html><body>Content</body></html>",
        url: "https://example.com/1",
        fetchMethod: "direct",
      })
      mockExtractArticle.mockReturnValue({
        text: "Extracted content with sufficient length to pass the minimum content check.",
        title: "Page",
        author: null,
        excerpt: null,
        siteName: null,
      })

      const signal = AbortSignal.timeout(5000)
      const result = await source.lookup(makeSubject(), signal)

      expect(result!.metadata!.searchEngine).toBe("Test Search")
      expect(result!.metadata!.linksFollowed).toBe(1)
      expect(result!.metadata!.pagesExtracted).toBe(1)
      expect(result!.metadata!.urls).toEqual(["https://example.com/1"])
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/sources && npx vitest run src/__tests__/web-search/base.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// packages/sources/src/web-search/base.ts
/**
 * Abstract base class for web search sources.
 *
 * Implements the template method pattern: subclasses implement performSearch()
 * to call their search API, and the base class handles the full pipeline:
 * search → score links → fetch pages → extract content → combine.
 *
 * Link selection is consumer-configurable via domainScores, boostKeywords,
 * and penaltyKeywords — no domain-specific defaults are baked in.
 */

import {
  BaseResearchSource,
  type BaseSourceOptions,
  type ResearchSubject,
  type RawFinding,
} from "debriefer"

import { fetchPage } from "../shared/fetch-page.js"
import { extractArticleContent } from "../shared/readability-extract.js"
import { sanitizeSourceText } from "../shared/sanitize-text.js"

// ============================================================================
// Types
// ============================================================================

/** A single search result from any search engine */
export interface WebSearchResult {
  url: string
  title: string
  snippet: string
}

/** Options for link selection heuristics */
export interface LinkSelectionOptions {
  /** Domain → score mapping (0-100). Higher = preferred. */
  domainScores?: Record<string, number>
  /** Keywords in title/snippet that boost a link's score */
  boostKeywords?: { keyword: string; boost: number }[]
  /** Keywords in title/snippet that penalize a link's score */
  penaltyKeywords?: { keyword: string; penalty: number }[]
  /** Domains to never follow */
  blockedDomains?: string[]
}

/** Combined options for web search sources */
export interface WebSearchOptions extends BaseSourceOptions, LinkSelectionOptions {
  /** Max links to follow from search results (default: 3) */
  maxLinksToFollow?: number
  /** Min content length after extraction to accept a page (default: 200) */
  minContentLength?: number
}

// ============================================================================
// Base Class
// ============================================================================

export abstract class WebSearchBase extends BaseResearchSource<ResearchSubject> {
  protected searchOptions: WebSearchOptions

  constructor(options: WebSearchOptions = {}) {
    super(options)
    this.searchOptions = {
      maxLinksToFollow: 3,
      minContentLength: 200,
      ...options,
    }
  }

  /**
   * Subclasses implement this — call their search API and return results.
   * The query is already built from the subject name.
   */
  protected abstract performSearch(query: string, signal: AbortSignal): Promise<WebSearchResult[]>

  /**
   * Full pipeline: search → score links → fetch → extract → combine.
   */
  protected async fetchResult(
    subject: ResearchSubject,
    signal: AbortSignal
  ): Promise<RawFinding | null> {
    const query = this.buildQuery(subject)

    // 1. Search
    const searchResults = await this.performSearch(query, signal)
    if (searchResults.length === 0) return null

    // 2. Score, filter, and rank links
    const rankedLinks = this.rankLinks(searchResults)
    if (rankedLinks.length === 0) return null

    // 3. Fetch and extract top N pages
    const maxLinks = this.searchOptions.maxLinksToFollow!
    const linksToFollow = rankedLinks.slice(0, maxLinks)

    const extractedPages: { text: string; url: string; title: string }[] = []

    for (const link of linksToFollow) {
      if (signal.aborted) break

      try {
        const page = await fetchPage({ url: link.url, signal })
        if (page.fetchMethod === "none" || !page.content) continue

        const article = extractArticleContent(page.content, page.url)
        if (!article || article.text.length < this.searchOptions.minContentLength!) continue

        const sanitized = sanitizeSourceText(article.text)
        if (sanitized.length < this.searchOptions.minContentLength!) continue

        extractedPages.push({
          text: sanitized,
          url: page.url,
          title: article.title || link.title,
        })
      } catch {
        // Skip failed pages
      }
    }

    if (extractedPages.length === 0) return null

    // 4. Combine texts with source attribution
    const combinedText = extractedPages
      .map((p) => `[${p.title || p.url}]\n${p.text}`)
      .join("\n\n---\n\n")

    return {
      text: combinedText,
      confidence: -1, // Delegate to base class keyword scoring
      costUsd: this.estimatedCostPerQuery,
      url: extractedPages[0].url,
      metadata: {
        searchEngine: this.name,
        linksFollowed: linksToFollow.length,
        pagesExtracted: extractedPages.length,
        urls: extractedPages.map((p) => p.url),
      },
    }
  }

  /**
   * Score, filter, and rank search results.
   * Uses domainScores, boostKeywords, and penaltyKeywords from options.
   */
  private rankLinks(results: WebSearchResult[]): WebSearchResult[] {
    const {
      domainScores = {},
      boostKeywords = [],
      penaltyKeywords = [],
      blockedDomains = [],
    } = this.searchOptions

    // Filter blocked domains
    const filtered = results.filter((r) => {
      try {
        const hostname = new URL(r.url).hostname
        return !blockedDomains.some((d) => hostname === d || hostname.endsWith("." + d))
      } catch {
        return true
      }
    })

    // Score each result
    const scored = filtered.map((result, index) => {
      let score = 50 - index // Base score favors original search order

      // Domain score
      try {
        const hostname = new URL(result.url).hostname
        for (const [domain, domainScore] of Object.entries(domainScores)) {
          if (hostname === domain || hostname.endsWith("." + domain)) {
            score += domainScore
            break
          }
        }
      } catch {
        // Invalid URL
      }

      // Boost keywords
      const text = `${result.title} ${result.snippet}`.toLowerCase()
      for (const { keyword, boost } of boostKeywords) {
        if (text.includes(keyword.toLowerCase())) {
          score += boost
        }
      }

      // Penalty keywords
      for (const { keyword, penalty } of penaltyKeywords) {
        if (text.includes(keyword.toLowerCase())) {
          score -= penalty
        }
      }

      return { result, score }
    })

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score)

    return scored.map((s) => s.result)
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/sources && npx vitest run src/__tests__/web-search/base.test.ts`
Expected: All 12 tests PASS

**Step 5: Commit**

```bash
git add packages/sources/src/web-search/base.ts packages/sources/src/__tests__/web-search/base.test.ts
git commit -m "feat(sources): add WebSearchBase abstract class with link-following pipeline"
```

---

## Task 4: Google Search source

**Files:**

- Create: `packages/sources/src/web-search/google.ts`
- Test: `packages/sources/src/__tests__/web-search/google.test.ts`

**Step 1: Write the tests**

```typescript
// packages/sources/src/__tests__/web-search/google.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier } from "debriefer"
import { GoogleSearchSource, googleSearch } from "../../web-search/google.js"

const mockFetch = vi.fn()

// Mock shared utilities used by WebSearchBase pipeline
vi.mock("../../shared/fetch-page.js", () => ({
  fetchPage: vi.fn().mockResolvedValue({ content: "", url: "", fetchMethod: "none" }),
}))
vi.mock("../../shared/readability-extract.js", () => ({
  extractArticleContent: vi.fn().mockReturnValue(null),
}))

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal("fetch", mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("GoogleSearchSource", () => {
  describe("properties", () => {
    it("has correct metadata", () => {
      const source = new GoogleSearchSource({ apiKey: "key", cx: "cx" })
      expect(source.name).toBe("Google Search")
      expect(source.type).toBe("google-search")
      expect(source.reliabilityTier).toBe(ReliabilityTier.SEARCH_AGGREGATOR)
      expect(source.isFree).toBe(false)
      expect(source.estimatedCostPerQuery).toBe(0.005)
    })
  })

  describe("isAvailable", () => {
    it("returns true when apiKey and cx are provided", () => {
      const source = new GoogleSearchSource({ apiKey: "key", cx: "cx" })
      expect(source.isAvailable()).toBe(true)
    })

    it("returns false when apiKey is missing", () => {
      const source = new GoogleSearchSource({ cx: "cx" })
      expect(source.isAvailable()).toBe(false)
    })

    it("returns false when cx is missing", () => {
      const source = new GoogleSearchSource({ apiKey: "key" })
      expect(source.isAvailable()).toBe(false)
    })
  })

  describe("performSearch", () => {
    it("calls Google CSE API with correct parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { title: "Result 1", link: "https://example.com/1", snippet: "Snippet 1" },
            { title: "Result 2", link: "https://example.com/2", snippet: "Snippet 2" },
          ],
        }),
      })

      const source = new GoogleSearchSource({ apiKey: "test-key", cx: "test-cx" })
      const signal = AbortSignal.timeout(5000)

      // Access performSearch via lookup (it's protected)
      // We test indirectly — the fetch URL should contain the API params
      await source.lookup({ id: 1, name: "test query" }, signal)

      const url = new URL(mockFetch.mock.calls[0][0])
      expect(url.origin + url.pathname).toBe("https://www.googleapis.com/customsearch/v1")
      expect(url.searchParams.get("key")).toBe("test-key")
      expect(url.searchParams.get("cx")).toBe("test-cx")
      expect(url.searchParams.get("q")).toBe("test query")
      expect(url.searchParams.get("num")).toBe("10")
    })

    it("returns empty results on API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      })

      const source = new GoogleSearchSource({ apiKey: "key", cx: "cx" })
      const result = await source.lookup({ id: 1, name: "test" }, AbortSignal.timeout(5000))

      expect(result).toBeNull()
    })

    it("returns empty results when response has no items", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      })

      const source = new GoogleSearchSource({ apiKey: "key", cx: "cx" })
      const result = await source.lookup({ id: 1, name: "test" }, AbortSignal.timeout(5000))

      expect(result).toBeNull()
    })
  })
})

describe("googleSearch factory", () => {
  it("creates a GoogleSearchSource instance", () => {
    const source = googleSearch({ apiKey: "key", cx: "cx" })
    expect(source).toBeInstanceOf(GoogleSearchSource)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/sources && npx vitest run src/__tests__/web-search/google.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// packages/sources/src/web-search/google.ts
/**
 * Google Custom Search source.
 *
 * Uses Google's Custom Search JSON API to search the web, then follows
 * links via the WebSearchBase pipeline (fetch → extract → combine).
 *
 * Requires: GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX environment variables
 * (or pass apiKey and cx options).
 */

import { ReliabilityTier } from "debriefer"
import { WebSearchBase, type WebSearchOptions, type WebSearchResult } from "./base.js"

const GOOGLE_CSE_URL = "https://www.googleapis.com/customsearch/v1"

export interface GoogleSearchOptions extends WebSearchOptions {
  /** Google API key (default: process.env.GOOGLE_SEARCH_API_KEY) */
  apiKey?: string
  /** Custom Search Engine ID (default: process.env.GOOGLE_SEARCH_CX) */
  cx?: string
  /** Number of results to request (default: 10) */
  maxResults?: number
}

export class GoogleSearchSource extends WebSearchBase {
  readonly name = "Google Search"
  readonly type = "google-search"
  readonly reliabilityTier = ReliabilityTier.SEARCH_AGGREGATOR
  readonly domain = "www.googleapis.com"
  readonly isFree = false
  readonly estimatedCostPerQuery = 0.005

  private apiKey: string | undefined
  private cx: string | undefined
  private maxResults: number

  constructor(options: GoogleSearchOptions = {}) {
    super({ rateLimitMs: 500, ...options })
    this.apiKey = options.apiKey ?? process.env.GOOGLE_SEARCH_API_KEY
    this.cx = options.cx ?? process.env.GOOGLE_SEARCH_CX
    this.maxResults = options.maxResults ?? 10
  }

  override isAvailable(): boolean {
    return Boolean(this.apiKey && this.cx)
  }

  protected async performSearch(query: string, signal: AbortSignal): Promise<WebSearchResult[]> {
    if (!this.apiKey || !this.cx) return []

    const url = new URL(GOOGLE_CSE_URL)
    url.searchParams.set("key", this.apiKey)
    url.searchParams.set("cx", this.cx)
    url.searchParams.set("q", query)
    url.searchParams.set("num", String(this.maxResults))

    const response = await fetch(url.toString(), { signal })

    if (!response.ok) {
      throw new Error(`Google CSE error: HTTP ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as {
      items?: Array<{ title: string; link: string; snippet: string }>
    }

    if (!data.items || data.items.length === 0) return []

    return data.items.map((item) => ({
      url: item.link,
      title: item.title,
      snippet: item.snippet,
    }))
  }
}

export function googleSearch(options?: GoogleSearchOptions): GoogleSearchSource {
  return new GoogleSearchSource(options)
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/sources && npx vitest run src/__tests__/web-search/google.test.ts`
Expected: All 7 tests PASS

**Step 5: Commit**

```bash
git add packages/sources/src/web-search/google.ts packages/sources/src/__tests__/web-search/google.test.ts
git commit -m "feat(sources): add Google Custom Search source"
```

---

## Task 5: Bing Search source

**Files:**

- Create: `packages/sources/src/web-search/bing.ts`
- Test: `packages/sources/src/__tests__/web-search/bing.test.ts`

**Step 1: Write the tests**

```typescript
// packages/sources/src/__tests__/web-search/bing.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier } from "debriefer"
import { BingSearchSource, bingSearch } from "../../web-search/bing.js"

const mockFetch = vi.fn()

vi.mock("../../shared/fetch-page.js", () => ({
  fetchPage: vi.fn().mockResolvedValue({ content: "", url: "", fetchMethod: "none" }),
}))
vi.mock("../../shared/readability-extract.js", () => ({
  extractArticleContent: vi.fn().mockReturnValue(null),
}))

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal("fetch", mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("BingSearchSource", () => {
  describe("properties", () => {
    it("has correct metadata", () => {
      const source = new BingSearchSource({ apiKey: "key" })
      expect(source.name).toBe("Bing Search")
      expect(source.type).toBe("bing-search")
      expect(source.reliabilityTier).toBe(ReliabilityTier.SEARCH_AGGREGATOR)
      expect(source.isFree).toBe(false)
      expect(source.estimatedCostPerQuery).toBe(0.003)
    })
  })

  describe("isAvailable", () => {
    it("returns true when apiKey is provided", () => {
      expect(new BingSearchSource({ apiKey: "key" }).isAvailable()).toBe(true)
    })

    it("returns false when apiKey is missing", () => {
      expect(new BingSearchSource().isAvailable()).toBe(false)
    })
  })

  describe("performSearch", () => {
    it("sends correct headers and parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          webPages: { value: [{ name: "Result", url: "https://example.com", snippet: "Text" }] },
        }),
      })

      const source = new BingSearchSource({ apiKey: "test-key" })
      await source.lookup({ id: 1, name: "test query" }, AbortSignal.timeout(5000))

      const url = mockFetch.mock.calls[0][0] as string
      const opts = mockFetch.mock.calls[0][1] as RequestInit
      expect(url).toContain("api.bing.microsoft.com/v7.0/search")
      expect(url).toContain("q=test+query")
      expect((opts.headers as Record<string, string>)["Ocp-Apim-Subscription-Key"]).toBe("test-key")
    })

    it("merges web and news results, deduplicating by URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          webPages: {
            value: [
              { name: "Web Result", url: "https://example.com/1", snippet: "Web" },
              { name: "Shared", url: "https://example.com/shared", snippet: "Both" },
            ],
          },
          news: {
            value: [
              { name: "News Result", url: "https://example.com/2", description: "News" },
              { name: "Shared News", url: "https://example.com/shared", description: "Dup" },
            ],
          },
        }),
      })

      const source = new BingSearchSource({ apiKey: "key" })
      // We need to test performSearch output. Since it's protected,
      // we verify indirectly via the pipeline — but we can check fetch was called once
      // (meaning performSearch returned results, though pipeline may return null if
      // page extraction fails)
      await source.lookup({ id: 1, name: "test" }, AbortSignal.timeout(5000))

      expect(mockFetch).toHaveBeenCalledTimes(1) // Only the search call (pages fail extraction)
    })
  })
})

describe("bingSearch factory", () => {
  it("creates a BingSearchSource instance", () => {
    const source = bingSearch({ apiKey: "key" })
    expect(source).toBeInstanceOf(BingSearchSource)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/sources && npx vitest run src/__tests__/web-search/bing.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// packages/sources/src/web-search/bing.ts
/**
 * Bing Web Search source.
 *
 * Uses Bing Web Search API v7 (Azure Cognitive Services) to search the web,
 * merging web and news results. Deduplicates by URL.
 *
 * Requires: BING_SEARCH_API_KEY environment variable (or pass apiKey option).
 */

import { ReliabilityTier } from "debriefer"
import { WebSearchBase, type WebSearchOptions, type WebSearchResult } from "./base.js"

const BING_SEARCH_URL = "https://api.bing.microsoft.com/v7.0/search"

export interface BingSearchOptions extends WebSearchOptions {
  /** Bing API key (default: process.env.BING_SEARCH_API_KEY) */
  apiKey?: string
  /** Number of results to request (default: 20) */
  maxResults?: number
}

export class BingSearchSource extends WebSearchBase {
  readonly name = "Bing Search"
  readonly type = "bing-search"
  readonly reliabilityTier = ReliabilityTier.SEARCH_AGGREGATOR
  readonly domain = "api.bing.microsoft.com"
  readonly isFree = false
  readonly estimatedCostPerQuery = 0.003

  private apiKey: string | undefined
  private maxResults: number

  constructor(options: BingSearchOptions = {}) {
    super({ rateLimitMs: 500, ...options })
    this.apiKey = options.apiKey ?? process.env.BING_SEARCH_API_KEY
    this.maxResults = options.maxResults ?? 20
  }

  override isAvailable(): boolean {
    return Boolean(this.apiKey)
  }

  protected async performSearch(query: string, signal: AbortSignal): Promise<WebSearchResult[]> {
    if (!this.apiKey) return []

    const url = `${BING_SEARCH_URL}?q=${encodeURIComponent(query)}&count=${this.maxResults}&mkt=en-US&responseFilter=Webpages,News`

    const response = await fetch(url, {
      headers: {
        "Ocp-Apim-Subscription-Key": this.apiKey,
      },
      signal,
    })

    if (!response.ok) {
      throw new Error(`Bing Search error: HTTP ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as {
      webPages?: { value: Array<{ name: string; url: string; snippet: string }> }
      news?: { value: Array<{ name: string; url: string; description: string }> }
    }

    const results: WebSearchResult[] = []
    const seenUrls = new Set<string>()

    // Add web results
    for (const item of data.webPages?.value ?? []) {
      if (seenUrls.has(item.url)) continue
      seenUrls.add(item.url)
      results.push({ url: item.url, title: item.name, snippet: item.snippet })
    }

    // Add news results (deduplicated)
    for (const item of data.news?.value ?? []) {
      if (seenUrls.has(item.url)) continue
      seenUrls.add(item.url)
      results.push({ url: item.url, title: item.name, snippet: item.description })
    }

    return results
  }
}

export function bingSearch(options?: BingSearchOptions): BingSearchSource {
  return new BingSearchSource(options)
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/sources && npx vitest run src/__tests__/web-search/bing.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add packages/sources/src/web-search/bing.ts packages/sources/src/__tests__/web-search/bing.test.ts
git commit -m "feat(sources): add Bing Web Search source"
```

---

## Task 6: Brave Search source

**Files:**

- Create: `packages/sources/src/web-search/brave.ts`
- Test: `packages/sources/src/__tests__/web-search/brave.test.ts`

**Step 1: Write the tests**

```typescript
// packages/sources/src/__tests__/web-search/brave.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier } from "debriefer"
import { BraveSearchSource, braveSearch } from "../../web-search/brave.js"

const mockFetch = vi.fn()

vi.mock("../../shared/fetch-page.js", () => ({
  fetchPage: vi.fn().mockResolvedValue({ content: "", url: "", fetchMethod: "none" }),
}))
vi.mock("../../shared/readability-extract.js", () => ({
  extractArticleContent: vi.fn().mockReturnValue(null),
}))

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal("fetch", mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("BraveSearchSource", () => {
  describe("properties", () => {
    it("has correct metadata", () => {
      const source = new BraveSearchSource({ apiKey: "key" })
      expect(source.name).toBe("Brave Search")
      expect(source.type).toBe("brave-search")
      expect(source.reliabilityTier).toBe(ReliabilityTier.SEARCH_AGGREGATOR)
      expect(source.isFree).toBe(false)
      expect(source.estimatedCostPerQuery).toBe(0.005)
    })
  })

  describe("isAvailable", () => {
    it("returns true when apiKey is provided", () => {
      expect(new BraveSearchSource({ apiKey: "key" }).isAvailable()).toBe(true)
    })

    it("returns false when apiKey is missing", () => {
      expect(new BraveSearchSource().isAvailable()).toBe(false)
    })
  })

  describe("performSearch", () => {
    it("sends correct headers and parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          web: { results: [{ title: "Result", url: "https://example.com", description: "Text" }] },
        }),
      })

      const source = new BraveSearchSource({ apiKey: "test-key" })
      await source.lookup({ id: 1, name: "test query" }, AbortSignal.timeout(5000))

      const url = mockFetch.mock.calls[0][0] as string
      const opts = mockFetch.mock.calls[0][1] as RequestInit
      expect(url).toContain("api.search.brave.com/res/v1/web/search")
      expect(url).toContain("q=test+query")
      expect((opts.headers as Record<string, string>)["X-Subscription-Token"]).toBe("test-key")
    })

    it("merges web and news results, deduplicating", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          web: {
            results: [
              { title: "Web", url: "https://example.com/1", description: "Web result" },
              { title: "Shared", url: "https://example.com/shared", description: "Both" },
            ],
          },
          news: {
            results: [
              { title: "News", url: "https://example.com/2", description: "News result" },
              { title: "Shared News", url: "https://example.com/shared", description: "Dup" },
            ],
          },
        }),
      })

      const source = new BraveSearchSource({ apiKey: "key" })
      await source.lookup({ id: 1, name: "test" }, AbortSignal.timeout(5000))

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })
})

describe("braveSearch factory", () => {
  it("creates a BraveSearchSource instance", () => {
    const source = braveSearch({ apiKey: "key" })
    expect(source).toBeInstanceOf(BraveSearchSource)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/sources && npx vitest run src/__tests__/web-search/brave.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// packages/sources/src/web-search/brave.ts
/**
 * Brave Search source.
 *
 * Uses Brave Web Search API v1 to search the web, merging web and news
 * results. Deduplicates by URL.
 *
 * Requires: BRAVE_SEARCH_API_KEY environment variable (or pass apiKey option).
 */

import { ReliabilityTier } from "debriefer"
import { WebSearchBase, type WebSearchOptions, type WebSearchResult } from "./base.js"

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"

export interface BraveSearchOptions extends WebSearchOptions {
  /** Brave API key (default: process.env.BRAVE_SEARCH_API_KEY) */
  apiKey?: string
  /** Number of results to request (default: 20) */
  maxResults?: number
}

export class BraveSearchSource extends WebSearchBase {
  readonly name = "Brave Search"
  readonly type = "brave-search"
  readonly reliabilityTier = ReliabilityTier.SEARCH_AGGREGATOR
  readonly domain = "api.search.brave.com"
  readonly isFree = false
  readonly estimatedCostPerQuery = 0.005

  private apiKey: string | undefined
  private maxResults: number

  constructor(options: BraveSearchOptions = {}) {
    super({ rateLimitMs: 500, ...options })
    this.apiKey = options.apiKey ?? process.env.BRAVE_SEARCH_API_KEY
    this.maxResults = options.maxResults ?? 20
  }

  override isAvailable(): boolean {
    return Boolean(this.apiKey)
  }

  protected async performSearch(query: string, signal: AbortSignal): Promise<WebSearchResult[]> {
    if (!this.apiKey) return []

    const url = `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(query)}&count=${this.maxResults}&search_lang=en`

    const response = await fetch(url, {
      headers: {
        "X-Subscription-Token": this.apiKey,
        Accept: "application/json",
      },
      signal,
    })

    if (!response.ok) {
      throw new Error(`Brave Search error: HTTP ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as {
      web?: { results: Array<{ title: string; url: string; description: string }> }
      news?: { results: Array<{ title: string; url: string; description: string }> }
    }

    const results: WebSearchResult[] = []
    const seenUrls = new Set<string>()

    for (const item of data.web?.results ?? []) {
      if (seenUrls.has(item.url)) continue
      seenUrls.add(item.url)
      results.push({ url: item.url, title: item.title, snippet: item.description })
    }

    for (const item of data.news?.results ?? []) {
      if (seenUrls.has(item.url)) continue
      seenUrls.add(item.url)
      results.push({ url: item.url, title: item.title, snippet: item.description })
    }

    return results
  }
}

export function braveSearch(options?: BraveSearchOptions): BraveSearchSource {
  return new BraveSearchSource(options)
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/sources && npx vitest run src/__tests__/web-search/brave.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add packages/sources/src/web-search/brave.ts packages/sources/src/__tests__/web-search/brave.test.ts
git commit -m "feat(sources): add Brave Search source"
```

---

## Task 7: DuckDuckGo Search source

**Files:**

- Create: `packages/sources/src/web-search/duckduckgo.ts`
- Test: `packages/sources/src/__tests__/web-search/duckduckgo.test.ts`

**Step 1: Write the tests**

```typescript
// packages/sources/src/__tests__/web-search/duckduckgo.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ReliabilityTier } from "debriefer"
import { DuckDuckGoSearchSource, duckduckgoSearch } from "../../web-search/duckduckgo.js"

const mockSearchDDG = vi.fn()

vi.mock("../../shared/duckduckgo-search.js", () => ({
  searchDuckDuckGo: (...args: unknown[]) => mockSearchDDG(...args),
}))
vi.mock("../../shared/fetch-page.js", () => ({
  fetchPage: vi.fn().mockResolvedValue({ content: "", url: "", fetchMethod: "none" }),
}))
vi.mock("../../shared/readability-extract.js", () => ({
  extractArticleContent: vi.fn().mockReturnValue(null),
}))

beforeEach(() => {
  mockSearchDDG.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("DuckDuckGoSearchSource", () => {
  describe("properties", () => {
    it("has correct metadata", () => {
      const source = new DuckDuckGoSearchSource()
      expect(source.name).toBe("DuckDuckGo")
      expect(source.type).toBe("duckduckgo-search")
      expect(source.reliabilityTier).toBe(ReliabilityTier.SEARCH_AGGREGATOR)
      expect(source.isFree).toBe(true)
      expect(source.estimatedCostPerQuery).toBe(0)
    })
  })

  describe("isAvailable", () => {
    it("always returns true (no API key needed)", () => {
      expect(new DuckDuckGoSearchSource().isAvailable()).toBe(true)
    })
  })

  describe("performSearch", () => {
    it("delegates to shared searchDuckDuckGo utility", async () => {
      mockSearchDDG.mockResolvedValueOnce([
        { url: "https://example.com/1", title: "Result 1", snippet: "Text 1" },
      ])

      const source = new DuckDuckGoSearchSource()
      await source.lookup({ id: 1, name: "test query" }, AbortSignal.timeout(5000))

      expect(mockSearchDDG).toHaveBeenCalledTimes(1)
      expect(mockSearchDDG.mock.calls[0][0].query).toBe("test query")
    })
  })
})

describe("duckduckgoSearch factory", () => {
  it("creates a DuckDuckGoSearchSource instance", () => {
    const source = duckduckgoSearch()
    expect(source).toBeInstanceOf(DuckDuckGoSearchSource)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/sources && npx vitest run src/__tests__/web-search/duckduckgo.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// packages/sources/src/web-search/duckduckgo.ts
/**
 * DuckDuckGo search source.
 *
 * Free, no API key required. Wraps the shared duckduckgo-search utility
 * and feeds results into the WebSearchBase pipeline.
 *
 * Uses a more conservative rate limit (1000ms) to reduce CAPTCHA risk.
 */

import { ReliabilityTier } from "debriefer"
import { WebSearchBase, type WebSearchOptions, type WebSearchResult } from "./base.js"
import { searchDuckDuckGo } from "../shared/duckduckgo-search.js"

export interface DuckDuckGoSearchOptions extends WebSearchOptions {
  // No additional options — no API key needed
}

export class DuckDuckGoSearchSource extends WebSearchBase {
  readonly name = "DuckDuckGo"
  readonly type = "duckduckgo-search"
  readonly reliabilityTier = ReliabilityTier.SEARCH_AGGREGATOR
  readonly domain = "html.duckduckgo.com"
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  constructor(options: DuckDuckGoSearchOptions = {}) {
    super({ rateLimitMs: 1000, ...options })
  }

  protected async performSearch(query: string, signal: AbortSignal): Promise<WebSearchResult[]> {
    return searchDuckDuckGo({ query, signal })
  }
}

export function duckduckgoSearch(options?: DuckDuckGoSearchOptions): DuckDuckGoSearchSource {
  return new DuckDuckGoSearchSource(options)
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/sources && npx vitest run src/__tests__/web-search/duckduckgo.test.ts`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add packages/sources/src/web-search/duckduckgo.ts packages/sources/src/__tests__/web-search/duckduckgo.test.ts
git commit -m "feat(sources): add DuckDuckGo search source"
```

---

## Task 8: Update exports and run full test suite

**Files:**

- Modify: `packages/sources/src/index.ts`

**Step 1: Update index.ts with new exports**

Add the following exports to `packages/sources/src/index.ts`:

```typescript
// Shared utilities — fetch and search
export { fetchPage } from "./shared/fetch-page.js"
export type { FetchPageOptions, FetchPageResult } from "./shared/fetch-page.js"
export {
  searchDuckDuckGo,
  isDuckDuckGoCaptcha,
  extractUrlsFromDuckDuckGoHtml,
  cleanDuckDuckGoUrl,
} from "./shared/duckduckgo-search.js"
export type { DuckDuckGoSearchOptions, SearchResult } from "./shared/duckduckgo-search.js"

// Web search base (for building custom search sources)
export { WebSearchBase } from "./web-search/base.js"
export type { WebSearchOptions, LinkSelectionOptions, WebSearchResult } from "./web-search/base.js"

// Web search sources
export { GoogleSearchSource, googleSearch } from "./web-search/google.js"
export type { GoogleSearchOptions } from "./web-search/google.js"
export { BingSearchSource, bingSearch } from "./web-search/bing.js"
export type { BingSearchOptions } from "./web-search/bing.js"
export { BraveSearchSource, braveSearch } from "./web-search/brave.js"
export type { BraveSearchOptions } from "./web-search/brave.js"
export { DuckDuckGoSearchSource, duckduckgoSearch } from "./web-search/duckduckgo.js"
export type { DuckDuckGoSearchOptions as DuckDuckGoSourceOptions } from "./web-search/duckduckgo.js"
```

**Step 2: Run full test suite**

Run: `npx turbo test type-check`
Expected: All tests PASS, type-check clean

**Step 3: Commit**

```bash
git add packages/sources/src/index.ts
git commit -m "feat(sources): export web search sources and shared utilities"
```

**Step 4: Verify total test count**

Run: `cd packages/sources && npx vitest run`
Expected: ~200 tests across 13 test files (147 existing + ~50 new)
