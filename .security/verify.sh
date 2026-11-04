#!/usr/bin/env bash
# Verify the debriefer PII / secrets checkpoints in an ISOLATED temporary
# repository, using synthetic sensitive data that the configured scanners are
# confirmed to flag at the configured threshold.
#
#   .security/verify.sh
#
# Runs real `git commit` and `git push` against a throwaway local remote and
# asserts the observed exit codes. Nothing touches the debriefer repository or
# any network remote.
#
# The synthetic values below are non-functional strings chosen because they
# are NOT allowlisted by either scanner. Several obvious choices are:
#   - 4111 1111 1111 1111        a card test number, confidence-downgraded
#   - AKIAIOSFODNN7EXAMPLE       AWS's documentation key, allowlisted
#   - *@example.com, 555-01xx    reserved example ranges, downgraded
# Using any of those would make the suite pass without proving anything,
# so each value here was checked against the scanners first.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)" || exit 1
SECURITY_SRC="${REPO_ROOT}/.security"
HOOKS_SRC="${REPO_ROOT}/.githooks"

# --- synthetic test data (verified recognised; see header) ------------------
#
# ASSEMBLED FROM FRAGMENTS ON PURPOSE. These values are exactly what the
# scanners are built to catch, so writing them as literals would make this
# file unstageable: the pre-commit hook flags its own test fixtures, and the
# pre-push hook then flags them forever in history. Splitting each value means
# no complete pattern exists in the file text, while the runtime string is
# identical. (Found the hard way -- the first version of this script could not
# be committed.)
#
# ferret-scan: SSN, HIGH 100% -- a blocking-tier check.
SYNTH_SSN="457-55""-5462"
# ferret-scan: US_STREET_ADDRESS, HIGH 95% -- blocking-tier.
SYNTH_ADDR="1600 Pennsylvania"" Avenue NW, Washington, DC 20500"
# gitleaks: aws-access-token. Structurally valid, not AWS's example key.
SYNTH_AWS="AKIA""Z3MFQ7XK2PLWNDJ4"

pass=0
fail=0
PASS=$'\033[32mPASS\033[0m'
FAIL=$'\033[31mFAIL\033[0m'
[ -t 1 ] || { PASS="PASS"; FAIL="FAIL"; }

ok() { printf '  %s  %s\n' "$PASS" "$*"; pass=$((pass + 1)); }
no() { printf '  %s  %s\n' "$FAIL" "$*"; fail=$((fail + 1)); }

# assert_exit <expected|nonzero|zero> <description> -- reads $? style via "$1"
check() {
	local expect="$1" got="$2" desc="$3"
	case "$expect" in
	zero) [ "$got" -eq 0 ] && ok "$desc (exit $got)" || no "$desc (expected 0, got $got)" ;;
	nonzero) [ "$got" -ne 0 ] && ok "$desc (exit $got)" || no "$desc (expected non-zero, got $got)" ;;
	*) [ "$got" -eq "$expect" ] && ok "$desc (exit $got)" || no "$desc (expected $expect, got $got)" ;;
	esac
}

# Guard against a test that "passes" because git failed for an unrelated
# reason (a bad refspec, a missing branch) and never invoked the hook at all.
# Every push/commit assertion should be paired with this.
hook_ran() {
	local file="$1" which="$2"
	if grep -q "^${which}: scanning" "$file"; then
		ok "${which} hook actually ran"
	else
		no "${which} hook did NOT run -- the result above proves nothing"
		sed 's/^/      /' "$file" | head -4
	fi
}

SANDBOX="$(mktemp -d -t debriefer-verify)" || exit 1
cleanup() {
	if [ -n "${KEEP_SANDBOX:-}" ]; then
		printf "\nsandbox kept: %s\n" "$SANDBOX"
		return
	fi
	rm -rf -- "$SANDBOX"
}
trap cleanup EXIT INT TERM

printf '\ndebriefer PII / secrets verification\n'
printf 'sandbox: %s\n' "$SANDBOX"

# ---------------------------------------------------------------------------
# Build an isolated repository with the real hooks and a local bare remote.
# ---------------------------------------------------------------------------
new_repo() {
	local dir="$1"
	rm -rf -- "$dir" && mkdir -p "$dir"
	# Pin the initial branch name. Inheriting init.defaultBranch from the
	# user's global config made `git push origin main` fail with "src refspec
	# main does not match any" on a machine configured for `master` -- and
	# that failure LOOKED like the hook blocking the push, so the test passed
	# for entirely the wrong reason.
	git -C "$dir" init -q -b main
	git -C "$dir" config user.email "verify@invalid.test"
	git -C "$dir" config user.name "Verify"
	# Signing would prompt; the sandbox has no key policy to honour.
	git -C "$dir" config commit.gpgsign false
	cp -R "$SECURITY_SRC" "$dir/.security"
	# Drop any locally-installed pinned binaries. They are ~50 MB each, they
	# are gitignored in the real repository, and committing them into the
	# sandbox adds two unscannable files that muddy the coverage reporting.
	rm -rf -- "$dir/.security/.tools"
	cp -R "$HOOKS_SRC" "$dir/.githooks"
	chmod +x "$dir/.githooks/"* "$dir/.security/"*.sh
	git -C "$dir" config core.hooksPath .githooks
	# Seed a clean commit so there is a parent to diff against.
	printf 'export const ok = true\n' >"$dir/clean.ts"
	git -C "$dir" add -A
	git -C "$dir" commit -qm "seed" --no-verify
}

new_remote() {
	local dir="$1"
	rm -rf -- "$dir"
	git init -q --bare "$dir"
}

R="${SANDBOX}/repo"
REMOTE="${SANDBOX}/remote.git"
new_remote "$REMOTE"
new_repo "$R"
git -C "$R" remote add origin "$REMOTE"

# ===========================================================================
printf '\n1. Pre-commit blocks staged PII\n'
# ===========================================================================
printf 'ssn: %s\n' "$SYNTH_SSN" >"$R/leak.txt"
git -C "$R" add leak.txt
git -C "$R" commit -qm "add pii" >"${SANDBOX}/out1" 2>&1
check nonzero $? "staged SSN blocks the commit"
hook_ran "${SANDBOX}/out1" "pre-commit"
grep -q 'SSN' "${SANDBOX}/out1" && ok "report names the finding type" || no "report should name SSN"
grep -qi 'value hidden\|HIDDEN' "${SANDBOX}/out1" && ok "value kept out of the output" || no "value should be hidden"
if grep -q "$SYNTH_SSN" "${SANDBOX}/out1"; then
	no "SECURITY: the matched value leaked into hook output"
else
	ok "matched value does not appear anywhere in hook output"
fi

printf '\n2. Pre-commit blocks a staged credential\n'
git -C "$R" reset -q
printf 'AWS_ACCESS_KEY_ID=%s\n' "$SYNTH_AWS" >"$R/creds.env"
git -C "$R" add creds.env
git -C "$R" commit -qm "add creds" >"${SANDBOX}/out2" 2>&1
check nonzero $? "staged AWS key blocks the commit"
hook_ran "${SANDBOX}/out2" "pre-commit"
grep -q 'aws-access-token' "${SANDBOX}/out2" && ok "gitleaks rule id reported" || no "expected gitleaks rule id"
if grep -q "$SYNTH_AWS" "${SANDBOX}/out2"; then
	no "SECURITY: the credential leaked into hook output"
else
	ok "credential does not appear in hook output (--redact active)"
fi

printf '\n3. Clean content commits normally\n'
rm -f "$R/leak.txt" "$R/creds.env"
git -C "$R" reset -q
printf 'export const two = 2\n' >"$R/also-clean.ts"
git -C "$R" add also-clean.ts
git -C "$R" commit -qm "clean change" >"${SANDBOX}/out3" 2>&1
check zero $? "clean staged content commits"

# ===========================================================================
printf '\n4. Partially staged files use the INDEX, not the working tree\n'
# ===========================================================================
# 4a. staged clean + unstaged PII -> must PASS (the PII is not being committed)
printf 'line one\n' >"$R/partial.txt"
git -C "$R" add partial.txt
printf 'line one\nunstaged ssn: %s\n' "$SYNTH_SSN" >"$R/partial.txt"
git -C "$R" commit -qm "staged clean, worktree dirty" >"${SANDBOX}/out4a" 2>&1
check zero $? "unstaged PII does not block (index is clean)"

# 4b. staged PII + clean worktree -> must BLOCK (the PII IS being committed)
printf 'line one\nstaged ssn: %s\n' "$SYNTH_SSN" >"$R/partial2.txt"
git -C "$R" add partial2.txt
printf 'line one\n' >"$R/partial2.txt"
git -C "$R" commit -qm "staged dirty, worktree clean" >"${SANDBOX}/out4b" 2>&1
check nonzero $? "staged PII blocks even though the worktree is clean"
git -C "$R" reset -q
git -C "$R" checkout -q -- . 2>/dev/null || true
rm -f "$R/partial2.txt"

# ===========================================================================
printf '\n5. Pre-push scans outgoing history\n'
# ===========================================================================
# Establish a clean pushed baseline. Step 4a deliberately left an UNSTAGED
# PII file on disk; it must be removed first, or `git add -A` sweeps it into
# the baseline and every later push assertion ends up testing the wrong thing.
rm -f "$R/partial.txt" "$R/partial2.txt"
git -C "$R" checkout -q -- . 2>/dev/null || true
git -C "$R" rm -q --cached partial.txt partial2.txt 2>/dev/null || true
rm -f "$R/partial.txt" "$R/partial2.txt"
git -C "$R" add -A >/dev/null 2>&1
git -C "$R" commit -qm "tidy" --no-verify >/dev/null 2>&1 || true
git -C "$R" push -q origin HEAD:refs/heads/main >"${SANDBOX}/out5base" 2>&1
check zero $? "clean history pushes to a new branch"
hook_ran "${SANDBOX}/out5base" "pre-push"

printf '\n6. Pre-push blocks PII ADDED then DELETED in later commits\n'
# This is the case a working-tree scan and a final-diff scan both miss.
printf 'ssn: %s\n' "$SYNTH_SSN" >"$R/transient.txt"
git -C "$R" add transient.txt
git -C "$R" commit -qm "add transient pii" --no-verify >/dev/null 2>&1
git -C "$R" rm -q transient.txt
git -C "$R" commit -qm "remove transient pii" --no-verify >/dev/null 2>&1
# The tip is clean; only the intermediate commit holds the data.
if [ -e "$R/transient.txt" ]; then
	no "sanity: transient.txt should be gone from the working tree"
else
	ok "sanity: file is absent from the tip and from the final diff"
fi
git -C "$R" push -q origin main >"${SANDBOX}/out6" 2>&1
check nonzero $? "add-then-delete PII blocks the push"
hook_ran "${SANDBOX}/out6" "pre-push"
grep -q 'SSN' "${SANDBOX}/out6" && ok "pre-push names the finding type" || no "expected SSN in pre-push report"
grep -qi 'rewritten\|rebase' "${SANDBOX}/out6" && ok "message explains history must be rewritten" || no "expected rewrite guidance"

printf '\n7. Pre-push on a brand new branch with no remote ancestor\n'
git -C "$R" checkout -q -b fresh-branch
git -C "$R" push -q origin fresh-branch >"${SANDBOX}/out7" 2>&1
check nonzero $? "new branch carrying the transient PII is blocked"
hook_ran "${SANDBOX}/out7" "pre-push"
# And a genuinely clean new branch from the pushed baseline must pass.
git -C "$R" checkout -q -B clean-branch origin/main
printf 'export const three = 3\n' >"$R/c3.ts"
git -C "$R" add c3.ts
git -C "$R" commit -qm "clean new branch" >/dev/null 2>&1
git -C "$R" push -q origin clean-branch >"${SANDBOX}/out7b" 2>&1
check zero $? "clean new branch pushes"

printf '\n8. Tag that introduces history\n'
git -C "$R" checkout -q fresh-branch
git -C "$R" tag -a v-bad -m "tag over transient pii" >/dev/null 2>&1
git -C "$R" push -q origin v-bad >"${SANDBOX}/out8" 2>&1
check nonzero $? "tag pointing at PII-bearing history is blocked"
hook_ran "${SANDBOX}/out8" "pre-push"

printf '\n9. Ref deletion has nothing to scan\n'
git -C "$R" checkout -q clean-branch
git -C "$R" push -q origin :clean-branch >"${SANDBOX}/out9" 2>&1
check zero $? "deleting a remote branch is allowed"

# ===========================================================================
printf '\n10. Fails closed when a scanner is missing\n'
# ===========================================================================
R2="${SANDBOX}/repo2"
new_repo "$R2"
printf 'export const x = 1\n' >"$R2/x.ts"
git -C "$R2" add x.ts
# An empty PATH plus a tools dir with nothing in it: neither scanner resolves.
mkdir -p "${SANDBOX}/empty-tools"
env PATH="/usr/bin:/bin" SECURITY_TOOLS_DIR="${SANDBOX}/empty-tools" \
	git -C "$R2" commit -qm "no scanners" >"${SANDBOX}/out10" 2>&1
check nonzero $? "missing scanner blocks the commit rather than passing"
grep -qi 'not found\|fails closed' "${SANDBOX}/out10" && ok "explains that the scanner is absent" || no "expected a missing-scanner message"

printf '\n11. Fails closed on a scanner failure\n'
# A ferret-scan config that cannot be parsed makes the scanner exit 1.
R3="${SANDBOX}/repo3"
new_repo "$R3"
printf 'this: is: not: valid: yaml: [\n' >"$R3/.security/ferret-scan.yaml"
printf 'export const y = 2\n' >"$R3/y.ts"
git -C "$R3" add y.ts
git -C "$R3" commit -qm "broken scanner config" >"${SANDBOX}/out11" 2>&1
check nonzero $? "unreadable scanner config blocks the commit"
grep -qi 'failed\|did not complete' "${SANDBOX}/out11" && ok "reports a scanner failure, not a clean result" || no "expected a scanner-failure message"

printf '\n12. A pre-existing hook keeps running\n'
# core.hooksPath makes git ignore $GIT_DIR/hooks entirely, so the new hook
# must chain to whatever was already installed there.
R4="${SANDBOX}/repo4"
new_repo "$R4"
mkdir -p "$R4/.git/hooks"
cat >"$R4/.git/hooks/pre-commit" <<'LEGACY'
#!/usr/bin/env bash
echo "LEGACY-HOOK-RAN"
exit 0
LEGACY
chmod +x "$R4/.git/hooks/pre-commit"
printf 'export const z = 3\n' >"$R4/z.ts"
git -C "$R4" add z.ts
git -C "$R4" commit -qm "with legacy hook" >"${SANDBOX}/out12" 2>&1
check zero $? "commit succeeds with a pre-existing hook present"
grep -q 'LEGACY-HOOK-RAN' "${SANDBOX}/out12" && ok "pre-existing hook still executed" || no "pre-existing hook did NOT run"

printf '\n13. A failing pre-existing hook still blocks\n'
cat >"$R4/.git/hooks/pre-commit" <<'LEGACY'
#!/usr/bin/env bash
echo "LEGACY-HOOK-REFUSES"
exit 7
LEGACY
chmod +x "$R4/.git/hooks/pre-commit"
printf 'export const w = 4\n' >"$R4/w.ts"
git -C "$R4" add w.ts
git -C "$R4" commit -qm "legacy hook refuses" >"${SANDBOX}/out13" 2>&1
# git collapses ANY hook failure to exit 1 -- verified directly: a hook
# exiting 7 and a hook exiting 42 both surface as `git commit` exit 1. The
# hook's own code is therefore not observable from here, so assert on the
# behaviour that matters: the refusal is honoured and attributed.
check nonzero $? "a refusing pre-existing hook blocks the commit"
grep -q 'LEGACY-HOOK-REFUSES' "${SANDBOX}/out13" && ok "pre-existing hook ran and its output is shown" || no "expected the legacy hook's output"
grep -qi 'not overriding it' "${SANDBOX}/out13" && ok "reports that the pre-existing hook's refusal was honoured" || no "expected a chaining message"

# ===========================================================================
printf '\n14. Hooks fire inside a linked worktree (the Herdr case)\n'
# ===========================================================================
# Herdr runs agents in git worktrees under ~/.herdr/worktrees. Linked
# worktrees share the main repository's config, so core.hooksPath applies --
# and because it is a RELATIVE path, git resolves it against the worktree root,
# where the tracked .githooks/ directory is also checked out. Verify, do not
# assume.
WT="${SANDBOX}/linked-worktree"
git -C "$R4" worktree add -q -b wt-branch "$WT" >/dev/null 2>&1
if [ -d "$WT/.githooks" ]; then
	ok "worktree checkout contains .githooks/"
else
	no ".githooks/ missing from the worktree checkout"
fi
printf 'ssn: %s\n' "$SYNTH_SSN" >"$WT/wt-leak.txt"
git -C "$WT" add wt-leak.txt
git -C "$WT" commit -qm "pii in a worktree" >"${SANDBOX}/out14" 2>&1
check nonzero $? "PII staged inside a linked worktree is blocked"
hook_ran "${SANDBOX}/out14" "pre-commit"
grep -q 'SSN' "${SANDBOX}/out14" && ok "worktree hook produced the same report" || no "expected the same finding in the worktree"
git -C "$R4" worktree remove --force "$WT" >/dev/null 2>&1 || true

# ===========================================================================
printf '\n15. Blocking-tier coverage the convenience flag would have missed\n'
# ===========================================================================
# --pre-commit-mode narrows ferret-scan to CREDIT_CARD,SECRETS,SSN,EMAIL,
# PHONE,IP_ADDRESS. A street address is in none of those, so this case proves
# the hook is not relying on that flag.
R5="${SANDBOX}/repo5"
new_repo "$R5"
printf 'home: %s\n' "$SYNTH_ADDR" >"$R5/addr.txt"
git -C "$R5" add addr.txt
git -C "$R5" commit -qm "street address" >"${SANDBOX}/out15" 2>&1
check nonzero $? "PHYSICAL_ADDRESS blocks (outside --pre-commit-mode's check set)"
# Confirm the narrow mode really would have let it through.
addr_rc=0
"$(command -v ferret-scan)" --file "$R5/addr.txt" --pre-commit-mode >/dev/null 2>&1 || addr_rc=$?
if [ "$addr_rc" -eq 0 ]; then
	ok "confirmed: --pre-commit-mode alone exits 0 on the same file"
else
	printf '  note: --pre-commit-mode exited %s here; upstream check set may have changed\n' "$addr_rc"
fi

# ===========================================================================
printf '\n16. Commit-message credential detection (not weakened by the SECRETS carve-out)\n'
# ===========================================================================
# ferret-scan's SECRETS check is excluded from BLOCKING on commit metadata,
# because its entropy heuristic fires on the opaque identifiers commit messages
# legitimately carry. gitleaks covers credentials there instead. Prove that a
# real token in a commit message still blocks, and that an ordinary
# identifier-bearing message does not.
R6="${SANDBOX}/repo6"
new_repo "$R6"
git -C "$R6" remote add origin "$REMOTE" 2>/dev/null || true
printf 'export const m = 1\n' >"$R6/m.ts"
git -C "$R6" add m.ts
# A real credential pasted into the commit MESSAGE, not the diff.
git -C "$R6" commit -q --no-verify -m "chore: rotate key

AWS_ACCESS_KEY_ID=${SYNTH_AWS}
"
git -C "$R6" push -q origin main >"${SANDBOX}/out16a" 2>&1
check nonzero $? "credential in a commit MESSAGE blocks the push"
hook_ran "${SANDBOX}/out16a" "pre-push"
grep -q 'aws-access-token' "${SANDBOX}/out16a" && ok "gitleaks caught it in the metadata" || no "expected gitleaks to flag the commit message"

# An ordinary message full of opaque identifiers must NOT block.
R7="${SANDBOX}/repo7"
new_repo "$R7"
git -C "$R7" remote add origin "${SANDBOX}/remote7.git" 2>/dev/null || true
git init -q --bare "${SANDBOX}/remote7.git"
printf 'export const n = 2\n' >"$R7/n.ts"
git -C "$R7" add n.ts
git -C "$R7" commit -q --no-verify -m "fix(deps): clear advisories

GHSA-6pq8-jhm2-2vcw, GHSA-4mjr-xmp4-gh2g
Session: https://example.invalid/code/session_014eK2ELHjvSpV1JkGXUMnx6
Reverts commit 3705475e951018b3ad82f9b718c54f04dcde6076.
"
git -C "$R7" push -q origin main >"${SANDBOX}/out16b" 2>&1
check zero $? "opaque identifiers in a commit message do NOT block"
hook_ran "${SANDBOX}/out16b" "pre-push"

printf '\n17. Pi hook-guard rules\n'
if node "${SECURITY_SRC}/tests/pi-hook-guard.test.mjs" >"${SANDBOX}/out17" 2>&1; then
	ok "Pi bypass-guard rules pass ($(grep -c '  ok ' "${SANDBOX}/out17") cases)"
else
	no "Pi bypass-guard rules failed"
	sed 's/^/      /' "${SANDBOX}/out17" | grep -i fail | head
fi

# ===========================================================================
printf '\n%s\n' "────────────────────────────────────────────────"
printf '%s passed, %s failed\n\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
