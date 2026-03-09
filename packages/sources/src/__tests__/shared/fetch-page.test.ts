/**
 * Tests for the fetch-page utility.
 *
 * Mocks the global `fetch` function to avoid real HTTP calls.
 * Tests direct fetching, browser-like headers, block detection,
 * archive.org fallback, error handling, and abort signal support.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fetchPage } from "../../shared/fetch-page.js"

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

function makeOkResponse(body: string, status = 200): Response {
  return {
    ok: true,
    status,
    statusText: "OK",
    text: async () => body,
    headers: new Headers({ "content-length": String(body.length) }),
  } as unknown as Response
}

function makeErrorResponse(status: number, body = ""): Response {
  return {
    ok: false,
    status,
    statusText: status === 403 ? "Forbidden" : status === 429 ? "Too Many Requests" : "Error",
    text: async () => body,
    headers: new Headers({ "content-length": String(body.length) }),
  } as unknown as Response
}

// ============================================================================
// Direct Fetch Success
// ============================================================================

describe("fetchPage", () => {
  describe("direct fetch success", () => {
    it("returns content from a successful direct fetch", async () => {
      const html = "<html><body><h1>Hello World</h1></body></html>"
      mockFetch.mockResolvedValueOnce(makeOkResponse(html))

      const result = await fetchPage({ url: "https://example.com/page" })

      expect(result.content).toBe(html)
      expect(result.url).toBe("https://example.com/page")
      expect(result.fetchMethod).toBe("direct")
      expect(result.error).toBeUndefined()
    })
  })

  // ============================================================================
  // Browser-like Headers
  // ============================================================================

  describe("browser-like headers", () => {
    it("sends browser-like headers on direct fetch", async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse("<html></html>"))

      await fetchPage({ url: "https://example.com" })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [, options] = mockFetch.mock.calls[0]
      const headers = options.headers as Record<string, string>

      // Should have a Chrome-like User-Agent
      expect(headers["User-Agent"]).toContain("Chrome")
      // Should accept text/html
      expect(headers["Accept"]).toContain("text/html")
      // Should include Accept-Language
      expect(headers["Accept-Language"]).toBeDefined()
    })
  })

  // ============================================================================
  // Custom User-Agent
  // ============================================================================

  describe("custom User-Agent", () => {
    it("uses the provided userAgent instead of the default", async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse("<html></html>"))

      await fetchPage({ url: "https://example.com", userAgent: "MyBot/1.0" })

      const [, options] = mockFetch.mock.calls[0]
      const headers = options.headers as Record<string, string>
      expect(headers["User-Agent"]).toBe("MyBot/1.0")
    })
  })

  // ============================================================================
  // Hard Block → Archive.org Fallback
  // ============================================================================

  describe("hard block fallback", () => {
    it("falls back to archive.org on HTTP 403", async () => {
      const archiveHtml = "<html><body>Archived content</body></html>"
      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(403))
        .mockResolvedValueOnce(makeOkResponse(archiveHtml))

      const result = await fetchPage({ url: "https://blocked-site.com/page" })

      expect(result.fetchMethod).toBe("archive.org")
      expect(result.content).toBe(archiveHtml)
      // The archive URL should be used
      expect(result.url).toContain("web.archive.org")
      expect(result.url).toContain("https://blocked-site.com/page")
    })

    it("falls back to archive.org on HTTP 429", async () => {
      const archiveHtml = "<html><body>Archived version</body></html>"
      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(429))
        .mockResolvedValueOnce(makeOkResponse(archiveHtml))

      const result = await fetchPage({ url: "https://rate-limited.com/page" })

      expect(result.fetchMethod).toBe("archive.org")
      expect(result.content).toBe(archiveHtml)
    })

    it("falls back to archive.org on HTTP 401", async () => {
      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(401))
        .mockResolvedValueOnce(makeOkResponse("<html>archived</html>"))

      const result = await fetchPage({ url: "https://auth-required.com" })

      expect(result.fetchMethod).toBe("archive.org")
    })

    it("falls back to archive.org on HTTP 451", async () => {
      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(451))
        .mockResolvedValueOnce(makeOkResponse("<html>archived</html>"))

      const result = await fetchPage({ url: "https://legal-block.com" })

      expect(result.fetchMethod).toBe("archive.org")
    })
  })

  // ============================================================================
  // Soft Block → Archive.org Fallback
  // ============================================================================

  describe("soft block fallback", () => {
    it("detects captcha in body and falls back to archive.org", async () => {
      const captchaBody =
        '<html><body><div class="captcha">Please complete the CAPTCHA to continue</div></body></html>'
      const archiveHtml = "<html><body>Real content from archive</body></html>"

      mockFetch
        .mockResolvedValueOnce(makeOkResponse(captchaBody))
        .mockResolvedValueOnce(makeOkResponse(archiveHtml))

      const result = await fetchPage({ url: "https://captcha-site.com/page" })

      expect(result.fetchMethod).toBe("archive.org")
      expect(result.content).toBe(archiveHtml)
    })

    it("detects 'access denied' in body and falls back", async () => {
      const blockedBody = "<html><body><h1>Access Denied</h1><p>You do not have permission.</p></body></html>"

      mockFetch
        .mockResolvedValueOnce(makeOkResponse(blockedBody))
        .mockResolvedValueOnce(makeOkResponse("<html>archived</html>"))

      const result = await fetchPage({ url: "https://denied-site.com" })

      expect(result.fetchMethod).toBe("archive.org")
    })

    it("detects cloudflare challenge and falls back", async () => {
      const cfBody =
        '<html><head><title>Just a moment...</title></head><body>DDoS protection by Cloudflare</body></html>'

      mockFetch
        .mockResolvedValueOnce(makeOkResponse(cfBody))
        .mockResolvedValueOnce(makeOkResponse("<html>archived</html>"))

      const result = await fetchPage({ url: "https://cf-protected.com" })

      expect(result.fetchMethod).toBe("archive.org")
    })
  })

  // ============================================================================
  // Large Page with Block Words — NOT Treated as Blocked
  // ============================================================================

  describe("large page with block words", () => {
    it("does NOT treat a large page (>50KB) with block words as blocked", async () => {
      // Create a body larger than 50KB that contains a soft-block word
      const padding = "x".repeat(60_000)
      const largeBody = `<html><body>${padding} captcha appears in article text</body></html>`

      mockFetch.mockResolvedValueOnce(makeOkResponse(largeBody))

      const result = await fetchPage({ url: "https://big-site.com/article" })

      // Should be treated as direct success, not a soft block
      expect(result.fetchMethod).toBe("direct")
      expect(result.content).toBe(largeBody)
      // Archive should NOT have been attempted
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  // ============================================================================
  // Both Direct and Archive Fail → none
  // ============================================================================

  describe("both direct and archive fail", () => {
    it("returns none when both direct and archive.org fail", async () => {
      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(403))
        .mockResolvedValueOnce(makeErrorResponse(404))

      const result = await fetchPage({ url: "https://dead-site.com/page" })

      expect(result.fetchMethod).toBe("none")
      expect(result.content).toBe("")
      expect(result.error).toBeDefined()
    })
  })

  // ============================================================================
  // archiveFallback=false Skips Archive
  // ============================================================================

  describe("archiveFallback disabled", () => {
    it("skips archive.org when archiveFallback is false", async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(403))

      const result = await fetchPage({
        url: "https://blocked-site.com/page",
        archiveFallback: false,
      })

      expect(result.fetchMethod).toBe("none")
      expect(result.content).toBe("")
      // Should NOT have attempted archive.org fetch
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  // ============================================================================
  // Non-Blocking HTTP Errors → none Without Archive
  // ============================================================================

  describe("non-blocking HTTP errors", () => {
    it("returns none on 404 without attempting archive.org", async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(404))

      const result = await fetchPage({ url: "https://example.com/missing-page" })

      expect(result.fetchMethod).toBe("none")
      expect(result.content).toBe("")
      expect(result.error).toContain("404")
      // Should NOT have tried archive.org
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it("returns none on 500 without attempting archive.org", async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(500))

      const result = await fetchPage({ url: "https://example.com/error-page" })

      expect(result.fetchMethod).toBe("none")
      expect(result.content).toBe("")
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  // ============================================================================
  // Abort Signal Handling
  // ============================================================================

  describe("abort signal handling", () => {
    it("passes the signal to fetch and returns none on abort", async () => {
      const controller = new AbortController()
      controller.abort()

      mockFetch.mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"))

      const result = await fetchPage({
        url: "https://example.com",
        signal: controller.signal,
      })

      expect(result.fetchMethod).toBe("none")
      expect(result.content).toBe("")
      expect(result.error).toBeDefined()
      // Should not attempt archive.org on abort
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it("combines caller signal with timeout", async () => {
      mockFetch.mockResolvedValueOnce(makeOkResponse("<html>ok</html>"))

      const controller = new AbortController()
      await fetchPage({
        url: "https://example.com",
        signal: controller.signal,
        timeoutMs: 5000,
      })

      const [, options] = mockFetch.mock.calls[0]
      // A signal should have been passed to fetch
      expect(options.signal).toBeDefined()
    })
  })

  // ============================================================================
  // Network Error → Archive Fallback
  // ============================================================================

  describe("network error fallback", () => {
    it("falls back to archive.org on network error", async () => {
      const archiveHtml = "<html><body>Archived version</body></html>"

      mockFetch
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(makeOkResponse(archiveHtml))

      const result = await fetchPage({ url: "https://unreachable-site.com/page" })

      expect(result.fetchMethod).toBe("archive.org")
      expect(result.content).toBe(archiveHtml)
    })

    it("returns none when network error occurs and archive also fails", async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))

      const result = await fetchPage({ url: "https://unreachable-site.com/page" })

      expect(result.fetchMethod).toBe("none")
      expect(result.content).toBe("")
      expect(result.error).toBeDefined()
    })
  })
})
