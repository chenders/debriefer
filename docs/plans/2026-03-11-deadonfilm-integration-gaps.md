# Deadonfilm Integration Gaps

**Date**: 2026-03-11
**Status**: Ready for implementation
**Context**: Deadonfilm's death enrichment pipeline now uses debriefer as its orchestration engine (PR #566). Several features from the old `DeathEnrichmentOrchestrator` require debriefer API changes to fully replicate.

## Gap 1: Sequential Phase Execution

**Priority**: High
**Why**: AI model sources must run sequentially (cheapest first, stop at first success) to control costs. Currently working around this by putting each AI model in its own phase, which is ugly and inflates phase counts.

**Change**: Add `sequential?: boolean` to `SourcePhaseGroup` in `packages/core/src/types.ts`.

When `sequential: true`, the orchestrator should execute sources one at a time within the phase (instead of `Promise.allSettled`). Stop processing remaining sources in the phase when one returns a non-null finding.

```typescript
export interface SourcePhaseGroup<TSubject extends ResearchSubject> {
  phase: number
  name?: string
  sources: ReadonlyArray<MinimalSource<TSubject>>
  /** If true, execute sources sequentially within this phase (stop at first success). */
  sequential?: boolean
}
```

**Files to modify**:

- `packages/core/src/types.ts` — Add `sequential` to interface
- `packages/core/src/orchestrator.ts` — In `executePhase()`, check `phaseGroup.sequential` and use a `for` loop instead of `Promise.allSettled` when true
- Tests for the orchestrator

## Gap 2: Wikipedia AI Section Selection

**Priority**: Medium
**Why**: Deadonfilm uses Gemini Flash to intelligently select which Wikipedia sections contain death/health information, rather than relying on regex patterns. This catches non-obvious sections like "Hunting and Fishing" or "Controversies" that may contain death info.

The debriefer Wikipedia source already has `sectionFilter` as a sync callback. The gap is that deadonfilm's AI section selection is async (calls Gemini API) and needs the full article context to decide.

**Options**:

1. Add an `asyncSectionFilter` option to `WikipediaOptions` that receives all sections and returns a Promise
2. Add a dedicated `aiSectionSelector` option that takes a model config and handles the AI call internally
3. Let the consumer handle this by wrapping the Wikipedia source (least invasive)

**Recommendation**: Option 1 — add `asyncSectionFilter?: (sections: WikipediaSection[], articleText: string) => Promise<WikipediaSection[]>` to `WikipediaOptions`. This keeps debriefer generic (no AI dependency in the sources package) while letting deadonfilm inject its Gemini-based selector.

**Files to modify**:

- `packages/sources/src/structured/wikipedia.ts` — Add `asyncSectionFilter` option, call it in `fetchResult()` when present (falls back to sync `sectionFilter`)

## Gap 3: Wikipedia Date Validation

**Priority**: Low
**Why**: Deadonfilm validates that a Wikipedia article is about the correct person by comparing birth/death years from the article against known dates. When validation fails, it tries alternate titles. The debriefer Wikipedia source handles disambiguation but doesn't do date-based person validation.

**Change**: Add `validatePerson?: (articleText: string, subject: ResearchSubject) => boolean` callback to `WikipediaOptions`. When provided and returns `false`, try disambiguation suffixes.

**Files to modify**:

- `packages/sources/src/structured/wikipedia.ts` — Add validation callback, invoke after successful article fetch

## Summary

| Gap                            | Priority | Effort | Approach                                    |
| ------------------------------ | -------- | ------ | ------------------------------------------- |
| Sequential phases              | High     | Small  | Add `sequential` flag to `SourcePhaseGroup` |
| Wikipedia AI section selection | Medium   | Small  | Add `asyncSectionFilter` callback           |
| Wikipedia date validation      | Low      | Small  | Add `validatePerson` callback               |

All three are additive (no breaking changes). Gap 1 is the most impactful — it affects cost control for any consumer using AI model sources.
