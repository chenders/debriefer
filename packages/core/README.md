# @debriefer/core

Multi-source research orchestration engine with reliability scoring, phase-based execution, and AI synthesis.

## Install

```bash
npm install @debriefer/core
```

To use `ClaudeSynthesizer`, also install the optional peer dependency:

```bash
npm install @anthropic-ai/sdk
```

## Quick Start

```typescript
import { ResearchOrchestrator, NoopSynthesizer } from "@debriefer/core"
import { wikipedia, wikidata, openLibrary } from "@debriefer/sources"

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

## Key Exports

**Engine**

- `ResearchOrchestrator` — phased execution, early stopping, batch processing, lifecycle hooks
- `BaseResearchSource` — abstract base class for all source implementations

**Synthesis**

- `ClaudeSynthesizer` — AI synthesis via Anthropic SDK; produces typed, cited output
- `NoopSynthesizer` — returns raw findings without synthesis

**Reliability Scoring**

- `ReliabilityTier` — 12-tier enum based on Wikipedia's Reliable Sources Perennial list (0.35–1.0)
- `RELIABILITY_SCORES`, `getReliabilityScore`, `meetsReliabilityThreshold`

**Infrastructure**

- `InMemoryCache` — TTL cache with optional FIFO eviction (`maxSize`)
- `SourceRateLimiter` — per-domain async queue
- `BatchCostTracker` — per-subject and total cost limits
- `ParallelBatchRunner` — concurrency-limited batch processor
- `ConsoleTelemetry`, `NoopTelemetry` — pluggable observability
- `calculateConfidence` — keyword-based confidence scoring

**Types**

- `ResearchSubject`, `RawFinding`, `ScoredFinding`, `DebriefResult`, `ResearchConfig`
- `Synthesizer`, `CacheProvider`, `TelemetryProvider`, `LifecycleHooks`
- `CostLimitExceededError`, `SourceTimeoutError`, `SourceAccessBlockedError`

## Dependencies

One hard dependency: [`p-limit`](https://github.com/sindresorhus/p-limit).

`@anthropic-ai/sdk` is an optional peer dependency — only required when using `ClaudeSynthesizer`. Consumers using a custom synthesizer do not need it.

All other infrastructure (cache backends, telemetry, rate limiting) is injected via interfaces.

## Documentation

See the [monorepo README](https://github.com/chenders/debriefer) for full documentation, integration examples, reliability tier reference, and source catalog.

## License

[MIT](../../LICENSE)
