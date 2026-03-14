import { ReliabilityTier } from "@debriefer/core"
import { WebSearchBase, type WebSearchOptions, type WebSearchResult } from "./base.js"
import { searchDuckDuckGo } from "../shared/duckduckgo-search.js"

export type DuckDuckGoSourceOptions = WebSearchOptions

export class DuckDuckGoSearchSource extends WebSearchBase {
  readonly name = "DuckDuckGo"
  readonly type = "duckduckgo-search"
  readonly reliabilityTier = ReliabilityTier.SEARCH_AGGREGATOR
  readonly domain = "html.duckduckgo.com"
  readonly isFree = true
  readonly estimatedCostPerQuery = 0

  constructor(options: DuckDuckGoSourceOptions = {}) {
    super({ rateLimitMs: 1000, ...options })
  }

  protected async performSearch(query: string, signal: AbortSignal): Promise<WebSearchResult[]> {
    return searchDuckDuckGo({ query, signal })
  }
}

export function duckduckgoSearch(options?: DuckDuckGoSourceOptions): DuckDuckGoSearchSource {
  return new DuckDuckGoSearchSource(options)
}
