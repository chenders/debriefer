/**
 * Find a Grave obituary source.
 *
 * Searches findagrave.com for memorial pages by name, extracts biography
 * content via Readability (with regex fallback), and returns sanitized text.
 *
 * Find a Grave is user-generated content — anyone can create or edit memorials.
 * Reliability tier is UNRELIABLE_UGC (0.35) per Wikipedia RSP guidelines.
 */

import {
  BaseResearchSource,
  ReliabilityTier,
  type BaseSourceOptions,
  type ResearchSubject,
  type RawFinding,
} from "debriefer"
import { fetchPage } from "../shared/fetch-page.js"
import { extractArticleContent } from "../shared/readability-extract.js"
import { sanitizeSourceText } from "../shared/sanitize-text.js"

// ============================================================================
// Constants
// ============================================================================

const SEARCH_BASE_URL = "https://www.findagrave.com/memorial/search"
const MEMORIAL_URL_PATTERN = /\/memorial\/(\d+)\//g
const MIN_BIO_LENGTH = 100
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
const BIO_REGEX = /<div[^>]*id="bio"[^>]*>([\s\S]*?)<\/div>/i

// ============================================================================
// Types
// ============================================================================

/** Options for the Find a Grave source. */
export type FindAGraveOptions = BaseSourceOptions

// ============================================================================
// Source Implementation
// ============================================================================

/**
 * Find a Grave source for obituary / memorial content.
 *
 * Pipeline:
 * 1. Search findagrave.com by first/last name
 * 2. Parse memorial URLs from search results HTML
 * 3. Filter for URLs containing the subject's name (normalized)
 * 4. Fetch the memorial page via fetchPage (with archive fallback)
 * 5. Extract bio via Readability, falling back to regex
 * 6. Sanitize text and return if long enough
 */
export class FindAGraveSource extends BaseResearchSource<ResearchSubject> {
  readonly name = "Find a Grave"
  readonly type = "find-a-grave"
  readonly reliabilityTier = ReliabilityTier.UNRELIABLE_UGC
  readonly domain = "www.findagrave.com"
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  constructor(options: FindAGraveOptions = {}) {
    super({ rateLimitMs: 2000, ...options })
  }

  protected async fetchResult(
    subject: ResearchSubject,
    signal: AbortSignal
  ): Promise<RawFinding | null> {
    // Step 1: Split name into first/last
    const nameParts = subject.name.trim().split(/\s+/)
    const firstName = nameParts[0] ?? ""
    const lastName = nameParts.slice(1).join(" ") || ""

    // Step 2: Search for memorials
    const searchUrl = `${SEARCH_BASE_URL}?firstname=${encodeURIComponent(firstName)}&lastname=${encodeURIComponent(lastName)}&orderby=r`

    const searchResponse = await fetch(searchUrl, {
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal,
    })

    if (!searchResponse.ok) {
      return null
    }

    const searchHtml = await searchResponse.text()

    // Step 3: Extract memorial URLs
    const memorialUrls: string[] = []
    let match: RegExpExecArray | null
    // Reset lastIndex before use
    MEMORIAL_URL_PATTERN.lastIndex = 0
    while ((match = MEMORIAL_URL_PATTERN.exec(searchHtml)) !== null) {
      const fullMatch = match[0]
      // Build the full memorial URL from the path found in the HTML
      // Search result links look like: /memorial/12345/john-wayne
      const endIdx = searchHtml.indexOf('"', searchHtml.indexOf(fullMatch))
      const startIdx = searchHtml.lastIndexOf('"', searchHtml.indexOf(fullMatch)) + 1
      const path = searchHtml.slice(startIdx, endIdx)

      if (path.startsWith("/memorial/")) {
        const url = `https://www.findagrave.com${path}`
        if (!memorialUrls.includes(url)) {
          memorialUrls.push(url)
        }
      }
    }

    if (memorialUrls.length === 0) {
      return null
    }

    // Step 4: Filter for URLs containing the subject's name (normalized)
    const normalizedName = subject.name.toLowerCase().replace(/\s+/g, "-")
    const matchingUrls = memorialUrls.filter((url) => url.toLowerCase().includes(normalizedName))

    if (matchingUrls.length === 0) {
      return null
    }

    const memorialUrl = matchingUrls[0]

    // Step 5: Fetch the memorial page
    const page = await fetchPage({ url: memorialUrl, signal })

    if (page.fetchMethod === "none" || !page.content) {
      return null
    }

    // Step 6: Extract bio content
    const actualUrl = page.url || memorialUrl
    let bioText: string | null = null

    // Try Readability first
    const extracted = extractArticleContent(page.content, actualUrl)
    if (extracted && extracted.text.length >= MIN_BIO_LENGTH) {
      bioText = extracted.text
    }

    // Fall back to regex if Readability didn't get enough content
    if (!bioText) {
      const bioMatch = BIO_REGEX.exec(page.content)
      if (bioMatch && bioMatch[1]) {
        // Strip HTML tags from the regex-extracted content
        const stripped = bioMatch[1]
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
        if (stripped.length >= MIN_BIO_LENGTH) {
          bioText = stripped
        }
      }
    }

    if (!bioText) {
      return null
    }

    // Step 7: Sanitize and return
    const text = sanitizeSourceText(bioText)

    if (text.length < MIN_BIO_LENGTH) {
      return null
    }

    return {
      text,
      confidence: -1,
      costUsd: 0,
      url: actualUrl,
      publication: "Find a Grave",
      metadata: {
        memorialUrl: actualUrl,
      },
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a Find a Grave source instance.
 *
 * @example
 * ```typescript
 * const source = findAGrave()
 * ```
 */
export function findAGrave(options?: FindAGraveOptions): FindAGraveSource {
  return new FindAGraveSource(options)
}
