# Debriefer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract deadonfilm's enrichment pipeline into a standalone, containerized multi-source research orchestration engine with npm, MCP, and Python interfaces.

**Architecture:** TypeScript monorepo (npm workspaces + turborepo) with 5 packages: core engine, built-in sources, CLI, HTTP server, and MCP server. Plus a Python client. Core is generic via `ResearchOrchestrator<TSubject, TOutput>`. Sources extend `BaseResearchSource<TSubject>`. AI synthesis is pluggable via `Synthesizer<TSubject, TOutput>` interface. Infrastructure (cache, telemetry) is injected, not hardwired.

**Tech Stack:** TypeScript 5.x, Node.js 22, npm workspaces, turborepo, vitest, Express/Fastify, Commander.js, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, Docker, Pydantic (Python client)

**Reference design:** `docs/plans/2026-03-07-debriefer-design.md`

**Reference architecture (deadonfilm source):**

- Shared utils: `server/src/lib/shared/` (concurrency.ts, readability-extract.ts, sanitize-source-text.ts, duckduckgo-search.ts, fetch-page-with-fallbacks.ts)
- Death base source: `server/src/lib/death-sources/base-source.ts`
- Bio base source: `server/src/lib/biography-sources/base-source.ts`
- Death orchestrator: `server/src/lib/death-sources/orchestrator.ts`
- Bio orchestrator: `server/src/lib/biography-sources/orchestrator.ts`
- Death types: `server/src/lib/death-sources/types.ts`
- Bio types: `server/src/lib/biography-sources/types.ts`
- Reliability tiers: `server/src/lib/death-sources/types.ts` (ReliabilityTier enum, RELIABILITY_SCORES)
- Claude synthesis (death): `server/src/lib/death-sources/claude-cleanup.ts`
- Claude synthesis (bio): `server/src/lib/biography-sources/claude-cleanup.ts`
- Cache: `server/src/lib/death-sources/cache.ts`
- HTML utils: `server/src/lib/death-sources/html-utils.ts`

---

## Phase 1: Repository Scaffold

### Task 1: Create debriefer repo and monorepo structure

**Files:**

- Create: `debriefer/` repo with full directory structure
- Create: `package.json` (workspace root)
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/sources/package.json`
- Create: `packages/sources/tsconfig.json`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`

**Step 1: Create GitHub repo**

```bash
mkdir debriefer && cd debriefer
git init
```

**Step 2: Create workspace root package.json**

```json
{
  "name": "debriefer-monorepo",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "type-check": "turbo type-check"
  },
  "devDependencies": {
    "turbo": "^2",
    "typescript": "^5.7",
    "vitest": "^3",
    "prettier": "^3",
    "eslint": "^9"
  }
}
```

**Step 3: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {},
    "type-check": {
      "dependsOn": ["^build"]
    }
  }
}
```

**Step 4: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

**Step 5: Create package directories and package.json files**

For `packages/core/package.json`:

```json
{
  "name": "debriefer",
  "version": "0.1.0",
  "description": "Multi-source research orchestration engine with reliability scoring",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "type-check": "tsc --noEmit",
    "lint": "eslint src/"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39",
    "p-limit": "^6",
    "zod": "^3"
  },
  "peerDependencies": {
    "ioredis": "^5"
  },
  "peerDependenciesMeta": {
    "ioredis": { "optional": true }
  }
}
```

For `packages/sources/package.json`:

```json
{
  "name": "debriefer-sources",
  "version": "0.1.0",
  "description": "Built-in source integrations for debriefer",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "dependencies": {
    "debriefer": "workspace:*",
    "@mozilla/readability": "^0.5",
    "jsdom": "^25",
    "he": "^1",
    "wtf_wikipedia": "^10",
    "fast-xml-parser": "^4"
  },
  "optionalDependencies": {
    "playwright-core": "^1.50",
    "fingerprint-injector": "^2"
  }
}
```

For `packages/cli/package.json`:

```json
{
  "name": "debriefer-cli",
  "version": "0.1.0",
  "description": "CLI for debriefer research engine",
  "type": "module",
  "bin": { "debriefer": "dist/index.js" },
  "dependencies": {
    "debriefer": "workspace:*",
    "debriefer-sources": "workspace:*",
    "commander": "^13"
  }
}
```

For `packages/server/package.json`:

```json
{
  "name": "debriefer-server",
  "version": "0.1.0",
  "description": "HTTP server for debriefer research engine",
  "type": "module",
  "dependencies": {
    "debriefer": "workspace:*",
    "debriefer-sources": "workspace:*",
    "express": "^4",
    "cors": "^2",
    "zod": "^3"
  }
}
```

For `packages/mcp/package.json`:

```json
{
  "name": "debriefer-mcp",
  "version": "0.1.0",
  "description": "MCP server for debriefer research engine",
  "type": "module",
  "bin": { "debriefer-mcp": "dist/index.js" },
  "dependencies": {
    "debriefer": "workspace:*",
    "debriefer-sources": "workspace:*",
    "@modelcontextprotocol/sdk": "^1"
  }
}
```

**Step 6: Run `npm install` and verify workspace links**

```bash
npm install
npx turbo build --dry-run
```

**Step 7: Create .gitignore, LICENSE, README stub**

**Step 8: Commit**

```bash
git add .
git commit -m "feat: scaffold monorepo with 5 packages"
```

---

## Phase 2: Core Types & Reliability

### Task 2: Implement core type system

**Files:**

- Create: `packages/core/src/types.ts`
- Test: `packages/core/src/__tests__/types.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/types.test.ts
import { describe, it, expect } from "vitest"
import type { ResearchSubject, RawFinding, ScoredFinding, ResearchConfig } from "../types.js"

describe("core types", () => {
  it("ResearchSubject accepts minimal fields", () => {
    const subject: ResearchSubject = { id: "1", name: "Test" }
    expect(subject.name).toBe("Test")
  })

  it("ResearchSubject accepts context", () => {
    const subject: ResearchSubject = {
      id: 1,
      name: "John Wayne",
      context: { deathday: "1979-06-11", tmdbId: 2157 },
    }
    expect(subject.context?.deathday).toBe("1979-06-11")
  })

  it("RawFinding has required and optional fields", () => {
    const finding: RawFinding = {
      text: "He died of stomach cancer.",
      confidence: 0.85,
      costUsd: 0,
    }
    expect(finding.url).toBeUndefined()
    expect(finding.confidence).toBe(0.85)
  })

  it("ResearchConfig has sensible defaults expressible", () => {
    const config: ResearchConfig = {
      concurrency: 5,
      confidenceThreshold: 0.6,
      reliabilityThreshold: 0.6,
      earlyStopThreshold: 3,
      costLimits: { maxCostPerSubject: 0.5 },
    }
    expect(config.concurrency).toBe(5)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd packages/core && npx vitest run src/__tests__/types.test.ts
```

Expected: FAIL (module not found)

**Step 3: Implement types.ts**

Extract and generalize from `server/src/lib/death-sources/types.ts` and `server/src/lib/biography-sources/types.ts`. See design doc Section 2 for full type definitions. Key types:

- `ResearchSubject` (id, name, context)
- `RawFinding` (text, url, publication, articleTitle, confidence, costUsd, metadata)
- `ScoredFinding extends RawFinding` (+ sourceType, sourceName, reliabilityTier, reliabilityScore)
- `SynthesisOptions` (model, maxTokens, systemPrompt)
- `SynthesisResult<TOutput>` (data, costUsd, inputTokens, outputTokens, model)
- `DebriefResult<TOutput>` (subject, data, findings, synthesisResult, totalCostUsd, sourcesAttempted, sourcesSucceeded, stoppedAtPhase, duration)
- `ResearchConfig` (categories, concurrency, thresholds, costLimits, synthesis, cache, telemetry)
- `SourcePhaseGroup<TSubject>` (phase number, sources array)
- `BatchProgressStats` (completed, total, costUsd, elapsed)
- `BatchStats` (extends BatchProgressStats + perSubjectResults)

**Step 4: Run test to verify it passes**

```bash
cd packages/core && npx vitest run src/__tests__/types.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/__tests__/types.test.ts
git commit -m "feat(core): add core type system"
```

### Task 3: Implement reliability scoring

**Files:**

- Create: `packages/core/src/reliability.ts`
- Test: `packages/core/src/__tests__/reliability.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/reliability.test.ts
import { describe, it, expect } from "vitest"
import { ReliabilityTier, RELIABILITY_SCORES, getReliabilityScore } from "../reliability.js"

describe("ReliabilityTier", () => {
  it("has all 12 tiers", () => {
    expect(Object.keys(ReliabilityTier)).toHaveLength(12)
  })

  it("TIER_1_NEWS scores 0.95", () => {
    expect(RELIABILITY_SCORES[ReliabilityTier.TIER_1_NEWS]).toBe(0.95)
  })

  it("UNRELIABLE_UGC scores 0.35", () => {
    expect(RELIABILITY_SCORES[ReliabilityTier.UNRELIABLE_UGC]).toBe(0.35)
  })

  it("getReliabilityScore returns correct score", () => {
    expect(getReliabilityScore(ReliabilityTier.STRUCTURED_DATA)).toBe(1.0)
  })

  it("scores are ordered descending", () => {
    const tiers = Object.values(ReliabilityTier)
    const scores = tiers.map((t) => RELIABILITY_SCORES[t])
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1])
    }
  })
})
```

**Step 2: Run test to verify it fails**

**Step 3: Implement reliability.ts**

Extract from `server/src/lib/death-sources/types.ts` — the `ReliabilityTier` enum and `RELIABILITY_SCORES` map. Add `getReliabilityScore()` helper. Add JSDoc referencing Wikipedia RSP.

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add packages/core/src/reliability.ts packages/core/src/__tests__/reliability.test.ts
git commit -m "feat(core): add Wikipedia RSP-based reliability scoring"
```

---

## Phase 3: Core Infrastructure

### Task 4: Implement SourceRateLimiter

**Files:**

- Create: `packages/core/src/rate-limiter.ts`
- Test: `packages/core/src/__tests__/rate-limiter.test.ts`

**Reference:** `server/src/lib/shared/concurrency.ts` — `SourceRateLimiter` class

**Step 1: Write the failing test**

Test that: concurrent calls to the same domain are serialized with delay, different domains run in parallel, custom delay per domain works.

**Step 2: Run test to verify it fails**

**Step 3: Implement rate-limiter.ts**

Extract `SourceRateLimiter` from `server/src/lib/shared/concurrency.ts`. Remove the `SourcePhase` import dependency — the rate limiter doesn't need it. Keep the per-key async queue, configurable delay, and `execute<T>(key, fn)` method.

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git commit -m "feat(core): add per-domain SourceRateLimiter"
```

### Task 5: Implement BatchCostTracker

**Files:**

- Create: `packages/core/src/cost-tracker.ts`
- Test: `packages/core/src/__tests__/cost-tracker.test.ts`

**Reference:** `server/src/lib/shared/concurrency.ts` — `BatchCostTracker` class

**Step 1: Write the failing test**

Test: addCost, getTotalCost, getSubjectCost, isSubjectLimitExceeded, isTotalLimitExceeded, concurrent cost additions are safe.

**Step 2-5:** Implement, test, commit.

### Task 6: Implement ParallelBatchRunner

**Files:**

- Create: `packages/core/src/batch-runner.ts`
- Test: `packages/core/src/__tests__/batch-runner.test.ts`

**Reference:** `server/src/lib/shared/concurrency.ts` — `ParallelBatchRunner<T, R>` class

**Step 1: Write the failing test**

Test: processes items with bounded concurrency, reports progress via callback, handles errors per-item without failing batch, respects abort signal.

**Step 2-5:** Implement, test, commit.

### Task 7: Implement CacheProvider interface + InMemoryCache

**Files:**

- Create: `packages/core/src/cache/types.ts`
- Create: `packages/core/src/cache/in-memory.ts`
- Test: `packages/core/src/__tests__/cache.test.ts`

**Step 1: Write the failing test**

Test: get/set/delete, TTL expiration (use `vi.useFakeTimers()`), cache miss returns null.

**Step 2-5:** Implement, test, commit.

### Task 8: Implement TelemetryProvider interface + ConsoleTelemetry

**Files:**

- Create: `packages/core/src/telemetry/types.ts`
- Create: `packages/core/src/telemetry/console.ts`
- Create: `packages/core/src/telemetry/noop.ts`
- Test: `packages/core/src/__tests__/telemetry.test.ts`

**Step 1: Write the failing test**

Test: ConsoleTelemetry logs events to console (spy), NoopTelemetry does nothing without error, startSpan returns a span with end() method.

**Step 2-5:** Implement, test, commit.

### Task 9: Implement confidence calculation

**Files:**

- Create: `packages/core/src/confidence.ts`
- Test: `packages/core/src/__tests__/confidence.test.ts`

**Reference:** `calculateConfidence()` in both `server/src/lib/death-sources/base-source.ts` and `server/src/lib/biography-sources/base-source.ts` — they're identical.

**Step 1: Write the failing test**

Test: returns 0 if no keywords found, returns 0.5 base from required keywords, adds bonus from circumstance keywords, caps at 1.0, accepts custom keyword lists.

The key generalization: instead of hardcoded `DEATH_KEYWORDS` and `BIO_REQUIRED_KEYWORDS`, `calculateConfidence()` accepts `requiredKeywords: string[]` and `bonusKeywords: string[]` as parameters.

**Step 2-5:** Implement, test, commit.

---

## Phase 4: Base Source + Orchestrator

### Task 10: Implement BaseResearchSource

**Files:**

- Create: `packages/core/src/base-source.ts`
- Test: `packages/core/src/__tests__/base-source.test.ts`

**Reference:** `server/src/lib/death-sources/base-source.ts` and `server/src/lib/biography-sources/base-source.ts`

**Step 1: Write the failing test**

Create a `TestSource extends BaseResearchSource<ResearchSubject>` that returns a fixed finding. Test: lookup returns finding, rate limiter is respected, cache is checked before lookup, cache is populated after lookup, timeout signal works, isAvailable() defaults to true.

**Step 2: Run test to verify it fails**

**Step 3: Implement base-source.ts**

Generalize from both deadonfilm base classes. Key changes from deadonfilm:

- Remove `DataSourceType` / `BiographySourceType` enum dependency — use `string` for type
- Accept `CacheProvider` injection instead of importing `death-sources/cache.ts` directly
- Accept `SourceRateLimiter` injection instead of importing it
- Accept `TelemetryProvider` injection instead of hardwired New Relic
- `calculateConfidence()` delegates to the standalone function from Task 9
- `buildQuery()` is a simple default that consumers override
- No domain-specific keyword lists — consumers provide their own via constructor options

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git commit -m "feat(core): add BaseResearchSource with caching, rate limiting, telemetry"
```

### Task 11: Implement Synthesizer interface + ClaudeSynthesizer

**Files:**

- Create: `packages/core/src/synthesizer.ts`
- Test: `packages/core/src/__tests__/synthesizer.test.ts`

**Reference:** `server/src/lib/death-sources/claude-cleanup.ts` and `server/src/lib/biography-sources/claude-cleanup.ts`

**Step 1: Write the failing test**

Mock `@anthropic-ai/sdk` to return a fixed JSON response. Test: synthesize() calls Claude with correct prompt structure, findings are sorted by reliability score, source text is truncated at configurable max chars, cost is calculated from token counts, JSON is parsed from response (with markdown code fence stripping).

**Step 2-5:** Implement, test, commit.

Key generalization: the synthesis prompt is provided by the consumer, not hardcoded. `ClaudeSynthesizer` accepts a `promptBuilder: (subject, findings) => string` function. The JSON response schema is validated via a consumer-provided zod schema.

### Task 12: Implement ResearchOrchestrator

**Files:**

- Create: `packages/core/src/orchestrator.ts`
- Test: `packages/core/src/__tests__/orchestrator.test.ts`

**Reference:** `server/src/lib/biography-sources/orchestrator.ts` (the cleaner of the two)

**Step 1: Write the failing test**

Create 3 mock sources across 2 phases. Test:

- `debrief()`: executes phases sequentially, sources within phase concurrently
- `debrief()`: accumulates all findings, passes to synthesizer
- `debrief()`: early stops when threshold met
- `debrief()`: respects cost limits
- `debriefBatch()`: processes multiple subjects with bounded concurrency
- `debriefBatch()`: fires lifecycle hooks at correct points
- `debriefBatch()`: continues on per-subject errors

**Step 2: Run test to verify it fails**

**Step 3: Implement orchestrator.ts**

Core algorithm (from both deadonfilm orchestrators):

1. For each subject: iterate phases sequentially
2. Within each phase: `Promise.allSettled()` all source lookups
3. Accumulate successful findings into `scoredFindings[]` (tag with reliability info)
4. Between phases: check early-stop condition (N+ high-quality source families)
5. Between phases: check cost limit
6. After all phases (or early stop): call `synthesizer.synthesize(subject, scoredFindings)`
7. Return `DebriefResult<TOutput>`

For `debriefBatch()`: wrap in `ParallelBatchRunner`, fire hooks, track costs via `BatchCostTracker`.

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git commit -m "feat(core): add ResearchOrchestrator with phased execution and early stopping"
```

### Task 13: Create core package index and verify build

**Files:**

- Create: `packages/core/src/index.ts` (re-exports all public API)

**Step 1: Create index.ts that exports everything**

```typescript
export { ResearchOrchestrator } from "./orchestrator.js"
export { BaseResearchSource } from "./base-source.js"
export { ClaudeSynthesizer } from "./synthesizer.js"
export { ReliabilityTier, RELIABILITY_SCORES, getReliabilityScore } from "./reliability.js"
export { SourceRateLimiter } from "./rate-limiter.js"
export { BatchCostTracker } from "./cost-tracker.js"
export { ParallelBatchRunner } from "./batch-runner.js"
export { InMemoryCache } from "./cache/in-memory.js"
export { ConsoleTelemetry } from "./telemetry/console.js"
export { NoopTelemetry } from "./telemetry/noop.js"
export { calculateConfidence } from "./confidence.js"
export type {} from /* all types */ "./types.js"
export type { CacheProvider } from "./cache/types.js"
export type { TelemetryProvider, TelemetrySpan } from "./telemetry/types.js"
```

**Step 2: Build and verify**

```bash
cd packages/core && npm run build
```

Expected: clean compilation, `dist/` populated with .js and .d.ts files

**Step 3: Run all core tests**

```bash
cd packages/core && npm test
```

Expected: all pass

**Step 4: Commit**

```bash
git commit -m "feat(core): complete core package with public API exports"
```

---

## Phase 5: Built-in Sources

### Task 14: Implement shared source utilities

**Files:**

- Create: `packages/sources/src/shared/readability-extract.ts`
- Create: `packages/sources/src/shared/sanitize-text.ts`
- Create: `packages/sources/src/shared/html-utils.ts`
- Create: `packages/sources/src/shared/duckduckgo-search.ts`
- Create: `packages/sources/src/shared/fetch-page.ts`
- Test: `packages/sources/src/__tests__/shared/` (one test per file)

**Reference:**

- `server/src/lib/shared/readability-extract.ts`
- `server/src/lib/shared/sanitize-source-text.ts`
- `server/src/lib/death-sources/html-utils.ts`
- `server/src/lib/shared/duckduckgo-search.ts`
- `server/src/lib/shared/fetch-page-with-fallbacks.ts`

Key changes: remove lazy imports from `death-sources/`. Browser fallback and archive fallback move into `shared/` directly. All functions accept dependencies via parameters (no `getPool()` calls, no `newrelic` imports).

**Step 1-5:** Implement each utility with tests, commit after each file.

### Task 15: Implement structured data sources (Wikidata, Wikipedia)

**Files:**

- Create: `packages/sources/src/structured/wikidata.ts`
- Create: `packages/sources/src/structured/wikipedia.ts`
- Test: `packages/sources/src/__tests__/structured/`

**Reference:**

- `server/src/lib/death-sources/sources/wikidata.ts`
- `server/src/lib/death-sources/sources/wikipedia.ts`
- `server/src/lib/biography-sources/sources/wikidata.ts`
- `server/src/lib/biography-sources/sources/wikipedia.ts`

Key change: each source is now generic, extending `BaseResearchSource<ResearchSubject>`. The consumer provides query-building logic via constructor options or by subclassing. The source itself handles the API call, parsing, and confidence calculation.

Each source exports a factory function:

```typescript
export function wikidata(options?: WikidataOptions): WikidataSource { ... }
export function wikipedia(options?: WikipediaOptions): WikipediaSource { ... }
```

**Step 1-5:** Implement with mocked HTTP tests, commit.

### Task 16: Implement web search sources

**Files:**

- Create: `packages/sources/src/web-search/google.ts`
- Create: `packages/sources/src/web-search/bing.ts`
- Create: `packages/sources/src/web-search/duckduckgo.ts`
- Create: `packages/sources/src/web-search/brave.ts`
- Create: `packages/sources/src/web-search/base.ts` (shared web search base with link following)
- Test: `packages/sources/src/__tests__/web-search/`

**Reference:**

- `server/src/lib/death-sources/sources/google-search.ts`
- `server/src/lib/death-sources/sources/bing-search.ts`
- `server/src/lib/death-sources/sources/duckduckgo-search.ts`
- `server/src/lib/death-sources/sources/brave-search.ts`
- `server/src/lib/death-sources/web-search-base.ts`

**Step 1-5:** Implement with mocked HTTP tests, commit.

### Task 17: Implement news sources

**Files:**

- Create: `packages/sources/src/news/guardian.ts`
- Create: `packages/sources/src/news/nytimes.ts`
- Create: `packages/sources/src/news/ap-news.ts`
- Create: `packages/sources/src/news/reuters.ts`
- Create: `packages/sources/src/news/bbc.ts`
- Create: (remaining news sources — see design doc for full list)
- Create: `packages/sources/src/news/base.ts` (shared news source base using DDG site: search)
- Test: `packages/sources/src/__tests__/news/`

**Reference:** `server/src/lib/death-sources/sources/` and `server/src/lib/biography-sources/sources/` — all news sources follow the same pattern (DDG `site:` search → link follow → extract).

**Step 1-5:** Implement with mocked tests, commit per batch of sources.

### Task 18: Implement book sources

**Files:**

- Create: `packages/sources/src/books/google-books.ts`
- Create: `packages/sources/src/books/open-library.ts`
- Create: `packages/sources/src/books/ia-books.ts`
- Test: `packages/sources/src/__tests__/books/`

**Reference:**

- `server/src/lib/shared/google-books-api.ts`
- `server/src/lib/shared/open-library-api.ts`
- `server/src/lib/shared/ia-books-api.ts`

**Step 1-5:** Implement with mocked tests, commit.

### Task 19: Implement archive sources

**Files:**

- Create: `packages/sources/src/archives/chronicling-america.ts`
- Create: `packages/sources/src/archives/trove.ts`
- Create: `packages/sources/src/archives/europeana.ts`
- Create: `packages/sources/src/archives/internet-archive.ts`
- Test: `packages/sources/src/__tests__/archives/`

**Reference:** `server/src/lib/death-sources/sources/` and `server/src/lib/biography-sources/sources/`

**Step 1-5:** Implement with mocked tests, commit.

### Task 20: Implement obituary sources

**Files:**

- Create: `packages/sources/src/obituary/find-a-grave.ts`
- Create: `packages/sources/src/obituary/legacy.ts`
- Test: `packages/sources/src/__tests__/obituary/`

**Step 1-5:** Implement with mocked tests, commit.

### Task 21: Create sources package index

**Files:**

- Create: `packages/sources/src/index.ts`

Export all sources as factory functions:

```typescript
export { wikidata } from "./structured/wikidata.js"
export { wikipedia } from "./structured/wikipedia.js"
export { googleSearch } from "./web-search/google.js"
// ... all sources
```

Also export shared utilities that consumers might need:

```typescript
export { extractArticle } from "./shared/readability-extract.js"
export { sanitizeText } from "./shared/sanitize-text.js"
export { htmlToText } from "./shared/html-utils.js"
```

Build, test all, commit.

---

## Phase 6: CLI

### Task 22: Implement CLI

**Files:**

- Create: `packages/cli/src/index.ts`
- Test: manual testing (CLI is thin wrapper)

**Reference:** `server/scripts/enrich-death-details.ts` and `server/scripts/enrich-biographies.ts` for Commander.js patterns.

```typescript
#!/usr/bin/env node
import { Command } from "commander"
import { ResearchOrchestrator, ClaudeSynthesizer } from "debriefer"
import * as sources from "debriefer-sources"

const program = new Command()
  .name("debriefer")
  .description("Multi-source research orchestration engine")
  .version("0.1.0")

program
  .command("debrief")
  .description("Research a subject")
  .argument("<name>", "Subject name to research")
  .option("--budget <amount>", "Max cost in USD", parseFloat, 1.0)
  .option("--categories <list>", "Comma-separated source categories", "structured,news,books")
  .option("--concurrency <n>", "Parallel subjects", parseInt, 5)
  .option("--model <model>", "Synthesis model", "claude-sonnet-4-20250514")
  .option("--prompt <prompt>", "Synthesis system prompt")
  .option("--format <format>", "Output format: json, text", "json")
  .option("--no-synthesis", "Skip AI synthesis, return raw findings only")
  .action(async (name, options) => {
    /* wire up orchestrator */
  })

program
  .command("sources")
  .description("List available sources")
  .action(async () => {
    /* list sources with tiers */
  })

program
  .command("serve")
  .description("Start HTTP server")
  .option("--port <port>", "Port", parseInt, 8090)
  .option("--config <path>", "Config file path", "debriefer.config.yml")
  .action(async (options) => {
    /* start server */
  })

program.parse()
```

Build, test manually, commit.

---

## Phase 7: HTTP Server + Docker

### Task 23: Implement HTTP server

**Files:**

- Create: `packages/server/src/index.ts`
- Create: `packages/server/src/routes/debrief.ts`
- Create: `packages/server/src/routes/runs.ts`
- Create: `packages/server/src/routes/sources.ts`
- Create: `packages/server/src/routes/health.ts`
- Create: `packages/server/src/middleware/auth.ts`
- Create: `packages/server/src/config.ts`
- Test: `packages/server/src/__tests__/routes/`

See design doc "HTTP Service" section for all endpoints. Use Express (familiar from deadonfilm). Zod for request validation.

**Step 1: Write failing tests for each route**

Test POST /api/debrief with mocked orchestrator. Test GET /api/sources returns source list. Test GET /api/health returns 200. Test auth middleware rejects missing API key.

**Step 2-5:** Implement routes, test, commit per route.

### Task 24: Implement config file loading

**Files:**

- Create: `packages/server/src/config.ts`
- Test: `packages/server/src/__tests__/config.test.ts`

Load `debriefer.config.yml` using Node.js `fs` + a YAML parser. Merge with environment variables (env vars take precedence). Validate with zod schema.

**Step 1-5:** Implement, test, commit.

### Task 25: Create Docker setup

**Files:**

- Create: `docker/Dockerfile`
- Create: `docker/docker-compose.yml`

See design doc "Docker" section for Dockerfile and compose file. Multi-stage build with optional Playwright browsers.

**Step 1: Create Dockerfile**

**Step 2: Create docker-compose.yml**

**Step 3: Build and test**

```bash
cd docker && docker compose build
docker compose up -d
curl http://localhost:8090/api/health
curl http://localhost:8090/api/sources
docker compose down
```

**Step 4: Commit**

```bash
git commit -m "feat(server): add HTTP server with Docker support"
```

---

## Phase 8: MCP Server

### Task 26: Implement MCP server

**Files:**

- Create: `packages/mcp/src/index.ts`
- Create: `packages/mcp/src/tools.ts`
- Test: `packages/mcp/src/__tests__/tools.test.ts`

**Reference:** `@modelcontextprotocol/sdk` docs. See design doc "MCP Server" section for tool definitions.

**Step 1: Write failing test**

Test that the MCP server registers all 6 tools (debrief, debrief_batch, get_run_status, get_run_results, list_sources, configure). Test that calling the `debrief` tool with a subject name invokes the orchestrator correctly. Test that `list_sources` returns source metadata.

**Step 2: Implement tools.ts**

Define each MCP tool with its input schema (JSON Schema), description, and handler. The `debrief` tool creates an orchestrator instance, calls `debrief()`, and returns the result as JSON.

**Step 3: Implement index.ts**

```typescript
#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { registerTools } from "./tools.js"

const server = new Server(
  { name: "debriefer", version: "0.1.0" },
  {
    capabilities: { tools: {} },
  }
)

registerTools(server)

const transport = new StdioServerTransport()
await server.connect(transport)
```

Support `--server <url>` flag to proxy to a running debriefer-server instance instead of running sources in-process.

**Step 4: Run test to verify it passes**

**Step 5: Build and test manually with Claude Code**

Add to `.claude/settings.json` and verify tools appear.

**Step 6: Commit**

```bash
git commit -m "feat(mcp): add MCP server for AI assistant integration"
```

---

## Phase 9: Python Client

### Task 27: Implement Python client

**Files:**

- Create: `clients/python/debriefer/__init__.py`
- Create: `clients/python/debriefer/client.py`
- Create: `clients/python/debriefer/types.py`
- Create: `clients/python/pyproject.toml`
- Test: `clients/python/tests/test_client.py`

**Step 1: Create pyproject.toml**

```toml
[project]
name = "debriefer"
version = "0.1.0"
description = "Python client for debriefer research orchestration engine"
requires-python = ">=3.10"
dependencies = ["httpx>=0.27", "pydantic>=2"]

[project.optional-dependencies]
dev = ["pytest>=8", "pytest-asyncio>=0.24", "respx>=0.22"]
```

**Step 2: Create Pydantic types matching TypeScript types**

```python
# clients/python/debriefer/types.py
from pydantic import BaseModel

class Subject(BaseModel):
    id: str | int
    name: str
    context: dict | None = None

class Finding(BaseModel):
    text: str
    url: str | None = None
    publication: str | None = None
    confidence: float
    cost_usd: float
    source_type: str
    source_name: str
    reliability_tier: str
    reliability_score: float

class DebriefResult(BaseModel):
    data: dict | None
    findings: list[Finding]
    total_cost_usd: float
    sources_attempted: int
    sources_succeeded: int
    stopped_at_phase: int | None = None
    duration_ms: int
```

**Step 3: Implement client.py**

See design doc "Python Client" section. Use `httpx` for async HTTP. Expose sync and async interfaces.

**Step 4: Write tests with mocked HTTP (using respx)**

**Step 5: Commit**

```bash
git commit -m "feat(python): add Python client for debriefer server"
```

---

## Phase 10: Deadonfilm Consumer Refactor

This phase happens on the `feat/debriefer-extraction` branch of the deadonfilm repo.

### Task 28: Create experimental branch on deadonfilm

```bash
cd /Users/chris/Source/deadonfilm
git checkout -b feat/debriefer-extraction
```

### Task 29: Add debriefer as dependency

```bash
# During development, use a local file reference or npm link
# Once published: npm install debriefer debriefer-sources
```

### Task 30: Refactor biography enrichment to use debriefer

**Files:**

- Modify: `server/src/lib/biography-sources/orchestrator.ts`
- Create: `server/src/lib/biography-sources/debriefer-adapter.ts`

The biography orchestrator is the cleaner of the two — refactor it first.

**Approach:** Create an adapter that:

1. Maps `ActorForBiography` → `ResearchSubject` (with context fields)
2. Wraps existing biography sources as `BaseResearchSource<ResearchSubject>` instances
3. Provides the biography synthesis prompt to `ClaudeSynthesizer`
4. Provides a zod schema for `BiographyData` output
5. Maps `DebriefResult<BiographyData>` → existing `BiographyResult` type

This is the validation step — if debriefer can serve biography enrichment cleanly, the abstraction works.

**Step 1: Write integration test** comparing old orchestrator output vs debriefer-backed output for a golden test actor.

**Step 2: Implement adapter**

**Step 3: Run biography enrichment with adapter, verify output matches**

**Step 4: Commit**

### Task 31: Refactor death enrichment to use debriefer

Same pattern as Task 30 but for death enrichment. Additional complexity: link-follow config, AI models phase.

### Task 32: Verify both enrichment systems work end-to-end

Run both enrichment scripts on the experimental branch. Verify results match or improve on the current system. Run golden tests for biography.

---

## Phase 11: Polish and Publish

### Task 33: Write README

Cover: installation, quick start, core concepts (subjects, sources, reliability, phases), configuration, Docker, MCP, Python client, adding custom sources.

### Task 34: Add RedisCache and SqliteCache implementations

**Files:**

- Create: `packages/core/src/cache/redis.ts`
- Create: `packages/core/src/cache/sqlite.ts`
- Test: `packages/core/src/__tests__/cache-redis.test.ts` (use ioredis-mock)
- Test: `packages/core/src/__tests__/cache-sqlite.test.ts` (use better-sqlite3)

### Task 35: Add OpenTelemetry provider

**Files:**

- Create: `packages/core/src/telemetry/opentelemetry.ts`
- Test: `packages/core/src/__tests__/telemetry-otel.test.ts`

### Task 36: Publish to npm

```bash
# Verify all tests pass
npx turbo test

# Verify builds
npx turbo build

# Publish (each package)
cd packages/core && npm publish --access public
cd packages/sources && npm publish --access public
cd packages/cli && npm publish --access public
cd packages/server && npm publish --access public
cd packages/mcp && npm publish --access public
```

### Task 37: Publish Python client to PyPI

```bash
cd clients/python
pip install build twine
python -m build
twine upload dist/*
```

### Task 38: Push Docker image

```bash
docker build -t debriefer/debriefer:0.1.0 -f docker/Dockerfile .
docker push debriefer/debriefer:0.1.0
```
