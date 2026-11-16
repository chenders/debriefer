# Tasks — company-dossier deep-research investigation

All tasks remain pending: this change specifies an investigation, not its results.
Read `AGENTS.md` first. Work on a dedicated feature branch without importing any
uncommitted edits from another worktree. Record the actual tested revision, not
an assumed current `origin/main`.

## Acceptance and evidence policy

Raw requests, logs, traces, prompts and model outputs stay outside the repository
in an operator-selected local evidence directory. They may contain confidential
company or personal information. Do not commit them or paste them into public PRs.
Use synthetic companies and reserved example domains for offline fixtures.
Only a manually sanitized findings summary may be proposed for publication, after
both human inspection and the repository's PII/credential gates. Do not record
credential values, internal endpoints or provider account identifiers.

Each task's acceptance checklist must be reviewed against its local evidence;
file existence or keyword matches alone are not proof. Record each command,
exit code and mock/live mode; a failed command leaves its task incomplete.
Missing evidence may produce an inconclusive result, not a passing reproduction.

No production changes, credential probing or live research are authorized by this
charter. Live calls require a separate approved test plan naming endpoints,
request bounds, network timeout, provider/model, maximum spend including synthesis
and browser/CAPTCHA costs, and how the limit is enforced. A configured collection
budget alone is not proof of an end-to-end spending ceiling. Anthropic is an
explicit opt-in; inspecting its existing code is not authorization to invoke it.
Offline unit tests use mocked HTTP/AI and visible browsers if browser execution is
needed. No credential-bearing tests or unapproved billable calls.

- [ ] **INV-1 — Establish the failing invocation.**
      **Reads:** `docs/examples.md` Corporate Due Diligence; `README.md` relevant
      transport sections; `packages/server/src/config.ts`.
      **Do:** Capture transport (SDK/HTTP/CLI/MCP), caller integration, deployed
      revision/image or package version, minimal sanitized request, expected fields
      and source coverage, observed output/error, timestamp and reproduction mode.
      If unavailable, list what is missing; the documented SDK example is a comparison,
      not a substitute for the owner's failing request.
      **Acceptance:** Local evidence identifies every listed field as observed or
      unknown. Expected dossier completeness is defined before judging output. No
      failure claim depends solely on a documented example or an HTTP 2xx.

- [ ] **INV-2 — Trace validation and context propagation.**
      **Reads:** `packages/server/src/schemas.ts`; `packages/server/src/routes/debrief.ts`;
      `packages/core/src/types.ts` ResearchSubject; the actual caller files identified
      by INV-1, after obtaining access within the authorized scope.
      **Do:** Trace request fields through parsing to the orchestrator subject using
      an offline fixture and intercepted/mocked orchestrator invocation. Compare SDK
      and HTTP only where relevant. Observe how unknown fields are handled, and
      whether ticker/domain/industry or other identity context is supplied, retained
      and consumed. Context loss is not a demonstrated cause until downstream impact
      is shown.
      **Acceptance:** Assertions compare actual parsed fields and received subject
      contents, including missing/extra fields. Record test command and exit code,
      code locations and differences from the deployed revision. If caller access is
      missing, mark that boundary not measured.

- [ ] **INV-3 — Measure source selection and stopping.**
      **Reads:** `packages/server/src/source-registry.ts`; route phases/config;
      `packages/core/src/orchestrator.ts`; availability implementations for selected
      sources, reading only those identified by the request.
      **Do:** Inventory requested categories, created sources, availability booleans,
      phases, effective thresholds, confidence/reliability filters and cost limits.
      Use mocked source outcomes to isolate distinct `sourceType` early stopping,
      budget exhaustion, cancellation and unavailable-source paths. Credential
      presence is distinct from working authentication or provider reachability.
      **Acceptance:** Every selected source has a named availability/attempt verdict
      and reason; every phase's execution or skip is supported by evidence. Compare
      the SDK example's explicit threshold of 4 with the HTTP default only if that
      comparison explains the actual caller. Record fixture assertions and exit codes.

- [ ] **INV-4 — Trace queries and collection outcomes.**
      **Reads:** `packages/core/src/base-source.ts`; `packages/sources/src/web-search/base.ts`;
      `packages/sources/src/news/site-search-source.ts`; selected source query/fetch
      implementations and their focused tests.
      **Do:** Intercept outgoing requests offline. Inspect query construction, intended
      company disambiguation, filtering/ranking, content extraction, timeouts, caching,
      provider errors and resulting finding counts. Record attempted query and typed
      failure locally; redact query content before publication. Check provider/API
      lifecycle documentation before treating an endpoint as currently supported.
      **Acceptance:** Each reached source has a query, attempted/not-attempted verdict,
      outcome, finding count and evidence reference. Empty results are distinct from
      failed requests. Any proposed context/query defect has a controlled comparison
      showing its effect; otherwise retain it as a hypothesis.

- [ ] **INV-5 — Trace synthesis and response mapping.**
      **Reads:** route synthesizer construction; `packages/ai/src/synthesizer.ts`;
      `packages/ai/src/ai-client.ts`; `packages/core/src/orchestrator.ts` synthesis;
      actual consumer response handling identified by INV-1.
      **Do:** Mock AI requests/responses and capture selected model/provider, supplied
      findings, expected output schema, parse failures and final response mapping.
      Distinguish the HTTP generic summary from the SDK's caller-defined risk schema.
      Test empty findings, malformed output and authentication failure without live
      credentials. Trace consumer behavior after the response where access permits.
      **Acceptance:** Assertions show actual input/output contents and error mapping;
      record commands and exit codes. A non-empty summary is not accepted as a
      complete dossier. No unapproved hosted model is invoked.

- [ ] **INV-6 — Classify stage outcomes and unknowns.**
      **Reads:** INV-1 through INV-5 local evidence.
      **Do:** Produce a stage/source matrix: not-attempted, skipped, failed or succeeded,
      with reason and evidence. Add a separate measured/not-measured flag so lack of
      access is not confused with proof a stage did not run. Identify missing fields,
      coverage or citations against INV-1's expected result.
      **Acceptance:** Every verdict has a concrete observation or explicit unknown;
      no overall HTTP status supplies a missing per-stage observation. Mark mock
      evidence separately from deployed observations and list what would settle gaps.

- [ ] **INV-7 — Report diagnosis or inconclusive outcome.**
      **Reads:** all local evidence; this proposal and requirement spec.
      **Do:** Identify the earliest supported failing boundary and any contributing
      causes, with evidence references. Separate facts, hypotheses and unknowns.
      Propose the smallest safe follow-up and its regression acceptance test, or the
      next bounded diagnostic if evidence is insufficient. No runtime fix belongs in
      this investigation change.
      **Acceptance:** Every causal claim has a reproduction/control or is explicitly
      tentative. The report states what remains unexplained, evidence provenance,
      authorization/spend (including zero for offline work), and a separate follow-up.
      Review sanitization before proposing any findings summary for publication.
