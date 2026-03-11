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

/**
 * Async section filter that receives all sections and the full article text.
 * Returns a promise resolving to the sections to include.
 * Takes precedence over the sync `sectionFilter` when both are provided.
 */
export type AsyncSectionFilter = (
  sections: WikipediaSection[],
  articleText: string
) => Promise<WikipediaSection[]>

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
   * Async section filter. Receives all sections and the full article text,
   * returns a promise of which sections to include. Takes precedence over
   * the sync `sectionFilter`. Useful for AI-based section selection.
   *
   * @example
   * ```typescript
   * asyncSectionFilter: async (sections, articleText) => {
   *   const selected = await geminiSelectSections(sections, articleText)
   *   return selected
   * }
   * ```
   */
  asyncSectionFilter?: AsyncSectionFilter

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
   * Validate that the fetched article matches the intended person.
   * Receives the full article text and the subject. When provided and
   * returns false, the source tries disambiguation suffixes before giving up.
   *
   * @example
   * ```typescript
   * validatePerson: (articleText, subject) => {
   *   const birthYear = subject.context?.birthYear as string
   *   return birthYear ? articleText.includes(birthYear) : true
   * }
   * ```
   */
  validatePerson?: (articleText: string, subject: ResearchSubject) => boolean
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
  private asyncSectionFilter?: AsyncSectionFilter
  private includeIntro: boolean
  private handleDisambiguation: boolean
  private disambiguationSuffixes: string[]
  private validatePerson?: (articleText: string, subject: ResearchSubject) => boolean

  constructor(options: WikipediaOptions = {}) {
    super({ rateLimitMs: 500, ...options })
    this.sectionFilter = options.sectionFilter ?? defaultSectionFilter
    this.asyncSectionFilter = options.asyncSectionFilter
    this.includeIntro = options.includeIntro ?? true
    this.handleDisambiguation = options.handleDisambiguation ?? true
    this.disambiguationSuffixes = options.disambiguationSuffixes ?? ["_(actor)", "_(actress)"]
    this.validatePerson = options.validatePerson
  }

  protected async fetchResult(
    subject: ResearchSubject,
    // Note: wtf_wikipedia.fetch() does not accept an AbortSignal.
    // The base class timeout/abort still applies to the overall lookup()
    // call, but the underlying HTTP request cannot be cancelled mid-flight.
    _signal: AbortSignal
  ): Promise<RawFinding | null> {
    const baseTitle = subject.name.replace(/ /g, "_")

    // Try the base title first
    let doc = await this.fetchDocument(baseTitle)

    // Handle disambiguation pages
    if (this.handleDisambiguation && (!doc || this.isDisambig(doc))) {
      doc = await this.tryDisambiguationSuffixes(baseTitle, doc)
    }

    // If we still have no valid document, return null
    if (!doc || this.isDisambig(doc)) return null

    // Validate person if callback is provided.
    // Track fullText so we can reuse it for asyncSectionFilter without recomputing.
    let cachedFullText: string | undefined
    if (this.validatePerson) {
      cachedFullText = this.getFullText(doc)
      if (!this.validatePerson(cachedFullText, subject)) {
        // Validation failed — try disambiguation suffixes if enabled
        if (!this.handleDisambiguation) return null
        const altDoc = await this.tryDisambiguationSuffixes(baseTitle, null)
        if (!altDoc || this.isDisambig(altDoc)) return null
        // Validate the alternate document too
        const altText = this.getFullText(altDoc)
        if (!this.validatePerson(altText, subject)) return null
        doc = altDoc
        cachedFullText = altText
      }
    }

    const sections = doc.sections() as wtf.Section[]
    if (sections.length === 0) return null

    // Reuse cached full text from validation, or compute once for async filter
    const fullText = this.asyncSectionFilter ? (cachedFullText ?? this.getFullText(doc)) : undefined

    // Map wtf sections to WikipediaSection interface
    const wikiSections: WikipediaSection[] = sections.map((s: wtf.Section, i: number) => ({
      index: i,
      title: s.title() || "Introduction",
      depth: s.depth(),
    }))

    // Apply section filter — async takes precedence over sync
    const selectedSections = this.asyncSectionFilter
      ? await this.asyncSectionFilter(wikiSections, fullText!)
      : this.sectionFilter(wikiSections)

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
    const confidence = this.calculateContentConfidence(combinedText, subject, sectionTexts.length)

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
   * Includes option-derived key material so different WikipediaSource instances
   * with different sectionFilter/includeIntro options don't collide in cache.
   */
  override buildQuery(subject: ResearchSubject): string {
    const parts = [subject.name]
    if (this.asyncSectionFilter) parts.push("sections:async")
    else if (this.sectionFilter !== defaultSectionFilter) parts.push("sections:custom")
    if (this.includeIntro === false) parts.push("no-intro")
    if (this.validatePerson) parts.push("validate:person")
    if (!this.handleDisambiguation) parts.push("disambig:off")
    if (this.disambiguationSuffixes.length > 0) {
      parts.push(`suffixes:${this.disambiguationSuffixes.join(",")}`)
    }
    return parts.join("|")
  }

  /**
   * Fetch a Wikipedia document using wtf_wikipedia.
   * Returns null if the article doesn't exist. Lets other errors propagate
   * so BaseResearchSource.lookup() can record them via telemetry.
   */
  private async fetchDocument(title: string): Promise<InstanceType<typeof wtf.Document> | null> {
    const doc = await wtf.fetch(title)
    return (doc as InstanceType<typeof wtf.Document> | null) ?? null
  }

  /**
   * Check if a document is a disambiguation page.
   */
  private isDisambig(doc: InstanceType<typeof wtf.Document>): boolean {
    return doc.isDisambiguation()
  }

  /**
   * Try disambiguation suffixes to find a valid (non-disambiguation) article.
   * Returns the first valid document found, or the provided fallback if none match.
   */
  private async tryDisambiguationSuffixes(
    baseTitle: string,
    fallback: InstanceType<typeof wtf.Document> | null
  ): Promise<InstanceType<typeof wtf.Document> | null> {
    for (const suffix of this.disambiguationSuffixes) {
      const altTitle = baseTitle + suffix
      const altDoc = await this.fetchDocument(altTitle)
      if (altDoc && !this.isDisambig(altDoc)) {
        return altDoc
      }
    }
    return fallback
  }

  /**
   * Extract full plaintext from a document for validation and async filtering.
   */
  private getFullText(doc: InstanceType<typeof wtf.Document>): string {
    const sections = doc.sections() as wtf.Section[]
    return sections.map((s: wtf.Section) => s.text({})).join("\n\n")
  }

  /**
   * Calculate content confidence based on text length and subject name presence.
   * Returns a score between 0.3 and 0.9.
   */
  private calculateContentConfidence(
    text: string,
    subject: ResearchSubject,
    sectionCount: number
  ): number {
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

    // If keywords are configured, delegate to the base class keyword-based
    // confidence calculation instead of using our content heuristics.
    // The base class checks for confidence === -1 as the delegation signal.
    if (this.options.requiredKeywords && this.options.requiredKeywords.length > 0) {
      return -1 // DELEGATE_TO_BASE_CLASS: base-source.ts:150 replaces with keyword confidence
    }

    // Section count bonus — use actual extracted section count, not regex on text
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
