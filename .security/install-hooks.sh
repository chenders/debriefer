#!/usr/bin/env bash
# Install (or verify) the debriefer PII / secrets git hooks.
#
# Sets core.hooksPath for THIS REPOSITORY ONLY. Global git configuration is
# never touched, so other repositories on this machine are unaffected.
#
#   .security/install-hooks.sh            install and verify
#   .security/install-hooks.sh --verify   verify only, non-zero if not installed
#
# Safe to re-run.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

HOOKS_DIR=".githooks"
VERIFY_ONLY=0
[ "${1:-}" = "--verify" ] && VERIFY_ONLY=1

ok() { printf '  \033[32mok\033[0m    %s\n' "$*"; }
bad() { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; }
note() { printf '        %s\n' "$*"; }

problems=0

printf '\ndebriefer PII / secrets hook installation\n\n'

# ---------------------------------------------------------------------------
# Warn about hooks that would stop running once core.hooksPath is set.
# ---------------------------------------------------------------------------
GIT_DIR="$(git rev-parse --git-dir)"
# In a linked worktree, hooks live in the shared common dir.
COMMON_DIR="$(git rev-parse --git-common-dir)"
for hook in pre-commit pre-push; do
	legacy="${COMMON_DIR}/hooks/${hook}"
	if [ -x "$legacy" ]; then
		note "found a pre-existing ${hook} at ${legacy}"
		note "  it will be chained from ${HOOKS_DIR}/${hook}, not replaced"
	fi
done

# ---------------------------------------------------------------------------
# Configure core.hooksPath (repository-local).
# ---------------------------------------------------------------------------
current="$(git config --local --get core.hooksPath || true)"
if [ "$VERIFY_ONLY" -eq 1 ]; then
	if [ "$current" = "$HOOKS_DIR" ]; then
		ok "core.hooksPath = ${HOOKS_DIR}"
	else
		bad "core.hooksPath is '${current:-unset}', expected '${HOOKS_DIR}'"
		note "run .security/install-hooks.sh to fix"
		problems=$((problems + 1))
	fi
else
	if [ -n "$current" ] && [ "$current" != "$HOOKS_DIR" ]; then
		bad "core.hooksPath is already set to '${current}'"
		note "refusing to overwrite another hook configuration; resolve by hand"
		exit 1
	fi
	git config --local core.hooksPath "$HOOKS_DIR"
	ok "core.hooksPath = ${HOOKS_DIR} (repository-local)"
fi

# A global core.hooksPath would be overridden by the local one, but say so,
# because the user may expect their global hooks to run here.
global_hooks="$(git config --global --get core.hooksPath || true)"
if [ -n "$global_hooks" ]; then
	note "note: global core.hooksPath='${global_hooks}' is overridden in this repository"
fi

# ---------------------------------------------------------------------------
# Hook files present and executable.
# ---------------------------------------------------------------------------
for hook in pre-commit pre-push; do
	f="${HOOKS_DIR}/${hook}"
	if [ ! -f "$f" ]; then
		bad "missing ${f}"
		problems=$((problems + 1))
	elif [ ! -x "$f" ]; then
		if [ "$VERIFY_ONLY" -eq 1 ]; then
			bad "${f} is not executable"
			problems=$((problems + 1))
		else
			chmod +x "$f"
			ok "${f} (made executable)"
		fi
	else
		ok "$f"
	fi
done

# ---------------------------------------------------------------------------
# Scanners present.
# ---------------------------------------------------------------------------
SECURITY_DIR="${REPO_ROOT}/.security"
# shellcheck source=policy.sh
. "${SECURITY_DIR}/policy.sh"
# shellcheck source=lib/scan.sh
. "${SECURITY_DIR}/lib/scan.sh"

if resolve_ferret 2>/dev/null; then
	ok "ferret-scan ${FERRET_VERSION} (pinned ${FERRET_SCAN_PINNED_VERSION})"
else
	bad "ferret-scan unavailable or too old -- hooks will BLOCK until fixed"
	note "brew install ferret-scan   # or: pip install ferret-scan==${FERRET_SCAN_PINNED_VERSION}"
	problems=$((problems + 1))
fi

if resolve_gitleaks 2>/dev/null; then
	ok "gitleaks ${GITLEAKS_VERSION} (pinned ${GITLEAKS_PINNED_VERSION})"
else
	bad "gitleaks unavailable or too old -- hooks will BLOCK until fixed"
	note "brew install gitleaks"
	problems=$((problems + 1))
fi

if resolve_node 2>/dev/null; then
	ok "node $("$NODE_BIN" --version)"
else
	bad "node unavailable -- hooks will BLOCK until fixed"
	problems=$((problems + 1))
fi

# ---------------------------------------------------------------------------
# Confirm git actually resolves the hooks from here, including in a worktree.
# ---------------------------------------------------------------------------
# core.hooksPath is relative, so it resolves against the top of the working
# tree. Linked worktrees share this repository's config, and .githooks/ is a
# tracked directory, so it is present in every worktree -- but verify rather
# than assume, because Herdr runs agents in linked worktrees.
resolved="$(git rev-parse --git-path hooks)"
ok "git resolves hooks to: ${resolved}"
if [ "$(cd "$(dirname "$resolved")" 2>/dev/null && pwd)" = "$COMMON_DIR" ] 2>/dev/null; then
	bad "git is still resolving hooks inside the git dir; core.hooksPath did not take effect"
	problems=$((problems + 1))
fi

printf '\n'
if [ "$problems" -gt 0 ]; then
	printf '%s problem(s) found.\n\n' "$problems"
	exit 1
fi
printf 'Hooks installed and verified.\n\n'
printf 'Manual scans:\n'
printf '  .security/scan-staged.sh      scan what is currently staged\n'
printf '  .security/scan-worktree.sh    scan tracked files in the working tree\n'
printf '  .security/audit-history.sh    full-history audit (all branches and tags)\n\n'
