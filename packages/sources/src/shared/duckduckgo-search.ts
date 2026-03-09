/**
 * DuckDuckGo HTML search utility.
 *
 * Scrapes DDG's HTML endpoint (no API key required) to extract
 * search result URLs, titles, and snippets. Includes CAPTCHA detection,
 * DDG redirect URL cleaning, and domain-based filtering.
 *
 * Used by DuckDuckGoSearchSource and future news sources for
 * `site:domain.com` style queries.
 */

import { decodeHtmlEntities } from "./html-utils.js"

// ============================================================================
// Types
// ============================================================================

/** Options for a DuckDuckGo HTML search. */
export interface DuckDuckGoSearchOptions {
  /** Search query string. */
  query: string
  /** Domain to restrict results to (prepended as site: to query). */
  domainFilter?: string
  /** Maximum number of results to return. Default: 10. */
  maxResults?: number
  /** AbortSignal from the caller (combined with timeoutMs). */
  signal?: AbortSignal
  /** Timeout in milliseconds for the fetch. Default: 15000. */
  timeoutMs?: number
}

/** A single search result extracted from DDG HTML. */
export interface SearchResult {
  /** Cleaned URL of the search result. */
  url: string
  /** Title of the search result. */
  title: string
  /** Snippet/description of the search result. */
  snippet: string
}

// ============================================================================
// Constants
// ============================================================================

/** DDG HTML search endpoint. */
const DDG_HTML_URL = "https://html.duckduckgo.com/html/"

/** Default timeout for the search fetch in milliseconds. */
const DEFAULT_TIMEOUT_MS = 15000

/** Default maximum number of results to return. */
const DEFAULT_MAX_RESULTS = 10

// ============================================================================
// CAPTCHA Detection
// ============================================================================

/**
 * Detect whether DDG returned a CAPTCHA/bot-detection page.
 *
 * Checks for "anomaly-modal" (DDG's CAPTCHA container) and the
 * "bots use DuckDuckGo too" message.
 *
 * @param html - Raw HTML response body from DDG
 * @returns True if the page is a CAPTCHA challenge
 */
export function isDuckDuckGoCaptcha(html: string): boolean {
  const lower = html.toLowerCase()
  return lower.includes("anomaly-modal") || lower.includes("bots use duckduckgo too")
}

// ============================================================================
// URL Cleaning
// ============================================================================

/**
 * Clean a DuckDuckGo result URL.
 *
 * DDG wraps result URLs in redirect links like:
 *   `//duckduckgo.com/l/?uddg=ENCODED_URL&rut=...`
 *
 * This function:
 * 1. Extracts the real URL from the `uddg` query parameter
 * 2. Handles protocol-relative `//` URLs by prepending `https:`
 * 3. Passes normal URLs through unchanged
 *
 * @param url - URL from a DDG search result
 * @returns Cleaned URL pointing to the actual destination
 */
export function cleanDuckDuckGoUrl(url: string): string {
  // Handle DDG redirect URLs containing uddg parameter
  if (url.includes("uddg=")) {
    // Normalize protocol-relative URL before parsing
    const normalizedUrl = url.startsWith("//") ? `https:${url}` : url
    try {
      const parsed = new URL(normalizedUrl)
      const uddg = parsed.searchParams.get("uddg")
      if (uddg) {
        return uddg
      }
    } catch {
      // Fall through to other checks
    }
  }

  // Handle protocol-relative URLs
  if (url.startsWith("//")) {
    return `https:${url}`
  }

  return url
}

// ============================================================================
// HTML Extraction
// ============================================================================

/**
 * Extract search results from DuckDuckGo HTML response.
 *
 * Parses DDG's HTML structure:
 * - `class="result__url"` href for URLs (primary)
 * - `class="result__a"` for titles (and fallback URLs)
 * - `class="result__snippet"` for snippets
 *
 * If no `result__url` matches are found, falls back to `result__a` hrefs.
 * Filters by domain using URL hostname parsing to prevent substring spoofing
 * (e.g., "nytimes.com.evil.com" won't match "nytimes.com").
 *
 * @param html - Raw HTML response from DDG
 * @param domainFilter - Optional domain to filter results by
 * @returns Array of extracted search results
 */
export function extractUrlsFromDuckDuckGoHtml(html: string, domainFilter?: string): SearchResult[] {
  // Extract result__url hrefs
  const urlPattern = /class="result__url"\s+href="([^"]+)"/g
  const resultUrls: string[] = []
  let match: RegExpExecArray | null

  match = urlPattern.exec(html)
  while (match !== null) {
    resultUrls.push(cleanDuckDuckGoUrl(decodeHtmlEntities(match[1])))
    match = urlPattern.exec(html)
  }

  // Extract result__a titles and hrefs
  const titlePattern = /class="result__a"\s+href="([^"]+)"[^>]*>([^<]*)</g
  const titles: Array<{ href: string; title: string }> = []

  match = titlePattern.exec(html)
  while (match !== null) {
    titles.push({
      href: cleanDuckDuckGoUrl(decodeHtmlEntities(match[1])),
      title: decodeHtmlEntities(match[2]).trim(),
    })
    match = titlePattern.exec(html)
  }

  // Extract result__snippet text
  const snippetPattern = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  const snippets: string[] = []

  match = snippetPattern.exec(html)
  while (match !== null) {
    // Strip any inline HTML tags from snippet content
    const rawSnippet = match[1].replace(/<[^>]+>/g, "")
    snippets.push(decodeHtmlEntities(rawSnippet).trim())
    match = snippetPattern.exec(html)
  }

  // Build results: prefer result__url, fall back to result__a hrefs
  const useUrls = resultUrls.length > 0
  const primaryUrls = useUrls ? resultUrls : titles.map((t) => t.href)
  const count = primaryUrls.length

  const results: SearchResult[] = []

  for (let i = 0; i < count; i++) {
    const url = primaryUrls[i]
    const title = titles[i]?.title ?? ""
    const snippet = snippets[i] ?? ""

    // Filter by domain using hostname parsing to prevent substring spoofing
    if (domainFilter) {
      try {
        const hostname = new URL(url).hostname
        if (hostname !== domainFilter && !hostname.endsWith("." + domainFilter)) {
          continue
        }
      } catch {
        // If URL can't be parsed, skip it when filtering
        continue
      }
    }

    results.push({ url, title, snippet })
  }

  return results
}

// ============================================================================
// Search Function
// ============================================================================

/**
 * Build the combined AbortSignal from a caller signal and a timeout.
 *
 * Uses `AbortSignal.any()` to combine both so that neither defeats the other.
 */
function buildSignal(callerSignal?: AbortSignal, timeoutMs?: number): AbortSignal {
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeoutSignal = AbortSignal.timeout(timeout)

  if (callerSignal) {
    return AbortSignal.any([callerSignal, timeoutSignal])
  }
  return timeoutSignal
}

/**
 * Search DuckDuckGo via its HTML endpoint.
 *
 * Fetches `https://html.duckduckgo.com/html/?q=QUERY`, optionally
 * prepending `site:domain` when domainFilter is set. Returns an empty
 * array on CAPTCHA, error, or non-OK response.
 *
 * @param options - Search options including query, domain filter, and limits
 * @returns Array of search results (empty on failure)
 */
export async function searchDuckDuckGo(options: DuckDuckGoSearchOptions): Promise<SearchResult[]> {
  const {
    query,
    domainFilter,
    maxResults = DEFAULT_MAX_RESULTS,
    signal: callerSignal,
    timeoutMs,
  } = options

  // Build the search query, prepending site: if domainFilter is set
  const fullQuery = domainFilter ? `site:${domainFilter} ${query}` : query

  // Build the search URL
  const searchUrl = `${DDG_HTML_URL}?q=${encodeURIComponent(fullQuery)}`

  // Build the abort signal combining caller signal with timeout
  const signal = buildSignal(callerSignal, timeoutMs)

  let response: Response
  try {
    response = await fetch(searchUrl, { signal })
  } catch (error) {
    // Re-throw abort/timeout so BaseResearchSource.lookup() can record telemetry
    if (
      error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw error
    }
    return []
  }

  if (!response.ok) {
    return []
  }

  const html = await response.text()

  if (isDuckDuckGoCaptcha(html)) {
    return []
  }

  const results = extractUrlsFromDuckDuckGoHtml(html, domainFilter)

  return results.slice(0, maxResults)
}
