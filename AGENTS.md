# AGENTS.md

Instructions for coding agents working in this repository (Claude Code, Pi,
GitHub Copilot, or any other). Human contributors should read this too.

For everything else — architecture, commands, conventions — see
[CLAUDE.md](CLAUDE.md).

## PII and secrets checks are not optional

This repository blocks commits and pushes that contain personal data or
credentials. The checks live in [`.security/`](.security/README.md) and run at
pre-commit, pre-push and in CI.

**Keep them enabled. Fix findings. Do not bypass them.**

### Never do these

| Don't                                                                                                          | Why                                                |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `git commit --no-verify` / `git commit -n`                                                                     | skips the staged-content PII and credential scan   |
| `git push --no-verify`                                                                                         | skips the outgoing-history scan                    |
| `git -c core.hooksPath=… <cmd>`                                                                                | redirects hooks for one command                    |
| `git config core.hooksPath …` / `--unset`                                                                      | disables every hook in the repository              |
| deleting, moving or `chmod -x`ing `.githooks/`                                                                 | same effect, less obviously                        |
| adding a gitleaks `--baseline-path`                                                                            | records every current finding as acceptable        |
| running `ferret-scan --generate-suppressions`                                                                  | mass-suppresses findings instead of triaging them  |
| lowering `FERRET_BLOCK_AT_LEVEL`, or moving a check from blocking to advisory, to make a scan pass             | defeats the control                                |
| widening a path pattern in `.security/gitleaks.toml` to silence a finding                                      | same                                               |
| committing an audit report, or pasting scanner `--show-match` output into an issue, PR, commit message or chat | republishes the values the scanners exist to catch |

Attempts at the first six are **blocked** when working through Pi — see
[`.pi/extensions/pii-hook-guard.ts`](.pi/extensions/pii-hook-guard.ts). The
block is not a suggestion to find another route; it means stop and fix the
finding.

### When a check blocks you

1. Read the finding. Values are hidden by design; the type, path and line are
   shown.
2. Inspect locally if you need the value:
   ```bash
   .security/scan-staged.sh --show-match
   ```
   Output stays on this machine. Do not copy it anywhere.
3. **If it is real** — remove it from the file. If it is already committed,
   the commit must be rewritten, not just reverted: `git rebase -i` for a
   local branch. Ask the human before rewriting anything already pushed.
   If it is a credential, say so explicitly: **it must be rotated**, and a
   history rewrite does not accomplish that.
4. **If it is a false positive** — prefer removing the _trigger_ over
   recording an exception. Then, if an exception is genuinely needed, add a
   narrow documented one per
   [`.security/README.md`](.security/README.md#exceptions). One finding, one
   entry, with the reason written down.
5. **If you are unsure** — ask the human. Do not guess, and do not bypass
   while waiting.

### Escalate, don't route around

If a check is wrong, slow, or blocking legitimate work, say so and propose a
policy change to [`.security/policy.sh`](.security/policy.sh) for the human to
approve. Changing the policy is a reviewed decision; silently working around
it is not.

## Before committing

```bash
npx turbo test lint type-check   # all packages
npx prettier --check .           # root-level, catches docs too
```

The PII and credential scans run automatically on commit. To see what they
will say first:

```bash
.security/scan-staged.sh
```

## Things hooks cannot see

Git hooks only observe `git commit` and `git push`. Sensitive data can still
leave the repository through paths that bypass them entirely — release asset
uploads, `gh api` writes, `npm publish`, workflow artifacts, GitHub web-UI
edits, and pasting content into an issue or a chat. Those are manual-review
paths; the scanners will not catch them. The table in
[`.security/README.md`](.security/README.md#paths-that-bypass-git-hooks-entirely)
lists what is and is not covered.

## Writing tests that need sensitive-looking data

Synthetic values that the scanners genuinely recognise will block your commit
— correctly, since the scanner cannot tell your fixture from a real leak.

- Prefer reserved example values: `example.com` / `example.org` domains,
  `555-01xx` phone numbers, documented vendor test credentials. Both scanners
  deliberately allowlist or confidence-downgrade these.
- If you need a value that _is_ recognised (to test a detector), assemble it
  from fragments at runtime so no complete pattern appears in the file text.
  `.security/verify.sh` does exactly this, and explains why.
- Do not add a suppression to make a fixture committable.
