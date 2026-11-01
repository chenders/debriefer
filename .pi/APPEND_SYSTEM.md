# debriefer — project instructions

Read `AGENTS.md` and `CLAUDE.md` at the repository root. `AGENTS.md` is
authoritative for how to behave around the security checks; this file only
highlights the parts that matter most in a Pi session.

## PII and secrets checks are mandatory

This repository blocks commits and pushes containing personal data or
credentials, via `core.hooksPath=.githooks`. The hooks apply to every `git`
invocation — including from Pi's bash tool and inside the linked worktrees
Herdr creates — because hook configuration belongs to the repository, not the
caller.

**Hook-bypass attempts are blocked in this project.**
`.pi/extensions/pii-hook-guard.ts` refuses `--no-verify`, `git commit -n`,
`git -c core.hooksPath=…`, `git config core.hooksPath` writes, and attempts to
remove or disable `.githooks/`.

If you hit that block: **fix the finding, do not look for another route.**

1. `.security/scan-staged.sh --show-match` to see what was flagged (output
   stays local — do not paste it anywhere).
2. Real finding → remove it. Already committed → the commit needs rewriting,
   and a credential needs **rotating** regardless.
3. False positive → prefer removing the trigger; otherwise add one narrow
   documented exception per `.security/README.md`.
4. Unsure → ask. Do not bypass while waiting.

Never add a gitleaks baseline, never run
`ferret-scan --generate-suppressions`, and never lower a threshold to make a
scan pass.

## Before committing

```bash
npx turbo test lint type-check
npx prettier --check .
```

## Note

This file loads only after project trust is granted for this directory
(`pi --approve`, or accepting the trust prompt). The git hooks themselves do
not depend on Pi and run regardless.
