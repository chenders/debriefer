# Proposal: Diagnose company-dossier deep research failures

## Why

The documented Corporate Due Diligence example in `docs/examples.md` builds a `ResearchOrchestrator` with structured, news and web-search phases, a `ClaudeSynthesizer`, and a typed risk-assessment result. The documented example does not establish that this exact flow works through the deployed server/API or through the consumer's real dossier request.

A read-only inspection of a clean worktree at baseline `9e90af9` found concrete questions to test, not a confirmed root cause:

- `packages/server/src/schemas.ts` accepts name, categories, budget, synthesis, model and prompt, but no subject `context`.
- `packages/server/src/routes/debrief.ts` constructs `{ id: name, name }` for the orchestrator, so it does not forward caller context in this baseline.
- `packages/core/src/types.ts` allows generic subject context, and `docs/examples.md` demonstrates passing company-specific context directly to the SDK; that does not prove a server consumer can do the same.
- The HTTP route's synthesizer requests only a generic summary, while the example's dossier output schema and prompt are supplied by its SDK consumer.
- The SDK company example explicitly supplies three source phases, `earlyStopThreshold: 4`, and a per-subject collection cost limit of $0.25. The HTTP route instead groups available sources into free/paid phases and inherits the orchestrator's default infinite early-stop threshold. Neither configuration establishes what the failing consumer actually uses; credential presence also does not establish provider reachability.

These observations are hypotheses for investigation. They do **not** establish the owner's failing request, the deployed revision, or that any single item is the cause. The original Debriefer working tree contains unrelated uncommitted work; this investigation uses a separate clean worktree and does not import, stage, or overwrite those edits.

## What Changes

Create a bounded investigation that obtains a sanitized failing request and expected result, reproduces it without production changes, and records evidence at each boundary: request validation, subject construction/context propagation, source category selection and availability, query construction, source outcomes, phase/early-stop/cost decisions, synthesizer invocation/parsing, and HTTP response mapping. Distinguish not attempted, skipped, failed and succeeded; a 2xx response or a non-empty generic summary alone is not dossier success.

The investigation ends with an evidence-backed diagnosis when reproduction supports one, or an explicitly inconclusive report when required evidence remains unavailable, plus a smallest safe follow-up proposal. It does not implement a fix, change source policy, perform unbounded or billable live research, access production data, or use credentials from another working tree. Any live network call or paid request requires an explicit bounded test plan with its cost ceiling and the operator's authorization.

## Out of Scope

- Changing Debriefer runtime behavior or the existing 12 uncommitted files in the owner's Debriefer working tree.
- Adding company-specific behavior to the generic engine without evidence that the failure belongs there.
- Treating presence of API credentials as proof a provider works; credential values must never enter evidence.
- Expanding this diagnosis into a production implementation or a broad source-quality audit.
