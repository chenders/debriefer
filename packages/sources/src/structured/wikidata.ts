/**
 * Generic Wikidata SPARQL source for structured data.
 *
 * Queries Wikidata's SPARQL endpoint to retrieve structured facts about
 * a research subject. Domain-agnostic: consumers customize the SPARQL query
 * via the `queryBuilder` option and control what properties to extract.
 *
 * Default query searches by name with an optional birth year filter,
 * returning basic identity properties (labels, descriptions, Wikipedia links).
 * Consumers can provide a custom `queryBuilder` for domain-specific properties
 * (e.g., cause of death P509, education P69, occupation P106).
 */

import { createHash } from "node:crypto"

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

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql"
const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 2000
const DEFAULT_USER_AGENT = "debriefer/0.1.0 (https://github.com/chenders/debriefer)"

// ============================================================================
// SPARQL Helpers
// ============================================================================

/**
 * Escape a string for use in a SPARQL string literal.
 * Escapes backslashes first, then double quotes, to prevent injection.
 */
export function escapeSparql(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
}

/**
 * Check if a Wikidata label value is valid (not a URL, blank node, or raw entity ID).
 * Wikidata sometimes returns genid URLs instead of actual labels when the value
 * is a complex statement or blank node.
 */
export function isValidLabel(value: string | undefined): value is string {
  if (!value) return false
  if (value.startsWith("http://") || value.startsWith("https://")) return false
  if (value.includes("genid")) return false
  if (/^Q\d+$/.test(value)) return false
  return true
}

/**
 * Get a valid label value or null if invalid.
 */
export function getValidLabel(value: string | undefined): string | null {
  return isValidLabel(value) ? value : null
}

/**
 * Filter a comma-separated string of labels, removing invalid entries.
 * Returns null if no valid labels remain.
 */
export function filterValidLabels(concatenated: string | undefined): string | null {
  if (!concatenated) return null
  const labels = concatenated.split(/\s*,\s*/).filter((label) => isValidLabel(label))
  return labels.length > 0 ? labels.join(", ") : null
}

// ============================================================================
// Types
// ============================================================================

/** A single binding (row) from a SPARQL response */
export interface SparqlBinding {
  [key: string]: { value: string; type?: string } | undefined
}

/** Standard SPARQL JSON response format */
export interface SparqlResponse {
  results: {
    bindings: SparqlBinding[]
  }
}

/**
 * Function that builds a SPARQL query for a given research subject.
 * The subject's `context` bag may contain domain-specific fields
 * (e.g., `birthYear`, `deathYear`) for more targeted queries.
 */
export type SparqlQueryBuilder = (subject: ResearchSubject) => string

/**
 * Function that parses SPARQL bindings into a text string and confidence score.
 * Returns null if no relevant data was found in the bindings.
 */
export type SparqlResultParser = (
  bindings: SparqlBinding[],
  subject: ResearchSubject
) => { text: string; confidence: number; metadata?: Record<string, unknown> } | null

/** Options for the Wikidata source */
export interface WikidataOptions extends BaseSourceOptions {
  /** Custom SPARQL query builder. Default searches by name. */
  queryBuilder?: SparqlQueryBuilder
  /** Custom result parser. Default formats all bindings as key: value text. */
  resultParser?: SparqlResultParser
  /** User-Agent string for Wikidata API requests. */
  userAgent?: string
  /** Maximum retries on 429/5xx responses (default: 3) */
  maxRetries?: number
}

// ============================================================================
// Default Query Builder
// ============================================================================

/**
 * Default SPARQL query builder that searches for a person by name.
 * If the subject context includes `birthYear`, filters by birth year for disambiguation.
 * Returns label, description, and English Wikipedia article link.
 */
function defaultQueryBuilder(subject: ResearchSubject): string {
  const escapedName = escapeSparql(subject.name)

  const rawBirthYear = subject.context?.birthYear
  const parsedBirthYear =
    typeof rawBirthYear === "number" && Number.isFinite(rawBirthYear)
      ? rawBirthYear
      : typeof rawBirthYear === "string"
        ? parseInt(rawBirthYear, 10)
        : undefined
  const validBirthYear =
    parsedBirthYear !== undefined && Number.isFinite(parsedBirthYear) ? parsedBirthYear : undefined

  const birthFilter = validBirthYear
    ? `?person wdt:P569 ?birthDate .
       FILTER(YEAR(?birthDate) = ${validBirthYear})`
    : ""

  return `
    SELECT ?person ?personLabel ?personDescription ?article
    WHERE {
      ?person wdt:P31 wd:Q5 .
      ?person rdfs:label "${escapedName}"@en .
      ${birthFilter}

      OPTIONAL {
        ?article schema:about ?person .
        ?article schema:isPartOf <https://en.wikipedia.org/> .
      }

      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 5
  `
}

// ============================================================================
// Default Result Parser
// ============================================================================

/**
 * Default result parser that extracts person label, description, and Wikipedia URL.
 * Formats them as plain text with a base confidence of 0.5.
 */
function defaultResultParser(
  bindings: SparqlBinding[],
  subject: ResearchSubject
): { text: string; confidence: number; metadata?: Record<string, unknown> } | null {
  if (bindings.length === 0) return null

  // Find the first binding whose label matches the subject name
  for (const binding of bindings) {
    const personName = binding.personLabel?.value ?? ""
    if (!isNameMatch(subject.name, personName)) continue

    const lines: string[] = []
    const label = getValidLabel(binding.personLabel?.value)
    const description = binding.personDescription?.value
    const articleUrl = binding.article?.value

    if (label) lines.push(`Name: ${label}`)
    if (description) lines.push(`Description: ${description}`)
    if (articleUrl) lines.push(`Wikipedia: ${articleUrl}`)

    // Add all other non-standard fields
    for (const [key, val] of Object.entries(binding)) {
      if (["person", "personLabel", "personDescription", "article"].includes(key)) continue
      const labelValue = getValidLabel(val?.value)
      if (labelValue) {
        const readableKey = key
          .replace(/Label$/, "")
          .replace(/([A-Z])/g, " $1")
          .trim()
        lines.push(`${readableKey}: ${labelValue}`)
      }
    }

    if (lines.length === 0) continue

    return {
      text: lines.join("\n"),
      confidence: 0.5 + Math.min(0.3, (lines.length - 1) * 0.1),
      metadata: { entityUrl: binding.person?.value, articleUrl },
    }
  }

  return null
}

// ============================================================================
// Name Matching
// ============================================================================

/**
 * Check if two names match, handling common variations.
 * Normalizes to lowercase ASCII and checks for exact match, substring
 * containment, or last-name + first-initial match.
 *
 * Note: Normalization strips non-ASCII characters (accents, diacritics),
 * which works for most Western names but may cause false matches for
 * names that differ only in diacritics.
 */
function isNameMatch(name1: string, name2: string): boolean {
  const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, "")
  const norm1 = normalize(name1)
  const norm2 = normalize(name2)

  if (norm1 === norm2) return true
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true

  // Last name + first initial match (avoids "John Smith" matching "Mary Smith")
  const parts1 = name1.toLowerCase().split(/\s+/)
  const parts2 = name2.toLowerCase().split(/\s+/)
  if (parts1.length < 2 || parts2.length < 2) return false
  const last1 = parts1[parts1.length - 1]
  const last2 = parts2[parts2.length - 1]
  if (last1 !== last2) return false

  // Require first initial to match
  return parts1[0]![0] === parts2[0]![0]
}

// ============================================================================
// Source Implementation
// ============================================================================

/**
 * Wikidata SPARQL source for structured research data.
 *
 * Queries Wikidata for structured facts about a subject. Consumers customize
 * what data is queried via `queryBuilder` and how results are parsed via
 * `resultParser`. Ships with sensible defaults that search by person name.
 */
export class WikidataSource extends BaseResearchSource<ResearchSubject> {
  readonly name = "Wikidata"
  readonly type = "wikidata"
  readonly reliabilityTier = ReliabilityTier.STRUCTURED_DATA
  readonly domain = "query.wikidata.org"
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  private queryBuilder: SparqlQueryBuilder
  private resultParser: SparqlResultParser
  private userAgent: string
  private maxRetries: number

  constructor(options: WikidataOptions = {}) {
    super({ rateLimitMs: 500, ...options })
    this.queryBuilder = options.queryBuilder ?? defaultQueryBuilder
    this.resultParser = options.resultParser ?? defaultResultParser
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT
    this.maxRetries = options.maxRetries ?? MAX_RETRIES
  }

  protected async fetchResult(
    subject: ResearchSubject,
    signal: AbortSignal
  ): Promise<RawFinding | null> {
    const query = this.queryBuilder(subject)

    const data = await this.fetchWithRetry(query, signal)
    if (!data) return null

    const parsed = this.resultParser(data.results.bindings, subject)
    if (!parsed) return null

    // Build URL — use Wikipedia article URL if available, otherwise Wikidata entity
    const entityUrl = parsed.metadata?.entityUrl as string | undefined
    const articleUrl = parsed.metadata?.articleUrl as string | undefined
    const url = articleUrl ?? entityUrl

    return {
      text: parsed.text,
      confidence: parsed.confidence,
      costUsd: 0,
      url,
      publication: "Wikidata",
      metadata: {
        ...parsed.metadata,
        sparqlQuery: query,
        bindingCount: data.results.bindings.length,
      },
    }
  }

  /**
   * Build the search query for cache key generation.
   * Uses the actual SPARQL query (truncated) so different queryBuilders
   * don't collide in cache. Falls back to name + birth year for the default builder.
   */
  override buildQuery(subject: ResearchSubject): string {
    if (this.queryBuilder !== defaultQueryBuilder) {
      // Custom queryBuilder: hash the full SPARQL query for a collision-resistant cache key
      const query = this.queryBuilder(subject)
      return createHash("sha256").update(query).digest("hex").slice(0, 16)
    }
    // Default builder: name + validated birth year (number or numeric string,
    // matching the same parsing logic used in defaultQueryBuilder)
    const rawBirthYear = subject.context?.birthYear
    let birthYear: number | undefined
    if (typeof rawBirthYear === "number" && Number.isFinite(rawBirthYear)) {
      birthYear = rawBirthYear
    } else if (typeof rawBirthYear === "string") {
      const parsed = parseInt(rawBirthYear, 10)
      if (Number.isFinite(parsed)) {
        birthYear = parsed
      }
    }
    return birthYear !== undefined ? `${subject.name}:${birthYear}` : subject.name
  }

  /**
   * Fetch SPARQL results with retry on 429/5xx responses.
   * Uses exponential backoff: 2s, 4s, 8s.
   */
  private async fetchWithRetry(query: string, signal: AbortSignal): Promise<SparqlResponse | null> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(`${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(query)}`, {
          headers: {
            Accept: "application/sparql-results+json",
            "User-Agent": this.userAgent,
          },
          signal,
        })

        if ((response.status === 429 || response.status >= 500) && attempt < this.maxRetries) {
          if (signal.aborted) throw new DOMException("Aborted", "AbortError")
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => {
              clearTimeout(timer)
              reject(signal.reason)
            }
            const timer = setTimeout(() => {
              signal.removeEventListener("abort", onAbort)
              resolve()
            }, delay)
            signal.addEventListener("abort", onAbort, { once: true })
          })
          continue
        }

        if (!response.ok) {
          // 404 = subject not found, return null. Other errors should propagate
          // for telemetry recording via BaseResearchSource.lookup()
          if (response.status === 404) return null
          throw new Error(
            `Wikidata SPARQL request failed: ${response.status} ${response.statusText}`
          )
        }

        return (await response.json()) as SparqlResponse
      } catch (error) {
        // Don't retry abort errors
        if (error instanceof DOMException && error.name === "AbortError") throw error
        if (signal.aborted) throw new DOMException("Aborted", "AbortError")

        if (attempt < this.maxRetries) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => {
              clearTimeout(timer)
              reject(signal.reason)
            }
            const timer = setTimeout(() => {
              signal.removeEventListener("abort", onAbort)
              resolve()
            }, delay)
            signal.addEventListener("abort", onAbort, { once: true })
          })
          continue
        }
        throw error
      }
    }
    return null
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a Wikidata SPARQL source instance.
 *
 * @example
 * ```typescript
 * // Default: search by name, return basic info
 * const source = wikidata()
 *
 * // Custom: death-specific query
 * const deathSource = wikidata({
 *   queryBuilder: (subject) => {
 *     const name = escapeSparql(subject.name)
 *     const deathYear = subject.context?.deathYear as number
 *     return `SELECT ... WHERE { ... }`
 *   },
 *   resultParser: (bindings, subject) => {
 *     // Extract cause of death, manner, location...
 *     return { text: "...", confidence: 0.8 }
 *   },
 * })
 * ```
 */
export function wikidata(options?: WikidataOptions): WikidataSource {
  return new WikidataSource(options)
}
