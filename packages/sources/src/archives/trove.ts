/**
 * Trove (National Library of Australia) source.
 *
 * Queries the Trove API v3 for newspaper articles about a research subject.
 * Requires a free API key from the National Library of Australia.
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

const TROVE_API_URL = "https://api.trove.nla.gov.au/v3/result"

// ============================================================================
// Types
// ============================================================================

export interface TroveOptions extends BaseSourceOptions {
  /** Trove API key. Defaults to process.env.TROVE_API_KEY. */
  apiKey?: string
}

/** Shape of a single article from the Trove API. */
interface TroveArticle {
  heading?: string
  snippet?: string
  date?: string
  troveUrl?: string
}

/** Shape of a category in the Trove API response. */
interface TroveCategory {
  records?: {
    article?: TroveArticle[]
  }
}

/** Shape of the Trove API response. */
interface TroveApiResponse {
  category?: TroveCategory[]
}

// ============================================================================
// TroveSource
// ============================================================================

/**
 * Research source backed by the Trove API (National Library of Australia).
 *
 * Searches digitized Australian newspapers for biographical content
 * about a subject. Requires a free API key.
 */
export class TroveSource extends BaseResearchSource<ResearchSubject> {
  readonly name = "Trove"
  readonly type = "trove"
  readonly reliabilityTier = ReliabilityTier.ARCHIVAL
  readonly domain = "api.trove.nla.gov.au"
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  private apiKey: string | undefined

  constructor(options: TroveOptions = {}) {
    super({ rateLimitMs: 1000, ...options })
    this.apiKey = options.apiKey ?? process.env.TROVE_API_KEY
  }

  override isAvailable(): boolean {
    return Boolean(this.apiKey)
  }

  protected async fetchResult(
    subject: ResearchSubject,
    signal: AbortSignal
  ): Promise<RawFinding | null> {
    if (!this.apiKey) return null

    const url = new URL(TROVE_API_URL)
    url.searchParams.set("key", this.apiKey)
    url.searchParams.set("q", `"${subject.name}" biography`)
    url.searchParams.set("category", "newspaper")
    url.searchParams.set("encoding", "json")
    url.searchParams.set("n", "5")

    const response = await fetch(url.toString(), { signal })

    if (!response.ok) {
      throw new Error(`Trove API error: HTTP ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as TroveApiResponse

    const articles = data.category?.[0]?.records?.article
    if (!articles?.length) return null

    // Combine heading + cleaned snippet from all articles
    const parts: string[] = []
    for (const article of articles) {
      if (article.heading) parts.push(article.heading)
      if (article.snippet) {
        // Strip HTML tags from snippets
        const cleaned = article.snippet.replace(/<[^>]+>/g, "")
        if (cleaned.trim()) parts.push(cleaned)
      }
    }

    const text = parts.join("\n\n")
    if (!text.trim()) return null

    const sanitized = sanitizeSourceText(text)
    if (!sanitized) return null

    const firstWithUrl = articles.find((a) => a.troveUrl)

    return {
      text: sanitized,
      confidence: -1,
      costUsd: 0,
      url: firstWithUrl?.troveUrl,
      publication: "Trove (National Library of Australia)",
      metadata: {
        title: articles[0]?.heading ?? "",
      },
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a Trove source instance.
 *
 * @param options - Trove-specific options (apiKey, rateLimitMs, etc.)
 * @returns A configured TroveSource
 */
export function trove(options?: TroveOptions): TroveSource {
  return new TroveSource(options)
}
