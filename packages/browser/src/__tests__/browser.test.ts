import { describe, it, expect, vi, beforeEach } from "vitest"
import { createBrowserFetchPage } from "../index.js"

// Mock global fetch for archive tests
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
})

describe("createBrowserFetchPage", () => {
  it("returns a function", () => {
    const fetchPage = createBrowserFetchPage()
    expect(fetchPage).toBeTypeOf("function")
  })

  it("returns content on successful direct fetch", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "<html><body>Article content here with enough text to pass.</body></html>",
    })

    const fetchPage = createBrowserFetchPage()
    const result = await fetchPage("https://example.com/article", AbortSignal.timeout(5000))

    expect(result).toContain("Article content")
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it("returns null when direct fetch returns 404", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    })

    const fetchPage = createBrowserFetchPage()
    const result = await fetchPage("https://example.com/missing", AbortSignal.timeout(5000))

    expect(result).toBeNull()
  })

  it("tries archive.org when direct fetch returns 403", async () => {
    // Direct fetch returns 403
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    })

    // archive.org availability check
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        archived_snapshots: {
          closest: {
            available: true,
            url: "https://web.archive.org/web/2024/https://example.com/article",
            timestamp: "20240101",
            status: "200",
          },
        },
      }),
    })

    // archive.org page fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        "<html><body><article>Archived article content that is long enough to be extracted properly by the article extraction function.</article></body></html>",
    })

    const fetchPage = createBrowserFetchPage()
    const result = await fetchPage("https://example.com/article", AbortSignal.timeout(10000))

    expect(result).toContain("Archived article content")
  })

  it("tries archive.org when soft block detected", async () => {
    // Direct fetch returns CAPTCHA page
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        '<html><body><div class="captcha">Please verify you are human</div></body></html>',
    })

    // archive.org availability — not available
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ archived_snapshots: {} }),
    })

    // archive.is availability — not available
    mockFetch.mockResolvedValueOnce({
      status: 404,
      headers: new Headers(),
    })

    const fetchPage = createBrowserFetchPage()
    const result = await fetchPage("https://example.com/blocked", AbortSignal.timeout(5000))

    expect(result).toBeNull()
    // Should have made 3+ fetch calls (direct + archive.org check + archive.is check)
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it("returns null when all fallbacks fail", { timeout: 15000 }, async () => {
    // Direct fetch fails
    mockFetch.mockRejectedValueOnce(new Error("Network error"))

    // archive.org not available
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ archived_snapshots: {} }),
    })

    // archive.is not available
    mockFetch.mockResolvedValueOnce({
      status: 404,
      headers: new Headers(),
    })

    const fetchPage = createBrowserFetchPage()
    const result = await fetchPage("https://example.com/down", AbortSignal.timeout(5000))

    expect(result).toBeNull()
  })
})

describe("createBrowserFetchPage options", () => {
  it("accepts captchaSolver configuration", () => {
    const fetchPage = createBrowserFetchPage({
      captchaSolver: {
        provider: "2captcha",
        apiKey: "test-key",
        timeoutMs: 60000,
        maxCostPerSolve: 0.005,
      },
    })
    expect(fetchPage).toBeTypeOf("function")
  })

  it("accepts custom timeout and user agent", () => {
    const fetchPage = createBrowserFetchPage({
      timeoutMs: 30000,
      userAgent: "Custom Bot/1.0",
    })
    expect(fetchPage).toBeTypeOf("function")
  })
})
