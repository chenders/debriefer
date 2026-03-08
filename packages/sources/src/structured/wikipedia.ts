/**
 * Generic Wikipedia source for encyclopedia content.
 *
 * Uses `wtf_wikipedia` to fetch and parse Wikipedia articles, producing clean
 * plaintext with no citation markers, footnotes, or HTML artifacts.
 *
 * Domain-agnostic: consumers customize which sections to extract via the
 * `sectionFilter` option. Default returns all sections. Common use cases:
 * - Death research: filter for "Death", "Health", "Illness" sections
 * - Biography research: filter for "Early life", "Personal life" sections
 * - General research: return all sections (default)
 *
 * Handles disambiguation pages by trying alternate titles with common suffixes.
 */

import wtf from "wtf_wikipedia"

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

const MIN_SECTION_LENGTH = 50
const DEFAULT_USER_AGENT = "debriefer/0.1.0 (https://github.com/chenders/debriefer)"

// ============================================================================
// Types
// ============================================================================

/** Metadata about a Wikipedia article section */
export interface WikipediaSection {
  /** Section index within the article */
  index: number
  /** Section title (e.g., "Early life", "Death") */
  title: string
  /** Depth level (0 = top-level, 1 = subsection, etc.) */
  depth: number
}

/**
 * Function that filters Wikipedia sections to determine which to include.
 * Receives all sections and returns the ones that should be extracted.
 */
export type SectionFilter = (sections: WikipediaSection[]) => WikipediaSection[]

/** Options for the Wikipedia source */
export interface WikipediaOptions extends BaseSourceOptions {
  /**
   * Custom section filter. Receives all article sections, returns the ones
   * to extract. Default: return all sections.
   *
   * @example
   * ```typescript
   * // Only extract death-related sections
   * sectionFilter: (sections) => sections.filter(s =>
   *   /death|illness|health|assassination/i.test(s.title)
   * )
   * ```
   */
  sectionFilter?: SectionFilter

  /**
   * Whether to include the article introduction (section 0).
   * Default: true.
   */
  includeIntro?: boolean

  /**
   * Whether to handle disambiguation pages by trying alternate titles.
   * Default: true.
   */
  handleDisambiguation?: boolean

  /**
   * Alternate title suffixes to try if the article is a disambiguation page
   * or not found. Default: ["_(actor)", "_(actress)"].
   * Set to an empty array to disable alternate title attempts.
   */
  disambiguationSuffixes?: string[]

  /**
   * User-Agent string for Wikipedia API requests.
   */
  userAgent?: string
}

// ============================================================================
// Default Section Filter
// ============================================================================

/**
 * Default section filter: returns all sections.
 */
function defaultSectionFilter(sections: WikipediaSection[]): WikipediaSection[] {
  return sections
}

// ============================================================================
// Source Implementation
// ============================================================================

/**
 * Wikipedia source for encyclopedia article content.
 *
 * Fetches Wikipedia articles via `wtf_wikipedia`, extracts sections based
 * on a configurable filter, and returns clean plaintext content as a RawFinding.
 */
export class WikipediaSource extends BaseResearchSource<ResearchSubject> {
  readonly name = "Wikipedia"
  readonly type = "wikipedia"
  readonly reliabilityTier = ReliabilityTier.SECONDARY_COMPILATION
  readonly domain = "en.wikipedia.org"
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  private sectionFilter: SectionFilter
  private includeIntro: boolean
  private handleDisambiguation: boolean
  private disambiguationSuffixes: string[]
  private userAgent: string

  constructor(options: WikipediaOptions = {}) {
    super({ rateLimitMs: 500, ...options })
    this.sectionFilter = options.sectionFilter ?? defaultSectionFilter
    this.includeIntro = options.includeIntro ?? true
    this.handleDisambiguation = options.handleDisambiguation ?? true
    this.disambiguationSuffixes = options.disambiguationSuffixes ?? ["_(actor)", "_(actress)"]
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT
  }

  protected async fetchResult(
    subject: ResearchSubject,
    _signal: AbortSignal
  ): Promise<RawFinding | null> {
    const baseTitle = subject.name.replace(/ /g, "_")

    // Try the base title first
    let doc = await this.fetchDocument(baseTitle)

    // Handle disambiguation pages
    if (this.handleDisambiguation && (!doc || this.isDisambig(doc))) {
      for (const suffix of this.disambiguationSuffixes) {
        const altTitle = baseTitle + suffix
        const altDoc = await this.fetchDocument(altTitle)
        if (altDoc && !this.isDisambig(altDoc)) {
          doc = altDoc
          break
        }
      }
    }

    // If we still have no valid document, return null
    if (!doc || this.isDisambig(doc)) return null

    const sections = doc.sections() as wtf.Section[]
    if (sections.length === 0) return null

    // Map wtf sections to WikipediaSection interface
    const wikiSections: WikipediaSection[] = sections.map((s: wtf.Section, i: number) => ({
      index: i,
      title: s.title() || "Introduction",
      depth: s.depth(),
    }))

    // Apply section filter
    const selectedSections = this.sectionFilter(wikiSections)

    // Build the set of section indices to extract
    const indicesToExtract = new Set(selectedSections.map((s) => s.index))

    // Always include intro if configured and not already in the filter result
    if (this.includeIntro && !indicesToExtract.has(0)) {
      indicesToExtract.add(0)
    }

    // If nothing to extract (filter returned empty and intro disabled), return null
    if (indicesToExtract.size === 0) return null

    // Extract text from selected sections
    const sectionTexts: string[] = []
    const extractedTitles: string[] = []

    // Sort indices for consistent output order (article order)
    const sortedIndices = [...indicesToExtract].sort((a, b) => a - b)

    for (const idx of sortedIndices) {
      const section = sections[idx] as wtf.Section | undefined
      if (!section) continue

      const title = section.title() || "Introduction"
      const text = section.text({})

      if (text && text.length >= MIN_SECTION_LENGTH) {
        sectionTexts.push(`[${title}] ${text}`)
        extractedTitles.push(title)
      }
    }

    if (sectionTexts.length === 0) return null

    const combinedText = sectionTexts.join("\n\n")
    const resolvedTitle = doc.title() || baseTitle.replace(/_/g, " ")
    const resolvedUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(resolvedTitle.replace(/ /g, "_"))}`

    // Calculate confidence based on content quality
    const confidence = this.calculateContentConfidence(combinedText, subject)

    return {
      text: combinedText,
      confidence,
      costUsd: 0,
      url: resolvedUrl,
      publication: "Wikipedia",
      articleTitle: resolvedTitle,
      metadata: {
        sectionCount: sectionTexts.length,
        sectionTitles: extractedTitles,
        textLength: combinedText.length,
      },
    }
  }

  /**
   * Build the search query for cache key generation.
   */
  override buildQuery(subject: ResearchSubject): string {
    return subject.name
  }

  /**
   * Fetch a Wikipedia document using wtf_wikipedia.
   * Returns null if the article doesn't exist or an error occurs.
   */
  private async fetchDocument(title: string): Promise<InstanceType<typeof wtf.Document> | null> {
    try {
      const doc = await wtf.fetch(title)
      return (doc as InstanceType<typeof wtf.Document> | null) ?? null
    } catch {
      return null
    }
  }

  /**
   * Check if a document is a disambiguation page.
   */
  private isDisambig(doc: InstanceType<typeof wtf.Document>): boolean {
    return doc.isDisambiguation()
  }

  /**
   * Calculate content confidence based on text length and subject name presence.
   * Returns a score between 0.3 and 0.9.
   */
  private calculateContentConfidence(text: string, subject: ResearchSubject): number {
    let confidence = 0.4

    // Name presence
    if (text.toLowerCase().includes(subject.name.toLowerCase())) {
      confidence += 0.1
    }

    // Content length
    if (text.length > 500) {
      confidence += 0.2
    } else if (text.length > 200) {
      confidence += 0.1
    }

    // If keywords are configured, use the base class keyword confidence
    // Otherwise, give a moderate boost for having multiple sections
    if (this.options.requiredKeywords) {
      // Let the base class handle keyword-based confidence
      // Return -1 to signal that
      return -1
    }

    // Section count bonus
    const sectionCount = (text.match(/\[.*?\]/g) ?? []).length
    if (sectionCount > 1) {
      confidence += Math.min(0.2, sectionCount * 0.05)
    }

    return Math.min(0.9, confidence)
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a Wikipedia source instance.
 *
 * @example
 * ```typescript
 * // Default: all sections
 * const source = wikipedia()
 *
 * // Death research: only death-related sections
 * const deathSource = wikipedia({
 *   sectionFilter: (sections) => sections.filter(s =>
 *     /death|illness|health|assassination|final years/i.test(s.title)
 *   ),
 * })
 *
 * // Biography research: personal life sections
 * const bioSource = wikipedia({
 *   sectionFilter: (sections) => sections.filter(s =>
 *     /early life|personal|childhood|education|family/i.test(s.title)
 *   ),
 *   includeIntro: true,
 * })
 * ```
 */
export function wikipedia(options?: WikipediaOptions): WikipediaSource {
  return new WikipediaSource(options)
}
