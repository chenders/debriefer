# AGENTS.md

Guidance for any coding agent or human contributor working in this repository.

This is the **canonical** instruction file. `CLAUDE.md` and
`.github/copilot-instructions.md` are symlinks to it, so every tool reads the
same content and there is only one file to keep current. Tools that look for
`AGENTS.md` (Pi, Codex, Cursor, Zed and others) find it directly; tools that
look for a vendor-specific filename follow the symlink.

Nothing here is tied to a particular model or vendor. Where Anthropic, OpenAI
or GitHub are named below, it is because the **product** genuinely depends on
them (`@debriefer/ai` wraps the Anthropic SDK; CI runs on GitHub Actions), not
because the instructions assume a particular assistant.

<details>
<summary>Notes on the symlinks</summary>

- **Edit `AGENTS.md`, never a symlink.** Some editors follow the link and write
  through it, which is fine, but others replace the link with a regular file and
  the three copies silently diverge.
- **Windows**: a checkout with `core.symlinks=false` materialises each symlink as
  a small text file containing the target path, so `CLAUDE.md` would read as the
  literal string `AGENTS.md`. Enable symlinks (`git config core.symlinks true`,
  requires Developer Mode or elevation) or read `AGENTS.md` directly.
- The PII/secrets scanners skip symlinks by design (git mode `120000` holds a
  path, not content), so this file is scanned exactly once — as `AGENTS.md`. No
  coverage is lost and nothing is scanned three times.

</details>

---

## Project Overview

Debriefer is a standalone multi-source research orchestration engine. It
orchestrates dozens of data sources with Wikipedia RSP-based reliability
scoring, phased execution with early stopping, per-query cost control, and
pluggable AI synthesis. Originally extracted from the
[deadonfilm](https://github.com/chenders/deadonfilm) enrichment pipeline.

**Tooling**: npm workspaces, turborepo, TypeScript 5.x, vitest, Node.js 22

---

## Critical Rules

1. **NEVER commit directly to main** — all changes go through PRs. The default branch is protected by a ruleset.
2. **NEVER bypass or weaken the PII/secrets checks** — no `--no-verify`, no `core.hooksPath` changes, no gitleaks baseline, no lowered thresholds, no widened allowlists to make a scan pass. See [PII & secrets](#pii--secrets-protection).
3. **NEVER add hard dependencies to `packages/core`** — currently only `p-limit`. SDKs go in `peerDependencies` with `optional: true`. Heavy deps go in `packages/sources`.
4. **NEVER use raw strings for reliability tiers** — always use the `ReliabilityTier` enum from `reliability.ts`.
5. **NEVER count early-stop families by `reliabilityTier`** — count by `sourceType`. Multiple sources share tiers.
6. **NEVER fire `onRunFailed` for per-subject errors** — use `onSubjectComplete` with `data: null`. `onRunFailed` is for unrecoverable batch-level failures only.
7. **NEVER skip tests** — ship tests with code in the same commit.
8. **NEVER use `--no-verify`, `--force` (without lease), or a history rewrite on shared branches** without explicit human authorisation.
9. When reviewing, **surface ALL issues in a single pass** rather than drip-feeding them.

---

## PII & Secrets Protection

Commits and pushes are scanned for personal data (ferret-scan) and credentials
(gitleaks) via `core.hooksPath=.githooks`. The full policy, verified scanner
behaviour, coverage limits and exception process are in
[.security/README.md](.security/README.md).

**Keep the checks enabled. Fix findings. Do not bypass them.**

```bash
.security/install-hooks.sh     # configure + verify (repository-local, run once)
.security/scan-staged.sh       # preview what pre-commit will say
.security/audit-history.sh     # full-history audit
.security/verify.sh            # self-test the whole setup in a temp repo
```

### Never do these

| Don't                                                                                              | Why                                                |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `git commit --no-verify` / `git commit -n`                                                         | skips the staged-content PII and credential scan   |
| `git push --no-verify`                                                                             | skips the outgoing-history scan                    |
| `git -c core.hooksPath=… <cmd>`                                                                    | redirects hooks for one command                    |
| `git config core.hooksPath …` / `--unset`                                                          | disables every hook in the repository              |
| deleting, moving or `chmod -x`ing `.githooks/`                                                     | same effect, less obviously                        |
| adding a gitleaks `--baseline-path`                                                                | records every current finding as acceptable        |
| running `ferret-scan --generate-suppressions`                                                      | mass-suppresses findings instead of triaging them  |
| lowering `FERRET_BLOCK_AT_LEVEL`, or moving a check from blocking to advisory, to make a scan pass | defeats the control                                |
| widening a path pattern in `.security/gitleaks.toml` to silence a finding                          | same                                               |
| committing an audit report, or pasting `--show-match` output into an issue, PR or chat             | republishes the values the scanners exist to catch |

Attempts at the first six are **blocked** under Pi by
[`.pi/extensions/pii-hook-guard.ts`](.pi/extensions/pii-hook-guard.ts). The
block is not a prompt to find another route; it means stop and fix the finding.

### When a check blocks you

1. Read the finding. Values are hidden by design; the type, path and line are shown.
2. Inspect locally if you need the value: `.security/scan-staged.sh --show-match`.
   Output stays on this machine. Do not copy it anywhere.
3. **If it is real** — remove it. If it is already committed, the commit must be
   rewritten, not just reverted (`git rebase -i` for a local branch). Ask a human
   before rewriting anything already pushed. If it is a credential, say so
   explicitly: **it must be rotated**, and a history rewrite does not do that.
4. **If it is a false positive** — prefer removing the _trigger_ over recording an
   exception. If an exception is genuinely needed, add a narrow documented one per
   [.security/README.md](.security/README.md#exceptions). One finding, one entry,
   with the reason written down.
5. **If you are unsure** — ask. Do not guess, and do not bypass while waiting.

### Escalate, don't route around

If a check is wrong, slow, or blocking legitimate work, say so and propose a
policy change to [`.security/policy.sh`](.security/policy.sh) for a human to
approve. Changing the policy is a reviewed decision; silently working around it
is not.

### Two things to know before changing anything in `.security/`

- **ferret-scan exit 0 does not mean "clean"** — findings do not affect its exit
  code, so the hooks parse `--format json` and classify findings themselves.
- **Do not add `--pre-commit-mode`** — it silently narrows detection to six check
  types, dropping addresses, dates of birth, passports, driver's licences,
  medical IDs and bank accounts.

### Things hooks cannot see

Git hooks only observe `git commit` and `git push`. Sensitive data can still
leave through paths that bypass them entirely — release asset uploads, `gh api`
writes, `npm publish`, workflow artifacts, web-UI edits, and pasting content
into an issue or a chat. Those are manual-review paths. The table in
[.security/README.md](.security/README.md#paths-that-bypass-git-hooks-entirely)
lists what is and is not covered.

### Writing tests that need sensitive-looking data

Synthetic values the scanners genuinely recognise will block your commit —
correctly, since a scanner cannot tell a fixture from a real leak.

- Prefer reserved example values: `example.com` / `example.org` domains,
  `555-01xx` phone numbers, documented vendor test credentials. Both scanners
  deliberately allowlist or confidence-downgrade these.
- If you need a value that _is_ recognised (to test a detector), assemble it from
  fragments at runtime so no complete pattern appears in the file text.
  `.security/verify.sh` does exactly this, and explains why.
- Do not add a suppression to make a fixture committable.

---

## Git Workflow

**The default branch is protected — all changes go through PRs.**

1. Create a feature branch: `git checkout -b feat/descriptive-name` (or `fix/`, `chore/`, `docs/`)
2. Make changes, commit with descriptive messages
3. Push: `git push -u origin feat/descriptive-name`
4. Open a PR: `gh pr create --title "..." --body "..."`
5. **Get the change reviewed** — see below
6. Merge after review

**Never push directly to the default branch.**

### Commit messages and PR bodies

- Describe what changed and why. Reference the reasoning, not the tooling used.
- **Do not add assistant attribution footers or links to assistant session URLs.**
  They land permanently in public history and mean nothing to a later reader.
- `Co-Authored-By:` trailers are fine.

### Review

A passing CI run is **not** a review. The required checks verify behaviour the
authors thought to test; a review finds what they did not.

> **Known gap:** the ruleset carries a `copilot_code_review` rule and this file
> previously documented a "Copilot auto-review" step, but **no automated review
> has ever actually been produced on a PR in this repository**. Requesting the
> reviewer via the API returns success and silently no-ops, and
> `mergeStateStatus` still reports `CLEAN`. Treat the automated review as
> absent until proven otherwise — check `gh pr view <n> --json reviews` rather
> than trusting the merge state.

So, before merging anything non-trivial:

```bash
gh pr view <n> --json reviews,reviewDecision   # confirm a review actually exists
```

Request a human or tool review explicitly. If an agent authored the change, it
should say plainly that the change is unreviewed rather than letting a green
merge state imply otherwise.

### Branch Naming

| Prefix   | Use Case                  | Example                     |
| -------- | ------------------------- | --------------------------- |
| `feat/`  | New features, new sources | `feat/wikipedia-source`     |
| `fix/`   | Bug fixes                 | `fix/early-stop-counting`   |
| `chore/` | Maintenance, deps         | `chore/update-dependencies` |
| `docs/`  | Documentation only        | `docs/add-source-guide`     |

---

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

CI workflows:

| Workflow      | File                                | Jobs                                                             |
| ------------- | ----------------------------------- | ---------------------------------------------------------------- |
| CI            | `.github/workflows/ci.yml`          | Build, Test, Type Check, Lint, Format Check, CodeQL (push only)  |
| Security      | `.github/workflows/security.yml`    | Dependency Audit (`npm audit`)                                   |
| PII & Secrets | `.github/workflows/pii-secrets.yml` | PII/credential scan on PRs and pushes; weekly full-history audit |

All required checks must pass before merging.

> **Watch for silently disabled workflows.** GitHub disables an entire workflow
> after 60 days of repository inactivity if it contains a `schedule:` trigger —
> including its `push` and `pull_request` triggers. The Security workflow was
> found in exactly that state while `Dependency Audit` was still a required
> check, so it could never report. Both scheduled workflows now declare
> `workflow_dispatch` so they can be recovered. Check with
> `gh workflow list --all` and look for `disabled_inactivity`.

### Common CI failures to avoid

- **Format Check**: Prettier runs at root level (`prettier --check .`) and checks
  ALL files including `AGENTS.md` — not just `src/`. Run `npx prettier --write .`
  before committing. Prettier is pinned to an exact version on purpose: a
  floating `^3` let a patch release change union-type formatting and break this
  check on an unrelated PR.
- **Lint**: ESLint catches issues like empty interfaces
  (`@typescript-eslint/no-empty-object-type`). Use `type Foo = Bar` instead of
  `interface Foo extends Bar {}` when adding no members.
- **Subagent output**: subagents don't run prettier or lint. After cherry-picking
  or merging subagent work, run `npx prettier --write` on their files and
  `npx turbo lint` before committing.

---

## Monorepo Structure

```
debriefer/
├── packages/
│   ├── core/       # "@debriefer/core" — orchestration engine (COMPLETE)
│   ├── sources/    # "@debriefer/sources" — built-in source integrations
│   ├── ai/         # "@debriefer/ai" — AI-first defaults (synthesis, confidence)
│   ├── browser/    # "@debriefer/browser" — browser stealth, CAPTCHA, archive fallbacks
│   ├── cli/        # "@debriefer/cli" — CLI tool (bin: debriefer)
│   ├── server/     # "@debriefer/server" — HTTP service
│   └── mcp/        # "@debriefer/mcp" — MCP server for AI assistants
├── clients/
│   └── python/     # PyPI "debriefer" — Python HTTP client
├── docs/
│   └── plans/      # Implementation plans (future use)
├── docker/         # Dockerfile + docker-compose.yml
├── .security/      # PII/secrets policy, scanner configs, audit + verify scripts
├── .githooks/      # pre-commit / pre-push scanning hooks (core.hooksPath)
└── .pi/            # Pi-specific: hook-bypass guard extension
```

### Monorepo Rules

- All packages use ESM (`"type": "module"`)
- All packages extend `tsconfig.base.json`
- Cross-package deps use `"*"` (npm workspaces resolves them locally)
- `turbo.json` defines the build dependency graph — `core` builds first
- `"files": ["dist"]` in every package.json — only ship compiled output
- Test files go in `src/__tests__/`, not a top-level `test/` directory
- A package that imports a sibling must declare it in `dependencies` **or**
  `devDependencies`, not only `peerDependencies` — newer turbo does not derive
  build order from peer deps, and the build will race

---

## Architecture

### Core Package (`packages/core/` — "@debriefer/core")

The core is generic via TypeScript generics: `ResearchOrchestrator<TSubject, TOutput>`.

| Module              | File                                        | Purpose                                                                                 |
| ------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Orchestrator        | `orchestrator.ts`                           | Phased execution, early stopping, batch processing, lifecycle hooks                     |
| BaseResearchSource  | `base-source.ts`                            | Abstract base class for all sources (caching, rate limiting, timeout, confidence)       |
| NoopSynthesizer     | `synthesizer.ts`                            | Pass-through synthesizer returning raw findings (AI synthesis lives in `@debriefer/ai`) |
| ReliabilityTier     | `reliability.ts`                            | 12-tier scoring based on Wikipedia RSP (0.0–1.0)                                        |
| SourceRateLimiter   | `rate-limiter.ts`                           | Per-domain async queue preventing thundering herd                                       |
| BatchCostTracker    | `cost-tracker.ts`                           | Per-subject and total cost limits                                                       |
| ParallelBatchRunner | `batch-runner.ts`                           | Concurrency-limited batch processor with p-limit                                        |
| InMemoryCache       | `cache/in-memory.ts`                        | CacheProvider with TTL and optional maxSize eviction                                    |
| Telemetry           | `telemetry/console.ts`, `telemetry/noop.ts` | Pluggable observability                                                                 |
| Confidence          | `confidence.ts`                             | Generic keyword-based confidence scoring                                                |
| Types               | `types.ts`                                  | All core interfaces, error classes                                                      |

### Key Design Principles

1. **Domain knowledge lives in the consumer, not the engine** — Synthesis prompts, output schemas, query builders, and source selections are all consumer-provided. Debriefer provides orchestration, reliability scoring, cost control, and phased execution.
2. **Infrastructure is injected, not hardwired** — Cache, telemetry, and rate limiting are injected interfaces. No hardcoded New Relic, no hardcoded Redis, no hardcoded database.
3. **Two-axis quality model** — Source reliability (publisher trustworthiness, from RSP) and content confidence (does this page answer the question?) are independent. Both must meet thresholds for a finding to count as "high quality."
4. **Phased execution with early stopping** — Sources execute in phases (cheap first, expensive later). The orchestrator stops after `earlyStopThreshold` distinct high-quality source families are found.

### Orchestrator Invariants

These are architectural invariants — flag any code that violates them:

- **Phases execute sequentially** — sources within a phase execute concurrently via `Promise.allSettled()`
- **Early stopping counts `sourceType`** — distinct source types meeting both confidence AND reliability thresholds
- **Cost tracking is synchronous** — `BatchCostTracker` reads/writes are atomic within the Node event loop
- **Cache keys**: `debriefer:{sourceType}:{subjectId}:{query}`
- **Infrastructure is injected** — no imports of `newrelic`, `ioredis`, `pg`, or any infrastructure library in core
- **Findings are immutable** — the orchestrator creates `ScoredFinding` by spreading `RawFinding` + source metadata

### Source Family Counting (Early Stopping)

A "source family" is a unique `sourceType` string. Early stopping counts
distinct source types whose findings meet BOTH the confidence threshold AND the
reliability threshold. Do NOT count by `reliabilityTier` — multiple different
sources can share the same tier.

### AI Package (`packages/ai/` — "@debriefer/ai")

Houses all Anthropic SDK integration, keeping `@debriefer/core` fully zero-AI.
The package name and class names below reflect a real product dependency, not
an assumption about which assistant is editing this repo.

| Module                 | File                  | Purpose                                                                 |
| ---------------------- | --------------------- | ----------------------------------------------------------------------- |
| ClaudeSynthesizer      | `synthesizer.ts`      | AI synthesis via Anthropic SDK (moved from core)                        |
| HaikuClient / AIClient | `ai-client.ts`        | `AIClient` provider interface + `HaikuClient` default Anthropic wrapper |
| Confidence             | `confidence.ts`       | AI-powered confidence scoring for findings                              |
| SectionFilter          | `section-filter.ts`   | AI-driven Wikipedia section relevance filtering                         |
| LinkSelector           | `link-selector.ts`    | AI-based web search result link selection                               |
| PersonValidator        | `person-validator.ts` | AI validation of person-entity matches                                  |

Entry point: `createAIDefaults()` returns pre-built AI callbacks for section
filtering, confidence scoring, link selection, and person validation.

`AIClient` is a provider interface — a consumer can supply a non-Anthropic
implementation without touching the orchestrator.

### Browser Package (`packages/browser/` — "@debriefer/browser")

Browser stealth, CAPTCHA solving, authentication, and archive fallbacks.

| Module                 | File                         | Purpose                                                                   |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| fetchPageWithFallbacks | `archives/fallback-chain.ts` | 4-step chain: direct fetch → archive.org → archive.is → browser + CAPTCHA |
| Stealth                | `stealth.ts`                 | Fingerprint injection via `fingerprint-injector`                          |
| CAPTCHA                | `captcha/`                   | CAPTCHA detection and solver provider interface                           |
| Auth                   | `auth/`                      | Cookie/session persistence and site credentials                           |
| HTML Utils             | `html-utils.ts`              | `htmlToText` conversion utility                                           |

Entry point: `createBrowserFetchPage()` returns a `fetchPage` callback
compatible with `@debriefer/sources` `WebSearchOptions`.

---

## Dependencies Policy

### Core package (`@debriefer/core`)

The core has ONE hard dependency: `p-limit`. Everything else is injected:

- `ioredis`, `better-sqlite3`, etc. — NOT dependencies. Cache implementations that need them go in separate packages or consumers provide their own.
- `zod` — NOT a dependency. Consumers bring their own validation in `responseParser` callbacks.

**Rule**: Do not add hard dependencies to the core package unless absolutely
necessary. Every dependency is an install-size and security-audit burden for all
consumers.

### Sources package (`@debriefer/sources`)

Heavier dependencies are acceptable here: `@mozilla/readability`, `jsdom`, `he`,
`wtf_wikipedia`. Consumers who only use the core with custom sources never
install these.

### AI package (`@debriefer/ai`)

Hard dependency on `@anthropic-ai/sdk`. Peer-depends on `@debriefer/core` and
`@debriefer/sources` (and dev-depends on them so turbo orders the build).
Consumers who don't need AI synthesis or AI callbacks never install this.

### Browser package (`@debriefer/browser`)

Hard dependencies on `playwright-core` and `fingerprint-injector`. Peer-depends
on `@debriefer/core` (and dev-depends on it for build ordering). Only needed if
using browser-based fetching, CAPTCHA solving, or archive fallbacks.

---

## Code Quality

### Type Safety

- Use `ReliabilityTier` enum (not raw strings) for all reliability tier references
- Use `unknown` over `any` — narrow with type guards
- All exported functions must have explicit return types
- Interfaces over type aliases for public API contracts
- `ScoredFinding.reliabilityTier` and `MinimalSource.reliabilityTier` are typed as `ReliabilityTier`, not `string`

### Testing

- **Ship tests with code** — same commit, never deferred
- **Assert deeply** — verify payload contents, not just call counts
- **Test all paths** — happy path, error handling, edge cases
- **Mock HTTP** — never call real APIs in unit tests
- **Test files**: `src/__tests__/*.test.ts` alongside source
- Type mocks with `Mock<Iface["method"]>`, not `ReturnType<typeof vi.fn>` — the
  latter widens to `Mock<Procedure>` in vitest 4+ and stops assigning to a
  specific signature
- Constructor mocks must use a function expression, not an arrow — vitest 4+
  invokes the implementation with `new`, and arrows are not constructable

### Error Handling

- `BaseResearchSource.lookup()` catches errors and returns `null` — never throws
- `ResearchOrchestrator.debrief()` continues on per-source errors (via `Promise.allSettled`)
- `debriefBatch` per-subject failures do NOT fire `onRunFailed` — they report via `onSubjectComplete` with `data: null`
- Always record errors via the telemetry provider, never swallow silently
- Sources should throw `SourceTimeoutError` or `SourceAccessBlockedError` for typed error handling
- **Never swallow stderr in scripts or tooling** — more than one bug in this
  repository hid behind a piped-away error message

### AbortSignal Safety

Combine caller signals with timeouts using `AbortSignal.any()` — never `??`,
which defeats the timeout:

```typescript
// CORRECT — both signal and timeout enforced
const signal = callerSignal
  ? AbortSignal.any([callerSignal, AbortSignal.timeout(30000)])
  : AbortSignal.timeout(30000)

// WRONG — caller signal disables timeout
const signal = callerSignal ?? AbortSignal.timeout(30000)
```

### Cache Patterns

- `InMemoryCache` supports `maxSize` for FIFO eviction — use it for large batches
- Cache TTL is configurable per-source via `cacheTtlSeconds` (default: 24h)
- Cache keys follow format: `debriefer:{sourceType}:{subjectId}:{query}`

### Package Publishing

- `"files": ["dist"]` in package.json — only ship compiled output
- Hard dependencies must be truly necessary (currently only `p-limit` in core)
- Heavy SDKs belong in leaf packages (`@anthropic-ai/sdk` in `@debriefer/ai`, `playwright-core` in `@debriefer/browser`)

### General

- **DRY**: extract shared logic between sources into `packages/sources/src/shared/`
- **Function length**: keep under 60 lines — extract helpers
- **Early returns** over deep nesting
- **No magic numbers**: extract to named constants with JSDoc
- **No N+1 patterns**: batch operations where possible
- **Unused code**: remove immediately, don't comment out

---

## Reliability Scoring

Based on Wikipedia's Reliable Sources Perennial list (RSP). When adding new
sources, consult the RSP list to determine the appropriate tier:

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
| AI_MODEL              | 0.55  | No RSP equivalent             | any LLM-generated answer       |
| UNRELIABLE_FAST       | 0.5   | "Generally unreliable"        | TMZ                            |
| UNRELIABLE_UGC        | 0.35  | User-generated content        | Find a Grave                   |

---

## Adding a New Source

1. Create `packages/sources/src/{category}/{name}.ts`
2. Extend `BaseResearchSource<ResearchSubject>`
3. Declare: `name`, `type`, `reliabilityTier` (from the RSP list), `domain`, `isFree`, `estimatedCostPerQuery`
4. Implement `fetchResult(subject, signal)` → returns `RawFinding | null` (never throws; the base class catches)
5. Override `buildQuery(subject)` if the default (just `subject.name`) isn't sufficient
6. Override `isAvailable()` to check required API keys / env vars
7. Export a factory function, not the class directly: `export function mySource(options?): MySource { ... }`
8. Register in `packages/sources/src/index.ts`
9. Write tests with mocked HTTP — never call real APIs in tests

---

## Maintaining This File

This repository is developed primarily by coding agents. This file must stay in
sync with the codebase — stale instructions actively mislead every future
session, whichever tool is reading them.

**Update AGENTS.md in the same commit when you:**

- Add, remove, or rename a package → update Monorepo Structure
- Move a module between packages → update both Architecture sections
- Add or change a hard/peer dependency → update Dependencies Policy
- Change CI workflow jobs or checks → update Pre-Push Verification
- Add a new command or change an existing script → update Common Commands
- Change a pattern documented in Code Quality

**Do not let these sections go stale:**

- Architecture module tables — must match actual exports
- Dependencies Policy — must match actual `package.json` files
- Monorepo Structure tree — must match actual directory layout

Edit `AGENTS.md` itself, never the symlinks. When in doubt, update: a
30-second edit now prevents confusion across every future session.

---

## Cross-Repo References

- Deadonfilm (upstream consumer): https://github.com/chenders/deadonfilm/tree/main/server/src/lib
