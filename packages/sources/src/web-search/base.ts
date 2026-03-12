/**
 * Abstract base class for web search sources using the template method pattern.
 *
 * Subclasses only implement `performSearch()` — the base class handles the
 * full pipeline: search → score/rank links → fetch pages → extract content →
 * sanitize → combine with attribution.
 *
 * Used by Google, Bing, Brave, and DuckDuckGo search sources.
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

/** A single result from a web search engine. */
export interface WebSearchResult {
  url: string
  title: string
  snippet: string
}

/** Options for scoring and filtering search result links. */
export interface LinkSelectionOptions {
  /** Domain → 0-100 score. Adds to link score when hostname matches. */
  domainScores?: Record<string, number>
  /** Keywords that boost a result's score when found in title+snippet. */
  boostKeywords?: Array<{ keyword: string; boost: number }>
  /** Keywords that penalize a result's score when found in title+snippet. */
  penaltyKeywords?: Array<{ keyword: string; penalty: number }>
  /** Domains to completely exclude from results. */
  blockedDomains?: string[]
}

/** Options for WebSearchBase sources, combining base source and link selection options. */
export interface WebSearchOptions extends BaseSourceOptions, LinkSelectionOptions {
  /** Maximum number of search result pages to fetch. Default: 3. */
  maxLinksToFollow?: number
  /** Minimum extracted text length in characters. Pages below this are filtered. Default: 200. */
  minContentLength?: number
  /**
   * Maximum cost in USD for link following per subject. When set, the source
   * tracks cumulative fetch cost and stops following links when the budget
   * is exhausted. Default: unlimited.
   */
  maxLinkCost?: number
  /**
   * Custom link selector that filters/reorders search results before fetching.
   * Receives ranked results and the subject, returns the results to follow.
   * Useful for AI-assisted link selection (e.g., Claude ranking URLs by relevance).
   * Applied after scoring/ranking but before the maxLinksToFollow limit.
   */
  linkSelector?: (
    results: WebSearchResult[],
    subject: ResearchSubject
  ) => Promise<WebSearchResult[]> | WebSearchResult[]
  /**
   * Custom page fetcher that replaces the default fetch+readability pipeline.
   * Useful for browser-based fetching (Playwright) or sites requiring
   * authentication/fingerprinting. Returns extracted text or null on failure.
   */
  fetchPage?: (url: string, signal: AbortSignal) => Promise<string | null>
}

// ============================================================================
// Scored result (internal)
// ============================================================================

interface ScoredResult {
  result: WebSearchResult
  score: number
}

// ============================================================================
// WebSearchBase
// ============================================================================

/**
 * Abstract base class for web search sources.
 *
 * Implements the template method pattern: subclasses provide `performSearch()`
 * and this class handles the rest of the pipeline (scoring, fetching,
 * extracting, sanitizing, combining).
 */
export abstract class WebSearchBase extends BaseResearchSource<ResearchSubject> {
  protected readonly maxLinksToFollow: number
  protected readonly minContentLength: number
  protected readonly domainScores: Record<string, number>
  protected readonly boostKeywords: Array<{ keyword: string; boost: number }>
  protected readonly penaltyKeywords: Array<{ keyword: string; penalty: number }>
  protected readonly blockedDomains: string[]
  private readonly maxLinkCost?: number
  private readonly linkSelector?: WebSearchOptions["linkSelector"]
  private readonly customFetchPage?: WebSearchOptions["fetchPage"]

  constructor(options: WebSearchOptions = {}) {
    super(options)
    this.maxLinksToFollow = options.maxLinksToFollow ?? 3
    this.minContentLength = options.minContentLength ?? 200
    this.domainScores = options.domainScores ?? {}
    this.boostKeywords = options.boostKeywords ?? []
    this.penaltyKeywords = options.penaltyKeywords ?? []
    this.blockedDomains = options.blockedDomains ?? []
    this.maxLinkCost = options.maxLinkCost
    this.linkSelector = options.linkSelector
    this.customFetchPage = options.fetchPage
  }

  /**
   * Subclass-specific search API call. Returns raw search results.
   *
   * @param query - The search query string
   * @param signal - Abort signal for cancellation
   * @returns Array of search results (URL, title, snippet)
   */
  protected abstract performSearch(query: string, signal: AbortSignal): Promise<WebSearchResult[]>

  /**
   * Full search pipeline: search → score → fetch → extract → combine.
   *
   * @param subject - The research subject
   * @param signal - Abort signal for cancellation
   * @returns RawFinding with combined text, or null if no content extracted
   */
  protected async fetchResult(
    subject: ResearchSubject,
    signal: AbortSignal
  ): Promise<RawFinding | null> {
    // 1. Build query and perform search
    const query = this.buildQuery(subject)
    const searchResults = await this.performSearch(query, signal)

    if (searchResults.length === 0) {
      return null
    }

    // 2. Filter blocked domains
    const filtered = searchResults.filter((r) => !this.isDomainBlocked(r.url))

    if (filtered.length === 0) {
      return null
    }

    // 3. Score & rank links
    const ranked = this.scoreAndRank(filtered)

    // 4. Apply custom link selector if provided, then take top N
    let selectedResults = ranked.map((r) => r.result)
    if (this.linkSelector) {
      selectedResults = await this.linkSelector(selectedResults, subject)
    }
    const linksToFollow = selectedResults.slice(0, this.maxLinksToFollow)

    // 5. Fetch and extract content from each page
    const extractedPages: Array<{ url: string; title: string; text: string }> = []
    let linksAttempted = 0
    let linkCostUsd = 0

    for (const result of linksToFollow) {
      if (signal.aborted) break
      if (this.maxLinkCost !== undefined && linkCostUsd >= this.maxLinkCost) break

      linksAttempted++

      // Use custom fetch if provided, otherwise default pipeline
      if (this.customFetchPage) {
        const text = await this.customFetchPage(result.url, signal)
        if (text && text.length >= this.minContentLength) {
          extractedPages.push({
            url: result.url,
            title: result.title ?? result.url,
            text,
          })
          linkCostUsd += this.estimatedCostPerQuery
        }
        continue
      }

      const pageResult = await fetchPage({ url: result.url, signal })

      if (pageResult.fetchMethod === "none" || !pageResult.content) {
        continue
      }

      // Use the actual fetched URL (may be archive.org URL if fallback was used)
      const actualUrl = pageResult.url || result.url

      const extracted = extractArticleContent(pageResult.content, actualUrl)
      if (!extracted) {
        continue
      }

      // 6. Filter by minimum content length
      if (extracted.text.length < this.minContentLength) {
        continue
      }

      extractedPages.push({
        url: actualUrl,
        title: extracted.title ?? result.title ?? result.url,
        text: extracted.text,
      })
      linkCostUsd += this.estimatedCostPerQuery
    }

    if (extractedPages.length === 0) {
      return null
    }

    // 7. Sanitize each page's text
    const sanitizedPages = extractedPages.map((page) => ({
      ...page,
      text: sanitizeSourceText(page.text),
    }))

    // 8. Combine texts with source attribution
    const combinedText = sanitizedPages
      .map((page) => `${page.title}\n${page.text}`)
      .join("\n\n---\n\n")

    // 9. Return RawFinding
    return {
      text: combinedText,
      confidence: -1,
      costUsd: this.estimatedCostPerQuery + linkCostUsd,
      url: extractedPages[0].url,
      metadata: {
        searchEngine: this.name,
        linksFollowed: linksAttempted,
        pagesExtracted: extractedPages.length,
        urls: extractedPages.map((p) => p.url),
      },
    }
  }

  /**
   * Score and rank search results by relevance.
   *
   * Scoring:
   * - Base: 50 - index (preserves search engine ordering)
   * - + domainScores[domain] if hostname matches
   * - + boost for each boostKeyword found in title+snippet
   * - - penalty for each penaltyKeyword found in title+snippet
   */
  private scoreAndRank(results: WebSearchResult[]): ScoredResult[] {
    const scored = results.map((result, index) => {
      let score = 50 - index

      // Domain score bonus
      let hostname: string | null = null
      try {
        hostname = new URL(result.url).hostname
      } catch {
        // Invalid URL — skip domain scoring
      }
      for (const [domain, domainScore] of Object.entries(this.domainScores)) {
        if (!hostname) break
        if (this.hostnameMatchesDomain(hostname, domain)) {
          score += domainScore
          break
        }
      }

      // Boost keywords
      const combined = `${result.title} ${result.snippet}`.toLowerCase()
      for (const { keyword, boost } of this.boostKeywords) {
        if (combined.includes(keyword.toLowerCase())) {
          score += boost
        }
      }

      // Penalty keywords
      for (const { keyword, penalty } of this.penaltyKeywords) {
        if (combined.includes(keyword.toLowerCase())) {
          score -= penalty
        }
      }

      return { result, score }
    })

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score)

    return scored
  }

  /**
   * Check whether a URL should be excluded (blocked domain or unsafe URL).
   * Blocks: non-http(s) schemes, localhost, private IP ranges, and user-specified domains.
   */
  protected isDomainBlocked(url: string): boolean {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return true // Unparseable URLs are blocked
    }

    // Only allow http and https
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return true
    }

    // Block localhost, private IPs, and link-local addresses (SSRF prevention)
    // Normalize IPv4-mapped IPv6 (e.g., ::ffff:127.0.0.1) to plain IPv4
    let hostname = parsed.hostname
    const mappedMatch = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(hostname)
    if (mappedMatch) {
      hostname = mappedMatch[1]
    }

    if (
      hostname === "localhost" ||
      hostname.startsWith("127.") || // 127.0.0.0/8 loopback
      hostname === "::1" || // IPv6 loopback
      hostname === "[::1]" || // IPv6 loopback (bracketed form)
      hostname.startsWith("10.") || // RFC 1918
      hostname.startsWith("192.168.") || // RFC 1918
      hostname.startsWith("169.254.") || // Link-local / cloud metadata (169.254.169.254)
      hostname === "0.0.0.0" ||
      hostname.endsWith(".local") ||
      (hostname.includes(":") && hostname.startsWith("fc")) || // IPv6 unique local (fc00::/7)
      (hostname.includes(":") && hostname.startsWith("fd")) || // IPv6 unique local (fc00::/7)
      (hostname.includes(":") && hostname.startsWith("fe80")) || // IPv6 link-local (fe80::/10)
      this.isPrivate172(hostname)
    ) {
      return true
    }

    return this.blockedDomains.some((domain) => this.hostnameMatchesDomain(hostname, domain))
  }

  /**
   * Check if a hostname matches a domain (exact or subdomain match).
   * Normalizes domain to lowercase since URL.hostname is always lowercase.
   *
   * "www.example.com" matches "example.com"
   * "sub.example.com" matches "example.com"
   * "example.com" matches "example.com"
   * "notexample.com" does NOT match "example.com"
   */
  private hostnameMatchesDomain(hostname: string, domain: string): boolean {
    const d = domain.toLowerCase()
    return hostname === d || hostname.endsWith("." + d)
  }

  /** Check if hostname is in the 172.16.0.0–172.31.255.255 private range (RFC 1918). */
  private isPrivate172(hostname: string): boolean {
    if (!hostname.startsWith("172.")) return false
    const secondOctet = parseInt(hostname.split(".")[1], 10)
    return secondOctet >= 16 && secondOctet <= 31
  }
}
