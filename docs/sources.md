# Reliability Scoring & Sources

Debriefer scores research quality on two independent axes. **Source reliability** measures how trustworthy the publisher is — the BBC is more editorially rigorous than a user-generated wiki. **Content confidence** measures how relevant a particular result is to the query — a trusted source that returns an irrelevant page doesn't help. Both scores must exceed configurable thresholds for a finding to count as high quality.

Source reliability tiers are derived from Wikipedia's [Reliable Sources Perennial](https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources) (RSP) list — the same classification system Wikipedia editors use to settle sourcing disputes. Each built-in source is assigned a tier based on its RSP classification, and that tier maps to a numeric score between 0.0 and 1.0.

## Reliability Tiers

| Tier                    | Score | RSP Equivalent                | Examples                                                    |
| ----------------------- | ----- | ----------------------------- | ----------------------------------------------------------- |
| `STRUCTURED_DATA`       | 1.0   | N/A                           | Wikidata, government databases                              |
| `TIER_1_NEWS`           | 0.95  | "Generally reliable"          | AP, NYT, BBC, Reuters, Guardian, Washington Post            |
| `TRADE_PRESS`           | 0.9   | "Generally reliable" (domain) | Rolling Stone, Smithsonian, National Geographic             |
| `ARCHIVAL`              | 0.9   | Primary sources               | Library of Congress (Chronicling America), Trove, Europeana |
| `SECONDARY_COMPILATION` | 0.85  | Wikipedia self-assessment     | Wikipedia, Google Books                                     |
| `SEARCH_AGGREGATOR`     | 0.7   | Depends on linked sources     | Google, Bing, DuckDuckGo                                    |
| `ARCHIVE_MIRROR`        | 0.7   | Mirrors                       | Internet Archive                                            |
| `MARGINAL_EDITORIAL`    | 0.65  | "Use with caution"            | People Magazine                                             |
| `MARGINAL_MIXED`        | 0.6   | Mixed editorial + UGC         | Legacy.com                                                  |
| `AI_MODEL`              | 0.55  | No RSP equivalent             | Claude, GPT                                                 |
| `UNRELIABLE_FAST`       | 0.5   | "Generally unreliable"        | TMZ                                                         |
| `UNRELIABLE_UGC`        | 0.35  | User-generated content        | Find a Grave                                                |

## Source Categories

| Category       | Sources                                                         | Free?                     |
| -------------- | --------------------------------------------------------------- | ------------------------- |
| **Structured** | Wikidata, Wikipedia                                             | Yes                       |
| **News**       | AP, Reuters, BBC, NYT, Guardian, Washington Post, NPR, and more | Mostly free (site-search) |
| **Search**     | Google, Bing, Brave, DuckDuckGo                                 | Mixed (DDG free)          |
| **Books**      | Google Books, Open Library                                      | Mixed (Open Library free) |
| **Archives**   | Chronicling America, Trove, Europeana, Internet Archive         | Yes                       |
| **Obituary**   | Legacy.com, Find a Grave                                        | Yes                       |

Most news sources use free DuckDuckGo site-search (e.g., `site:apnews.com`) and need no API key. Only Guardian and NYTimes use their own APIs (free tier). Sources requiring no API key run in the earliest phases — basic research costs nothing and completes in seconds.

## How Quality Thresholds Work

When configuring the orchestrator, you set thresholds that control quality and stopping behavior:

```typescript
const orchestrator = new ResearchOrchestrator(
  [
    { phase: 1, sources: [wikidata(), wikipedia()] },
    { phase: 2, sources: [apNews(), reuters()] },
  ],
  new NoopSynthesizer(),
  {
    confidenceThreshold: 0.6, // content relevance minimum
    reliabilityThreshold: 0.7, // source trust minimum
    earlyStopThreshold: 3, // distinct source families needed
  }
)
```

A finding counts toward early stopping only when **both** its content confidence and its source reliability exceed their respective thresholds. Setting `reliabilityThreshold: 0.85` means only tier-1 news, structured data, archival sources, and secondary compilations can trigger early stopping — but lower-tier sources are still queried and their findings are still available for synthesis.

Early stopping counts distinct **source families** (unique `sourceType` strings), not individual findings. Three findings from the same source count as one family. This ensures breadth of coverage before the orchestrator stops searching.
