/**
 * Google Books API source.
 *
 * Searches Google Books for volumes matching the research subject,
 * extracts text snippets and descriptions, and returns the best
 * match as a finding.
 *
 * Requires a Google Books API key (https://developers.google.com/books).
 */

import {
  BaseResearchSource,
  ReliabilityTier,
  type BaseSourceOptions,
  type ResearchSubject,
  type RawFinding,
} from "@debriefer/core"
import { decodeHtmlEntities } from "../shared/html-utils.js"
import { sanitizeSourceText } from "../shared/sanitize-text.js"

// ============================================================================
// Constants
// ============================================================================

const GOOGLE_BOOKS_API_URL = "https://www.googleapis.com/books/v1/volumes"

// ============================================================================
// Types
// ============================================================================

export interface GoogleBooksOptions extends BaseSourceOptions {
  /** Google Books API key. Defaults to process.env.GOOGLE_BOOKS_API_KEY. */
  apiKey?: string
}

/** Shape of a single volume from the Google Books API. */
interface GoogleBooksVolume {
  volumeInfo: {
    title?: string
    description?: string
    authors?: string[]
    publishedDate?: string
    infoLink?: string
  }
  searchInfo?: {
    textSnippet?: string
  }
}

/** Shape of the Google Books API response. */
interface GoogleBooksApiResponse {
  totalItems: number
  items?: GoogleBooksVolume[]
}

// ============================================================================
// GoogleBooksSource
// ============================================================================

/**
 * Research source backed by the Google Books API.
 *
 * Searches for volumes about a subject, picks the first item with
 * enough combined text (snippet + description), and returns the
 * sanitized result.
 */
export class GoogleBooksSource extends BaseResearchSource<ResearchSubject> {
  readonly name = "Google Books"
  readonly type = "google-books"
  readonly reliabilityTier = ReliabilityTier.SECONDARY_COMPILATION
  readonly domain = "www.googleapis.com"
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  private apiKey: string | undefined

  constructor(options: GoogleBooksOptions = {}) {
    super({ rateLimitMs: 1000, ...options })
    this.apiKey = options.apiKey ?? process.env.GOOGLE_BOOKS_API_KEY
  }

  override isAvailable(): boolean {
    return Boolean(this.apiKey)
  }

  protected async fetchResult(
    subject: ResearchSubject,
    signal: AbortSignal
  ): Promise<RawFinding | null> {
    if (!this.apiKey) return null

    const query = `"${subject.name}" biography`

    const url = new URL(GOOGLE_BOOKS_API_URL)
    url.searchParams.set("q", query)
    url.searchParams.set("key", this.apiKey)
    url.searchParams.set("maxResults", "5")

    const response = await fetch(url.toString(), { signal })

    if (!response.ok) {
      throw new Error(`Google Books API error: HTTP ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as GoogleBooksApiResponse

    if (!data.items?.length) return null

    // Pick first item with enough combined text
    for (const item of data.items) {
      const combined = this.extractText(item)
      if (combined.length >= 100) {
        const sanitized = sanitizeSourceText(combined)
        if (sanitized.length < 50) continue

        return {
          text: sanitized,
          confidence: -1,
          costUsd: 0,
          url: item.volumeInfo.infoLink,
          publication: "Google Books",
          metadata: {
            title: item.volumeInfo.title,
            authors: item.volumeInfo.authors,
            publishedDate: item.volumeInfo.publishedDate,
          },
        }
      }
    }

    return null
  }

  /**
   * Extract and combine text from a Google Books volume.
   *
   * Combines the text snippet (with HTML tags stripped and entities decoded)
   * and the description into a single string.
   */
  private extractText(item: GoogleBooksVolume): string {
    const parts: string[] = []

    if (item.searchInfo?.textSnippet) {
      // Strip <b> and other HTML tags, then decode entities
      const stripped = item.searchInfo.textSnippet.replace(/<[^>]+>/g, "")
      parts.push(decodeHtmlEntities(stripped))
    }

    if (item.volumeInfo.description) {
      parts.push(item.volumeInfo.description)
    }

    return parts.join(" ").trim()
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a Google Books API source instance.
 *
 * @param options - Google Books-specific options (apiKey, rateLimitMs, etc.)
 * @returns A configured GoogleBooksSource
 */
export function googleBooks(options?: GoogleBooksOptions): GoogleBooksSource {
  return new GoogleBooksSource(options)
}
