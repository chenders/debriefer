# Debriefer

**Orchestrates dozens of research sources, scores them for reliability, and stops when it has enough.**

[![CI](https://github.com/chenders/debriefer/actions/workflows/ci.yml/badge.svg)](https://github.com/chenders/debriefer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

You need facts from the open web, but every source has a different API, a different credibility level, and a different cost. Debriefer queries 30+ sources in parallel — news wires, digital archives, structured databases, search engines — scores each one using Wikipedia's own reliability methodology, and stops early once it has enough high-quality, cross-referenced findings. You define the subject, the output shape, and the quality bar. Debriefer handles the orchestration, the budget, and the trust math.

## Quick Start

```typescript
import { ResearchOrchestrator, NoopSynthesizer } from "debriefer"
import { wikipedia, wikidata, openLibrary } from "debriefer-sources"

const orchestrator = new ResearchOrchestrator(
  [{ phase: 1, name: "Free Sources", sources: [wikidata(), wikipedia(), openLibrary()] }],
  new NoopSynthesizer()
)

const result = await orchestrator.debrief({ id: "nm0000030", name: "Audrey Hepburn" })

console.log(`${result.findings.length} findings from ${result.sourcesSucceeded} sources`)
for (const finding of result.findings) {
  console.log(`[${finding.sourceName}] (reliability: ${finding.reliabilityScore}) ${finding.url}`)
}
```

No API keys required — Wikipedia, Wikidata, and Open Library are free and open.

## Key Features

- **Wikipedia-grade reliability scoring** — Every source is rated on a 12-tier scale derived from the [Reliable Sources Perennial (RSP)](https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources) list that Wikipedia editors use to settle disputes.
- **Two independent quality axes** — Source reliability ("is the BBC trustworthy?") and content confidence ("does this article actually mention the person we're researching?") are scored separately. A trusted source with an irrelevant page doesn't pollute your results.
- **Phased execution with early stopping** — Cheap, fast sources run first. Expensive ones only fire if the cheap ones didn't find enough. When the quality bar is met, remaining phases are skipped.
- **Per-query cost budgets** — Set a dollar limit per subject and per batch. Debriefer tracks costs and stops before you overspend.
- **Pluggable AI synthesis** — Optionally pass findings through Claude to distill raw results into structured, cited output matching your schema. Or skip synthesis entirely. The Anthropic SDK is an optional peer dependency.
- **Fully generic engine** — `ResearchOrchestrator<TSubject, TOutput>` doesn't know or care whether you're researching people, companies, or historical events. Bring your own subject type, output schema, and synthesis prompt.
- **No lock-in on infrastructure** — Cache, telemetry, and rate limiting are injected interfaces. Swap in Redis, Datadog, or SQLite without touching orchestration code. Core has one hard dependency (`p-limit`).

## Packages

| Package                                 | Description                              | Status  |
| --------------------------------------- | ---------------------------------------- | ------- |
| [`debriefer`](packages/core)            | Core orchestration engine                | Stable  |
| [`debriefer-sources`](packages/sources) | 30+ built-in source integrations         | Stable  |
| [`debriefer-cli`](packages/cli)         | Command-line interface                   | Stable  |
| [`debriefer-server`](packages/server)   | REST API server + Docker                 | Planned |
| [`debriefer-mcp`](packages/mcp)         | Model Context Protocol for AI assistants | Planned |
| `debriefer` (PyPI)                      | Python HTTP client                       | Planned |

## How It Works

Debriefer runs research in **phases**, starting with free and fast sources (Wikipedia, Wikidata, open archives) before moving to API-gated sources (news APIs, search engines). Each phase runs its sources concurrently with per-domain rate limiting.

**Early stopping** kicks in when enough distinct source families return high-quality findings. If Wikipedia, AP News, and the Library of Congress all agree, there's no reason to burn through your search API quota. The threshold is configurable.

Quality is measured on **two independent axes**:

- **Source reliability** — How trustworthy is the publisher? Scored 0.0–1.0 using Wikipedia's RSP list. Wikidata scores 1.0, AP and Reuters score 0.95, user-generated content scores 0.35.
- **Content confidence** — Does this particular result actually answer the query? Computed per finding using keyword matching and source-specific heuristics.

Both must exceed their thresholds for a finding to count toward early stopping.

```
Consumer App ──▶ Orchestrator ──▶ Phase 1 (free) ──▶ Phase 2 (paid) ──▶ Synthesis
                     │                                                       │
                     ├── Cost Tracker    ┌─ Wikipedia                        ▼
                     ├── Rate Limiter    ├─ Wikidata        Structured output
                     ├── Cache           ├─ Open Library    with citations
                     └── Telemetry       ├─ AP News
                                         ├─ Guardian
                                         └─ ...30+ more
```

## Reliability Scoring

Based on Wikipedia's [Reliable Sources Perennial](https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources) list:

| Tier                    | Score | Examples                                                    |
| ----------------------- | ----- | ----------------------------------------------------------- |
| `STRUCTURED_DATA`       | 1.0   | Wikidata, government databases                              |
| `TIER_1_NEWS`           | 0.95  | AP, NYT, BBC, Reuters                                       |
| `TRADE_PRESS`           | 0.9   | Variety, Nature                                             |
| `ARCHIVAL`              | 0.9   | Library of Congress (Chronicling America), Trove, Europeana |
| `SECONDARY_COMPILATION` | 0.85  | Wikipedia, Google Books                                     |
| `SEARCH_AGGREGATOR`     | 0.7   | Google, Bing, DuckDuckGo                                    |
| `ARCHIVE_MIRROR`        | 0.7   | Internet Archive                                            |
| `MARGINAL_EDITORIAL`    | 0.65  | People Magazine                                             |
| `MARGINAL_MIXED`        | 0.6   | Legacy.com                                                  |
| `AI_MODEL`              | 0.55  | Claude, GPT                                                 |
| `UNRELIABLE_FAST`       | 0.5   | TMZ                                                         |
| `UNRELIABLE_UGC`        | 0.35  | Find a Grave                                                |

## Source Categories

| Category       | Sources                                                     | Free?                     |
| -------------- | ----------------------------------------------------------- | ------------------------- |
| **Structured** | Wikidata, Wikipedia                                         | Yes                       |
| **News**       | AP, Reuters, BBC, NYT, Guardian, Washington Post, + 16 more | API key required          |
| **Search**     | Google, Bing, Brave, DuckDuckGo                             | Mixed (DDG free)          |
| **Books**      | Google Books, Open Library                                  | Mixed (Open Library free) |
| **Archives**   | Chronicling America, Trove, Europeana, Internet Archive     | Yes                       |
| **Obituary**   | Legacy.com, Find a Grave                                    | Yes                       |

Sources requiring no API key run in the earliest phases. Basic research costs nothing and completes in seconds.

## Integration Examples

### Actor Research with AI Synthesis

Build a film database that enriches actor profiles from news, archives, and structured data — then synthesizes a cited biography with Claude:

```typescript
import { ResearchOrchestrator, ClaudeSynthesizer, type ResearchSubject } from "debriefer"
import {
  wikidata,
  wikipedia,
  guardian,
  apNews,
  variety,
  chroniclingAmerica,
  internetArchive,
  legacy,
} from "debriefer-sources"

interface ActorProfile {
  biography: string
  birthDate: string | null
  deathDate: string | null
  notableRoles: string[]
  sources: { name: string; url: string; reliability: number }[]
}

const synthesizer = new ClaudeSynthesizer<ResearchSubject, ActorProfile>({
  promptBuilder: (subject, findings) => ({
    system: `You are building a film database. Given research findings about an actor,
extract a biography, birth/death dates, notable roles, and cite your sources.
Return JSON matching: { biography, birthDate, deathDate, notableRoles, sources }`,
    user: `Actor: ${subject.name}\n\nFindings:\n${findings
      .map((f) => `[${f.sourceName}] (reliability: ${f.reliabilityScore}) ${f.url}\n${f.text}`)
      .join("\n\n")}`,
  }),
  responseParser: (raw) => raw as ActorProfile,
})

const orchestrator = new ResearchOrchestrator(
  [
    { phase: 1, name: "Structured", sources: [wikidata(), wikipedia()] },
    {
      phase: 2,
      name: "News & Archives",
      sources: [guardian(), apNews(), variety(), chroniclingAmerica()],
    },
    { phase: 3, name: "Deep Archives", sources: [internetArchive(), legacy()] },
  ],
  synthesizer,
  { earlyStopThreshold: 3, costLimits: { maxCostPerSubject: 0.1 } }
)

const profile = await orchestrator.debrief({
  id: "nm0000030",
  name: "Audrey Hepburn",
  context: { knownFor: "Breakfast at Tiffany's" },
})

console.log(profile.data!.biography)
console.log(
  `Sources: ${profile.data!.sources.length} cited, cost: $${profile.totalCostUsd.toFixed(4)}`
)
```

Structured data runs first (free, fast). News and archives only fire if early stopping hasn't triggered. Deep archives are the last resort. The whole thing costs pennies.

### Provenance-Scored Context for RAG Pipelines

RAG systems typically stuff all retrieved text into the LLM's context window with no way to distinguish a Reuters wire story from a random blog post. Debriefer solves this by scoring every piece of retrieved content on two axes — source reliability and content relevance — so your LLM only sees trusted, relevant context and can cite where each fact came from.

```typescript
import { ResearchOrchestrator, NoopSynthesizer, type ScoredFinding } from "debriefer"
import {
  wikidata,
  wikipedia,
  apNews,
  bbcNews,
  reuters,
  guardian,
  openLibrary,
} from "debriefer-sources"

const orchestrator = new ResearchOrchestrator(
  [
    { phase: 1, sources: [wikidata(), wikipedia(), openLibrary()] },
    { phase: 2, sources: [apNews(), bbcNews(), reuters(), guardian()] },
  ],
  new NoopSynthesizer(),
  { confidenceThreshold: 0.6, reliabilityThreshold: 0.7 }
)

async function buildRAGContext(query: string): Promise<string> {
  const result = await orchestrator.debrief({ id: query, name: query })

  // Filter to high-quality findings only
  const trusted = result.findings.filter((f) => f.reliabilityScore >= 0.7 && f.confidence >= 0.6)

  // Build context with provenance metadata the LLM can cite
  return trusted
    .map(
      (f) => `[Source: ${f.sourceName} | Reliability: ${f.reliabilityScore} | ${f.url}]\n${f.text}`
    )
    .join("\n\n---\n\n")
}

// Feed to your LLM with full provenance
const context = await buildRAGContext("climate change effects on coral reefs")
const prompt = `Using ONLY the following sourced context, answer the question. Cite sources by name.\n\n${context}\n\nQuestion: ...`
```

Without this, you'd need to build and maintain integrations with every source API, implement your own reliability scoring system, and somehow correlate quality signals across different source formats. Debriefer gives you a single call that returns findings pre-scored on both axes, ready to filter and feed into your model.

### Cross-Archive Historical Research

Historians and journalists researching how a person or event was documented across different countries and eras face a painful problem: every archive has a different API, different query syntax, different authentication, and different response format. Chronicling America (Library of Congress), Trove (National Library of Australia), Europeana (EU cultural heritage), and the Internet Archive each require separate integration work. Debriefer queries them all in one call, with reliability scoring to help you weight institutional archives against mirrors.

```typescript
import { ResearchOrchestrator, NoopSynthesizer } from "debriefer"
import {
  chroniclingAmerica,
  trove,
  europeana,
  internetArchive,
  wikipedia,
  openLibrary,
} from "debriefer-sources"

const orchestrator = new ResearchOrchestrator(
  [
    { phase: 1, name: "Reference", sources: [wikipedia(), openLibrary()] },
    {
      phase: 2,
      name: "Archives",
      sources: [chroniclingAmerica(), trove(), europeana(), internetArchive()],
    },
  ],
  new NoopSynthesizer()
)

const result = await orchestrator.debrief({ id: "1918-flu", name: "1918 influenza pandemic" })

// Group findings by source for comparative analysis
const bySource = Object.groupBy(result.findings, (f) => f.sourceName)
for (const [source, findings] of Object.entries(bySource)) {
  console.log(`\n${source} (${findings!.length} results):`)
  for (const f of findings!) {
    console.log(`  [reliability: ${f.reliabilityScore}] ${f.url}`)
    console.log(`  ${f.text.slice(0, 150)}...`)
  }
}
```

One researcher, four countries' archives, one API call. Without Debriefer, this is weeks of integration work per archive.

## CLI

```bash
npm install -g debriefer-cli

# List available sources and their reliability tiers
debriefer sources

# Research an actress with free structured data sources
debriefer debrief "Audrey Hepburn" --no-synthesis --categories structured

# JSON output, piped to jq
debriefer debrief "Sidney Poitier" --categories structured,news --format json \
  | jq '.findings[] | {source: .sourceName, url: .url}'

# Verbose mode shows per-source progress and early stopping
debriefer debrief "Toshiro Mifune" --verbose --categories structured,books,archives
```

## When to Use Debriefer

- **Film & entertainment databases** — Enrich actor profiles, filmographies, and biographical records from news archives, structured data, and obituary sources with reliability-scored citations.
- **RAG pipelines that need provenance** — Feed your LLM only trusted, relevant context with source reliability scores attached, so it can cite real sources instead of hallucinating URLs.
- **Cross-archive historical research** — Query digitized newspaper archives across multiple countries and institutions in one call instead of learning four different APIs.
- **Fact-checking pipelines** — Verify claims against multiple independent sources ranked by editorial credibility, not just by which API returned first.
- **Database enrichment at scale** — Pull biographical data, news coverage, or archival references for thousands of records from dozens of APIs without blowing your budget.

## Python Client

A Python HTTP client (`pip install debriefer`) is planned for use with `debriefer-server`:

```python
from debriefer import Debriefer

client = Debriefer(base_url="http://localhost:3000")
result = client.debrief(name="Marie Curie", categories=["structured", "news"])

for finding in result.findings:
    print(f"[{finding.source_name}] {finding.url}")
```

The HTTP server and Python client are on the [roadmap](#roadmap).

## Roadmap

| Phase                      | Status   |
| -------------------------- | -------- |
| Core engine                | Complete |
| 30+ built-in sources       | Complete |
| CLI                        | Complete |
| HTTP server + Docker       | Planned  |
| MCP server (AI assistants) | Planned  |
| Python client              | Planned  |
| npm publish                | Planned  |

## Contributing

```bash
git clone https://github.com/chenders/debriefer.git
cd debriefer && npm install
npm run build && npm test
```

See [CLAUDE.md](CLAUDE.md) for architecture details and development conventions.

## License

[MIT](LICENSE)
