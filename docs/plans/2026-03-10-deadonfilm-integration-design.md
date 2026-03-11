# Deadonfilm Integration v1 Design

**Date**: 2026-03-10
**Status**: Approved
**Phase**: 10

## Overview

Refactor deadonfilm's death enrichment pipeline to consume debriefer as its orchestration engine. Biography pipeline untouched. Zero functionality loss — all sources run through one debriefer `ResearchOrchestrator`.

## Architecture

```
CLI Script / Job Handler
    ↓
debriefer ResearchOrchestrator (NoopSynthesizer)
  ├── debriefer-sources (30+ standard sources)
  └── deadonfilm custom sources (AI providers, niche sites)
    ↓ raw ScoredFinding[]
deadonfilm claude-cleanup.ts (adapted for ScoredFinding[])
    ↓ DeathData
deadonfilm DB writer (existing)
    ↓
PostgreSQL
```

## Source Strategy

All sources run through **one orchestrator**:

- **From debriefer-sources**: Wikipedia, Wikidata, AP, Reuters, BBC, Guardian, NYT, Google, Bing, DuckDuckGo, Open Library, Google Books, Chronicling America, Trove, Europeana, Internet Archive, Legacy, Find a Grave, and others.
- **From deadonfilm** (custom `BaseResearchSource` implementations): Claude, GPT-4, Perplexity, Gemini, DeepSeek, Grok, Mistral, Deadline, Hollywood Reporter, Variety, and any other sources not yet in debriefer-sources.

Custom sources extend `BaseResearchSource<ResearchSubject>` and are passed into the same `SourcePhaseGroup[]` array. One orchestrator, one code path.

## Synthesis

Debriefer runs with `NoopSynthesizer` — raw findings only. Deadonfilm's existing `claude-cleanup.ts` runs as a post-processing step on the gathered findings. This keeps domain-specific extraction logic (cause of death, confidence scoring, structured fields) entirely in deadonfilm.

## Dependencies

Local path dependencies in deadonfilm's `server/package.json`:

```json
{
  "debriefer": "file:../../debriefer/packages/core",
  "debriefer-sources": "file:../../debriefer/packages/sources"
}
```

## What Changes in Deadonfilm

### New files

- `server/src/lib/death-sources/debriefer-adapter.ts` — Creates `ResearchOrchestrator` with combined source phases (debriefer-sources + custom sources)
- `server/src/lib/death-sources/custom-sources/` — Deadonfilm-only sources reimplemented as `BaseResearchSource` subclasses wrapping existing logic
- `server/src/lib/death-sources/finding-mapper.ts` — Maps debriefer `ScoredFinding[]` to the format `claude-cleanup.ts` expects

### Modified files

- `server/package.json` — Add debriefer + debriefer-sources local path deps
- `server/src/lib/enrichment-runner.ts` — Replace `DeathEnrichmentOrchestrator` with debriefer adapter
- `server/src/lib/death-sources/claude-cleanup.ts` — Accept mapped findings

### Untouched

- Biography enrichment pipeline (all of `biography-sources/`)
- Database writers
- Entity linking
- Admin routes, job handlers (they call `EnrichmentRunner`)

## Custom Source Pattern

```typescript
import { BaseResearchSource, ReliabilityTier } from "debriefer"
import type { ResearchSubject, RawFinding } from "debriefer"

export class PerplexitySource extends BaseResearchSource<ResearchSubject> {
  name = "Perplexity"
  type = "perplexity"
  reliabilityTier = ReliabilityTier.AI_MODEL
  domain = "api.perplexity.ai"
  isFree = false
  estimatedCostPerQuery = 0.01

  async fetchResult(subject: ResearchSubject, signal?: AbortSignal): Promise<RawFinding | null> {
    // Existing Perplexity logic from deadonfilm, adapted
  }

  isAvailable(): boolean {
    return !!process.env.PERPLEXITY_API_KEY
  }
}
```

## Finding Format Mapping

| Debriefer `ScoredFinding` | Deadonfilm equivalent  |
| ------------------------- | ---------------------- |
| `text`                    | extracted content      |
| `sourceName`              | source display name    |
| `sourceType`              | `DataSourceType` enum  |
| `reliabilityTier`         | `ReliabilityTier` enum |
| `reliabilityScore`        | numeric score          |
| `confidence`              | content confidence     |
| `url`                     | source URL             |
| `costUsd`                 | lookup cost            |

## Config Mapping

| Deadonfilm config    | Debriefer config               |
| -------------------- | ------------------------------ |
| `maxCostPerActor`    | `costLimits.maxCostPerSubject` |
| `maxTotalCost`       | `costLimits.maxTotalCost`      |
| `concurrency`        | batch runner concurrency       |
| `earlyStopThreshold` | `earlyStopThreshold`           |
| `phases` (custom)    | `SourcePhaseGroup[]`           |

## Key Decisions

- Death enrichment only (biography deferred)
- Local path dependencies (not npm — publish later)
- `NoopSynthesizer` + existing claude-cleanup as post-process
- Custom sources via `BaseResearchSource` — one orchestrator, no parallel code paths
- Custom sources can migrate to debriefer-sources later
