import { ReliabilityTier } from "debriefer"
import { WebSearchBase, type WebSearchOptions, type WebSearchResult } from "./base.js"

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"

export interface BraveSearchOptions extends WebSearchOptions {
  apiKey?: string // default: process.env.BRAVE_SEARCH_API_KEY
  maxResults?: number // default: 20
}

export class BraveSearchSource extends WebSearchBase {
  readonly name = "Brave Search"
  readonly type = "brave-search"
  readonly reliabilityTier = ReliabilityTier.SEARCH_AGGREGATOR
  readonly domain = "api.search.brave.com"
  readonly isFree = false
  readonly estimatedCostPerQuery = 0.005

  private apiKey: string | undefined
  private maxResults: number

  constructor(options: BraveSearchOptions = {}) {
    super({ rateLimitMs: 500, ...options })
    this.apiKey = options.apiKey ?? process.env.BRAVE_SEARCH_API_KEY
    this.maxResults = options.maxResults ?? 20
  }

  override isAvailable(): boolean {
    return Boolean(this.apiKey)
  }

  protected async performSearch(query: string, signal: AbortSignal): Promise<WebSearchResult[]> {
    if (!this.apiKey) return []

    const url = `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(query)}&count=${this.maxResults}&search_lang=en`

    const response = await fetch(url, {
      headers: {
        "X-Subscription-Token": this.apiKey,
        Accept: "application/json",
      },
      signal,
    })

    if (!response.ok) {
      throw new Error(`Brave Search error: HTTP ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as {
      web?: { results: Array<{ title: string; url: string; description: string }> }
      news?: { results: Array<{ title: string; url: string; description: string }> }
    }

    const results: WebSearchResult[] = []
    const seenUrls = new Set<string>()

    for (const item of data.web?.results ?? []) {
      if (seenUrls.has(item.url)) continue
      seenUrls.add(item.url)
      results.push({ url: item.url, title: item.title, snippet: item.description })
    }

    for (const item of data.news?.results ?? []) {
      if (seenUrls.has(item.url)) continue
      seenUrls.add(item.url)
      results.push({ url: item.url, title: item.title, snippet: item.description })
    }

    return results
  }
}

export function braveSearch(options?: BraveSearchOptions): BraveSearchSource {
  return new BraveSearchSource(options)
}
