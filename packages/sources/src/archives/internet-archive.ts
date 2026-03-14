/**
 * Internet Archive source.
 *
 * Queries the Internet Archive advanced search API for books, documents,
 * and media about a research subject. No authentication required.
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

const IA_API_URL = "https://archive.org/advancedsearch.php"
const IA_DETAILS_BASE = "https://archive.org/details/"

// ============================================================================
// Types
// ============================================================================

export type InternetArchiveOptions = BaseSourceOptions

/** Shape of a single doc from the Internet Archive API. */
interface IADoc {
  identifier?: string
  title?: string
  description?: string
  creator?: string
}

/** Shape of the Internet Archive API response. */
interface IAApiResponse {
  response?: {
    docs?: IADoc[]
  }
}

// ============================================================================
// InternetArchiveSource
// ============================================================================

/**
 * Research source backed by the Internet Archive advanced search API.
 *
 * Searches for books, documents, and media about a subject.
 * Free, no API key required.
 */
export class InternetArchiveSource extends BaseResearchSource<ResearchSubject> {
  readonly name = "Internet Archive"
  readonly type = "internet-archive"
  readonly reliabilityTier = ReliabilityTier.ARCHIVE_MIRROR
  readonly domain = "archive.org"
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  constructor(options: InternetArchiveOptions = {}) {
    super({ rateLimitMs: 1000, ...options })
  }

  protected async fetchResult(
    subject: ResearchSubject,
    signal: AbortSignal
  ): Promise<RawFinding | null> {
    const url = new URL(IA_API_URL)
    url.searchParams.set("q", `"${subject.name}" AND (biography OR memoir)`)
    url.searchParams.append("fl[]", "identifier")
    url.searchParams.append("fl[]", "title")
    url.searchParams.append("fl[]", "description")
    url.searchParams.append("fl[]", "creator")
    url.searchParams.append("sort[]", "downloads desc")
    url.searchParams.set("rows", "5")
    url.searchParams.set("output", "json")

    const response = await fetch(url.toString(), { signal })

    if (!response.ok) {
      throw new Error(`Internet Archive API error: HTTP ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as IAApiResponse

    if (!data.response?.docs?.length) return null

    // Combine title + description from all docs
    const parts: string[] = []
    for (const doc of data.response.docs) {
      if (doc.title) parts.push(doc.title)
      if (doc.description) parts.push(doc.description)
    }

    const text = parts.join("\n\n")
    if (!text.trim()) return null

    const sanitized = sanitizeSourceText(text)
    if (!sanitized) return null

    const firstDoc = data.response.docs[0]
    const resultUrl = firstDoc?.identifier ? `${IA_DETAILS_BASE}${firstDoc.identifier}` : undefined

    return {
      text: sanitized,
      confidence: -1,
      costUsd: 0,
      url: resultUrl,
      publication: "Internet Archive",
      metadata: {
        title: firstDoc?.title ?? "",
      },
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an Internet Archive source instance.
 *
 * @param options - Source options (rateLimitMs, etc.)
 * @returns A configured InternetArchiveSource
 */
export function internetArchive(options?: InternetArchiveOptions): InternetArchiveSource {
  return new InternetArchiveSource(options)
}
