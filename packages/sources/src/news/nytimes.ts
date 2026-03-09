/**
 * New York Times Article Search API source.
 *
 * Uses the NYT Article Search API v2 to find biographical/profile articles.
 * Unlike site-search sources that scrape full article text, the NYT API only
 * returns partial content (lead_paragraph, abstract, snippet), so confidence
 * is capped at 0.7 rather than delegating to base class keyword scoring.
 */

import {
  BaseResearchSource,
  ReliabilityTier,
  type BaseSourceOptions,
  type ResearchSubject,
  type RawFinding,
} from "debriefer"
import { sanitizeSourceText } from "../shared/sanitize-text.js"

const NYT_API_URL = "https://api.nytimes.com/svc/search/v2/articlesearch.json"

const BIO_KEYWORDS = [
  "profile",
  "interview",
  "early life",
  "childhood",
  "biography",
  "life of",
  "portrait",
  "who is",
  "growing up",
  "personal",
]

export interface NYTimesOptions extends BaseSourceOptions {
  apiKey?: string // default: process.env.NYTIMES_API_KEY
}

export class NYTimesSource extends BaseResearchSource<ResearchSubject> {
  readonly name = "The New York Times"
  readonly type = "nytimes"
  readonly reliabilityTier = ReliabilityTier.TIER_1_NEWS
  readonly domain = "api.nytimes.com"
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  private apiKey: string | undefined

  constructor(options: NYTimesOptions = {}) {
    super({ rateLimitMs: 6000, ...options })
    this.apiKey = options.apiKey ?? process.env.NYTIMES_API_KEY
  }

  override isAvailable(): boolean {
    return Boolean(this.apiKey)
  }

  protected async fetchResult(
    subject: ResearchSubject,
    signal: AbortSignal
  ): Promise<RawFinding | null> {
    if (!this.apiKey) return null

    const query = `"${subject.name}" (biography OR profile OR interview)`

    const url = new URL(NYT_API_URL)
    url.searchParams.set("api-key", this.apiKey)
    url.searchParams.set("q", query)
    url.searchParams.set("sort", "relevance")
    url.searchParams.set("fq", 'document_type:("article")')

    const response = await fetch(url.toString(), { signal })

    if (!response.ok) {
      throw new Error(`NYT API error: HTTP ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as {
      status: string
      response?: {
        docs?: Array<{
          web_url?: string
          headline?: { main?: string }
          lead_paragraph?: string
          abstract?: string
          snippet?: string
        }>
      }
    }

    if (!data.response?.docs?.length) return null

    // Filter out docs without URLs, then pick best article
    const docsWithUrls = data.response.docs.filter((d) => d.web_url)
    if (docsWithUrls.length === 0) return null

    const doc = this.findBestArticle(docsWithUrls)
    if (!doc) return null

    // Combine available text fields (NYT API doesn't return full body)
    const parts = [doc.lead_paragraph, doc.abstract, doc.snippet].filter(Boolean)
    const text = parts.join("\n\n")
    if (text.length < 100) return null

    const sanitized = sanitizeSourceText(text)
    if (sanitized.length < 100) return null

    // Cap confidence at 0.7 — NYT API returns partial content only
    return {
      text: sanitized,
      confidence: 0.7,
      costUsd: 0,
      url: doc.web_url,
      publication: "The New York Times",
      metadata: {
        title: doc.headline?.main ?? "",
      },
    }
  }

  private findBestArticle(
    docs: Array<{
      web_url?: string
      headline?: { main?: string }
      lead_paragraph?: string
      abstract?: string
      snippet?: string
    }>
  ): (typeof docs)[number] | undefined {
    // First: match by headline
    for (const doc of docs) {
      const title = (doc.headline?.main ?? "").toLowerCase()
      if (BIO_KEYWORDS.some((kw) => title.includes(kw))) {
        return doc
      }
    }

    // Second: match by abstract/snippet
    for (const doc of docs) {
      const body = `${doc.abstract ?? ""} ${doc.snippet ?? ""}`.toLowerCase()
      if (BIO_KEYWORDS.some((kw) => body.includes(kw))) {
        return doc
      }
    }

    // Fallback: first result
    return docs[0]
  }
}

export function nytimes(options?: NYTimesOptions): NYTimesSource {
  return new NYTimesSource(options)
}
