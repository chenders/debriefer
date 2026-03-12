# Debriefer

**Multi-source research with built-in reliability scoring — 35+ sources, Wikipedia-grade trust ratings, and cost-controlled execution.**

[![CI](https://github.com/chenders/debriefer/actions/workflows/ci.yml/badge.svg)](https://github.com/chenders/debriefer/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-750%2B-brightgreen)](#contributing)

You need facts from the open web, but every source has a different API, a different credibility, and a different cost. Debriefer queries 35+ sources in parallel — news wires, digital archives, structured databases, search engines — scores each one using Wikipedia's [Reliable Sources](https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources) editorial methodology (RSP), and stops early once it has enough high-quality findings. You define the subject, the output shape, and the quality bar. Debriefer handles the orchestration, the budget, and the trust math.

Extracted from a [production enrichment pipeline](https://github.com/chenders/deadonfilm) that uses it to research thousands of records across 60+ sources.

## Quick Start

```bash
# npm publish planned — for now, clone and link from the repo:
git clone https://github.com/chenders/debriefer.git
cd debriefer && npm install && npm run build
```

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
// 3 findings from 3 sources
// [Wikidata] (reliability: 1) https://www.wikidata.org/wiki/Q41282
// [Wikipedia] (reliability: 0.85) https://en.wikipedia.org/wiki/Audrey_Hepburn
// [Open Library] (reliability: 0.85) https://openlibrary.org/search?q=Audrey+Hepburn
```

No API keys required — Wikipedia, Wikidata, and Open Library are free and open.

## When to Use Debriefer

- **[RAG](https://en.wikipedia.org/wiki/Retrieval-augmented_generation) pipelines that need provenance** — Feed your LLM only trusted, relevant context with source reliability scores attached, so it can cite real sources instead of hallucinating URLs.
- **Database enrichment at scale** — Pull biographical data, news coverage, or archival references for thousands of records across dozens of APIs, with per-subject cost caps keeping the bill predictable.
- **Cross-archive historical research** — Query digitized newspaper archives across multiple countries and institutions in one call instead of learning four different APIs.
- **Fact-checking pipelines** — Verify claims against multiple independent sources ranked by editorial credibility, not just by which API returned first.
- **Drug & pharmaceutical research** — Combine structured pharmacological data, clinical news, and published literature with reliability thresholds that exclude low-trust sources.
- **Corporate due diligence** — Screen companies across wire services, structured databases, and web search with batch processing and per-subject cost caps.
- **AI agent tooling** — Give AI agents structured access to 35+ research sources via the MCP server, with built-in cost guardrails so agents can't overspend.

## Key Features

- **Wikipedia-grade reliability scoring** — Every source is rated on a 12-tier scale derived from the [RSP list](https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources) that Wikipedia editors use to settle disputes. Wikidata scores 1.0, AP and Reuters score 0.95, user-generated content scores 0.35.
- **Two independent quality axes** — Source reliability ("is the BBC trustworthy?") and content confidence ("does this article actually answer the query?") are scored separately. A trusted source with an irrelevant page doesn't pollute your results.
- **Phased execution with early stopping** — Cheap, fast sources run first. Expensive sources only run if the cheap ones fall short. When the quality bar is met, remaining phases are skipped. Within a phase, sources can also be executed sequentially, stopping at the first non-null finding — useful for keeping AI model costs down.
- **Per-query cost budgets** — Set a dollar limit per subject and per batch. Debriefer tracks costs and stops before you overspend.
- **Pluggable AI synthesis** — Pass findings through Claude to distill raw results into structured, cited output matching your schema. Or skip synthesis entirely. The Anthropic SDK is an optional peer dependency.
- **Fully generic engine** — Research people, companies, drugs, or historical events — `ResearchOrchestrator<TSubject, TOutput>` has no domain assumptions built in. Bring your own subject type, output schema, and synthesis prompt.
- **The entire core has one hard dependency: `p-limit`** — Cache, telemetry, and rate limiting are injected interfaces. Swap in Redis, Datadog, or SQLite without touching orchestration code.

## How It Works

```
Subject ──> Orchestrator ──> Phase 1 (free) ──────> Phase 2 (API key) ──> Synthesis
                 │                 │                       │                   │
                 ├─ Cost Tracker   ├─ Wikidata             ├─ Google Search    v
                 ├─ Rate Limiter   ├─ Wikipedia            ├─ Bing Search   Structured
                 ├─ Cache          ├─ Guardian, NYT        ├─ Brave Search  output with
                 └─ Telemetry      └─ 20+ free site-search └─ ...           citations
```

The orchestrator runs phases in order. Within each phase, sources run concurrently with per-domain rate limiting. After each phase, the engine checks two things: has the **early stop threshold** been met (enough distinct source families returned high-quality findings)? Has the **cost limit** been exceeded? If either is true, remaining phases are skipped and synthesis runs on what's been collected.

Quality is measured on two independent axes. **Source reliability** (how trustworthy is the publisher?) and **content confidence** (does this particular result actually answer the query?) must both exceed their thresholds for a finding to count toward early stopping.

## Packages

| Package                                 | Description                              | Status |
| --------------------------------------- | ---------------------------------------- | ------ |
| [`debriefer`](packages/core)            | Core orchestration engine                | Stable |
| [`debriefer-sources`](packages/sources) | 35+ built-in source integrations         | Stable |
| [`debriefer-cli`](packages/cli)         | Command-line interface                   | Stable |
| [`debriefer-server`](packages/server)   | REST API server + Docker                 | Stable |
| [`debriefer-mcp`](packages/mcp)         | Model Context Protocol for AI assistants | Stable |
| [`debriefer` (Python)](clients/python)  | Python HTTP client                       | Stable |

## Reliability Scoring

Based on Wikipedia's [Reliable Sources Perennial](https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources) list:

| Tier                    | Score | Examples                                                    |
| ----------------------- | ----- | ----------------------------------------------------------- |
| `STRUCTURED_DATA`       | 1.0   | Wikidata, government databases                              |
| `TIER_1_NEWS`           | 0.95  | AP, NYT, BBC, Reuters, Guardian, Washington Post            |
| `TRADE_PRESS`           | 0.9   | Rolling Stone, Smithsonian, National Geographic             |
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

| Category       | Count | Sources                                                       | Free?                     |
| -------------- | ----- | ------------------------------------------------------------- | ------------------------- |
| **Structured** | 2     | Wikidata, Wikipedia                                           | Yes                       |
| **News**       | 23    | AP, Reuters, BBC, NYT, Guardian, Washington Post, NPR, + more | Mostly free (site-search) |
| **Search**     | 4     | Google, Bing, Brave, DuckDuckGo                               | Mixed (DDG free)          |
| **Books**      | 2     | Google Books, Open Library                                    | Mixed (Open Library free) |
| **Archives**   | 4     | Chronicling America, Trove, Europeana, Internet Archive       | Yes                       |
| **Obituary**   | 2     | Legacy.com, Find a Grave                                      | Yes                       |

Most news sources use free DuckDuckGo site-search (e.g., `site:apnews.com`) and need no API key. Only Guardian and NYTimes use their own APIs (free tier). Sources requiring no API key run in the earliest phases — basic research costs nothing and completes in seconds.

## Integration Examples

Examples across different domains — some use AI synthesis, some don't; some batch-process, some don't; some set strict reliability thresholds, some use defaults.

Jump to: [RAG Pipelines](#provenance-scored-retrieval-for-rag-pipelines) · [Historical Archives](#cross-archive-historical-research) · [Drug Research](#drug--disease-research) · [Due Diligence](#corporate-due-diligence) · [Actor Research](#actor-research-with-ai-synthesis)

### Provenance-Scored Retrieval for RAG Pipelines

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

  const trusted = result.findings.filter((f) => f.reliabilityScore >= 0.7 && f.confidence >= 0.6)

  return trusted
    .map(
      (f) => `[Source: ${f.sourceName} | Reliability: ${f.reliabilityScore} | ${f.url}]\n${f.text}`
    )
    .join("\n\n---\n\n")
}

// Pass to any LLM — works with Anthropic, OpenAI, or any chat completion API
const context = await buildRAGContext("climate change effects on coral reefs")
```

Without this, you'd need to build integrations for every source API, invent your own reliability scoring system, and figure out how to compare quality across completely different response formats. Debriefer gives you a single call that returns findings already scored on reliability and relevance, ready to filter and feed into your model.

### Cross-Archive Historical Research

Historians and journalists researching how a person or event was documented across countries and eras run into the same wall every time: every archive has a different API, different query syntax, different authentication, and different response format. Debriefer queries them all in one call, with reliability scoring to help you weight institutional archives against mirrors.

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

const bySource = Object.groupBy(result.findings, (f) => f.sourceName)
for (const [source, findings] of Object.entries(bySource)) {
  console.log(`\n${source} (${findings!.length} results):`)
  for (const f of findings!) {
    console.log(`  [reliability: ${f.reliabilityScore}] ${f.url}`)
  }
}
```

One researcher, four countries' archives, one API call. Without Debriefer, this is weeks of integration work per archive.

### Drug & Disease Research

Pharmaceutical teams researching a drug need structured pharmacological data, recent clinical trial news, and published literature — and they need to trust the sources they're reading. Debriefer's phased execution queries Wikidata for structured facts first, then tier-1 news for recent developments, then book archives for published research.

```typescript
import { ResearchOrchestrator, ClaudeSynthesizer, type ResearchSubject } from "debriefer"
import {
  wikidata,
  wikipedia,
  apNews,
  reuters,
  bbcNews,
  googleBooks,
  openLibrary,
} from "debriefer-sources"

interface DrugProfile {
  genericName: string
  mechanismOfAction: string
  approvedIndications: string[]
  recentDevelopments: string[]
  regulatoryStatus: string
  sources: { name: string; url: string; reliability: number }[]
}

const synthesizer = new ClaudeSynthesizer<ResearchSubject, DrugProfile>({
  promptBuilder: (subject, findings) => ({
    system: `You are a medical information specialist. Produce an accurate drug profile
from the research findings. Include mechanism of action, approved indications,
recent regulatory or safety developments, and cite your sources.
Return JSON: { genericName, mechanismOfAction, approvedIndications, recentDevelopments, regulatoryStatus, sources }`,
    user: `Drug: ${subject.name}\n\nFindings:\n${findings
      .map((f) => `[${f.sourceName}] (reliability: ${f.reliabilityScore}) ${f.url}\n${f.text}`)
      .join("\n\n")}`,
  }),
  responseParser: (raw) => raw as DrugProfile,
})

const orchestrator = new ResearchOrchestrator(
  [
    { phase: 1, name: "Structured", sources: [wikidata(), wikipedia()] },
    { phase: 2, name: "Clinical News", sources: [apNews(), reuters(), bbcNews()] },
    { phase: 3, name: "Published Research", sources: [googleBooks(), openLibrary()] },
  ],
  synthesizer,
  { earlyStopThreshold: 3, reliabilityThreshold: 0.85, costLimits: { maxCostPerSubject: 0.1 } }
)

const result = await orchestrator.debrief({
  id: "semaglutide",
  name: "semaglutide",
  context: { brandNames: ["Ozempic", "Wegovy", "Rybelsus"] },
})

console.log(result.data!.regulatoryStatus)
console.log(`${result.sourcesSucceeded} sources, cost: $${result.totalCostUsd.toFixed(4)}`)
```

The `reliabilityThreshold: 0.85` excludes search aggregators (0.7) and below from the quality check — they're still gathered, but only tier-1 news, structured data, and secondary compilations count toward early stopping.

### Corporate Due Diligence

Screen companies for investment, compliance, or M&A due diligence by pulling structured facts from Wikidata alongside tier-1 news coverage. The batch processor researches multiple companies concurrently with lifecycle hooks for progress tracking — and reliability scoring ensures wire services outweigh aggregated or user-generated sources.

```typescript
import { ResearchOrchestrator, ClaudeSynthesizer, type ResearchSubject } from "debriefer"
import {
  wikidata,
  wikipedia,
  apNews,
  reuters,
  bbcNews,
  guardian,
  bingSearch,
} from "debriefer-sources"

interface RiskAssessment {
  headquarters: string | null
  recentRegulatoryActions: string[]
  litigationRisk: "low" | "moderate" | "high"
  reputationalFlags: string[]
  summary: string
}

// Synthesizer follows the same pattern as above — only the output schema and prompt change
const synthesizer = new ClaudeSynthesizer<ResearchSubject, RiskAssessment>({
  promptBuilder: (subject, findings) => ({
    system: `You are a corporate intelligence analyst. Summarize the research on this company.
Flag regulatory actions, lawsuits, executive misconduct, or reputational controversies.
Assign litigation risk as low/moderate/high based on evidence.
Return JSON: { headquarters, recentRegulatoryActions, litigationRisk, reputationalFlags, summary }`,
    user: `Company: ${subject.name}\n\nFindings:\n${findings
      .map((f) => `[${f.sourceName}] (reliability: ${f.reliabilityScore}) ${f.url}\n${f.text}`)
      .join("\n\n")}`,
  }),
  responseParser: (raw) => raw as RiskAssessment,
})

const orchestrator = new ResearchOrchestrator(
  [
    { phase: 1, name: "Company Facts", sources: [wikidata(), wikipedia()] },
    { phase: 2, name: "News Coverage", sources: [apNews(), reuters(), bbcNews(), guardian()] },
    { phase: 3, name: "Web Search", sources: [bingSearch()] },
  ],
  synthesizer,
  { earlyStopThreshold: 4, costLimits: { maxCostPerSubject: 0.25 } }
)

const companies: ResearchSubject[] = [
  { id: "company-a", name: "Acme Corporation", context: { ticker: "ACME" } },
  { id: "company-b", name: "Globex Industries", context: { ticker: "GLBX" } },
  { id: "company-c", name: "Initech Financial", context: { industry: "Fintech" } },
]

const results = await orchestrator.debriefBatch(companies, {
  onSubjectComplete: (subject, result) =>
    console.log(
      `${subject.name}: risk=${result.data?.litigationRisk ?? "unknown"}, ` +
        `cost=$${result.totalCostUsd.toFixed(3)}, ${result.durationMs}ms`
    ),
  onRunComplete: (stats) =>
    console.log(
      `\nScreened ${stats.succeeded}/${stats.total} companies, $${stats.costUsd.toFixed(3)} total`
    ),
})
```

The batch processor shares rate limiting across all companies — no thundering herd against any single news API — and per-subject cost caps prevent any one company from consuming the entire budget.

### Actor Research with AI Synthesis

Build a film database that enriches actor profiles from news, archives, and structured data — then synthesizes a cited biography with Claude:

```typescript
import { ResearchOrchestrator, ClaudeSynthesizer, type ResearchSubject } from "debriefer"
import {
  wikidata,
  wikipedia,
  guardian,
  apNews,
  bbcNews,
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
      sources: [guardian(), apNews(), bbcNews(), chroniclingAmerica()],
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

## Deployment Options

Embed the library if you're in a TypeScript codebase. Use the HTTP server or Python client for polyglot environments. Use the MCP server to give AI agents research capabilities.

### CLI

```bash
# Until published to npm, install from the repo:
npm run build && npm link -w packages/cli

# List available sources and their reliability tiers
debriefer sources

# Research a subject with free structured data sources
debriefer debrief "Audrey Hepburn" --no-synthesis --categories structured

# JSON output, piped to jq
debriefer debrief "Sidney Poitier" --categories structured,news --format json \
  | jq '.findings[] | {source: .sourceName, url: .url}'

# Full synthesis with Claude, $0.50 budget
debriefer debrief "Toshiro Mifune" --budget 0.50 --verbose
```

### HTTP Server

```bash
# Build and run from the repo
npm run build -w packages/server
ANTHROPIC_API_KEY=sk-... node packages/server/dist/index.js

curl -X POST http://localhost:8090/api/debrief \
  -H "Content-Type: application/json" \
  -d '{"name": "Marie Curie", "categories": ["structured", "news"], "budget": 0.25}'
```

### MCP Server (AI Assistants)

```bash
# Run from source (npm publish planned)
npm run build -w packages/mcp
node packages/mcp/dist/index.js
```

Provides two tools: `debrief` (run multi-source research) and `list_sources` (browse available sources). Sources run in-process with zero HTTP overhead.

### Docker

```bash
cd docker && docker compose up -d

curl -X POST http://localhost:8090/api/debrief \
  -H "Content-Type: application/json" \
  -d '{"name": "Alan Turing", "synthesis": false}'
```

### Python Client

```bash
# Install from source (PyPI publish planned)
cd clients/python && pip install -e ".[dev]"
```

```python
import asyncio
from debriefer import AsyncDebriefer

async def main():
    async with AsyncDebriefer("http://localhost:8090") as db:
        result = await db.debrief("Marie Curie", categories=["structured", "news"])

        for finding in result.findings:
            print(f"[{finding.source_name}] {finding.url}")

asyncio.run(main())
```

## Roadmap

| Phase                      | Status   |
| -------------------------- | -------- |
| Core engine                | Complete |
| 35+ built-in sources       | Complete |
| CLI                        | Complete |
| HTTP server + Docker       | Complete |
| MCP server (AI assistants) | Complete |
| Python client              | Complete |
| npm / PyPI publish         | Planned  |

## Contributing

```bash
git clone https://github.com/chenders/debriefer.git
cd debriefer && npm install
npm run build && npm test    # 750+ tests across TypeScript and Python
```

## License

[MIT](LICENSE)
