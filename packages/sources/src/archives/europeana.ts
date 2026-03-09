/**
 * Europeana source.
 *
 * Queries the Europeana Search API for cultural heritage records about
 * a research subject. Requires a free API key from Europeana.
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

const EUROPEANA_API_URL = "https://api.europeana.eu/record/v2/search.json"

// ============================================================================
// Types
// ============================================================================

export interface EuropeanaOptions extends BaseSourceOptions {
  /** Europeana API key. Defaults to process.env.EUROPEANA_API_KEY. */
  apiKey?: string
}

/** Shape of a single item from the Europeana Search API. */
interface EuropeanaItem {
  title?: string[]
  dcDescription?: string[]
  dcCreator?: string[]
  edmIsShownAt?: string[]
  guid?: string
}

/** Shape of the Europeana Search API response. */
interface EuropeanaApiResponse {
  items?: EuropeanaItem[]
}

// ============================================================================
// EuropeanaSource
// ============================================================================

/**
 * Research source backed by the Europeana Search API.
 *
 * Searches European cultural heritage collections for records about
 * a subject. Requires a free API key.
 */
export class EuropeanaSource extends BaseResearchSource<ResearchSubject> {
  readonly name = "Europeana"
  readonly type = "europeana"
  readonly reliabilityTier = ReliabilityTier.ARCHIVAL
  readonly domain = "api.europeana.eu"
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  private apiKey: string | undefined

  constructor(options: EuropeanaOptions = {}) {
    super({ rateLimitMs: 1000, ...options })
    this.apiKey = options.apiKey ?? process.env.EUROPEANA_API_KEY
  }

  override isAvailable(): boolean {
    return Boolean(this.apiKey)
  }

  protected async fetchResult(
    subject: ResearchSubject,
    signal: AbortSignal
  ): Promise<RawFinding | null> {
    if (!this.apiKey) return null

    const url = new URL(EUROPEANA_API_URL)
    url.searchParams.set("wskey", this.apiKey)
    url.searchParams.set("query", `"${subject.name}" biography`)
    url.searchParams.set("rows", "5")

    const response = await fetch(url.toString(), { signal })

    if (!response.ok) {
      throw new Error(`Europeana API error: HTTP ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as EuropeanaApiResponse

    if (!data.items?.length) return null

    // Combine title + description from all items
    const parts: string[] = []
    for (const item of data.items) {
      if (item.title?.length) parts.push(item.title.join(" "))
      if (item.dcDescription?.length) parts.push(item.dcDescription.join(" "))
    }

    const text = parts.join("\n\n")
    if (!text.trim()) return null

    const sanitized = sanitizeSourceText(text)
    if (!sanitized) return null

    // Use edmIsShownAt[0] or fall back to guid for URL
    const firstItem = data.items[0]
    const resultUrl = firstItem?.edmIsShownAt?.[0] ?? firstItem?.guid

    return {
      text: sanitized,
      confidence: -1,
      costUsd: 0,
      url: resultUrl,
      publication: "Europeana",
      metadata: {
        title: firstItem?.title?.[0] ?? "",
      },
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a Europeana source instance.
 *
 * @param options - Europeana-specific options (apiKey, rateLimitMs, etc.)
 * @returns A configured EuropeanaSource
 */
export function europeana(options?: EuropeanaOptions): EuropeanaSource {
  return new EuropeanaSource(options)
}
