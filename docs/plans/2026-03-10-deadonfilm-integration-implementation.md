# Deadonfilm Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor deadonfilm's death enrichment pipeline to use debriefer as its orchestration engine, with zero functionality loss.

**Architecture:** Add debriefer + debriefer-sources as local path dependencies. Create an adapter that builds a `ResearchOrchestrator` with both debriefer-sources and custom deadonfilm sources. Map debriefer's `ScoredFinding[]` to deadonfilm's `RawSourceData[]` for claude-cleanup. Replace `DeathEnrichmentOrchestrator.enrichActor()` calls with the adapter.

**Tech Stack:** TypeScript, debriefer core + debriefer-sources (local path), existing deadonfilm infrastructure

**Design doc:** `/Users/chris/Source/debriefer/docs/plans/2026-03-10-deadonfilm-integration-design.md`

**Working directory:** `/Users/chris/Source/deadonfilm`

---

## Important Context

- Deadonfilm repo: `/Users/chris/Source/deadonfilm`
- Debriefer repo: `/Users/chris/Source/debriefer` (sibling directory)
- All file paths below are relative to `/Users/chris/Source/deadonfilm` unless noted
- The death enrichment pipeline has 42 sources across 8 phases
- 26 sources have equivalents in debriefer-sources; 16 need custom wrappers
- Claude cleanup (`cleanupWithClaude`) accepts `RawSourceData[]` — we map `ScoredFinding[]` to this

---

### Task 1: Add Debriefer Dependencies

Add debriefer and debriefer-sources as local path dependencies.

**Files:**

- Modify: `server/package.json`

**Step 1: Add dependencies**

```bash
cd /Users/chris/Source/deadonfilm
npm install --save debriefer@file:../debriefer/packages/core debriefer-sources@file:../debriefer/packages/sources
```

**Step 2: Verify imports work**

```bash
cd /Users/chris/Source/deadonfilm && node -e "import('debriefer').then(m => console.log(Object.keys(m).slice(0,5)))"
```

Expected: Array of export names

**Step 3: Commit**

```bash
git checkout -b feat/debriefer-integration
git add server/package.json package-lock.json
git commit -m "chore: add debriefer + debriefer-sources as local path dependencies"
```

---

### Task 2: Finding Mapper

Map debriefer's `ScoredFinding` to deadonfilm's `RawSourceData` so claude-cleanup can consume the findings.

**Files:**

- Create: `server/src/lib/death-sources/debriefer/finding-mapper.ts`
- Test: `server/src/lib/death-sources/debriefer/__tests__/finding-mapper.test.ts`

**Step 1: Write the mapper**

The mapping is almost 1:1. Key differences:

- Debriefer uses `ReliabilityTier` enum from debriefer; deadonfilm has its own `ReliabilityTier` enum
- Debriefer's `costUsd` is always present; deadonfilm's is optional
- Deadonfilm's `sourceType` is a `DataSourceType` enum; we map from debriefer's string

```typescript
/**
 * Maps debriefer ScoredFinding[] to deadonfilm RawSourceData[].
 *
 * This is the bridge between debriefer's output and deadonfilm's
 * claude-cleanup input. The formats are nearly identical since
 * debriefer was extracted from deadonfilm.
 */

import type { ScoredFinding } from "debriefer"
import type { RawSourceData } from "../types.js"
import { DataSourceType, ReliabilityTier } from "../types.js"

/**
 * Maps a debriefer source type string to deadonfilm's DataSourceType enum.
 * Falls back to a generic type for sources not in the enum.
 */
function mapSourceType(sourceType: string): DataSourceType {
  // Debriefer source types use the same string values as DataSourceType
  const upper = sourceType.toUpperCase().replace(/-/g, "_")
  if (upper in DataSourceType) {
    return DataSourceType[upper as keyof typeof DataSourceType]
  }
  // For custom sources registered with their own type strings,
  // check if the original value is already a valid enum member
  if (Object.values(DataSourceType).includes(sourceType as DataSourceType)) {
    return sourceType as DataSourceType
  }
  return DataSourceType.OTHER
}

/**
 * Maps a debriefer ReliabilityTier string to deadonfilm's ReliabilityTier enum.
 */
function mapReliabilityTier(tier: string): ReliabilityTier {
  if (Object.values(ReliabilityTier).includes(tier as ReliabilityTier)) {
    return tier as ReliabilityTier
  }
  return ReliabilityTier.UNRELIABLE_UGC
}

/**
 * Converts debriefer ScoredFinding[] to deadonfilm RawSourceData[].
 */
export function mapFindings(findings: ScoredFinding[]): RawSourceData[] {
  return findings.map((f) => ({
    sourceName: f.sourceName,
    sourceType: mapSourceType(f.sourceType),
    text: f.text,
    url: f.url,
    confidence: f.confidence,
    reliabilityTier: mapReliabilityTier(String(f.reliabilityTier)),
    reliabilityScore: f.reliabilityScore,
  }))
}
```

Note: Check deadonfilm's `DataSourceType` and `ReliabilityTier` enums in `server/src/lib/death-sources/types.ts` and adjust the mapping logic accordingly. The enum values should match since debriefer was extracted from deadonfilm.

**Step 2: Write tests**

Test that ScoredFinding fields map correctly to RawSourceData fields. Test fallback behavior for unknown source types.

**Step 3: Run tests and commit**

```bash
npx vitest run server/src/lib/death-sources/debriefer/__tests__/finding-mapper.test.ts
git add server/src/lib/death-sources/debriefer/
git commit -m "feat: add ScoredFinding → RawSourceData mapper"
```

---

### Task 3: Custom Source Wrappers

Create `BaseResearchSource` wrappers for the ~16 deadonfilm sources that don't have debriefer-sources equivalents. These wrap existing source logic in debriefer's interface.

**Files:**

- Create: `server/src/lib/death-sources/debriefer/custom-sources.ts`

**Approach:**

Each existing deadonfilm source extends `BaseDataSource` with a `performLookup()` method. The custom wrappers extend debriefer's `BaseResearchSource` and delegate to the existing source's lookup logic.

Rather than wrapping each source individually (16 separate classes), create a **generic adapter** that wraps any deadonfilm `BaseDataSource` as a debriefer `BaseResearchSource`:

```typescript
/**
 * Adapts a deadonfilm BaseDataSource to debriefer's BaseResearchSource interface.
 *
 * This allows deadonfilm-only sources (AI providers, niche sites) to run
 * inside debriefer's ResearchOrchestrator alongside debriefer-sources.
 */

import { BaseResearchSource, ReliabilityTier as DebrieferTier } from "debriefer"
import type { ResearchSubject, RawFinding } from "debriefer"
import type { BaseDataSource } from "../base-source.js"
import type { ActorForEnrichment } from "../types.js"

// Map deadonfilm reliability tiers to debriefer's enum
const TIER_MAP: Record<string, DebrieferTier> = {
  STRUCTURED_DATA: DebrieferTier.STRUCTURED_DATA,
  TIER_1_NEWS: DebrieferTier.TIER_1_NEWS,
  TRADE_PRESS: DebrieferTier.TRADE_PRESS,
  ARCHIVAL: DebrieferTier.ARCHIVAL,
  SECONDARY_COMPILATION: DebrieferTier.SECONDARY_COMPILATION,
  SEARCH_AGGREGATOR: DebrieferTier.SEARCH_AGGREGATOR,
  ARCHIVE_MIRROR: DebrieferTier.ARCHIVE_MIRROR,
  MARGINAL_EDITORIAL: DebrieferTier.MARGINAL_EDITORIAL,
  MARGINAL_MIXED: DebrieferTier.MARGINAL_MIXED,
  AI_MODEL: DebrieferTier.AI_MODEL,
  UNRELIABLE_FAST: DebrieferTier.UNRELIABLE_FAST,
  UNRELIABLE_UGC: DebrieferTier.UNRELIABLE_UGC,
}

export class LegacySourceAdapter extends BaseResearchSource<ResearchSubject> {
  readonly name: string
  readonly type: string
  readonly reliabilityTier: DebrieferTier
  readonly domain: string
  readonly isFree: boolean
  readonly estimatedCostPerQuery: number

  constructor(private legacySource: BaseDataSource) {
    super()
    this.name = legacySource.name
    this.type = legacySource.type
    this.reliabilityTier =
      TIER_MAP[String(legacySource.reliabilityTier)] ?? DebrieferTier.UNRELIABLE_UGC
    this.domain = legacySource.domain ?? legacySource.name.toLowerCase().replace(/\s+/g, "-")
    this.isFree = legacySource.isFree
    this.estimatedCostPerQuery = legacySource.estimatedCostPerQuery ?? 0
  }

  async fetchResult(subject: ResearchSubject, signal?: AbortSignal): Promise<RawFinding | null> {
    // Build the actor object that legacy sources expect
    const actor: ActorForEnrichment = {
      id: typeof subject.id === "number" ? subject.id : 0,
      name: subject.name,
      ...((subject.context as Record<string, unknown>) ?? {}),
    }

    const result = await this.legacySource.lookup(actor, signal)
    if (!result) return null

    return {
      text: result.text,
      url: result.url,
      confidence: result.confidence,
      costUsd: result.costUsd ?? 0,
    }
  }

  isAvailable(): boolean {
    return this.legacySource.isAvailable?.() ?? true
  }
}

/**
 * Wraps an array of legacy deadonfilm sources as debriefer BaseResearchSource[].
 */
export function adaptLegacySources(
  sources: BaseDataSource[]
): BaseResearchSource<ResearchSubject>[] {
  return sources.map((s) => new LegacySourceAdapter(s))
}
```

Note: The exact `BaseDataSource` interface, `ActorForEnrichment` type, and `SourceLookupResult` shape need to be verified from `server/src/lib/death-sources/base-source.ts` and `types.ts`. Adjust field mappings accordingly.

**Step 1: Implement and test the adapter**

**Step 2: Commit**

```bash
git add server/src/lib/death-sources/debriefer/custom-sources.ts
git commit -m "feat: add LegacySourceAdapter for deadonfilm-only sources"
```

---

### Task 4: Debriefer Adapter

The main integration piece. Creates a `ResearchOrchestrator` configured for death enrichment, combining debriefer-sources with adapted legacy sources.

**Files:**

- Create: `server/src/lib/death-sources/debriefer/adapter.ts`
- Test: `server/src/lib/death-sources/debriefer/__tests__/adapter.test.ts`

**Step 1: Write the adapter**

```typescript
/**
 * Debriefer adapter for death enrichment.
 *
 * Creates a ResearchOrchestrator with:
 * - Standard sources from debriefer-sources (26 sources)
 * - Adapted legacy sources from deadonfilm (16 sources)
 * - Phase groups matching deadonfilm's existing 8-phase structure
 * - NoopSynthesizer (claude-cleanup runs separately)
 */

import { ResearchOrchestrator, NoopSynthesizer } from "debriefer"
import type {
  ResearchSubject,
  ResearchConfig,
  SourcePhaseGroup,
  ScoredFinding,
  DebriefResult,
} from "debriefer"
import {
  // Import all debriefer-sources factories
  wikidata,
  wikipedia,
  googleSearch,
  bingSearch,
  braveSearch,
  duckduckgoSearch,
  apNews,
  bbcNews,
  reuters,
  guardian,
  nytimes,
  npr,
  independent,
  telegraph,
  washingtonPost,
  laTimes,
  time,
  newYorker,
  pbs,
  rollingStone,
  nationalGeographic,
  people,
  findAGrave,
  legacy,
  googleBooks,
  openLibrary,
  chroniclingAmerica,
  trove,
  europeana,
  internetArchive,
} from "debriefer-sources"
import { adaptLegacySources } from "./custom-sources.js"
import { mapFindings } from "./finding-mapper.js"
import type { RawSourceData, EnrichmentConfig } from "../types.js"

// Import deadonfilm-only source classes for legacy adapter
// (list the actual imports from deadonfilm's sources/)

export interface DebriefAdapterConfig {
  free?: boolean
  paid?: boolean
  ai?: boolean
  maxCostPerActor?: number
  earlyStopThreshold?: number
  confidenceThreshold?: number
  reliabilityThreshold?: number
}

export interface DebriefAdapterResult {
  rawSources: RawSourceData[]
  totalCostUsd: number
  sourcesAttempted: number
  sourcesSucceeded: number
  durationMs: number
  stoppedAtPhase?: number
}

/**
 * Runs death enrichment for a single actor using debriefer's orchestrator.
 */
export async function debriefActor(
  actor: { id: number | string; name: string; context?: Record<string, unknown> },
  config: DebriefAdapterConfig
): Promise<DebriefAdapterResult> {
  const phases = buildPhases(config)

  const orchestratorConfig: ResearchConfig = {
    earlyStopThreshold: config.earlyStopThreshold,
    confidenceThreshold: config.confidenceThreshold,
    reliabilityThreshold: config.reliabilityThreshold,
    costLimits: {
      maxCostPerSubject: config.maxCostPerActor,
    },
  }

  const orchestrator = new ResearchOrchestrator(phases, new NoopSynthesizer(), orchestratorConfig)

  const subject: ResearchSubject = {
    id: actor.id,
    name: actor.name,
    context: actor.context,
  }

  const result = await orchestrator.debrief(subject)

  return {
    rawSources: mapFindings(result.findings),
    totalCostUsd: result.totalCostUsd,
    sourcesAttempted: result.sourcesAttempted,
    sourcesSucceeded: result.sourcesSucceeded,
    durationMs: result.durationMs,
    stoppedAtPhase: result.stoppedAtPhase,
  }
}

/**
 * Builds source phase groups matching deadonfilm's 8-phase structure.
 */
function buildPhases(config: DebriefAdapterConfig): SourcePhaseGroup<ResearchSubject>[] {
  const phases: SourcePhaseGroup<ResearchSubject>[] = []

  // Phase 1: Structured Data (always free)
  if (config.free !== false) {
    phases.push({
      phase: 1,
      name: "Structured Data",
      sources: [wikidata(), wikipedia()],
    })
  }

  // Phase 2: Web Search (free)
  if (config.free !== false) {
    phases.push({
      phase: 2,
      name: "Web Search",
      sources: [googleSearch(), bingSearch(), braveSearch(), duckduckgoSearch()],
    })
  }

  // Phase 3: News (mix of free site-search and paid API)
  // Debriefer-sources news + legacy deadonfilm news sources
  const newsSources = [
    apNews(),
    bbcNews(),
    reuters(),
    npr(),
    independent(),
    telegraph(),
    washingtonPost(),
    laTimes(),
    time(),
    newYorker(),
    pbs(),
    rollingStone(),
    nationalGeographic(),
    people(),
  ]
  // Add paid API sources if enabled
  if (config.paid !== false) {
    newsSources.push(guardian(), nytimes())
  }
  // Add legacy deadonfilm-only news sources via adapter
  // e.g., adaptLegacySources([new VarietySource(), new DeadlineSource(), ...])

  phases.push({ phase: 3, name: "News", sources: newsSources })

  // Phase 4: Obituary
  phases.push({
    phase: 4,
    name: "Obituary",
    sources: [findAGrave(), legacy()],
  })

  // Phase 5: Books
  phases.push({
    phase: 5,
    name: "Books",
    sources: [googleBooks(), openLibrary()],
    // Add IABooksDeathSource via adapter if needed
  })

  // Phase 6: Archives
  phases.push({
    phase: 6,
    name: "Archives",
    sources: [chroniclingAmerica(), trove(), europeana(), internetArchive()],
  })

  // Phase 7: Genealogy (legacy sources only)
  // phases.push({ phase: 7, name: "Genealogy", sources: adaptLegacySources([new FamilySearchSource()]) })

  // Phase 8: AI Models (legacy sources only, if enabled)
  if (config.ai) {
    // phases.push({ phase: 8, name: "AI Models", sources: adaptLegacySources([...aiSources]) })
  }

  return phases
}
```

Note: The exact source imports and legacy source instantiation need to be filled in based on the actual deadonfilm source classes. The `buildPhases` function should match the existing 8-phase structure from `DeathEnrichmentOrchestrator`.

**Step 2: Write tests with mocked debriefer**

**Step 3: Commit**

```bash
git add server/src/lib/death-sources/debriefer/
git commit -m "feat: add debriefer adapter for death enrichment"
```

---

### Task 5: Wire Into Enrichment Runner

Replace the `DeathEnrichmentOrchestrator.enrichActor()` call in `enrichment-runner.ts` with the debriefer adapter.

**Files:**

- Modify: `server/src/lib/enrichment-runner.ts`

**Step 1: Replace orchestrator call**

In the `processActor` function (~line 367), replace:

```typescript
enrichment = await orchestrator.enrichActor(actor)
```

With:

```typescript
const debriefResult = await debriefActor(
  {
    id: actor.id,
    name: actor.name,
    context: { deathday: actor.deathday, birthday: actor.birthday },
  },
  { free, paid, ai, maxCostPerActor, earlyStopThreshold, confidenceThreshold, reliabilityThreshold }
)
```

Then pass `debriefResult.rawSources` to `cleanupWithClaude()` (which already accepts `RawSourceData[]`).

The rest of the pipeline (claude cleanup → DB write → entity linking) stays unchanged.

**Step 2: Verify existing tests still pass**

```bash
npm test
```

**Step 3: Commit**

```bash
git add server/src/lib/enrichment-runner.ts
git commit -m "feat: wire debriefer adapter into enrichment runner"
```

---

### Task 6: Integration Testing

Test the full pipeline end-to-end with mocked sources.

**Step 1: Run existing enrichment tests**

```bash
npm test
```

**Step 2: Manual smoke test with a single actor**

```bash
cd /Users/chris/Source/deadonfilm
npx tsx server/scripts/enrich-death-details.ts --actor-ids 12345 --limit 1 --free --no-claude-cleanup --dry-run
```

This verifies that the debriefer orchestrator runs sources and returns findings without touching the database.

**Step 3: Full test with claude cleanup**

```bash
npx tsx server/scripts/enrich-death-details.ts --actor-ids 12345 --limit 1 --free
```

Verify the output matches what the old pipeline would produce.

**Step 4: Commit**

```bash
git add -A
git commit -m "test: verify debriefer integration end-to-end"
```

---

### Task 7: Cleanup and PR

**Step 1: Run full test suite**

```bash
npm test
npm run type-check
npm run lint
```

**Step 2: Push and create PR**

```bash
git push -u origin feat/debriefer-integration
```

Create PR in the deadonfilm repo.

---

## Task Order

1. **Task 1** — Add dependencies
2. **Task 2** — Finding mapper
3. **Task 3** — Custom source wrappers (LegacySourceAdapter)
4. **Task 4** — Debriefer adapter (main integration)
5. **Task 5** — Wire into enrichment runner
6. **Task 6** — Integration testing
7. **Task 7** — Cleanup and PR

## Key Risk: Source Behavior Differences

Debriefer-sources implementations were extracted from deadonfilm but may have diverged. The most important verification is that the `ScoredFinding` output from debriefer-sources matches what deadonfilm's claude-cleanup expects. The finding mapper (Task 2) is the safety layer — if field names or formats differ, fix the mapper rather than changing either codebase.
