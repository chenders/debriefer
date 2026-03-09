/**
 * Page fetching utility with browser-like headers and archive.org fallback.
 *
 * Provides a resilient page fetching pipeline:
 * 1. Direct fetch with browser-like headers (Chrome UA, Accept text/html)
 * 2. Block detection (hard HTTP blocks + soft body pattern matching)
 * 3. Automatic archive.org fallback when blocked or on network error
 * 4. Non-blocking HTTP errors (404, 500) return immediately without fallback
 *
 * Used by WebSearchBase when following links from search results.
 */

/** Options for fetching a page. */
export interface FetchPageOptions {
  /** URL to fetch. */
  url: string
  /** AbortSignal from the caller (combined with timeoutMs). */
  signal?: AbortSignal
  /** Timeout in milliseconds for each fetch attempt. Default: 15000. */
  timeoutMs?: number
  /** User-Agent header to send. Default: browser-like Chrome UA. */
  userAgent?: string
  /** Whether to try archive.org when direct fetch is blocked. Default: true. */
  archiveFallback?: boolean
}

/** Result of a page fetch attempt. */
export interface FetchPageResult {
  /** Raw HTML content (empty string if fetch failed). */
  content: string
  /** Final URL (may differ from input if archive.org was used). */
  url: string
  /** How the content was obtained. */
  fetchMethod: "direct" | "archive.org" | "none"
  /** Error description when fetchMethod is "none". */
  error?: string
}

/** Default browser-like User-Agent string. */
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

/** Default timeout for each fetch attempt in milliseconds. */
const DEFAULT_TIMEOUT_MS = 15000

/** HTTP status codes that indicate a hard block (should trigger archive fallback). */
const HARD_BLOCK_STATUSES = new Set([401, 403, 429, 451])

/** Maximum body size (in bytes) for soft block detection. Pages larger than this are assumed to be real content. */
const SOFT_BLOCK_MAX_SIZE = 50_000

/** Case-insensitive patterns in response body that indicate a soft block. */
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

/** Build browser-like request headers. */
function buildHeaders(userAgent: string): Record<string, string> {
  return {
    "User-Agent": userAgent,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  }
}

/**
 * Check whether a response body indicates a soft block (captcha, bot detection, etc.).
 *
 * Only checks pages smaller than SOFT_BLOCK_MAX_SIZE to avoid false positives
 * on large legitimate pages that happen to mention these words.
 */
function isSoftBlocked(body: string): boolean {
  if (body.length > SOFT_BLOCK_MAX_SIZE) {
    return false
  }

  const lower = body.toLowerCase()
  return SOFT_BLOCK_PATTERNS.some((pattern) => lower.includes(pattern))
}

/**
 * Check whether an error is an abort (cancellation) error.
 */
function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  )
}

/**
 * Construct the archive.org Wayback Machine URL for a given URL.
 */
function archiveUrl(url: string): string {
  return `https://web.archive.org/web/${url}`
}

/**
 * Attempt to fetch a page from archive.org.
 *
 * Returns null if the archive fetch fails for any reason.
 */
async function fetchFromArchive(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal
): Promise<FetchPageResult | null> {
  const aUrl = archiveUrl(url)
  try {
    const response = await fetch(aUrl, { headers, signal })
    if (response.ok) {
      const content = await response.text()
      return {
        content,
        url: aUrl,
        fetchMethod: "archive.org",
      }
    }
  } catch {
    // Archive fetch failed — fall through to return null
  }
  return null
}

/**
 * Fetch a page with browser-like headers and automatic archive.org fallback.
 *
 * Pipeline:
 * 1. Direct fetch with browser-like headers
 * 2. Block detection (hard HTTP status codes + soft body pattern matching)
 * 3. If blocked and archiveFallback enabled, try archive.org
 * 4. Non-blocking HTTP errors (404, 500) return "none" immediately
 * 5. Network errors on direct fetch trigger archive fallback
 *
 * @param options - Fetch options including URL, signal, timeout, etc.
 * @returns Result with content, final URL, and fetch method
 */
export async function fetchPage(options: FetchPageOptions): Promise<FetchPageResult> {
  const {
    url,
    signal: callerSignal,
    timeoutMs,
    userAgent = DEFAULT_USER_AGENT,
    archiveFallback = true,
  } = options

  const signal = buildSignal(callerSignal, timeoutMs)
  const headers = buildHeaders(userAgent)

  // --- Direct fetch attempt ---
  let response: Response
  try {
    response = await fetch(url, { headers, signal })
  } catch (error: unknown) {
    // Abort errors should not trigger archive fallback
    if (isAbortError(error)) {
      return {
        content: "",
        url,
        fetchMethod: "none",
        error: "Request was aborted",
      }
    }

    // Network error — try archive fallback
    if (archiveFallback) {
      const archiveResult = await fetchFromArchive(url, headers, signal)
      if (archiveResult) {
        return archiveResult
      }
    }

    const message = error instanceof Error ? error.message : String(error)
    return {
      content: "",
      url,
      fetchMethod: "none",
      error: `Network error: ${message}`,
    }
  }

  // --- Hard block detection ---
  if (HARD_BLOCK_STATUSES.has(response.status)) {
    if (archiveFallback) {
      const archiveResult = await fetchFromArchive(url, headers, signal)
      if (archiveResult) {
        return archiveResult
      }
    }

    return {
      content: "",
      url,
      fetchMethod: "none",
      error: `HTTP ${response.status} (blocked)`,
    }
  }

  // --- Non-blocking HTTP errors (404, 500, etc.) — return immediately ---
  if (!response.ok) {
    return {
      content: "",
      url,
      fetchMethod: "none",
      error: `HTTP ${response.status}`,
    }
  }

  // --- Read body and check for soft blocks ---
  const body = await response.text()

  if (isSoftBlocked(body)) {
    if (archiveFallback) {
      const archiveResult = await fetchFromArchive(url, headers, signal)
      if (archiveResult) {
        return archiveResult
      }
    }

    return {
      content: "",
      url,
      fetchMethod: "none",
      error: "Soft block detected (captcha/bot detection)",
    }
  }

  // --- Success ---
  return {
    content: body,
    url,
    fetchMethod: "direct",
  }
}
