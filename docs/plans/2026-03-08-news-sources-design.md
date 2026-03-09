# News Sources Design

**Date:** 2026-03-08
**Scope:** Phase 5, Task 17 — news and reference sources (22 sources)
**Package:** `debriefer-sources`

## Overview

Add 22 news and reference sources. 20 follow an identical pattern (DDG `site:` search → fetch → extract) and are handled by a single configurable `SiteSearchSource` class. 2 use proprietary APIs (Guardian, NYT) and get their own classes.

**Files to create:** 4 source files + 3 test files
**Estimated tests:** ~31
**New dependencies:** None

## Architecture

```
news/
  site-search-source.ts    — SiteSearchSource class + pickBestUrl helper
  sources.ts               — 20 factory functions
  guardian.ts              — GuardianSource (direct API)
  nytimes.ts               — NYTimesSource (direct API)
```

## SiteSearchSource — Configurable search-based source

Single class handling 20 sources via config:

```typescript
export interface SiteSearchConfig {
  name: string
  type: string
  domain: string
  additionalDomains?: string[]
  reliabilityTier: ReliabilityTier
  rateLimitMs?: number // default: 1500
  preferredPaths?: string[]
  avoidPaths?: string[]
  queryTerms?: string
  minContentLength?: number // default: 200
}
```

**Pipeline:**

1. Build query: `site:${domain} "${subject.name}" ${queryTerms}`
2. Search via `searchDuckDuckGo({ query, domainFilter: domain })`
3. Pick best URL: boost results matching `preferredPaths`, penalize `avoidPaths`
4. Fetch via `fetchPage()`
5. Extract via `extractArticleContent()`
6. Sanitize via `sanitizeSourceText()`
7. Return with `confidence: -1` (delegate to base keyword scoring)

All 20 sources are free (no API keys), use DDG search, and differ only in config.

## API-Based Sources

### GuardianSource

- **API:** `GET content.guardianapis.com/search?q=...&show-fields=bodyText,standfirst`
- **Auth:** `GUARDIAN_API_KEY` env var
- **Tier:** TIER_1_NEWS (0.95)
- **Rate limit:** 200ms (~5 req/sec)
- **Returns:** Full bodyText — confidence delegated to base

### NYTimesSource

- **API:** `GET api.nytimes.com/svc/search/v2/articlesearch.json?q=...&api-key=...`
- **Auth:** `NYTIMES_API_KEY` env var
- **Tier:** TIER_1_NEWS (0.95)
- **Rate limit:** 6000ms (10 calls/min)
- **Returns:** lead_paragraph + abstract + snippet (partial content)
- **Confidence:** Capped at 0.7 due to partial content

## Source Registry

| Factory              | Domain                 | Tier                  | Rate (ms) | Query Terms                  |
| -------------------- | ---------------------- | --------------------- | --------- | ---------------------------- |
| `apNews`             | apnews.com             | TIER_1_NEWS           | 1500      | profile OR biography         |
| `bbcNews`            | bbc.com (+bbc.co.uk)   | TIER_1_NEWS           | 1500      | profile OR biography OR life |
| `reuters`            | reuters.com            | TIER_1_NEWS           | 2000      | profile OR biography         |
| `npr`                | npr.org                | TIER_1_NEWS           | 1500      | profile OR biography         |
| `independent`        | independent.co.uk      | TIER_1_NEWS           | 2000      | profile OR biography         |
| `telegraph`          | telegraph.co.uk        | TIER_1_NEWS           | 2000      | profile OR biography         |
| `washingtonPost`     | washingtonpost.com     | TIER_1_NEWS           | 2000      | profile OR biography         |
| `laTimes`            | latimes.com            | TIER_1_NEWS           | 2000      | profile OR biography         |
| `time`               | time.com               | TIER_1_NEWS           | 1500      | profile OR biography         |
| `newYorker`          | newyorker.com          | TIER_1_NEWS           | 2000      | profile OR biography         |
| `pbs`                | pbs.org                | TIER_1_NEWS           | 1500      | profile OR biography         |
| `britannica`         | britannica.com         | TIER_1_NEWS           | 1500      | biography                    |
| `rollingStone`       | rollingstone.com       | TRADE_PRESS           | 2000      | profile OR biography         |
| `smithsonian`        | smithsonianmag.com     | TRADE_PRESS           | 2000      | biography                    |
| `nationalGeographic` | nationalgeographic.com | TRADE_PRESS           | 1500      | profile OR biography         |
| `historyCom`         | history.com            | TRADE_PRESS           | 2000      | biography                    |
| `tcm`                | tcm.com                | TRADE_PRESS           | 2000      | biography                    |
| `allMusic`           | allmusic.com           | TRADE_PRESS           | 2000      | biography                    |
| `people`             | people.com             | MARGINAL_EDITORIAL    | 1500      | profile OR personal life     |
| `biographyCom`       | biography.com          | SECONDARY_COMPILATION | 1500      | (bare name)                  |

## Testing

| File                              | Tests | Scenarios                                                               |
| --------------------------------- | ----- | ----------------------------------------------------------------------- |
| `news/site-search-source.test.ts` | ~15   | Pipeline, pickBestUrl, multi-domain, query construction, factory checks |
| `news/guardian.test.ts`           | ~8    | API format, response parsing, keyword selection, isAvailable, errors    |
| `news/nytimes.test.ts`            | ~8    | API format, content combination, confidence cap, isAvailable, errors    |

**Total:** ~31 tests across 3 files
