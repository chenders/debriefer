import { ReliabilityTier } from "debriefer"
import { WebSearchBase, type WebSearchOptions, type WebSearchResult } from "./base.js"

const BING_SEARCH_URL = "https://api.bing.microsoft.com/v7.0/search"

export interface BingSearchOptions extends WebSearchOptions {
  apiKey?: string    // default: process.env.BING_SEARCH_API_KEY
  maxResults?: number // default: 20
}

export class BingSearchSource extends WebSearchBase {
  readonly name = "Bing Search"
  readonly type = "bing-search"
  readonly reliabilityTier = ReliabilityTier.SEARCH_AGGREGATOR
  readonly domain = "api.bing.microsoft.com"
  readonly isFree = false
  readonly estimatedCostPerQuery = 0.003

  private apiKey: string | undefined
  private maxResults: number

  constructor(options: BingSearchOptions = {}) {
    super({ rateLimitMs: 500, ...options })
    this.apiKey = options.apiKey ?? process.env.BING_SEARCH_API_KEY
    this.maxResults = options.maxResults ?? 20
  }

  override isAvailable(): boolean {
    return Boolean(this.apiKey)
  }

  protected async performSearch(query: string, signal: AbortSignal): Promise<WebSearchResult[]> {
    if (!this.apiKey) return []

    const url = `${BING_SEARCH_URL}?q=${encodeURIComponent(query)}&count=${this.maxResults}&mkt=en-US&responseFilter=Webpages,News`

    const response = await fetch(url, {
      headers: { "Ocp-Apim-Subscription-Key": this.apiKey },
      signal,
    })

    if (!response.ok) {
      throw new Error(`Bing Search error: HTTP ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as {
      webPages?: { value: Array<{ name: string; url: string; snippet: string }> }
      news?: { value: Array<{ name: string; url: string; description: string }> }
    }

    const results: WebSearchResult[] = []
    const seenUrls = new Set<string>()

    for (const item of data.webPages?.value ?? []) {
      if (seenUrls.has(item.url)) continue
      seenUrls.add(item.url)
      results.push({ url: item.url, title: item.name, snippet: item.snippet })
    }

    for (const item of data.news?.value ?? []) {
      if (seenUrls.has(item.url)) continue
      seenUrls.add(item.url)
      results.push({ url: item.url, title: item.name, snippet: item.description })
    }

    return results
  }
}

export function bingSearch(options?: BingSearchOptions): BingSearchSource {
  return new BingSearchSource(options)
}
