# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Debriefer is a standalone multi-source research orchestration engine. It orchestrates 60+ data sources with Wikipedia RSP-based reliability scoring, phased execution with early stopping, per-query cost control, and pluggable AI synthesis. Originally extracted from the [deadonfilm](https://github.com/chenders/deadonfilm) enrichment pipeline.

## Monorepo Structure

```
debriefer/
├── packages/
│   ├── core/       # "@debriefer/core" — orchestration engine (COMPLETE)
│   ├── sources/    # "@debriefer/sources" — 60+ built-in source integrations
│   ├── cli/        # "@debriefer/cli" — CLI tool (bin: debriefer)
│   ├── server/     # "@debriefer/server" — HTTP service
│   └── mcp/        # "@debriefer/mcp" — MCP server for AI assistants
├── clients/
│   └── python/     # PyPI "debriefer" — Python HTTP client
├── docs/
│   └── plans/      # Implementation plans (future use)
└── docker/         # Dockerfile + docker-compose.yml
```

**Tooling**: npm workspaces, turborepo, TypeScript 5.x, vitest, Node.js 22

## Git Workflow

**Main branch is protected — all changes go through PRs.**

1. Create a feature branch: `git checkout -b feat/descriptive-name` (or `fix/`, `chore/`, `docs/`)
2. Make changes, commit with descriptive messages
3. Push branch: `git push -u origin feat/descriptive-name`
4. Create PR: `gh pr create --title "..." --body "..."`
5. PR gets Copilot auto-review
6. Merge after review

**Never push directly to main.** Branch protection is enforced on GitHub.

### Branch Naming

| Prefix   | Use Case                  | Example                     |
| -------- | ------------------------- | --------------------------- |
| `feat/`  | New features, new sources | `feat/wikipedia-source`     |
| `fix/`   | Bug fixes                 | `fix/early-stop-counting`   |
| `chore/` | Maintenance, deps         | `chore/update-dependencies` |
| `docs/`  | Documentation only        | `docs/add-source-guide`     |

## Common Commands

```bash
# Root
npm run build          # turbo build (all packages)
npm test               # turbo test (all packages)
npm run type-check     # turbo type-check (all packages)

# Per-package
cd packages/core
npm run build          # tsc
npm test               # vitest run
npm run type-check     # tsc --noEmit
npx vitest run src/__tests__/orchestrator.test.ts  # single test file
```

### Pre-Push Verification

**Before pushing any branch, always run:**

```bash
npx turbo test lint type-check        # all packages
npx prettier --check .                # formatting (root-level, catches docs too)
```

CI runs Format Check (`prettier --check .`), Lint, Build, Test, Type Check, and Dependency Audit. All six must pass before merging.

### Copilot Review Loop

After pushing fixes for Copilot review comments, re-request a review and keep looping until clean:

1. Re-request the review:
   ```bash
   gh api repos/chenders/debriefer/pulls/{PR_NUMBER}/requested_reviewers -X POST -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
   ```
2. Poll until the new review appears (check review count increases).
3. Run `/respond-to-copilot` to address any new comments.
4. Repeat from step 1 until a review comes back with no new comments.

**Common CI failures to avoid:**

- **Format Check**: Prettier runs at root level (`prettier --check .`) and checks ALL files including `CLAUDE.md`, etc. — not just `src/`. Always run `npx prettier --write .` before committing.
- **Lint**: ESLint catches issues like empty interfaces (`@typescript-eslint/no-empty-object-type`). Use `type Foo = Bar` instead of `interface Foo extends Bar {}` when adding no members.
- **Subagent output**: Subagents don't run prettier or lint. After cherry-picking or merging subagent work, always run `npx prettier --write` on their files and `npx turbo lint` before committing.

## Architecture

### Core Package (`packages/core/` — "@debriefer/core")

The core is generic via TypeScript generics: `ResearchOrchestrator<TSubject, TOutput>`.

| Module              | File                                        | Purpose                                                                           |
| ------------------- | ------------------------------------------- | --------------------------------------------------------------------------------- |
| Orchestrator        | `orchestrator.ts`                           | Phased execution, early stopping, batch processing, lifecycle hooks               |
| BaseResearchSource  | `base-source.ts`                            | Abstract base class for all sources (caching, rate limiting, timeout, confidence) |
| ClaudeSynthesizer   | `synthesizer.ts`                            | AI synthesis via Anthropic SDK; also NoopSynthesizer for raw findings             |
| ReliabilityTier     | `reliability.ts`                            | 12-tier scoring based on Wikipedia RSP (0.0–1.0)                                  |
| SourceRateLimiter   | `rate-limiter.ts`                           | Per-domain async queue preventing thundering herd                                 |
| BatchCostTracker    | `cost-tracker.ts`                           | Per-subject and total cost limits                                                 |
| ParallelBatchRunner | `batch-runner.ts`                           | Concurrency-limited batch processor with p-limit                                  |
| InMemoryCache       | `cache/in-memory.ts`                        | CacheProvider with TTL and optional maxSize eviction                              |
| Telemetry           | `telemetry/console.ts`, `telemetry/noop.ts` | Pluggable observability                                                           |
| Confidence          | `confidence.ts`                             | Generic keyword-based confidence scoring                                          |
| Types               | `types.ts`                                  | All core interfaces, error classes                                                |

### Key Design Principles

1. **Domain knowledge lives in the consumer, not the engine** — Synthesis prompts, output schemas, query builders, and source selections are all consumer-provided. Debriefer provides orchestration, reliability scoring, cost control, and phased execution.

2. **Infrastructure is injected, not hardwired** — Cache, telemetry, and rate limiting are injected interfaces. No hardcoded New Relic, no hardcoded Redis, no hardcoded database.

3. **Two-axis quality model** — Source reliability (publisher trustworthiness, from RSP) and content confidence (does this page answer the question?) are independent. Both must meet thresholds for a finding to count as "high quality."

4. **Phased execution with early stopping** — Sources execute in phases (cheap first, expensive later). The orchestrator stops after `earlyStopThreshold` distinct high-quality source families are found.

### Source Family Counting (Early Stopping)

A "source family" is a unique `sourceType` string. Early stopping counts distinct source types whose findings meet BOTH the confidence threshold AND the reliability threshold. Do NOT count by `reliabilityTier` — multiple different sources can share the same tier.

## Dependencies Policy

### Core package (`@debriefer/core`)

The core has ONE hard dependency: `p-limit`. Everything else is optional or injected:

- `@anthropic-ai/sdk` — **optional peer dependency**. Only needed if using `ClaudeSynthesizer`. Consumers using their own synthesizer don't need it.
- `ioredis`, `better-sqlite3`, etc. — NOT dependencies. Cache implementations that need them go in separate packages or consumers provide their own.
- `zod` — NOT a dependency. Consumers bring their own validation in `responseParser` callbacks.

**Rule**: Do not add hard dependencies to the core package unless absolutely necessary. Every dependency is an install-size and security-audit burden for all consumers.

### Sources package (`@debriefer/sources`)

Heavier dependencies are acceptable here: `@mozilla/readability`, `jsdom`, `he`, `wtf_wikipedia`, `playwright-core` (optional). Consumers who only use the core with custom sources never install these.

## Code Quality

### Type Safety

- Use `ReliabilityTier` enum (not raw strings) for all reliability tier references
- Use `unknown` over `any` — narrow with type guards
- All exported functions must have explicit return types
- Interfaces over type aliases for public API contracts

### Testing

- **Ship tests with code** — same commit, never deferred
- **Assert deeply** — verify data contents, not just that functions were called
- **Test files**: `src/__tests__/*.test.ts` alongside source
- **Mock patterns**: use `vi.fn()` and `vi.mock()`, never real API calls in unit tests
- **Coverage targets**: happy path + error handling + edge cases for every module
- Hundreds of tests across all TypeScript packages and the Python client (see CI for current counts)

### Error Handling

- `BaseResearchSource.lookup()` catches errors and returns `null` — never throws
- `ResearchOrchestrator.debrief()` continues on per-source errors (via `Promise.allSettled`)
- `debriefBatch` per-subject failures do NOT fire `onRunFailed` — they report via `onSubjectComplete` with `data: null`
- Always record errors via the telemetry provider, never swallow silently

### AbortSignal Safety

Combine caller signals with timeouts using `AbortSignal.any()` — never `??` which defeats the timeout:

```typescript
// CORRECT
const signal = callerSignal
  ? AbortSignal.any([callerSignal, AbortSignal.timeout(30000)])
  : AbortSignal.timeout(30000)

// WRONG — caller signal disables timeout
const signal = callerSignal ?? AbortSignal.timeout(30000)
```

### Cache Patterns

- `InMemoryCache` supports `maxSize` for FIFO eviction — use it for large batches
- Cache TTL is configurable per-source via `cacheTtlSeconds` option (default: 24h)
- Cache keys follow format: `debriefer:{sourceType}:{subjectId}:{query}`

### Package Publishing

- `"files": ["dist"]` in package.json — only ship compiled output
- Hard dependencies must be truly necessary (currently only `p-limit` in core)
- Optional peer dependencies for provider-specific SDKs (`@anthropic-ai/sdk`)

## Reliability Scoring

Based on Wikipedia's Reliable Sources Perennial list (RSP). When adding new sources, consult the RSP list to determine the appropriate tier:

| Tier                  | Score | RSP Equivalent                | Examples                       |
| --------------------- | ----- | ----------------------------- | ------------------------------ |
| STRUCTURED_DATA       | 1.0   | N/A                           | Wikidata, government databases |
| TIER_1_NEWS           | 0.95  | "Generally reliable"          | AP, NYT, BBC, Reuters          |
| TRADE_PRESS           | 0.9   | "Generally reliable" (domain) | Variety, Nature                |
| ARCHIVAL              | 0.9   | Primary sources               | Trove, Europeana               |
| SECONDARY_COMPILATION | 0.85  | Wikipedia self-assessment     | Wikipedia                      |
| SEARCH_AGGREGATOR     | 0.7   | Depends on linked sources     | Google, Bing, DDG              |
| ARCHIVE_MIRROR        | 0.7   | Mirrors                       | Internet Archive               |
| MARGINAL_EDITORIAL    | 0.65  | "Use with caution"            | People Magazine                |
| MARGINAL_MIXED        | 0.6   | Mixed editorial + UGC         | Legacy.com                     |
| AI_MODEL              | 0.55  | No RSP equivalent             | Claude, GPT                    |
| UNRELIABLE_FAST       | 0.5   | "Generally unreliable"        | TMZ                            |
| UNRELIABLE_UGC        | 0.35  | User-generated content        | Find a Grave                   |

## Adding a New Source

1. Create `packages/sources/src/{category}/{name}.ts`
2. Extend `BaseResearchSource<ResearchSubject>`
3. Declare: `name`, `type`, `reliabilityTier` (from RSP), `domain`, `isFree`, `estimatedCostPerQuery`
4. Implement `fetchResult(subject, signal)` → returns `RawFinding | null`
5. Override `buildQuery(subject)` if the default (just `subject.name`) isn't sufficient
6. Override `isAvailable()` to check required API keys
7. Export a factory function: `export function mySource(options?): MySource { ... }`
8. Register in `packages/sources/src/index.ts`
9. Write tests with mocked HTTP (never call real APIs in tests)

## Implementation Status

| Phase                      | Status   | Description                                                            |
| -------------------------- | -------- | ---------------------------------------------------------------------- |
| 1. Scaffold                | Complete | Monorepo, 5 packages, Docker, Python stub                              |
| 2. Core types              | Complete | 19 types, 3 error classes, ReliabilityTier                             |
| 3. Infrastructure          | Complete | Rate limiter, cost tracker, batch runner, cache, telemetry, confidence |
| 4. Engine                  | Complete | BaseResearchSource, ClaudeSynthesizer, ResearchOrchestrator            |
| 5. Built-in sources        | Complete | 30+ sources migrated from deadonfilm                                   |
| 6. CLI                     | Complete | Commander.js CLI                                                       |
| 7. HTTP server             | Complete | Express REST API + Docker                                              |
| 8. MCP server              | Complete | Model Context Protocol for AI assistants                               |
| 9. Python client           | Complete | httpx + Pydantic HTTP wrapper                                          |
| 10. Deadonfilm integration | Complete | Refactor deadonfilm to consume debriefer                               |
| 11. Polish + publish       | Complete | npm publish, PyPI, Docker Hub                                          |

## Reference Documents

- Deadonfilm source: `/Users/chris/Source/deadonfilm/server/src/lib/`
