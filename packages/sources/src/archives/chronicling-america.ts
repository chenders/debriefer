/**
 * Chronicling America (Library of Congress) source.
 *
 * Queries the Library of Congress Chronicling America digital newspaper
 * archive for historical newspaper articles about a research subject.
 * No authentication required.
 */

import {
  BaseResearchSource,
  ReliabilityTier,
  type BaseSourceOptions,
  type ResearchSubject,
  type RawFinding,
} from "@debriefer/core"
import { sanitizeSourceText } from "../shared/sanitize-text.js"

// ============================================================================
// Constants
// ============================================================================

const LOC_API_URL = "https://www.loc.gov/collections/chronicling-america/"

// ============================================================================
// Types
// ============================================================================

export type ChroniclingAmericaOptions = BaseSourceOptions

/** Shape of a single result from the LOC API. */
interface LocResult {
  title?: string
  description?: string[]
  date?: string
  url?: string
}

/** Shape of the LOC API response. */
interface LocApiResponse {
  results?: LocResult[]
}

// ============================================================================
// ChroniclingAmericaSource
// ============================================================================

/**
 * Research source backed by the Library of Congress Chronicling America API.
 *
 * Searches historical digitized US newspapers for mentions of a subject.
 * Free, no API key required.
 */
export class ChroniclingAmericaSource extends BaseResearchSource<ResearchSubject> {
  readonly name = "Chronicling America"
  readonly type = "chronicling-america"
  readonly reliabilityTier = ReliabilityTier.ARCHIVAL
  readonly domain = "www.loc.gov"
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  constructor(options: ChroniclingAmericaOptions = {}) {
    super({ rateLimitMs: 1000, ...options })
  }

  protected async fetchResult(
    subject: ResearchSubject,
    signal: AbortSignal
  ): Promise<RawFinding | null> {
    const url = new URL(LOC_API_URL)
    url.searchParams.set("q", `"${subject.name}"`)
    url.searchParams.set("fo", "json")
    url.searchParams.set("c", "5")

    const response = await fetch(url.toString(), { signal })

    if (!response.ok) {
      throw new Error(
        `Chronicling America API error: HTTP ${response.status} ${response.statusText}`
      )
    }

    const data = (await response.json()) as LocApiResponse

    if (!data.results?.length) return null

    // Combine title + description from all results
    const parts: string[] = []
    for (const result of data.results) {
      if (result.title) parts.push(result.title)
      if (result.description?.length) {
        parts.push(result.description.join(" "))
      }
    }

    const text = parts.join("\n\n")
    if (!text.trim()) return null

    const sanitized = sanitizeSourceText(text)
    if (!sanitized) return null

    const firstWithUrl = data.results.find((r) => r.url)

    return {
      text: sanitized,
      confidence: -1,
      costUsd: 0,
      url: firstWithUrl?.url,
      publication: "Chronicling America (Library of Congress)",
      metadata: {
        title: data.results[0]?.title ?? "",
      },
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a Chronicling America source instance.
 *
 * @param options - Source options (rateLimitMs, etc.)
 * @returns A configured ChroniclingAmericaSource
 */
export function chroniclingAmerica(options?: ChroniclingAmericaOptions): ChroniclingAmericaSource {
  return new ChroniclingAmericaSource(options)
}
