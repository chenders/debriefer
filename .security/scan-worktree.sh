#!/usr/bin/env bash
# Scan the TRACKED files of the current checkout.
#
# This is the "current files" scan, kept deliberately separate from the
# history audit (.security/audit-history.sh) so that the two results are never
# conflated: a clean working tree says nothing about what is in history.
#
#   .security/scan-worktree.sh               report, values hidden
#   .security/scan-worktree.sh --show-match  reveal matched values (local only)
#
# Scans tracked files only. Untracked files are not scanned here because they
# are not part of the repository; the pre-commit hook covers them at the point
# they are staged.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)" || exit 1
SECURITY_DIR="${REPO_ROOT}/.security"
# shellcheck source=policy.sh
. "${SECURITY_DIR}/policy.sh"
# shellcheck source=lib/scan.sh
. "${SECURITY_DIR}/lib/scan.sh"

SHOW_MATCH=0
[ "${1:-}" = "--show-match" ] && SHOW_MATCH=1

resolve_ferret || exit 1
resolve_gitleaks || exit 1
resolve_node || exit 1
export FERRET_PRECOMMIT=0

TREE="$(mktemp -d)" || exit 1
trap 'rm -rf -- "$TREE"' EXIT INT TERM

# Copy tracked files, preserving paths so extensions and allowlists behave
# identically to a real checkout. Working-tree content is used here (that is
# the point of this scan), unlike the index-based pre-commit scan.
count=0
while IFS= read -r -d '' rel; do
	path_in_scope "$rel" || continue
	[ -f "$REPO_ROOT/$rel" ] || continue  # skip deleted / submodules
	[ -L "$REPO_ROOT/$rel" ] && continue  # symlink target is a path, not data
	mkdir -p -- "$(dirname -- "$TREE/$rel")"
	cp -- "$REPO_ROOT/$rel" "$TREE/$rel" 2>/dev/null && count=$((count + 1))
done < <(git ls-files -z)

scan_info "scanning ${count} tracked file(s) in the working tree"

status=0
if [ "$SHOW_MATCH" -eq 1 ]; then
	scan_warn "--show-match: sensitive values will be printed below. Do not share this output."
	"$FERRET_BIN" \
		--file "$TREE" --recursive \
		--checks "${FERRET_BLOCKING_CHECKS},${FERRET_ADVISORY_CHECKS}" \
		--confidence all --limit 0 --format text --verbose --show-match \
		--exclude "$FERRET_EXCLUDE_GLOBS" --no-color --fail-on-incomplete \
		${FERRET_CONFIG:+--config "$FERRET_CONFIG"} || status=1
	"$GITLEAKS_BIN" dir "$TREE" --no-banner --no-color -v \
		--log-level error --exit-code 2 \
		${GITLEAKS_CONFIG:+--config "$GITLEAKS_CONFIG"} || status=1
else
	ferret_scan_tree "$TREE" "tracked working-tree files" || status=1
	GITLEAKS_STRIP_PREFIX="$TREE" gitleaks_run "tracked working-tree files" dir "$TREE" || status=1
fi

exit "$status"
