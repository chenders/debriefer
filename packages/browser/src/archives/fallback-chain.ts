/**
 * Page fetching with automatic archive fallbacks.
 *
 * Fallback chain:
 * 1. Direct fetch with browser-like headers
 * 2. archive.org (Wayback Machine)
 * 3. archive.is (HTTP)
 * 4. archive.is (browser + CAPTCHA solver) — if configured
 */

import type {
  BrowserFetchPageOptions,
  BrowserFetchPageResult,
  CaptchaSolverConfig,
} from "../types.js"
import { fetchFromArchiveOrg } from "./archive-org.js"
import { fetchFromArchiveIs, searchArchiveIsWithBrowser } from "./archive-is.js"

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
  "enable javascript",
  "browser check",
  "cloudflare",
  "ddos protection",
  "checking your browser",
  "just a moment",
  "please wait while we verify",
  "security check",
  "recaptcha",
  "hcaptcha",
  "px-captcha",
  "distil",
  "imperva",
]

const SOFT_BLOCK_PAGE_SIZE_THRESHOLD = 50_000

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
}

function isBlockedResponse(status: number, body?: string): boolean {
  if (BLOCKED_STATUS_CODES.has(status)) return true

  if (body && status === 200 && body.length < SOFT_BLOCK_PAGE_SIZE_THRESHOLD) {
    const lowerBody = body.toLowerCase()
    return SOFT_BLOCK_PATTERNS.some((pattern) => lowerBody.includes(pattern))
  }

  return false
}

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return titleMatch ? titleMatch[1].trim() : ""
}

/**
 * Fetch a page with automatic archive fallbacks when blocked.
 *
 * The caller's AbortSignal is checked between each fallback step. The direct
 * fetch uses AbortSignal for in-flight cancellation. Archive fallbacks use
 * short HTTP requests with internal rate limiting — cancellation is checked
 * between steps rather than during each archive fetch.
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @param captchaSolver - Optional CAPTCHA solver for archive.is browser fallback
 */
export async function fetchPageWithFallbacks(
  url: string,
  options?: BrowserFetchPageOptions,
  captchaSolver?: CaptchaSolverConfig
): Promise<BrowserFetchPageResult> {
  const timeoutMs = options?.timeoutMs ?? 15000

  // Step 1: Direct fetch
  try {
    const headers: Record<string, string> = {
      ...BROWSER_HEADERS,
      ...(options?.userAgent ? { "User-Agent": options.userAgent } : {}),
      ...(options?.headers || {}),
    }

    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const combinedSignal = options?.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal

    const response = await fetch(url, { headers, signal: combinedSignal })

    if (response.ok) {
      const html = await response.text()
      if (!isBlockedResponse(response.status, html)) {
        return { content: html, title: extractTitle(html), url, fetchMethod: "direct" }
      }
    } else if (!isBlockedResponse(response.status)) {
      // Non-blocking error (404, 500) — don't try archives
      return {
        content: "",
        title: "",
        url,
        fetchMethod: "none",
        error: `HTTP ${response.status}`,
      }
    }
  } catch {
    // Network error — try archives
  }

  if (options?.signal?.aborted) {
    return { content: "", title: "", url, fetchMethod: "none", error: "Aborted" }
  }

  // Step 2: archive.org
  try {
    const archiveResult = await fetchFromArchiveOrg(url)
    if (archiveResult.success && archiveResult.content.length > 0) {
      return {
        content: archiveResult.content,
        title: archiveResult.title,
        url: archiveResult.archiveUrl || url,
        fetchMethod: "archive.org",
      }
    }
  } catch {
    // Continue to next fallback
  }

  if (options?.signal?.aborted) {
    return { content: "", title: "", url, fetchMethod: "none", error: "Aborted" }
  }

  // Step 3: archive.is (HTTP)
  try {
    const archiveIsResult = await fetchFromArchiveIs(url)
    if (archiveIsResult.success && archiveIsResult.content.length > 0) {
      return {
        content: archiveIsResult.content,
        title: archiveIsResult.title,
        url: archiveIsResult.archiveUrl || url,
        fetchMethod: "archive.is",
      }
    }
  } catch {
    // Continue to next fallback
  }

  if (options?.signal?.aborted) {
    return { content: "", title: "", url, fetchMethod: "none", error: "Aborted" }
  }

  // Step 4: archive.is (browser + CAPTCHA solver)
  if (captchaSolver?.apiKey) {
    try {
      const browserResult = await searchArchiveIsWithBrowser(url, captchaSolver)
      if (browserResult.success && browserResult.content.length > 0) {
        return {
          content: browserResult.content,
          title: browserResult.title,
          url: browserResult.archiveUrl || url,
          fetchMethod: "archive.is-browser",
        }
      }
    } catch {
      // All fallbacks exhausted
    }
  }

  return {
    content: "",
    title: "",
    url,
    fetchMethod: "none",
    error: "All fetch methods failed (direct + archive.org + archive.is)",
  }
}
