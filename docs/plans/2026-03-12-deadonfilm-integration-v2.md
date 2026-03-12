# Deadonfilm Integration v2 — Remaining Gaps

**Date**: 2026-03-12
**Status**: Ready for implementation
**Context**: The v1 integration (PR #566) replaced deadonfilm's `DeathEnrichmentOrchestrator` with debriefer's `ResearchOrchestrator`. Sequential phases, async section filter, and person validation were added to debriefer in `eb8232d`. This plan covers remaining gaps identified during code review.

## Overview

Two categories of work remain:

1. **Debriefer changes** — API additions needed in debriefer packages
2. **Deadonfilm wiring** — Using debriefer features that already exist but aren't wired up yet

---

## Task 1: Wikipedia `validatePerson` Wiring (deadonfilm only)

**Priority**: High
**Effort**: Small

Debriefer's `WikipediaOptions.validatePerson` callback exists but deadonfilm doesn't pass one. The old orchestrator used Gemini Flash to validate birth/death years from Wikipedia intro text.

**What to do in deadonfilm**:

- Create a `createPersonValidator()` function in `server/src/lib/death-sources/debriefer/` that returns a `validatePerson` callback
- The callback should extract birth/death years from article text (regex, matching the old `wikipedia-date-extractor.ts` logic) and compare against `subject.context.birthday`/`subject.context.deathday`
- Pass it to `wikipedia({ validatePerson: createPersonValidator() })` in `adapter.ts`

**Files**:

- Create: `server/src/lib/death-sources/debriefer/person-validator.ts`
- Modify: `server/src/lib/death-sources/debriefer/adapter.ts` — pass `validatePerson` to `wikipedia()`

---

## Task 2: Link Following Configuration (debriefer)

**Priority**: Medium
**Effort**: Medium

Deadonfilm's old orchestrator injected `LinkFollowConfig` into `WebSearchBase` sources controlling: max links per actor, cost limits for link following, AI-assisted link selection, and browser-based fetching for paywalled sites.

Debriefer's `WebSearchBase` has `maxLinksToFollow` (passed via `WebSearchOptions`) but lacks:

- Per-actor cost limits for link following
- AI-assisted link selection (choosing which URLs to follow based on relevance)
- Browser-based fetching with fingerprint injection for bot-protected sites

**What to do in debriefer**:

- Add `maxLinkCost?: number` to `WebSearchOptions` — cost budget for link following per subject
- Add `linkSelector?: (results: WebSearchResult[], subject: ResearchSubject) => WebSearchResult[]` callback to `WebSearchOptions` — lets consumers inject AI or heuristic link selection
- The browser-based fetching is deadonfilm-specific infrastructure (Playwright + fingerprint-injector) and should NOT be in debriefer. Instead, add a `fetchPage?: (url: string, signal: AbortSignal) => Promise<string | null>` callback to `WebSearchOptions` so consumers can inject custom page fetching.

**Files**:

- Modify: `packages/sources/src/web-search/base.ts` — Add `linkSelector`, `fetchPage`, `maxLinkCost` to `WebSearchOptions`, use them in the search pipeline

---

## Task 3: Lifecycle Hooks for Observability (deadonfilm only)

**Priority**: Medium
**Effort**: Small

Debriefer's `ResearchOrchestrator` accepts `LifecycleHooks` with 13 optional callbacks (onSourceAttempt, onSourceComplete, onPhaseComplete, etc.). Deadonfilm doesn't wire any of them, losing observability that the old orchestrator provided via New Relic and RunLogger.

**What to do in deadonfilm**:

- Create a `createLifecycleHooks()` function that returns a `LifecycleHooks` object wired to:
  - `onSourceAttempt` / `onSourceComplete` → Pino logging (replaces the old `StatusBar` and `EnrichmentLogger`)
  - `onEarlyStop` → Log reason
  - `onSubjectComplete` → New Relic custom event (if newrelic is available)
- Pass hooks to `orchestrator.debrief(subject, { hooks })` in the adapter's returned closure

**Files**:

- Create: `server/src/lib/death-sources/debriefer/lifecycle-hooks.ts`
- Modify: `server/src/lib/death-sources/debriefer/adapter.ts` — accept hooks option, pass to `debrief()`

---

## Task 4: BullMQ Job Handler Migration (deadonfilm only)

**Priority**: Medium
**Effort**: Small

The BullMQ job handler at `server/src/lib/jobs/handlers/enrich-death-details.ts` still uses the old `DeathEnrichmentOrchestrator` directly, creating a parallel code path. It should use `EnrichmentRunner` (which now uses debriefer) for consistency.

**What to do in deadonfilm**:

- Update the job handler to construct an `EnrichmentRunner` with the job's config
- Remove the direct `DeathEnrichmentOrchestrator` import
- This is the last consumer — once migrated, the old orchestrator can be deleted

**Files**:

- Modify: `server/src/lib/jobs/handlers/enrich-death-details.ts`

---

## Task 5: Remove Old Orchestrator (deadonfilm only)

**Priority**: Low (after Task 4)
**Effort**: Small

Once the BullMQ job handler is migrated (Task 4), the old `DeathEnrichmentOrchestrator` class and its `StatusBar`, `EnrichmentLogger` dependencies are dead code.

**What to do**:

- Remove or mark as deprecated: `server/src/lib/death-sources/orchestrator.ts`
- Remove unused exports from `server/src/lib/death-sources/index.ts`
- Remove `StatusBar` and related dead code

---

## Task Order

| Task                        | Where      | Depends On | Priority |
| --------------------------- | ---------- | ---------- | -------- |
| 1. Wikipedia validatePerson | deadonfilm | —          | High     |
| 2. Link following config    | debriefer  | —          | Medium   |
| 3. Lifecycle hooks          | deadonfilm | —          | Medium   |
| 4. Job handler migration    | deadonfilm | —          | Medium   |
| 5. Remove old orchestrator  | deadonfilm | Task 4     | Low      |

Tasks 1-4 are independent and can be done in parallel. Task 5 depends on Task 4.

## What's NOT in this plan

- **Docker build support** — Requires publishing debriefer to npm. Separate concern.
- **Biography enrichment migration** — Will be a separate phase after death enrichment is stable.
- **New Relic deep integration** — Covered minimally by Task 3 (lifecycle hooks). Full parity requires debriefer's `TelemetryProvider` integration which is a larger effort.
