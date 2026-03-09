/**
 * Open Library search source.
 *
 * Queries the Open Library Search API for books matching the research
 * subject. Returns book metadata (title, authors, publication year)
 * as a finding. No API key required.
 *
 * https://openlibrary.org/dev/docs/api/search
 */

import {
  BaseResearchSource,
  ReliabilityTier,
  type BaseSourceOptions,
  type ResearchSubject,
  type RawFinding,
} from "debriefer"

// ============================================================================
// Constants
// ============================================================================

const OPEN_LIBRARY_SEARCH_URL = "https://openlibrary.org/search.json"

// ============================================================================
// Types
// ============================================================================

export type OpenLibraryOptions = BaseSourceOptions

/** Shape of a single document from the Open Library Search API. */
interface OpenLibraryDoc {
  key?: string
  title?: string
  author_name?: string[]
  first_publish_year?: number
  ia?: string[]
}

/** Shape of the Open Library Search API response. */
interface OpenLibrarySearchResponse {
  numFound: number
  docs: OpenLibraryDoc[]
}

// ============================================================================
// OpenLibrarySource
// ============================================================================

/**
 * Research source backed by the Open Library Search API.
 *
 * Searches for books about a subject, picks the first result with
 * a title and author, and returns a combined attribution string
 * as the finding text.
 */
export class OpenLibrarySource extends BaseResearchSource<ResearchSubject> {
  readonly name = "Open Library"
  readonly type = "open-library"
  readonly reliabilityTier = ReliabilityTier.SECONDARY_COMPILATION
  readonly domain = "openlibrary.org"
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  constructor(options: OpenLibraryOptions = {}) {
    super({ rateLimitMs: 350, ...options })
  }

  override isAvailable(): boolean {
    return true
  }

  protected async fetchResult(
    subject: ResearchSubject,
    signal: AbortSignal
  ): Promise<RawFinding | null> {
    const query = `"${subject.name}" biography`

    const url = new URL(OPEN_LIBRARY_SEARCH_URL)
    url.searchParams.set("q", query)
    url.searchParams.set("limit", "5")

    const response = await fetch(url.toString(), { signal })

    if (!response.ok) {
      throw new Error(`Open Library API error: HTTP ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as OpenLibrarySearchResponse

    if (!data.docs?.length) return null

    // Pick the first doc with a title
    const doc = data.docs.find((d) => d.title)
    if (!doc) return null

    const text = this.buildText(doc)
    if (!text) return null

    const docUrl = doc.key ? `https://openlibrary.org${doc.key}` : undefined

    return {
      text,
      confidence: -1,
      costUsd: 0,
      url: docUrl,
      publication: "Open Library",
      metadata: {
        title: doc.title,
        authors: doc.author_name,
        firstPublishYear: doc.first_publish_year,
      },
    }
  }

  /**
   * Build attribution text from an Open Library document.
   *
   * Combines title, author names, and publication year into a
   * human-readable string.
   */
  private buildText(doc: OpenLibraryDoc): string | null {
    const parts: string[] = []

    if (doc.title) {
      parts.push(doc.title)
    }

    if (doc.author_name?.length) {
      parts.push(`by ${doc.author_name.join(", ")}`)
    }

    if (doc.first_publish_year) {
      parts.push(`(${doc.first_publish_year})`)
    }

    return parts.length > 0 ? parts.join(" ") : null
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an Open Library source instance.
 *
 * @param options - Open Library-specific options (rateLimitMs, etc.)
 * @returns A configured OpenLibrarySource
 */
export function openLibrary(options?: OpenLibraryOptions): OpenLibrarySource {
  return new OpenLibrarySource(options)
}
