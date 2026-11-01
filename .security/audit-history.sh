#!/usr/bin/env bash
# Full-history PII / secrets audit for the debriefer repository.
#
#   .security/audit-history.sh [--out <dir>]
#
# Scans, as four separate and separately-reported result sets:
#
#   1. HISTORICAL CONTENT  every unique blob reachable from every local and
#                          remote branch and tag, including files that were
#                          later deleted. Deduplicated by blob oid.
#   2. HISTORICAL PATHS    every path any blob has ever had -- a filename can
#                          itself be PII ("resume-jane-smith.pdf").
#   3. COMMIT/TAG METADATA commit messages, annotated tag messages, and the
#                          author/committer identities.
#   4. CURRENT FILES       the tracked files of the current checkout, reported
#                          separately so a clean working tree is never
#                          mistaken for clean history.
#
# Writes a report directory containing ONLY masked findings -- type,
# confidence, path, line number. No matched value is ever written to disk.
#
# Coverage limitations are detected and reported rather than assumed away.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)" || exit 1
SECURITY_DIR="${REPO_ROOT}/.security"
# shellcheck source=policy.sh
. "${SECURITY_DIR}/policy.sh"
# shellcheck source=lib/scan.sh
. "${SECURITY_DIR}/lib/scan.sh"

OUT_DIR=""
while [ $# -gt 0 ]; do
	case "$1" in
	--out)
		OUT_DIR="${2:-}"
		shift 2
		;;
	*)
		printf 'usage: %s [--out <dir>]\n' "$0" >&2
		exit 2
		;;
	esac
done
# Default to a temporary directory: a report inside the repository could be
# committed by accident, and even a masked report is best kept out of history.
[ -n "$OUT_DIR" ] || OUT_DIR="$(mktemp -d -t debriefer-audit)"
mkdir -p "$OUT_DIR"

resolve_ferret || exit 1
resolve_gitleaks || exit 1
resolve_node || exit 1
export FERRET_PRECOMMIT=0

WORK="$(mktemp -d)" || exit 1
trap 'rm -rf -- "$WORK"' EXIT INT TERM

hr() { printf '\n%s\n' "────────────────────────────────────────────────────────────────────────"; }

printf '\ndebriefer full-history PII / secrets audit\n'
printf 'repository: %s\n' "$REPO_ROOT"
printf 'report dir: %s\n' "$OUT_DIR"
printf 'ferret-scan %s | gitleaks %s\n' "$FERRET_VERSION" "$GITLEAKS_VERSION"

# ===========================================================================
# 0. Coverage preflight -- what CANNOT be covered must be said up front.
# ===========================================================================
hr
printf '0. Coverage preflight\n\n'

COVERAGE_NOTES="${OUT_DIR}/coverage-limitations.txt"
: >"$COVERAGE_NOTES"

note_gap() {
	printf '%s\n' "$*" >>"$COVERAGE_NOTES"
	printf '  GAP: %s\n' "$*"
}

if [ -f "$(git rev-parse --git-path shallow)" ]; then
	note_gap "History is SHALLOW. Commits below the graft point are absent and were NOT scanned. Run 'git fetch --unshallow' for full coverage."
else
	printf '  ok: history is complete (not shallow)\n'
fi

# Remote refs that exist on the remote but are not fetched locally cannot be
# scanned. Only ask the remote if it is reachable; an offline audit is still
# useful, but it must say what it could not see.
if git ls-remote --exit-code origin >/dev/null 2>&1; then
	remote_only="$(
		comm -23 \
			<(git ls-remote --heads --tags origin 2>/dev/null | awk '{print $2}' | sort -u) \
			<(git for-each-ref --format='%(refname)' refs/remotes/origin refs/tags 2>/dev/null |
				sed 's|^refs/remotes/origin/|refs/heads/|' | sort -u) || true
	)"
	if [ -n "$remote_only" ]; then
		note_gap "$(printf 'Refs present on origin but not fetched locally (NOT scanned):\n%s' "$(printf '%s\n' "$remote_only" | sed 's/^/    /')")"
	else
		printf '  ok: all origin refs are present locally\n'
	fi
else
	note_gap "origin is unreachable; could not confirm that all remote refs are present locally."
fi

# Formats neither scanner reads as containers.
cat >>"$COVERAGE_NOTES" <<'EOF'
Format coverage (applies to every section below):
  SCANNED as text              source, config, markdown, CSV, JSON, YAML, logs, plain text
  SCANNED via text extraction  PDF and Office documents -- the EXTRACTED TEXT only.
                               Embedded images, attachments, revision history,
                               and object metadata inside those files are NOT
                               fully covered.
  NOT SCANNED as containers    raster/vector images (PNG, JPEG, GIF, SVG, TIFF),
                               archives (zip, tar, gz), databases (SQLite and
                               similar), compiled binaries, fonts, audio, video.
                               ferret-scan's METADATA validator inspects some
                               image/document metadata; gitleaks skips these
                               paths entirely via its default allowlist.
  NOT SCANNED by gitleaks      lockfiles (package-lock.json, yarn.lock, ...),
                               node_modules/, vendored trees. These ARE scanned
                               by ferret-scan.
EOF
printf '  note: format coverage recorded in %s\n' "$(basename "$COVERAGE_NOTES")"

# What we are about to treat as "all history".
ALL_REFS=()
while IFS= read -r r; do [ -n "$r" ] && ALL_REFS+=("$r"); done < <(
	git for-each-ref --format='%(refname)' refs/heads refs/remotes refs/tags 2>/dev/null
)
printf '  refs in scope: %s\n' "${#ALL_REFS[@]}"
printf '  commits in scope: %s\n' "$(git rev-list --all --count 2>/dev/null || echo '?')"

# ===========================================================================
# 1. Historical content
# ===========================================================================
hr
printf '1. Historical file contents (all refs, including deleted files)\n\n'

HIST_TREE="${WORK}/history"
mkdir -p "$HIST_TREE"

# --all covers every local branch and tag; the explicit ref list adds
# remote-tracking branches, which --all does not include.
read -r h_files h_unique h_occ < <(materialize_rev_blobs "$HIST_TREE" --all "${ALL_REFS[@]}")
if [ -z "${h_files:-}" ]; then
	scan_err "could not enumerate historical objects; audit is incomplete."
	note_gap "Historical object enumeration FAILED; section 1 results are not trustworthy."
	h_files=0
	h_unique=0
	h_occ=0
fi
printf '  %s unique blob(s) deduplicated from %s object reference(s)\n' "$h_unique" "$h_occ"
printf '  %s materialised for scanning\n' "$h_files"
if [ "$h_unique" -gt "$h_files" ]; then
	note_gap "$((h_unique - h_files)) historical blob(s) could not be materialised (path collision or unreadable object) and were NOT scanned."
fi

hist_status=0
ferret_scan_tree "$HIST_TREE" "historical contents" || hist_status=$?
GITLEAKS_STRIP_PREFIX="$HIST_TREE" gitleaks_run "historical contents" dir "$HIST_TREE" || hist_status=$?

# Keep a masked machine-readable copy for triage.
"$FERRET_BIN" --file "$HIST_TREE" --recursive \
	--checks "${FERRET_BLOCKING_CHECKS},${FERRET_ADVISORY_CHECKS}" \
	--confidence all --limit 0 --format json --output "${OUT_DIR}/history-pii.json" \
	--exclude "$FERRET_EXCLUDE_GLOBS" --no-color --quiet \
	${FERRET_CONFIG:+--config "$FERRET_CONFIG"} >/dev/null 2>&1 || true

# ===========================================================================
# 2. Historical paths
# ===========================================================================
hr
printf '2. Historical paths (filenames themselves)\n\n'

PATHS_DIR="${WORK}/paths"
mkdir -p "$PATHS_DIR"
git rev-list --objects --all "${ALL_REFS[@]}" 2>/dev/null |
	awk 'NF>1 {$1=""; sub(/^ /,""); print}' | sort -u >"${PATHS_DIR}/historical-paths.txt"
path_count="$(wc -l <"${PATHS_DIR}/historical-paths.txt" | tr -d ' ')"
printf '  %s distinct historical path(s)\n' "$path_count"
ferret_scan_tree "$PATHS_DIR" "historical paths" || true
cp "${PATHS_DIR}/historical-paths.txt" "${OUT_DIR}/historical-paths.txt" 2>/dev/null || true

# ===========================================================================
# 3. Commit and tag metadata
# ===========================================================================
hr
printf '3. Commit messages, tag messages, author/committer identities\n\n'

META_DIR="${WORK}/metadata"
mkdir -p "$META_DIR"
git log --format='%H%n%s%n%b%n' --all >"${META_DIR}/commit-messages.txt" 2>/dev/null || true
git log --format='%an <%ae>%n%cn <%ce>' --all 2>/dev/null | sort -u >"${META_DIR}/identities.txt" || true
: >"${META_DIR}/tag-messages.txt"
while IFS= read -r tag; do
	[ -n "$tag" ] || continue
	if [ "$(git cat-file -t "$tag" 2>/dev/null)" = "tag" ]; then
		git cat-file tag "$tag" 2>/dev/null >>"${META_DIR}/tag-messages.txt"
	fi
done < <(git tag 2>/dev/null)

printf '  %s commit(s), %s distinct identity string(s), %s annotated tag(s)\n' \
	"$(git rev-list --all --count 2>/dev/null || echo '?')" \
	"$(wc -l <"${META_DIR}/identities.txt" | tr -d ' ')" \
	"$(git tag 2>/dev/null | while read -r t; do [ "$(git cat-file -t "$t" 2>/dev/null)" = tag ] && echo x; done | wc -l | tr -d ' ')"

printf '\n  Distinct author/committer identities (git attribution is expected,\n'
printf '  but review for a personal address committed by mistake):\n'
sed 's/^/    /' "${META_DIR}/identities.txt"
cp "${META_DIR}/identities.txt" "${OUT_DIR}/identities.txt" 2>/dev/null || true

printf '\n'
ferret_scan_tree "$META_DIR" "commit/tag metadata" || true
GITLEAKS_STRIP_PREFIX="$META_DIR" gitleaks_run "commit/tag metadata" dir "$META_DIR" || true

# ===========================================================================
# 4. Current files (reported separately from history)
# ===========================================================================
hr
printf '4. Current tracked files (separate result set)\n\n'
"${SECURITY_DIR}/scan-worktree.sh" || true

# ===========================================================================
# Summary
# ===========================================================================
hr
printf 'Summary\n\n'
if [ -s "$COVERAGE_NOTES" ]; then
	printf '  Coverage limitations (full text in %s):\n' "${OUT_DIR}/coverage-limitations.txt"
	grep -v '^ ' "$COVERAGE_NOTES" | head -20 | sed 's/^/    - /'
fi
printf '\n  Report files (masked -- no matched values):\n'
for f in "$OUT_DIR"/*; do [ -e "$f" ] && printf '    %s\n' "$f"; done
printf '\n  These reports are deliberately OUTSIDE the repository. Do not commit them.\n\n'
