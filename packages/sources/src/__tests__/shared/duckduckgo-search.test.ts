/**
 * Tests for the DuckDuckGo HTML search utility.
 *
 * Mocks the global `fetch` function to avoid real HTTP calls.
 * Tests CAPTCHA detection, URL cleaning, HTML result extraction,
 * domain filtering, and the full search function.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  isDuckDuckGoCaptcha,
  cleanDuckDuckGoUrl,
  extractUrlsFromDuckDuckGoHtml,
  searchDuckDuckGo,
} from "../../shared/duckduckgo-search.js"

// ============================================================================
// Mocks
// ============================================================================

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal("fetch", mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// Test Helpers
// ============================================================================

function makeOkResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => body,
    headers: new Headers({ "content-length": String(body.length) }),
  } as unknown as Response
}

function makeErrorResponse(status: number, body = ""): Response {
  return {
    ok: false,
    status,
    statusText: "Error",
    text: async () => body,
    headers: new Headers({ "content-length": String(body.length) }),
  } as unknown as Response
}

// ============================================================================
// isDuckDuckGoCaptcha
// ============================================================================

describe("isDuckDuckGoCaptcha", () => {
  it("detects anomaly-modal as CAPTCHA", () => {
    const html = '<html><body><div id="anomaly-modal">Please solve</div></body></html>'
    expect(isDuckDuckGoCaptcha(html)).toBe(true)
  })

  it("detects 'bots use DuckDuckGo too' as CAPTCHA", () => {
    const html =
      "<html><body><p>It seems like bots use DuckDuckGo too. Please try again.</p></body></html>"
    expect(isDuckDuckGoCaptcha(html)).toBe(true)
  })

  it("returns false for normal HTML", () => {
    const html = '<html><body><div class="results">Normal search results here</div></body></html>'
    expect(isDuckDuckGoCaptcha(html)).toBe(false)
  })
})

// ============================================================================
// cleanDuckDuckGoUrl
// ============================================================================

describe("cleanDuckDuckGoUrl", () => {
  it("decodes DDG redirect URLs with uddg parameter", () => {
    const ddgUrl =
      "//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.example.com%2Fpage%3Fid%3D1&rut=abc123"
    expect(cleanDuckDuckGoUrl(ddgUrl)).toBe("https://www.example.com/page?id=1")
  })

  it("handles protocol-relative URLs by prepending https:", () => {
    const url = "//www.example.com/some/path"
    expect(cleanDuckDuckGoUrl(url)).toBe("https://www.example.com/some/path")
  })

  it("returns normal URLs unchanged", () => {
    const url = "https://www.example.com/page"
    expect(cleanDuckDuckGoUrl(url)).toBe("https://www.example.com/page")
  })
})

// ============================================================================
// extractUrlsFromDuckDuckGoHtml
// ============================================================================

describe("extractUrlsFromDuckDuckGoHtml", () => {
  it("extracts URLs, titles, and snippets from result HTML", () => {
    const html = `
      <div class="result">
        <a class="result__url" href="https://www.example.com/page1"></a>
        <a class="result__a" href="https://www.example.com/page1">Example Page Title</a>
        <a class="result__snippet">This is the snippet for the first result.</a>
      </div>
      <div class="result">
        <a class="result__url" href="https://www.example.com/page2"></a>
        <a class="result__a" href="https://www.example.com/page2">Second Result</a>
        <a class="result__snippet">Snippet for second result.</a>
      </div>
    `

    const results = extractUrlsFromDuckDuckGoHtml(html)

    expect(results).toHaveLength(2)
    expect(results[0].url).toBe("https://www.example.com/page1")
    expect(results[0].title).toBe("Example Page Title")
    expect(results[0].snippet).toBe("This is the snippet for the first result.")
    expect(results[1].url).toBe("https://www.example.com/page2")
    expect(results[1].title).toBe("Second Result")
  })

  it("filters results by domain when domainFilter is specified", () => {
    const html = `
      <div class="result">
        <a class="result__url" href="https://www.nytimes.com/article"></a>
        <a class="result__a" href="https://www.nytimes.com/article">NYT Article</a>
        <a class="result__snippet">A NYT article snippet.</a>
      </div>
      <div class="result">
        <a class="result__url" href="https://www.example.com/page"></a>
        <a class="result__a" href="https://www.example.com/page">Other Site</a>
        <a class="result__snippet">Not from NYT.</a>
      </div>
    `

    const results = extractUrlsFromDuckDuckGoHtml(html, "nytimes.com")

    expect(results).toHaveLength(1)
    expect(results[0].url).toBe("https://www.nytimes.com/article")
    expect(results[0].title).toBe("NYT Article")
  })

  it("rejects domain spoofing (evilnytimes.com does not match nytimes.com)", () => {
    const html = `
      <div class="result">
        <a class="result__url" href="https://evilnytimes.com/article"></a>
        <a class="result__a" href="https://evilnytimes.com/article">Fake NYT</a>
        <a class="result__snippet">Spoofed domain.</a>
      </div>
      <div class="result">
        <a class="result__url" href="https://www.nytimes.com/real"></a>
        <a class="result__a" href="https://www.nytimes.com/real">Real NYT</a>
        <a class="result__snippet">Real article.</a>
      </div>
    `

    const results = extractUrlsFromDuckDuckGoHtml(html, "nytimes.com")

    expect(results).toHaveLength(1)
    expect(results[0].url).toBe("https://www.nytimes.com/real")
  })

  it("cleans DDG redirect URLs in results", () => {
    const html = `
      <div class="result">
        <a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.example.com%2Fpage&rut=abc"></a>
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.example.com%2Fpage&rut=abc">Example</a>
        <a class="result__snippet">A snippet.</a>
      </div>
    `

    const results = extractUrlsFromDuckDuckGoHtml(html)

    expect(results).toHaveLength(1)
    expect(results[0].url).toBe("https://www.example.com/page")
  })

  it("returns empty array for HTML with no results", () => {
    const html = "<html><body><p>No results found</p></body></html>"
    const results = extractUrlsFromDuckDuckGoHtml(html)
    expect(results).toEqual([])
  })

  it("falls back to result__a hrefs when no result__url matches found", () => {
    const html = `
      <div class="result">
        <a class="result__a" href="https://www.example.com/fallback">Fallback Title</a>
        <a class="result__snippet">Fallback snippet.</a>
      </div>
    `

    const results = extractUrlsFromDuckDuckGoHtml(html)

    expect(results).toHaveLength(1)
    expect(results[0].url).toBe("https://www.example.com/fallback")
    expect(results[0].title).toBe("Fallback Title")
  })
})

// ============================================================================
// searchDuckDuckGo
// ============================================================================

describe("searchDuckDuckGo", () => {
  it("returns search results on successful fetch", async () => {
    const html = `
      <div class="result">
        <a class="result__url" href="https://www.example.com/page"></a>
        <a class="result__a" href="https://www.example.com/page">Example Page</a>
        <a class="result__snippet">A snippet about the page.</a>
      </div>
    `
    mockFetch.mockResolvedValueOnce(makeOkResponse(html))

    const results = await searchDuckDuckGo({ query: "test query" })

    expect(results).toHaveLength(1)
    expect(results[0].url).toBe("https://www.example.com/page")
    expect(results[0].title).toBe("Example Page")

    // Verify the URL was called correctly
    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain("html.duckduckgo.com/html/")
    expect(url).toContain("q=test%20query")
  })

  it("prepends site: to query when domainFilter is set", async () => {
    const html = `
      <div class="result">
        <a class="result__url" href="https://www.nytimes.com/article"></a>
        <a class="result__a" href="https://www.nytimes.com/article">NYT Article</a>
        <a class="result__snippet">Snippet.</a>
      </div>
    `
    mockFetch.mockResolvedValueOnce(makeOkResponse(html))

    await searchDuckDuckGo({ query: "test query", domainFilter: "nytimes.com" })

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain("q=site%3Anytimes.com%20test%20query")
  })

  it("returns empty array on CAPTCHA response", async () => {
    const captchaHtml = '<html><body><div id="anomaly-modal">CAPTCHA</div></body></html>'
    mockFetch.mockResolvedValueOnce(makeOkResponse(captchaHtml))

    const results = await searchDuckDuckGo({ query: "test" })

    expect(results).toEqual([])
  })

  it("returns empty array on fetch error", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"))

    const results = await searchDuckDuckGo({ query: "test" })

    expect(results).toEqual([])
  })

  it("returns empty array on non-OK response", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(503))

    const results = await searchDuckDuckGo({ query: "test" })

    expect(results).toEqual([])
  })
})
