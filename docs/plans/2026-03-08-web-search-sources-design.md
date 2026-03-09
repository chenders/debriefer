# Web Search Sources Design

**Date:** 2026-03-08
**Scope:** Phase 5, Task 16 — web search infrastructure + 4 search engine sources
**Package:** `debriefer-sources`

## Overview

Build the web search infrastructure layer that enables search-based research sources. This is foundational — news sources, reference sources, and obituary sources all depend on the "search + fetch + extract" pattern established here.

**Files to create:** 7 source files + 7 test files (14 total)
**Estimated tests:** ~50
**New dependencies:** None (uses built-in fetch, existing shared utilities)

## Architecture

```
shared/
  fetch-page.ts              — Page fetcher with archive.org fallback
  duckduckgo-search.ts       — DDG HTML endpoint scraper (free, zero-config)
web-search/
  base.ts                    — Abstract base: search → select → fetch → clean → combine
  google.ts                  — Google Custom Search API
  bing.ts                    — Bing Web Search API v7
  brave.ts                   — Brave Search API v1
  duckduckgo.ts              — DuckDuckGo as a source (wraps shared utility)
```

## Shared Utilities

### fetch-page.ts

Fetches a URL with browser-like headers and optional archive.org fallback on block.

```typescript
export interface FetchPageOptions {
  url: string
  signal?: AbortSignal
  timeoutMs?: number // default: 15000
  userAgent?: string // default: browser-like UA
  archiveFallback?: boolean // default: true
}

export interface FetchPageResult {
  content: string // raw HTML
  url: string // may differ from input (archive URL)
  fetchMethod: "direct" | "archive.org" | "none"
  error?: string
}

export async function fetchPage(options: FetchPageOptions): Promise<FetchPageResult>
```

**Block detection:**

- Hard blocks: HTTP 401, 403, 429, 451
- Soft blocks: pattern matching in body (<50KB) for "captcha", "access denied", "cloudflare", "bot detection", "unusual traffic", etc.

**Differences from deadonfilm:**

- No archive.is fallback (requires browser/CAPTCHA solving)
- No Playwright dependency
- Fetch-only, suitable for a library

### duckduckgo-search.ts

Free, zero-config search via DDG HTML endpoint. Used directly by DuckDuckGoSearchSource and indirectly by news sources for `site:` queries.

```typescript
export interface DuckDuckGoSearchOptions {
  query: string
  domainFilter?: string // site: filter
  maxResults?: number // default: 10
  signal?: AbortSignal
  timeoutMs?: number // default: 15000
}

export interface SearchResult {
  url: string
  title: string
  snippet: string
}

export async function searchDuckDuckGo(options: DuckDuckGoSearchOptions): Promise<SearchResult[]>
```

Parses DDG HTML response, handles URL redirect decoding (`uddg=` param), detects CAPTCHA (`anomaly-modal`). Returns empty array on error.

## Web Search Base Class

### base.ts

Template method pattern. Subclasses implement `performSearch()`, base handles the full pipeline.

```typescript
export interface LinkSelectionOptions {
  domainScores?: Record<string, number> // domain → 0-100 score
  boostKeywords?: { keyword: string; boost: number }[] // title/snippet boosters
  penaltyKeywords?: { keyword: string; penalty: number }[] // title/snippet penalties
  blockedDomains?: string[] // never follow
}

export interface WebSearchOptions extends BaseSourceOptions, LinkSelectionOptions {
  maxLinksToFollow?: number // default: 3
  minContentLength?: number // default: 200 chars
}

export abstract class WebSearchBase extends BaseResearchSource<ResearchSubject> {
  protected abstract performSearch(query: string, signal: AbortSignal): Promise<WebSearchResult[]>

  protected async fetchResult(subject, signal): Promise<RawFinding | null>
  // Pipeline:
  // 1. Build query (subject.name by default)
  // 2. performSearch() — subclass API call
  // 3. Score & rank links (domainScores + boost/penalty keywords)
  // 4. Fetch top N pages via fetchPage()
  // 5. Extract via extractArticleContent() (Readability)
  // 6. Filter below minContentLength
  // 7. Sanitize via sanitizeSourceText()
  // 8. Combine with source attribution
  // 9. Return RawFinding with confidence -1 (delegate to base keyword scoring)
}
```

**Key decisions:**

- Confidence delegation via `-1` — consumers provide `requiredKeywords`/`bonusKeywords`
- No AI cleaning stage (domain-specific, adds cost)
- No career filtering (biography-specific)
- Link selection is fully configurable via options — no defaults baked in
- Metadata includes: searchEngine, linksFollowed, pagesExtracted, urls[]

## Search Engine Sources

All four follow the same pattern: extend WebSearchBase, declare metadata, implement performSearch(), export factory.

### google.ts — Google Custom Search

- **API:** `GET https://www.googleapis.com/customsearch/v1?key=&cx=&q=&num=`
- **Auth:** `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX` env vars
- **Tier:** SEARCH_AGGREGATOR (0.7)
- **Cost:** $0.005/query
- **Response:** `items[].{title, link, snippet}`

### bing.ts — Bing Web Search

- **API:** `GET https://api.bing.microsoft.com/v7.0/search?q=&count=&mkt=en-US`
- **Auth:** `BING_SEARCH_API_KEY` header (`Ocp-Apim-Subscription-Key`)
- **Tier:** SEARCH_AGGREGATOR (0.7)
- **Cost:** $0.003/query
- **Response:** Merges `webPages.value[]` + `news.value[]`, deduplicates by URL

### brave.ts — Brave Search

- **API:** `GET https://api.search.brave.com/res/v1/web/search?q=&count=`
- **Auth:** `BRAVE_SEARCH_API_KEY` header (`X-Subscription-Token`)
- **Tier:** SEARCH_AGGREGATOR (0.7)
- **Cost:** $0.005/query
- **Response:** Merges `web.results[]` + `news.results[]`, deduplicates

### duckduckgo.ts — DuckDuckGo

- **API:** Wraps `shared/duckduckgo-search.ts`
- **Auth:** None
- **Tier:** SEARCH_AGGREGATOR (0.7)
- **Cost:** $0 (free)
- **Rate limit:** 1000ms (conservative — CAPTCHA risk)

## Exports

```typescript
// Shared utilities
export { fetchPage, type FetchPageOptions, type FetchPageResult } from "./shared/fetch-page.js"
export {
  searchDuckDuckGo,
  type DuckDuckGoSearchOptions,
  type SearchResult,
} from "./shared/duckduckgo-search.js"

// Web search base (for custom search sources)
export {
  WebSearchBase,
  type WebSearchOptions,
  type LinkSelectionOptions,
  type WebSearchResult,
} from "./web-search/base.js"

// Sources + factories
export { GoogleSearchSource, googleSearch, type GoogleSearchOptions } from "./web-search/google.js"
export { BingSearchSource, bingSearch, type BingSearchOptions } from "./web-search/bing.js"
export { BraveSearchSource, braveSearch, type BraveSearchOptions } from "./web-search/brave.js"
export {
  DuckDuckGoSearchSource,
  duckduckgoSearch,
  type DuckDuckGoSearchOptions as DuckDuckGoSourceOptions,
} from "./web-search/duckduckgo.js"
```

## Testing

All tests mock `fetch` — no real API calls.

| File                               | Tests | Key scenarios                                                                                       |
| ---------------------------------- | ----- | --------------------------------------------------------------------------------------------------- |
| `shared/fetch-page.test.ts`        | ~10   | Direct success, block detection (403/429/soft patterns), archive.org fallback, timeout, abort       |
| `shared/duckduckgo-search.test.ts` | ~8    | HTML parsing, URL decoding, domain filter, CAPTCHA detection, empty results                         |
| `web-search/base.test.ts`          | ~12   | Full pipeline, link scoring, maxLinksToFollow, minContentLength, empty results, extraction failures |
| `web-search/google.test.ts`        | ~6    | API format, response parsing, isAvailable, errors                                                   |
| `web-search/bing.test.ts`          | ~6    | API format, web+news dedup, auth header                                                             |
| `web-search/brave.test.ts`         | ~6    | API format, web+news dedup, auth header                                                             |
| `web-search/duckduckgo.test.ts`    | ~4    | Delegates to shared, wraps results                                                                  |

**Total:** ~50 tests across 7 files
