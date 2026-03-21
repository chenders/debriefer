<div align="center">

# Debriefer

_Multi-source research orchestration with Wikipedia-grade reliability scoring._

[![CI](https://github.com/chenders/debriefer/actions/workflows/ci.yml/badge.svg)](https://github.com/chenders/debriefer/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

You need facts from the open web, but every source has a different API, a different credibility, and a different cost. Debriefer queries dozens of sources in parallel — news wires, digital archives, structured databases, search engines — scores each one using Wikipedia's [Reliable Sources](https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources) editorial methodology, and stops early once it has enough high-quality findings. You define the subject, the output shape, and the quality bar. Debriefer handles the orchestration, the budget, and the trust math.

Extracted from a [production enrichment pipeline](https://github.com/chenders/deadonfilm) that uses it to research thousands of records across dozens of sources.

## The Hook

What does a research run actually look like? Here's the CLI researching Audrey Hepburn across structured data and news sources (all free, no API keys needed):

```
$ debriefer debrief "Audrey Hepburn" --no-synthesis --categories structured,news

Subject: Audrey Hepburn
Sources: 18/20  Cost: $0.0000  Duration: 3.1s
Stopped at phase 1

--- Findings (18) ---

  Source: Wikidata
  Tier: structured_data  Confidence: 0.95
  URL: https://www.wikidata.org/wiki/Q41282
  Belgian-British actress (1929-1993). Known for Roman Holiday, Breakfast at...

  Source: Wikipedia
  Tier: secondary  Confidence: 0.92
  URL: https://en.wikipedia.org/wiki/Audrey_Hepburn
  Audrey Hepburn (born Audrey Kathleen Ruston; 4 May 1929 – 20 January 1993)...

  Source: AP News
  Tier: tier_1_news  Confidence: 0.88
  URL: https://apnews.com/search?q=Audrey+Hepburn
  ...
```

Structured data from Wikidata. Tier-1 news from AP, BBC, and Reuters. Wikipedia compilation. Twenty sources scored for reliability, queried in parallel, with early stopping — all in one call. Add API keys for Guardian, NYT, and archive sources to expand coverage further.

## How It Works

```
Subject ──> Orchestrator ──> Phase 1 (free / free-tier) ──> Phase 2 (paid search) ──> Synthesis
                 │                 │                              │                       │
                 ├─ Cost Tracker   ├─ Wikidata                   ├─ Google Search         v
                 ├─ Rate Limiter   ├─ Wikipedia                  ├─ Bing Search       Structured
                 ├─ Cache          ├─ Guardian, NYT (free key)   ├─ Brave Search      output with
                 └─ Telemetry      └─ 20+ site-search (no key)  └─ ...                citations
```

The orchestrator runs phases in order — cheap sources first, expensive sources later. After each phase, it checks whether the early stop threshold has been met (enough distinct source families returned high-quality findings) or the cost limit has been exceeded. If either is true, remaining phases are skipped and synthesis runs on what's been collected.

Quality is measured on two independent axes: **source reliability** (how trustworthy is the publisher?) and **content confidence** (does this result actually answer the query?). See [Reliability Scoring & Sources](docs/sources.md) for the full tier table and methodology.

## Quick Start

```bash
git clone https://github.com/chenders/debriefer.git
cd debriefer && npm install && npm run build
```

```typescript
import { ResearchOrchestrator, NoopSynthesizer } from "@debriefer/core"
import { wikipedia, wikidata, openLibrary } from "@debriefer/sources"

const orchestrator = new ResearchOrchestrator(
  [{ phase: 1, name: "Free Sources", sources: [wikidata(), wikipedia(), openLibrary()] }],
  new NoopSynthesizer()
)

const result = await orchestrator.debrief({ id: "nm0000030", name: "Audrey Hepburn" })

for (const finding of result.findings) {
  console.log(`[${finding.sourceName}] (reliability: ${finding.reliabilityScore}) ${finding.url}`)
}
```

No API keys required — Wikipedia, Wikidata, and Open Library are free and open.

## Use Cases

- **RAG with provenance** — Feed your LLM only trusted context with reliability scores attached, so it cites real sources instead of hallucinating URLs
- **Database enrichment at scale** — Pull data for thousands of records across dozens of APIs, with per-subject cost caps keeping the bill predictable
- **Cross-archive research** — Query digitized newspaper archives across multiple countries and institutions in one call
- **AI agent tooling** — Give AI agents structured access to research sources via the MCP server, with built-in cost guardrails

See [Integration Examples](docs/examples.md) for full code examples across RAG pipelines, historical research, pharmaceutical data, corporate due diligence, and more.

## Packages

| Package                                  | Description                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| [`@debriefer/core`](packages/core)       | Orchestration engine — phased execution, early stopping, cost control       |
| [`@debriefer/sources`](packages/sources) | Built-in source integrations (news, archives, structured data, search)      |
| [`@debriefer/ai`](packages/ai)           | AI-first defaults — Claude synthesis, confidence scoring, section filtering |
| [`@debriefer/browser`](packages/browser) | Browser stealth, CAPTCHA solving, and archive fallbacks                     |
| [`@debriefer/cli`](packages/cli)         | Command-line interface                                                      |
| [`@debriefer/server`](packages/server)   | REST API server + Docker                                                    |
| [`@debriefer/mcp`](packages/mcp)         | Model Context Protocol for AI assistants                                    |
| [`debriefer` (Python)](clients/python)   | Python HTTP client                                                          |

## Deploy

| Method      | Description                                                    | Details                          |
| ----------- | -------------------------------------------------------------- | -------------------------------- |
| **Library** | Import `@debriefer/core` and `@debriefer/sources` directly     | [Core README](packages/core)     |
| **CLI**     | `debriefer debrief "Marie Curie" --categories structured,news` | [CLI README](packages/cli)       |
| **HTTP**    | REST API with Docker support                                   | [Server README](packages/server) |
| **MCP**     | Research tools for AI assistants (Claude, etc.)                | [MCP README](packages/mcp)       |
| **Python**  | `AsyncDebriefer` HTTP client                                   | [Python README](clients/python)  |

## Interesting Implementation Details

- **Two-axis quality model** — Source reliability (publisher trust) and content confidence (query relevance) are scored independently. A trusted source returning an irrelevant page doesn't count. Both must exceed thresholds for a finding to matter.
- **One hard dependency** — The entire core package depends only on `p-limit`. Cache, telemetry, rate limiting, and synthesis are all injected interfaces. Swap in Redis, Datadog, or your own implementation without touching orchestration code.
- **Wikipedia RSP scoring** — Reliability tiers are derived from the same [Perennial Sources](https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources) classification system that Wikipedia editors use to settle sourcing disputes. Not invented metrics — borrowed editorial standards.
- **AI is optional** — The Anthropic SDK is an optional peer dependency. Use `ClaudeSynthesizer` to distill findings into structured output, or use `NoopSynthesizer` and process raw findings yourself. The engine doesn't care.
- **Browser fallback chain** — When a source blocks automated requests, `@debriefer/browser` provides a stealth browser with CAPTCHA solving and archive-specific fallback strategies. The browser package itself is optional — sources degrade gracefully without it.
- **Supply chain provenance** — Published via GitHub Releases with provenance attestations. What you see is what you get.

## Project History

Debriefer was extracted from [Dead on Film](https://github.com/chenders/deadonfilm), a site that researches the lives and deaths of people in film and television. The enrichment pipeline behind that project — querying dozens of sources, scoring reliability, managing costs, stopping early when quality thresholds are met — turned out to be completely domain-agnostic.

The orchestration logic, reliability scoring, phased execution, and cost control had nothing to do with film or mortality. So it was extracted into a standalone engine that works with any subject type, any output schema, and any source you can wrap in a class. Debriefer is the general-purpose tool; Dead on Film is the first consumer.

## Contributing

```bash
git clone https://github.com/chenders/debriefer.git
cd debriefer && npm install
npm run build && npm test
cd clients/python && pip install -e ".[dev]" && pytest
```

## License

[MIT](LICENSE)

---

<div align="center">

**[github.com/chenders/debriefer](https://github.com/chenders/debriefer)**

</div>
