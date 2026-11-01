#!/usr/bin/env bash
# CI entry point for the debriefer PII / secrets checks.
#
#   .security/ci-scan.sh --base <ref-or-oid> --head <ref-or-oid>
#   .security/ci-scan.sh --head <oid>                 # no base: new branch
#
# Produces two SEPARATE result sets, as the repository's security policy
# requires:
#
#   A. HISTORICAL CHANGES IN RANGE  every unique blob introduced by the
#      commits in base..head, plus their commit messages and identities.
#      Catches a secret added in one commit of a PR and deleted in another.
#
#   B. CHECKED-OUT TRACKED FILES    the tree as it would be merged.
#
# Exits non-zero if either set has a blocking finding, if a scanner fails, or
# if a required scan could not be completed. Logs are masked: no matched value
# is ever printed.
#
# Kept as a script rather than inline YAML so it can be run locally exactly as
# CI runs it.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)" || exit 1
SECURITY_DIR="${REPO_ROOT}/.security"
# shellcheck source=policy.sh
. "${SECURITY_DIR}/policy.sh"
# shellcheck source=lib/scan.sh
. "${SECURITY_DIR}/lib/scan.sh"

BASE=""
HEAD_REV="HEAD"
while [ $# -gt 0 ]; do
	case "$1" in
	--base) BASE="${2:-}"; shift 2 ;;
	--head) HEAD_REV="${2:-HEAD}"; shift 2 ;;
	*) printf 'usage: %s [--base <rev>] --head <rev>\n' "$0" >&2; exit 2 ;;
	esac
done

resolve_ferret || exit 1
resolve_gitleaks || exit 1
resolve_node || exit 1
export FERRET_PRECOMMIT=0
# CI logs are retained and often public. Never colourise, never reveal values.
export NO_COLOR=1

WORK="$(mktemp -d)" || exit 1
trap 'rm -rf -- "$WORK"' EXIT INT TERM

printf '::group::scanner versions\n'
printf 'ferret-scan %s (pinned %s)\n' "$FERRET_VERSION" "$FERRET_SCAN_PINNED_VERSION"
printf 'gitleaks    %s (pinned %s)\n' "$GITLEAKS_VERSION" "$GITLEAKS_PINNED_VERSION"
printf '::endgroup::\n'

status=0

# ===========================================================================
# A. Historical changes in the range
# ===========================================================================
printf '\n== A. historical changes in range ==\n'

# A missing or unresolvable base is not a reason to skip: it means we cannot
# narrow the range, so scan everything reachable from HEAD instead.
REV_ARGS=("$HEAD_REV")
if [ -n "$BASE" ] && git rev-parse --verify --quiet "$BASE" >/dev/null 2>&1; then
	REV_ARGS+=(--not "$BASE")
	printf 'range: %s..%s\n' "$BASE" "$HEAD_REV"
else
	if [ -n "$BASE" ]; then
		scan_warn "base '${BASE}' could not be resolved; scanning all history reachable from ${HEAD_REV}."
		scan_info "  If this is unexpected, the checkout needs more history (fetch-depth: 0)."
	else
		printf 'range: all history reachable from %s (no base given)\n' "$HEAD_REV"
	fi
fi

# Validate the range before scanning. A silently-invalid range would read as
# a clean result.
if ! commit_count="$(git rev-list --count "${REV_ARGS[@]}" 2>/dev/null)"; then
	scan_err "could not resolve the commit range; refusing to report a clean result."
	exit 1
fi
printf 'commits in range: %s\n' "$commit_count"

if [ "${commit_count:-0}" -eq 0 ]; then
	printf 'no commits in range; section A has nothing to scan\n'
else
	HIST_TREE="${WORK}/range"
	mkdir -p "$HIST_TREE"
	read -r n_files n_unique n_occ < <(materialize_rev_blobs "$HIST_TREE" "${REV_ARGS[@]}")
	if [ -z "${n_files:-}" ]; then
		scan_err "could not enumerate objects in the range; refusing to report a clean result."
		exit 1
	fi
	printf 'blobs: %s unique (from %s object refs), %s scanned\n' "$n_unique" "$n_occ" "$n_files"
	if [ "$n_unique" -gt "$n_files" ]; then
		scan_err "$((n_unique - n_files)) blob(s) in range could not be materialised; scan is incomplete."
		status=1
	fi

	ferret_scan_tree "$HIST_TREE" "range contents"
	case $? in 0) ;; 1) status=1 ;; *) status=1 ;; esac

	GITLEAKS_STRIP_PREFIX="$HIST_TREE" gitleaks_run "range contents" dir "$HIST_TREE"
	case $? in 0) ;; 1) status=1 ;; *) status=1 ;; esac

	scan_commit_metadata "range commit metadata" "${REV_ARGS[@]}"
	case $? in 0) ;; 1) status=1 ;; *) status=1 ;; esac
fi

# ===========================================================================
# B. Checked-out tracked files
# ===========================================================================
printf '\n== B. checked-out tracked files ==\n'
TREE="${WORK}/tree"
mkdir -p "$TREE"
count=0
while IFS= read -r -d '' rel; do
	path_in_scope "$rel" || continue
	[ -f "${REPO_ROOT}/${rel}" ] || continue
	[ -L "${REPO_ROOT}/${rel}" ] && continue
	mkdir -p -- "$(dirname -- "${TREE}/${rel}")"
	cp -- "${REPO_ROOT}/${rel}" "${TREE}/${rel}" 2>/dev/null && count=$((count + 1))
done < <(git ls-files -z)
printf 'tracked files: %s\n' "$count"

ferret_scan_tree "$TREE" "checked-out files"
case $? in 0) ;; 1) status=1 ;; *) status=1 ;; esac

GITLEAKS_STRIP_PREFIX="$TREE" gitleaks_run "checked-out files" dir "$TREE"
case $? in 0) ;; 1) status=1 ;; *) status=1 ;; esac

# ===========================================================================
printf '\n'
if [ "$status" -ne 0 ]; then
	scan_err "PII / secrets check FAILED."
	scan_info "  Values are masked above by design. Reproduce locally with:"
	scan_info "    .security/scan-worktree.sh --show-match"
	scan_info "    .security/audit-history.sh"
	scan_info "  See .security/README.md for the exception policy. Do not add a"
	scan_info "  baseline or widen an allowlist to make this pass."
	exit 1
fi
printf 'PII / secrets check passed (both result sets).\n'
exit 0
