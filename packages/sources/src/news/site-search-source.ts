/**
 * Configurable site-search source for news and reference sites.
 *
 * Uses DuckDuckGo `site:` search to find articles on a specific domain,
 * picks the best URL based on path preferences, fetches the page,
 * extracts article content, and returns a sanitized finding.
 *
 * This is the reusable base that 19+ news/reference source factories
 * instantiate with different SiteSearchConfig values (AP, BBC, Reuters, etc.).
 */

import {
  BaseResearchSource,
  type BaseSourceOptions,
  type ResearchSubject,
  type RawFinding,
  type ReliabilityTier,
} from "@debriefer/core"
import { searchDuckDuckGo, type SearchResult } from "../shared/duckduckgo-search.js"
import { fetchPage } from "../shared/fetch-page.js"
import { extractArticleContent } from "../shared/readability-extract.js"
import { sanitizeSourceText } from "../shared/sanitize-text.js"

// ============================================================================
// Types
// ============================================================================

/** Configuration for a site-search source. */
export interface SiteSearchConfig {
  /** Display name (e.g., "AP News"). */
  name: string
  /** Source type identifier (e.g., "ap-news"). */
  type: string
  /** Primary domain to search (e.g., "apnews.com"). */
  domain: string
  /** Additional domains to search (e.g., ["bbc.co.uk"]). */
  additionalDomains?: string[]
  /** Reliability tier from the RSP scale. */
  reliabilityTier: ReliabilityTier
  /** Rate limit delay in milliseconds. Default: 1500. */
  rateLimitMs?: number
  /** URL paths to boost when selecting results (e.g., ["/article/"]). */
  preferredPaths?: string[]
  /** URL paths to penalize when selecting results (e.g., ["/gallery/"]). */
  avoidPaths?: string[]
  /** Additional query terms appended to the search (e.g., "biography OR profile"). */
  queryTerms?: string
  /** Minimum extracted text length in characters. Default: 200. */
  minContentLength?: number
}

// ============================================================================
// pickBestUrl
// ============================================================================

/**
 * Pick the best URL from search results based on path preferences.
 *
 * Scoring:
 * - +10 for each preferredPaths match found in the URL pathname
 * - -10 for each avoidPaths match found in the URL pathname
 * - Returns highest-scored URL, falling back to first result
 * - Returns null for empty array
 *
 * @param results - Array of search results from DDG
 * @param options - Optional path preference configuration
 * @returns The best URL string, or null if no results
 */
export function pickBestUrl(
  results: SearchResult[],
  options?: { preferredPaths?: string[]; avoidPaths?: string[] }
): string | null {
  if (results.length === 0) {
    return null
  }

  const preferredPaths = options?.preferredPaths ?? []
  const avoidPaths = options?.avoidPaths ?? []

  // If no preferences, return first result
  if (preferredPaths.length === 0 && avoidPaths.length === 0) {
    return results[0].url
  }

  let bestUrl = results[0].url
  let bestScore = -Infinity

  for (const result of results) {
    let score = 0
    let pathname: string

    try {
      pathname = new URL(result.url).pathname
    } catch {
      // If URL is unparseable, treat pathname as empty
      pathname = ""
    }

    for (const preferred of preferredPaths) {
      if (pathname.includes(preferred)) {
        score += 10
      }
    }

    for (const avoid of avoidPaths) {
      if (pathname.includes(avoid)) {
        score -= 10
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

/**
 * A configurable research source that searches a specific news/reference
 * site via DuckDuckGo `site:` queries.
 *
 * All metadata (name, type, reliabilityTier, domain, isFree, estimatedCostPerQuery)
 * is derived from the provided SiteSearchConfig.
 */
export class SiteSearchSource extends BaseResearchSource<ResearchSubject> {
  readonly name: string
  readonly type: string
  readonly reliabilityTier: ReliabilityTier
  readonly domain: string
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  private readonly config: SiteSearchConfig

  constructor(config: SiteSearchConfig, options?: BaseSourceOptions) {
    super({ rateLimitMs: config.rateLimitMs ?? 1500, ...options })
    this.config = config
    this.name = config.name
    this.type = config.type
    this.reliabilityTier = config.reliabilityTier
    this.domain = config.domain
  }

  /**
   * Build search query for this subject.
   *
   * Format: `"subject name" queryTerms` (queryTerms omitted if empty).
   */
  buildQuery(subject: ResearchSubject): string {
    const base = `"${subject.name}"`
    if (this.config.queryTerms) {
      return `${base} (${this.config.queryTerms})`
    }
    return base
  }

  /**
   * Fetch a finding from this news/reference site.
   *
   * Pipeline:
   * 1. Search DDG with `site:domain` filter
   * 2. Pick best URL based on path preferences
   * 3. Fetch the page
   * 4. Extract article content via Readability
   * 5. Check minimum content length
   * 6. Sanitize text
   * 7. Return RawFinding with metadata
   */
  protected async fetchResult(
    subject: ResearchSubject,
    signal: AbortSignal
  ): Promise<RawFinding | null> {
    const query = this.buildQuery(subject)

    // Build domain filter: primary domain, plus additional domains via OR
    const allDomains = [this.config.domain, ...(this.config.additionalDomains ?? [])]

    // Search each domain and collect all results
    const allResults: SearchResult[] = []
    for (const domain of allDomains) {
      const results = await searchDuckDuckGo({ query, domainFilter: domain, signal })
      allResults.push(...results)
    }

    if (allResults.length === 0) {
      return null
    }

    // Pick best URL
    const bestUrl = pickBestUrl(allResults, {
      preferredPaths: this.config.preferredPaths,
      avoidPaths: this.config.avoidPaths,
    })

    if (!bestUrl) {
      return null
    }

    // Fetch the page
    const page = await fetchPage({ url: bestUrl, signal })

    if (page.fetchMethod === "none" || !page.content) {
      return null
    }

    // Extract article content
    const actualUrl = page.url || bestUrl
    const extracted = extractArticleContent(page.content, actualUrl)

    if (!extracted) {
      return null
    }

    // Check minimum content length
    const minContentLength = this.config.minContentLength ?? 200
    if (extracted.text.length < minContentLength) {
      return null
    }

    // Sanitize and return
    const text = sanitizeSourceText(extracted.text)

    return {
      text,
      confidence: -1,
      costUsd: 0,
      url: actualUrl,
      publication: this.config.name,
      metadata: {
        title: extracted.title,
        author: extracted.author,
        siteName: extracted.siteName,
        domain: (() => {
          try {
            return new URL(actualUrl).hostname
          } catch {
            return this.config.domain
          }
        })(),
      },
    }
  }
}
