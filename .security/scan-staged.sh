#!/usr/bin/env bash
# Scan the currently staged content on demand -- the same scan the pre-commit
# hook performs, runnable without attempting a commit.
#
#   .security/scan-staged.sh               report, values hidden
#   .security/scan-staged.sh --show-match  reveal matched values (local only)
#
# --show-match prints sensitive values to this terminal. Output is never sent
# anywhere, but do not paste it into an issue, a PR, or a chat log.

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

STAGE_DIR="$(mktemp -d)" || exit 1
trap 'rm -rf -- "$STAGE_DIR"' EXIT INT TERM

count="$(materialize_staged "$STAGE_DIR")" || {
	scan_err "could not read the index"
	exit 1
}
if [ "${count:-0}" -eq 0 ]; then
	scan_info "nothing staged in scope."
	exit 0
fi
scan_info "scanning ${count} staged file(s) (exact index content)"

status=0

if [ "$SHOW_MATCH" -eq 1 ]; then
	scan_warn "--show-match: sensitive values will be printed below. Do not share this output."
	"$FERRET_BIN" \
		--file "$STAGE_DIR" --recursive \
		--checks "${FERRET_BLOCKING_CHECKS},${FERRET_ADVISORY_CHECKS}" \
		--confidence all --limit 0 --format text --verbose --show-match \
		--exclude "$FERRET_EXCLUDE_GLOBS" --no-color --fail-on-incomplete \
		${FERRET_CONFIG:+--config "$FERRET_CONFIG"} || status=1
	# gitleaks without --redact also reveals values.
	"$GITLEAKS_BIN" dir "$STAGE_DIR" --no-banner --no-color -v \
		--log-level error --exit-code 2 \
		${GITLEAKS_CONFIG:+--config "$GITLEAKS_CONFIG"} || status=1
else
	ferret_scan_tree "$STAGE_DIR" "staged content" || status=1
	gitleaks_run "staged content" git "$REPO_ROOT" --staged || status=1
fi

exit "$status"
