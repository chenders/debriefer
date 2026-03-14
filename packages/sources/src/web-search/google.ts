import { ReliabilityTier } from "@debriefer/core"
import { WebSearchBase, type WebSearchOptions, type WebSearchResult } from "./base.js"

const GOOGLE_CSE_URL = "https://www.googleapis.com/customsearch/v1"

export interface GoogleSearchOptions extends WebSearchOptions {
  apiKey?: string // default: process.env.GOOGLE_SEARCH_API_KEY
  cx?: string // default: process.env.GOOGLE_SEARCH_CX
  /** Number of results (1–10, Google CSE limit). Default: 10. */
  maxResults?: number
}

export class GoogleSearchSource extends WebSearchBase {
  readonly name = "Google Search"
  readonly type = "google-search"
  readonly reliabilityTier = ReliabilityTier.SEARCH_AGGREGATOR
  readonly domain = "www.googleapis.com"
  readonly isFree = false
  readonly estimatedCostPerQuery = 0.005

  private apiKey: string | undefined
  private cx: string | undefined
  private maxResults: number

  constructor(options: GoogleSearchOptions = {}) {
    super({ rateLimitMs: 500, ...options })
    this.apiKey = options.apiKey ?? process.env.GOOGLE_SEARCH_API_KEY
    this.cx = options.cx ?? process.env.GOOGLE_SEARCH_CX
    this.maxResults = Math.min(Math.max(options.maxResults ?? 10, 1), 10)
  }

  override isAvailable(): boolean {
    return Boolean(this.apiKey && this.cx)
  }

  protected async performSearch(query: string, signal: AbortSignal): Promise<WebSearchResult[]> {
    if (!this.apiKey || !this.cx) return []

    const url = new URL(GOOGLE_CSE_URL)
    url.searchParams.set("key", this.apiKey)
    url.searchParams.set("cx", this.cx)
    url.searchParams.set("q", query)
    url.searchParams.set("num", String(this.maxResults))

    const response = await fetch(url.toString(), { signal })

    if (!response.ok) {
      throw new Error(`Google CSE error: HTTP ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as {
      items?: Array<{ title: string; link: string; snippet: string }>
    }

    if (!data.items || data.items.length === 0) return []

    return data.items.map((item) => ({
      url: item.link,
      title: item.title,
      snippet: item.snippet,
    }))
  }
}

export function googleSearch(options?: GoogleSearchOptions): GoogleSearchSource {
  return new GoogleSearchSource(options)
}
