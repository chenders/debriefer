## ADDED Requirements

### Requirement: Reproduction identifies the real consumer boundary

The investigation SHALL identify the failing transport, caller, tested revision,
minimal request, expected dossier content and observed result. Unavailable inputs
SHALL be marked unknown rather than replaced by the documented SDK example.

#### Scenario: Failing invocation is available

- **WHEN** the operator supplies a failing invocation
- **THEN** the investigation records its provenance and compares the observed result against predefined expected fields and coverage
- **AND** reproduction mode distinguishes offline mocks from deployed observations

#### Scenario: Failing invocation is unavailable

- **WHEN** the actual caller or deployed revision cannot be established
- **THEN** the report names those gaps and remains inconclusive about that deployment
- **AND** a documented example is used only as a labeled comparison

### Requirement: Boundary verdicts require evidence

The investigation SHALL trace validation, subject propagation, source selection,
queries, collection, stopping, synthesis and response mapping. Each stage SHALL
have a measured/not-measured flag and a reasoned outcome of not-attempted,
skipped, failed or succeeded when supported by evidence.

#### Scenario: Source is unavailable or request fails

- **WHEN** a selected source is unavailable or returns an error
- **THEN** the report distinguishes a skipped source from an attempted failure and from an empty successful result
- **AND** credential presence is not treated as proof of working authentication or endpoint reachability

#### Scenario: Overall response is successful but dossier is incomplete

- **WHEN** HTTP succeeds or synthesis returns a non-empty summary without required dossier content
- **THEN** the investigation evaluates expected fields and coverage independently of the HTTP status
- **AND** missing stage evidence is not promoted to succeeded

### Requirement: Causal diagnosis uses controlled comparisons

The investigation SHALL label static-code observations as hypotheses until a
reproduction or controlled comparison establishes their impact. The final report
SHALL separate facts, causes, hypotheses and unknowns and propose a separate
minimal follow-up with an acceptance test.

#### Scenario: Context differs between SDK and HTTP

- **WHEN** context propagation or output schemas differ between transports
- **THEN** the investigation checks the actual failing caller and demonstrates downstream impact before naming the difference as a cause

#### Scenario: Evidence does not settle the failure

- **WHEN** reproduction or caller access is insufficient
- **THEN** the report is explicitly inconclusive and names the next bounded diagnostic
- **AND** no runtime change is implemented under this investigation charter

### Requirement: Investigation preserves privacy and execution bounds

Raw evidence SHALL remain outside the tracked tree. Publication SHALL require
manual sanitization and repository security gates. Offline fixtures SHALL mock
network and AI dependencies. Live requests SHALL require a separately approved
plan bounding endpoints, timeouts, provider/model and total spend; this charter
SHALL NOT authorize production changes or Anthropic invocation.

#### Scenario: Evidence contains confidential request details

- **WHEN** requests, prompts, logs or outputs contain private information
- **THEN** raw evidence stays local outside the repository and is not pasted into public reviews
- **AND** only a manually inspected, sanitized findings summary is proposed for publication

#### Scenario: Diagnostic would call a paid provider

- **WHEN** a diagnostic requires live research or hosted synthesis
- **THEN** execution waits for approval of its total cost ceiling and enforcement, including synthesis and browser/CAPTCHA costs
- **AND** a source-collection budget alone is not accepted as an end-to-end spending limit
