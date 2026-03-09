/**
 * The Guardian API source.
 *
 * Queries the Guardian Content API for biographical/profile articles
 * about a research subject. Picks the best article by matching
 * biographical keywords in title, then body text, falling back to
 * the first result.
 *
 * Requires a Guardian API key (https://open-platform.theguardian.com/).
 */

import {
  BaseResearchSource,
  ReliabilityTier,
  type BaseSourceOptions,
  type ResearchSubject,
  type RawFinding,
} from "debriefer"
import { sanitizeSourceText } from "../shared/sanitize-text.js"

// ============================================================================
// Constants
// ============================================================================

const GUARDIAN_API_URL = "https://content.guardianapis.com/search"

const BIO_KEYWORDS = [
  "profile",
  "interview",
  "early life",
  "childhood",
  "biography",
  "life story",
  "portrait",
  "who is",
  "growing up",
  "memoir",
]

// ============================================================================
// Types
// ============================================================================

export interface GuardianOptions extends BaseSourceOptions {
  /** Guardian API key. Defaults to process.env.GUARDIAN_API_KEY. */
  apiKey?: string
}

/** Shape of a single result from the Guardian Content API. */
interface GuardianArticle {
  webTitle: string
  webUrl: string
  fields?: {
    bodyText?: string
    standfirst?: string
    trailText?: string
  }
}

/** Shape of the Guardian Content API response. */
interface GuardianApiResponse {
  response: {
    status: string
    results: GuardianArticle[]
  }
}

// ============================================================================
// GuardianSource
// ============================================================================

/**
 * Research source backed by the Guardian Content API.
 *
 * Searches for biographical/profile articles about a subject,
 * picks the best match by keyword scoring, and returns the
 * sanitized body text.
 */
export class GuardianSource extends BaseResearchSource<ResearchSubject> {
  readonly name = "The Guardian"
  readonly type = "guardian"
  readonly reliabilityTier = ReliabilityTier.TIER_1_NEWS
  readonly domain = "content.guardianapis.com"
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  private apiKey: string | undefined

  constructor(options: GuardianOptions = {}) {
    super({ rateLimitMs: 200, ...options })
    this.apiKey = options.apiKey ?? process.env.GUARDIAN_API_KEY
  }

  override isAvailable(): boolean {
    return Boolean(this.apiKey)
  }

  protected async fetchResult(
    subject: ResearchSubject,
    signal: AbortSignal
  ): Promise<RawFinding | null> {
    if (!this.apiKey) return null

    const query = `"${subject.name}" AND (profile OR interview OR "early life" OR childhood OR biography)`

    const url = new URL(GUARDIAN_API_URL)
    url.searchParams.set("api-key", this.apiKey)
    url.searchParams.set("q", query)
    url.searchParams.set("show-fields", "bodyText,standfirst,trailText")
    url.searchParams.set("page-size", "10")
    url.searchParams.set("order-by", "relevance")

    const response = await fetch(url.toString(), { signal })

    if (!response.ok) {
      throw new Error(`Guardian API error: HTTP ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as GuardianApiResponse

    if (!data.response?.results?.length) return null

    // Pick best article by biographical keyword matching
    const article = this.findBestArticle(data.response.results)
    if (!article) return null

    const text = article.fields?.bodyText || article.fields?.standfirst || article.fields?.trailText
    if (!text || text.length < 200) return null

    const sanitized = sanitizeSourceText(text)
    if (sanitized.length < 200) return null

    return {
      text: sanitized,
      confidence: -1,
      costUsd: 0,
      url: article.webUrl,
      publication: "The Guardian",
      metadata: {
        title: article.webTitle,
      },
    }
  }

  /**
   * Find the best article from Guardian search results.
   *
   * Priority:
   * 1. Article with a bio keyword in the title
   * 2. Article with a bio keyword in the body/standfirst
   * 3. First result as fallback
   */
  private findBestArticle(results: GuardianArticle[]): GuardianArticle | undefined {
    // First: match by title
    for (const result of results) {
      const title = result.webTitle.toLowerCase()
      if (BIO_KEYWORDS.some((kw) => title.includes(kw))) {
        return result
      }
    }

    // Second: match by body text
    for (const result of results) {
      const body = (result.fields?.bodyText || result.fields?.standfirst || "").toLowerCase()
      if (BIO_KEYWORDS.some((kw) => body.includes(kw))) {
        return result
      }
    }

    // Fallback: first result
    return results[0]
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a Guardian API source instance.
 *
 * @param options - Guardian-specific options (apiKey, rateLimitMs, etc.)
 * @returns A configured GuardianSource
 */
export function guardian(options?: GuardianOptions): GuardianSource {
  return new GuardianSource(options)
}
