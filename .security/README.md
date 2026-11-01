# PII & secrets protection

Two scanners run at three checkpoints, plus an on-demand full-history audit.

| Tool                                                         | Finds                                  | Pinned   |
| ------------------------------------------------------------ | -------------------------------------- | -------- |
| [ferret-scan](https://github.com/awslabs/ferret-scan)        | PII                                    | `2.5.5`  |
| [gitleaks](https://github.com/gitleaks/gitleaks)             | credentials                            | `8.30.1` |
| [git-filter-repo](https://github.com/newren/git-filter-repo) | history rewriting (manual, on request) | —        |

Everything runs locally. No repository content and no finding ever leaves the
host — neither scanner has a network mode in use here, and nothing is sent to
any AI or hosted scanning service.

## Setup

```bash
.security/install-hooks.sh          # configure + verify (repository-local)
brew install ferret-scan gitleaks   # or: .security/install-tools.sh
```

`install-hooks.sh` sets `core.hooksPath=.githooks` **for this repository
only**. Global git config is never modified.

## Checkpoints

| Where      | What it scans                                                         |
| ---------- | --------------------------------------------------------------------- |
| pre-commit | the exact **staged blob content** from the git index                  |
| pre-push   | **every outgoing commit's** blobs, plus commit messages & identities  |
| CI         | the PR/push **commit range** and the **checked-out tree**, separately |
| scheduled  | full-history audit, weekly                                            |

### Manual scans

```bash
.security/scan-staged.sh                # what pre-commit would see
.security/scan-staged.sh --show-match   # reveal values (LOCAL ONLY)
.security/scan-worktree.sh              # tracked files in the working tree
.security/audit-history.sh              # all blobs on all refs + metadata
.security/ci-scan.sh --base <rev> --head <rev>   # exactly what CI runs
.security/verify.sh                     # 41-assertion self-test, isolated
node .security/tests/pi-hook-guard.test.mjs      # Pi bypass-guard rules
```

`--show-match` prints sensitive values to your terminal. Do not paste that
output into an issue, a PR, or a chat log.

## Detection policy

Defined once in [`policy.sh`](policy.sh). Every checkpoint reads it; there is
no second copy.

**All checks run everywhere.** The tiers decide only what _blocks_.

| Tier                                  | Checks                                                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Blocking** (HIGH confidence)        | `SSN` `CREDIT_CARD` `BANK_ACCOUNT` `PASSPORT` `DRIVERS_LICENSE` `MEDICAL_ID` `DATE_OF_BIRTH` `PHYSICAL_ADDRESS` `SECRETS` + every gitleaks credential rule |
| **Advisory** (reported, never blocks) | `PERSON_NAME` `EMAIL` `IP_ADDRESS` `VIN` `SOCIAL_MEDIA` `INTELLECTUAL_PROPERTY` `CLOUD_RESOURCES` `METADATA` `OTP`                                         |

Category coverage: personal names (`PERSON_NAME`), emails (`EMAIL`), phones
(`PHONE`), addresses (`PHYSICAL_ADDRESS`), government identifiers (`SSN`,
`PASSPORT`, `DRIVERS_LICENSE`), financial identifiers (`CREDIT_CARD`,
`BANK_ACCOUNT`), medical identifiers (`MEDICAL_ID`).

### Why those checks are advisory

They are structurally present in this repository as **intended public
information**, so blocking on them would block routine work and the hooks
would get turned off:

- `PERSON_NAME` — debriefer researches public figures; test fixtures carry
  real public names by design, and every `packages/*/package.json` has an
  `author` field. 34 HIGH findings on the current tree, all intended.
- `EMAIL` — normal git attribution, plus upstream maintainer addresses inside
  the generated `package-lock.json` (`i@izs.me`).
- `IP_ADDRESS` — IPv4-mapped IPv6 prefixes in the SSRF guard in
  `packages/sources/src/web-search/base.ts`.
- `VIN` — observed only as a false positive on base64 integrity-hash
  fragments in `package-lock.json`.

This is a **documented policy decision, not a suppression file**: advisory
findings are still printed on every scan and still need human triage. They
simply do not fail the checkpoint.

### Exclusions

Only git internals, vendored dependencies and generated build output:
`.git`, `node_modules`, `dist`, `coverage`, `.turbo`, `.venv`,
`__pycache__`, `*.tsbuildinfo`.

**Deliberately in scope**: tests, fixtures, documentation, CSV, JSON, YAML and
`*.log`. ferret-scan's own documented example config excludes `*.log`; that
exclusion is intentionally omitted here.

`respect_gitignore` is forced **off**. `.gitignore` hides `.env`, `*.pem` and
credential files — exactly what is most worth scanning. ferret-scan's own CLI
help warns to leave it off for deep audits.

## Verified scanner behaviour

Re-verify after any version bump. **Neither tool documents its exit codes or
its default check set as stable API**, and several of these behaviours are
surprising enough to break a naive integration.

### ferret-scan 2.5.5 exit codes

| Code | Meaning                                                                           |
| ---- | --------------------------------------------------------------------------------- |
| `0`  | the scan **ran** — findings do **not** affect the exit code                       |
| `1`  | the run failed (bad args, missing path, unreadable config, unwritable output)     |
| `2`  | `--preprocess-only` only: nothing to preprocess                                   |
| `3`  | `--fail-on-incomplete` only: coverage was cut short, or findings went un-redacted |

Because `0` does not mean "clean", the hooks read `--format json` and classify
findings themselves ([`lib/classify.mjs`](lib/classify.mjs)). This is the
integration path upstream recommends.

### gitleaks 8.30.1 exit codes

Default behaviour makes "leaks found" and "internal error" both exit `1`,
which is indistinguishable. The hooks pass `--exit-code 2` to separate them:

| Code | Meaning                |
| ---- | ---------------------- |
| `0`  | completed, no leaks    |
| `1`  | gitleaks itself failed |
| `2`  | leaks found            |

### Three traps that would have produced a silently broken setup

1. **`--pre-commit-mode` narrows detection.** It replaces the check set with
   `CREDIT_CARD,SECRETS,SSN,EMAIL,PHONE,IP_ADDRESS`, dropping
   `PHYSICAL_ADDRESS`, `DATE_OF_BIRTH`, `PASSPORT`, `DRIVERS_LICENSE`,
   `MEDICAL_ID` and `BANK_ACCOUNT`. **Verified: a 95%-confidence US street
   address passes `--pre-commit-mode` at exit 0.** The hooks therefore do not
   use that flag; they pass `--checks` explicitly, export `FERRET_PRECOMMIT=0`
   to suppress the environment-based inference, and also define
   `profiles.precommit` in [`ferret-scan.yaml`](ferret-scan.yaml) as a third
   layer. `verify.sh` case 15 asserts this.

2. **gitleaks exits 0 when its own `git log` fails.** Verified with both a
   bogus `--log-opts` flag and an unknown revision range: it logs
   `ERR ... "stderr is not empty"`, reports zero findings, and exits `0`. Any
   hook trusting that exit code reads a broken scan as clean. Mitigated two
   ways: every revision range is validated with `git rev-list` _before_ a
   scanner sees it, and `gitleaks_run` treats any `ERR` on stderr as a
   scanner failure.

3. **ferret-scan truncates reports at 200 findings** (`--limit`, default
   `200`). The first full-history audit reported exactly 200 findings — a
   round number that turned out to be the cap, not the count. Every
   invocation now passes `--limit 0`.

### Other verified facts

- **`gitleaks git --staged` is index-based** and handles partial staging
  correctly. `gitleaks dir` on the working tree produces both false positives
  (unstaged secrets) and false negatives (staged secrets with a clean
  worktree). `verify.sh` case 4 asserts both directions.
- **git collapses any hook failure to exit 1.** A hook exiting 7 or 42 both
  surface as `git commit` exit 1, so a hook's own exit code is not observable
  by the caller.
- **The Homebrew and upstream-release builds print different version
  strings** (`ferret-scan v2.5.5` vs `ferret-scan 2.5.5`). The version check
  accepts both; requiring the `v` made the hooks fail closed on a good binary.
- **Unsupported formats are reported, not blocked.** A file ferret-scan skips
  because it is a binary is surfaced as `N skipped — coverage is incomplete`,
  but does not fail the checkpoint; blocking on every commit touching a PNG
  would be unusable. `--fail-on-incomplete` (exit 3) _does_ block, and covers
  the genuine "cut short" cases: timeouts, per-validator budgets, and files
  that could not be opened.

## Coverage and its limits

| Scanned                                                     | How                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| source, config, markdown, CSV, JSON, YAML, logs, plain text | as text                                                                                           |
| PDF, Office documents                                       | **extracted text only** — embedded images, attachments and revision history are not fully covered |

| NOT scanned                                                  | Why                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| images (PNG, JPEG, GIF, SVG, TIFF), fonts, audio, video      | not text containers; ferret-scan's `METADATA` validator inspects some metadata, gitleaks skips these paths entirely |
| archives (zip, tar, gz)                                      | not traversed (`--max-archive-depth` defaults to 0)                                                                 |
| databases (SQLite and similar), compiled binaries            | not parsed                                                                                                          |
| lockfiles, `node_modules/`, vendored trees — **by gitleaks** | upstream default global allowlist, which `[extend]` cannot subtract from. These **are** scanned by ferret-scan      |

Do not describe a scan as covering these. The audit prints its own coverage
limitations and writes them to `coverage-limitations.txt`.

The audit also detects and reports **shallow history** and **remote refs not
present locally**, both of which cap what can be scanned.

## Exceptions

Narrow, documented, justified per entry. Never a baseline, never a lowered
threshold.

**gitleaks** — preferred, because its allowlists key on path + regex and do
not break when lines move. Scope with `condition = "AND"` across rule id,
path and the literal placeholder text. See the `curl-auth-header` entry in
[`gitleaks.toml`](gitleaks.toml). An inline `gitleaks:allow` comment is better
still when it can live at the point of use.

**ferret-scan** — suppressions are SHA-256 hashes over
`Type|Confidence|FullLine|Filename|LineNumber|ContextHash|MatchHash`. Because
**line number and full line content are inputs**, a suppression silently
breaks when anything above that line shifts, turning a required check red for
an unrelated edit. Prefer removing the false-positive _trigger_.

Worked example: a docstring in `clients/python/debriefer/client.py` described
the `api_key` argument using the word **"Optional"** immediately after the
argument name and colon. ferret-scan matched that English word as a
95%-confidence secret, because a secret-shaped keyword sat directly beside a
token-shaped word. Rather than record a brittle hash, the line was reworded to
`Bearer token for authenticated servers (default None).` — identical meaning,
finding gone, nothing to maintain.

This paragraph is itself a worked example of the same rule. An earlier draft
quoted the offending docstring verbatim, which reproduced the trigger and
blocked the very commit that added this file. Describing the pattern instead
of reprinting it is the fix — exactly what the paragraph recommends.

There is deliberately **no** `--baseline-path` and no
`--generate-suppressions` anywhere in this setup.

## Bypassing

`--no-verify` skips these hooks. Don't. Anything pushed to a remote must be
assumed permanently recoverable, and **an exposed credential must be rotated
regardless of any later history rewrite**.

Coding agents are blocked from bypassing: `.pi/extensions/pii-hook-guard.ts`
refuses `--no-verify`, `git commit -n`, `-c core.hooksPath=`, `git config
core.hooksPath` writes, and attempts to delete or chmod `.githooks/`. A human
can still bypass from their own shell; that decision is not delegated to an
agent. See [`../AGENTS.md`](../AGENTS.md).

### A CI check can stop running without anyone noticing

GitHub **disables an entire workflow after 60 days of repository inactivity if
it contains a `schedule:` trigger** — including that workflow's `push` and
`pull_request` triggers. The scheduled job is not the only casualty; every
trigger in the file goes silent.

This repository was found in exactly that state: `Security` was
`disabled_inactivity` while `Dependency Audit` was still configured as a
**required** status check. The failure happened to be loud (every PR showed
`BLOCKED` because a required check could never report), but a non-required
check in the same position would simply have stopped scanning, silently.

Both scheduled workflows now declare `workflow_dispatch`, so a manual run can
recover them and reset the inactivity timer. To check the current state:

```bash
gh workflow list --all          # look for 'disabled_inactivity'
gh workflow enable <name>       # re-enable
gh workflow run <name>          # manual run, resets the timer
```

Worth checking whenever the repository has been quiet for a couple of months.

### Paths that bypass git hooks entirely

Hooks only see `git commit` and `git push`. These do not go through them:

| Path                                                                      | Covered?                                                                                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `gh release upload`, release assets                                       | **No.** Not git objects.                                                                                                   |
| `gh api` writes, `gh gist create`                                         | **No.**                                                                                                                    |
| `npm publish`                                                             | **No.** Publishes `dist/` from the local tree. CI scans the tree before merge, which is the practical control.             |
| GitHub web UI edits / `create_or_update_file` API                         | **No local hook.** The CI check covers the resulting PR/push.                                                              |
| Workflow artifact uploads                                                 | **No.**                                                                                                                    |
| Agent file-transfer tools, pasting into a chat or issue                   | **No.**                                                                                                                    |
| `git commit` / `git push` from any tool, including Pi and Herdr worktrees | **Yes** — `core.hooksPath` is a property of the repository, not the caller. `verify.sh` case 14 asserts the worktree case. |

CI is the backstop for everything that reaches a branch or a PR. Nothing is a
backstop for a direct upload — treat those as manual-review paths.

## History cleanup

`git-filter-repo` is **not** wired into any automated path. Rewriting history
changes every downstream commit id, so it is a deliberate, reviewed operation.
If the audit finds something that must come out of history, do it in a fresh
clone, keep a backup outside the repository, and understand that:

- rewriting **does not** erase copies held by others, forks, or GitHub's
  cached unreachable commits;
- open PR refs, releases, LFS objects and workflow artifacts need separate
  handling;
- exposed credentials require rotation, which rewriting does not accomplish.

## Files

```
.security/
  policy.sh            tiers, thresholds, exclusions, pinned versions
  lib/scan.sh          shared scanning helpers
  lib/classify.mjs     report classification (never prints a value)
  ferret-scan.yaml     PII scanner config
  gitleaks.toml        credential scanner config + exceptions
  tools.lock           pinned versions + published SHA-256
  install-hooks.sh     configure core.hooksPath, verify
  install-tools.sh     pinned download with checksum verification
  scan-staged.sh       manual: staged content
  scan-worktree.sh     manual: tracked working-tree files
  audit-history.sh     manual: full history + metadata + current files
  ci-scan.sh           CI entry point (range + checked-out tree)
  verify.sh            isolated 41-assertion self-test
  tests/               Pi bypass-guard rule tests
.githooks/
  pre-commit           staged (index) content
  pre-push             every outgoing commit
.pi/
  extensions/pii-hook-guard.ts   blocks hook-bypass attempts under Pi
  APPEND_SYSTEM.md               project instructions for Pi
```
