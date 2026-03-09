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

const result = await orchestrator.debrief({ id: "einstein", name: "Albert Einstein" })

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

### AI Agent with Grounded Research

Use Debriefer to gather cited sources, then synthesize structured output with Claude:

```typescript
import { ResearchOrchestrator, ClaudeSynthesizer } from "debriefer"
import { wikipedia, wikidata, guardian, apNews } from "debriefer-sources"

interface ResearchBrief {
  summary: string
  keyFacts: string[]
  sources: { name: string; url: string }[]
}

const synthesizer = new ClaudeSynthesizer<ResearchSubject, ResearchBrief>({
  promptBuilder: (subject, findings) => ({
    system: `Synthesize findings into a cited brief.
Return JSON: { "summary": "...", "keyFacts": ["..."], "sources": [{"name": "...", "url": "..."}] }`,
    user: `Subject: ${subject.name}\n\nFindings:\n${findings
      .map((f) => `[${f.sourceName}] ${f.url}\n${f.text}`)
      .join("\n\n")}`,
  }),
  responseParser: (raw) => raw as ResearchBrief,
})

const orchestrator = new ResearchOrchestrator(
  [
    { phase: 1, name: "Structured", sources: [wikidata(), wikipedia()] },
    { phase: 2, name: "News", sources: [guardian(), apNews()] },
  ],
  synthesizer,
  { earlyStopThreshold: 3, costLimits: { maxCostPerSubject: 0.05 } }
)

const result = await orchestrator.debrief({ id: 1, name: "Alan Turing" })
console.log(result.data!.summary)
result.data!.sources.forEach((s) => console.log(`  ${s.name}: ${s.url}`))
```

### Database Enrichment Pipeline

Process hundreds of records with concurrency control and lifecycle hooks:

```typescript
import { ResearchOrchestrator, NoopSynthesizer } from "debriefer"
import { wikipedia, wikidata, openLibrary } from "debriefer-sources"

const orchestrator = new ResearchOrchestrator(
  [{ phase: 1, sources: [wikidata(), wikipedia(), openLibrary()] }],
  new NoopSynthesizer(),
  { concurrency: 10, costLimits: { maxTotalCost: 1.0 } }
)

const subjects = await db.query("SELECT id, name FROM people WHERE bio IS NULL LIMIT 200")

await orchestrator.debriefBatch(subjects, {
  onSubjectComplete: async (subject, result) => {
    if (result.findings.length > 0) {
      await db.query("UPDATE people SET bio = $1 WHERE id = $2", [
        result.findings.map((f) => f.text).join("\n\n"),
        subject.id,
      ])
    }
  },
  onBatchProgress: (stats) => {
    console.log(`${stats.completed}/${stats.total} — $${stats.costUsd.toFixed(4)}`)
  },
})
```

## CLI

```bash
npm install -g debriefer-cli

# List available sources and their reliability tiers
debriefer sources

# Research with free structured data sources
debriefer debrief "Albert Einstein" --no-synthesis --categories structured

# JSON output, piped to jq
debriefer debrief "Marie Curie" --categories structured,news --format json \
  | jq '.findings[] | {source: .sourceName, url: .url}'

# Verbose mode shows per-source progress
debriefer debrief "Ada Lovelace" --verbose --categories structured,books
```

## When to Use Debriefer

- **Fact-checking pipelines** — Verify claims against multiple independent sources ranked by editorial credibility, not just by which API returned first.
- **Database enrichment** — Pull biographical data, news coverage, or archival references for thousands of records from dozens of APIs without blowing your budget.
- **Grounding AI agents** — Give your LLM-based agent real sources with reliability metadata instead of hallucinated URLs.
- **Coverage aggregation** — Find out what AP, BBC, Chronicling America, and the Internet Archive all say about something, with quality scoring to help you decide what to trust.

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
