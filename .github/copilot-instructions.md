# Copilot Instructions

Focused guidance for GitHub Copilot code review on the Debriefer repository.

**Full context**: `CLAUDE.md` | **Plans**: `docs/plans/`

---

## Critical Rules

1. **NEVER add hard dependencies to `packages/core`** — currently only `p-limit`. SDKs go in `peerDependencies` with `optional: true`. Heavy deps go in `packages/sources`.
2. **NEVER use raw strings for reliability tiers** — always use the `ReliabilityTier` enum from `reliability.ts`.
3. **NEVER count early-stop families by `reliabilityTier`** — count by `sourceType`. Multiple sources share tiers.
4. **NEVER fire `onRunFailed` for per-subject errors** — use `onSubjectComplete` with `data: null`. `onRunFailed` is for unrecoverable batch-level failures only.
5. **NEVER skip tests** — ship tests with code in the same commit.
6. **Review ALL files thoroughly and surface ALL issues in a single pass.**

---

## Type Safety

- **No `any`** — use `unknown` and narrow with type guards
- **`ReliabilityTier` enum** for all tier references — never raw strings like `"tier_1_news"`
- **Explicit return types** on all exported functions
- **`ScoredFinding.reliabilityTier`** is typed as `ReliabilityTier`, not `string`
- **`MinimalSource.reliabilityTier`** is typed as `ReliabilityTier`, not `string`

---

## AbortSignal Safety

Combine caller signals with timeouts using `AbortSignal.any()` — never `??`:

```typescript
// CORRECT — both signal and timeout enforced
const signal = callerSignal
  ? AbortSignal.any([callerSignal, AbortSignal.timeout(30000)])
  : AbortSignal.timeout(30000)

// WRONG — caller signal defeats timeout
const signal = callerSignal ?? AbortSignal.timeout(30000)
```

---

## Testing Requirements

- **Ship tests with code** — same commit, never deferred
- **Assert deeply** — verify payload contents, not just call counts
- **Test all paths**: happy path, error handling, edge cases
- **Mock HTTP** — never call real APIs in unit tests
- **Test files**: `src/__tests__/*.test.ts` alongside source
- Tests: 195 passing across 11 files in core

---

## Error Handling

- `BaseResearchSource.lookup()` catches errors → returns `null`, never throws
- `ResearchOrchestrator.debrief()` uses `Promise.allSettled()` — per-source errors don't stop the phase
- `debriefBatch` per-subject failures → `onSubjectComplete` with `data: null`, NOT `onRunFailed`
- Always record errors via `TelemetryProvider.recordError()`, never swallow silently
- Sources should throw `SourceTimeoutError` or `SourceAccessBlockedError` for typed error handling

---

## Dependencies Policy

**Core package (`debriefer`)** — minimal footprint:
- Hard deps: `p-limit` only
- Optional peer: `@anthropic-ai/sdk` (for ClaudeSynthesizer)
- NO `zod`, NO `ioredis`, NO heavy deps

**Sources package (`debriefer-sources`)** — heavier deps acceptable:
- `@mozilla/readability`, `jsdom`, `he`, `wtf_wikipedia`
- `playwright-core` as optional dep

Do not add dependencies without justification.

---

## Source Implementation

When adding or reviewing sources:

1. Must extend `BaseResearchSource<ResearchSubject>`
2. Must declare `reliabilityTier` using `ReliabilityTier` enum — consult Wikipedia RSP list
3. Must declare `domain` for rate limit coordination
4. `fetchResult()` returns `RawFinding | null` — never throws (base class catches)
5. `isAvailable()` must check for required API keys/env vars
6. Export a factory function, not a class directly
7. Tests must mock HTTP — no real API calls

---

## Orchestrator Invariants

These are architectural invariants — flag any code that violates them:

- **Phases execute sequentially** — sources within a phase execute concurrently via `Promise.allSettled()`
- **Early stopping counts `sourceType`** — distinct source types meeting both confidence AND reliability thresholds
- **Cost tracking is synchronous** — `BatchCostTracker` reads/writes are atomic within the Node event loop
- **Cache keys**: `debriefer:{sourceType}:{subjectId}:{query}`
- **Infrastructure is injected** — no imports of `newrelic`, `ioredis`, `pg`, or any infrastructure library in core
- **Findings are immutable** — the orchestrator creates `ScoredFinding` by spreading `RawFinding` + source metadata

---

## Monorepo Rules

- All packages use ESM (`"type": "module"`)
- All packages extend `tsconfig.base.json`
- Cross-package deps use `workspace:*` protocol (resolved by npm workspaces)
- `turbo.json` defines the build dependency graph — `core` builds first
- `"files": ["dist"]` in every package.json — only ship compiled output
- Test files go in `src/__tests__/`, not a top-level `test/` directory

---

## Code Quality

- **DRY**: extract shared logic between sources into `packages/sources/src/shared/`
- **Function length**: keep under 60 lines — extract helpers
- **Early returns** over deep nesting
- **No magic numbers**: extract to named constants with JSDoc
- **No N+1 patterns**: batch operations where possible
- **Unused code**: remove immediately, don't comment out
