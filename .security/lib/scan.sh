#!/usr/bin/env bash
# Shared scanning helpers for the debriefer PII / secrets checkpoints.
#
# Sourced by .githooks/pre-commit, .githooks/pre-push, .security/audit-history.sh
# and the CI workflow. Requires .security/policy.sh to be sourced first.
#
# Design notes that matter:
#
#  * Every scan materialises the EXACT git object content it claims to scan
#    (index blobs for pre-commit, history blobs for pre-push/audit) into a
#    temporary tree. Scanning the working tree would both miss staged secrets
#    and falsely flag unstaged ones -- verified in .security/README.md.
#
#  * Blobs keep their repository-relative path (history scans prefix it with
#    the blob's oid so that different versions of one path do not overwrite
#    each other) so that ferret-scan's document preprocessors still dispatch
#    on file extension. Piping through --stdin would scan .pdf/.docx bytes as
#    raw text instead.
#
#  * ferret-scan defaults to --limit 200 findings per report. Every invocation
#    here passes --limit 0, because a truncated report would silently read as
#    better than it is.
#
#  * Nothing here is ever allowed to pass on uncertainty. A missing scanner, a
#    scanner crash, an unparseable report or incomplete coverage all block.
#
#  * Matched values are never printed. ferret-scan hides them unless
#    --show-match is passed (it never is); gitleaks needs an explicit --redact.

# ---------------------------------------------------------------------------
# Output helpers. All diagnostics go to stderr so that a hook's stdout stays
# clean and so nothing is swallowed by a caller capturing stdout.
# ---------------------------------------------------------------------------
_c_red=''; _c_yel=''; _c_dim=''; _c_off=''
if [ -t 2 ] && [ -z "${NO_COLOR:-}" ]; then
	_c_red=$'\033[31m'; _c_yel=$'\033[33m'; _c_dim=$'\033[2m'; _c_off=$'\033[0m'
fi

scan_info() { printf '%s\n' "$*" >&2; }
scan_dim() { printf '%s%s%s\n' "$_c_dim" "$*" "$_c_off" >&2; }
scan_warn() { printf '%swarning:%s %s\n' "$_c_yel" "$_c_off" "$*" >&2; }
scan_err() { printf '%serror:%s %s\n' "$_c_red" "$_c_off" "$*" >&2; }

# ---------------------------------------------------------------------------
# Tool resolution. Fails closed: a checkpoint that cannot run its scanners
# must block, never pass.
# ---------------------------------------------------------------------------

# Compare dotted versions. 0 if $1 >= $2.
_version_ge() {
	[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

# Resolve a scanner, preferring a pinned local install over PATH.
# PRINTS the resolved path on stdout; returns 1 if unavailable.
#
# This used to assign to a caller-named variable with `declare -g`, which needs
# bash 4.2+. macOS ships /bin/bash 3.2.57, so on a machine without a newer bash
# the hooks died with "declare: -g: invalid option" and then blamed ferret-scan
# for having no version. Printing the path needs no indirection and works on
# every bash the hooks might run under.
resolve_tool() {
	local bin="$1" found=""
	# A pinned install produced by .security/install-tools.sh wins, so CI and
	# local runs agree even when PATH carries a different build.
	if [ -n "${SECURITY_TOOLS_DIR:-}" ] && [ -x "${SECURITY_TOOLS_DIR}/${bin}" ]; then
		found="${SECURITY_TOOLS_DIR}/${bin}"
	elif command -v "$bin" >/dev/null 2>&1; then
		found="$(command -v "$bin")"
	else
		return 1
	fi
	printf '%s' "$found"
	return 0
}

# Resolve ferret-scan and verify its version against the pin.
resolve_ferret() {
	if ! FERRET_BIN="$(resolve_tool ferret-scan)"; then
		scan_err "ferret-scan not found on PATH."
		scan_info "  PII detection cannot run, so this check fails closed."
		scan_info "  Install:  brew install ferret-scan   (or: pip install ferret-scan==${FERRET_SCAN_PINNED_VERSION})"
		scan_info "  Pinned version for this repository: ${FERRET_SCAN_PINNED_VERSION}"
		return 1
	fi
	# The "v" prefix is NOT consistent between builds:
	#   Homebrew bottle      "ferret-scan v2.5.5 (commit: 987e13d, ...)"
	#   upstream release bin "ferret-scan 2.5.5 (commit: 987e13d51ba..., ...)"
	# Accept either, or the hook fails closed on a perfectly good binary.
	FERRET_VERSION="$("$FERRET_BIN" --version 2>/dev/null | head -n1 |
		sed -n 's/^ferret-scan[[:space:]]\{1,\}v\{0,1\}\([0-9][0-9.]*\).*/\1/p')"
	if [ -z "$FERRET_VERSION" ]; then
		scan_err "could not determine ferret-scan version from '$FERRET_BIN --version'."
		scan_info "  Refusing to scan with an unidentified scanner build."
		return 1
	fi
	if ! _version_ge "$FERRET_VERSION" "$FERRET_SCAN_PINNED_VERSION"; then
		scan_err "ferret-scan ${FERRET_VERSION} is older than the pinned ${FERRET_SCAN_PINNED_VERSION}."
		scan_info "  Older builds narrow detection differently; refusing to scan."
		return 1
	fi
	[ "$FERRET_VERSION" = "$FERRET_SCAN_PINNED_VERSION" ] || \
		scan_warn "ferret-scan ${FERRET_VERSION} differs from pinned ${FERRET_SCAN_PINNED_VERSION} (policy verified against the pin)."
	return 0
}

# Resolve gitleaks and verify its version against the pin.
resolve_gitleaks() {
	if ! GITLEAKS_BIN="$(resolve_tool gitleaks)"; then
		scan_err "gitleaks not found on PATH."
		scan_info "  Credential detection cannot run, so this check fails closed."
		scan_info "  Install:  brew install gitleaks"
		scan_info "  Pinned version for this repository: ${GITLEAKS_PINNED_VERSION}"
		return 1
	fi
	GITLEAKS_VERSION="$("$GITLEAKS_BIN" version 2>/dev/null | head -n1 | tr -d 'v[:space:]')"
	if [ -z "$GITLEAKS_VERSION" ]; then
		scan_err "could not determine gitleaks version from '$GITLEAKS_BIN version'."
		return 1
	fi
	if ! _version_ge "$GITLEAKS_VERSION" "$GITLEAKS_PINNED_VERSION"; then
		scan_err "gitleaks ${GITLEAKS_VERSION} is older than the pinned ${GITLEAKS_PINNED_VERSION}."
		return 1
	fi
	[ "$GITLEAKS_VERSION" = "$GITLEAKS_PINNED_VERSION" ] || \
		scan_warn "gitleaks ${GITLEAKS_VERSION} differs from pinned ${GITLEAKS_PINNED_VERSION}."
	return 0
}

# ferret-scan reports JSON; classifying it needs a JSON parser. node is a hard
# requirement of this monorepo, so depending on it adds no new burden -- but if
# it is missing we still fail closed rather than guessing with grep.
resolve_node() {
	if ! NODE_BIN="$(resolve_tool node)"; then
		scan_err "node not found on PATH; cannot classify scanner reports."
		scan_info "  This repository requires Node 22+ (see package.json)."
		return 1
	fi
	return 0
}

# ---------------------------------------------------------------------------
# Materialising git object content
# ---------------------------------------------------------------------------

# Should this repository-relative path be scanned?
# Excludes git internals, vendored deps and build output only.
path_in_scope() {
	printf '%s' "$1" | grep -Eqv "$SCAN_EXCLUDE_PATH_RE"
}

# Write one blob to <dest_root>/<path>, creating parents.
# Keeps the original extension so ferret-scan's preprocessors dispatch.
materialize_blob() {
	local oid="$1" rel="$2" dest_root="$3" out
	out="${dest_root}/${rel}"
	mkdir -p -- "$(dirname -- "$out")" || return 1
	git cat-file blob "$oid" >"$out" 2>/dev/null || return 1
	return 0
}

# Materialise the staged (index) content of every added/copied/modified/renamed
# path into $1. Echoes the number of files written.
#
# Reads the index, never the working tree, so partially staged files are
# scanned exactly as they would be committed.
materialize_staged() {
	local dest_root="$1" count=0 mode oid stage rel
	# `git ls-files --stage` gives the index mode + blob oid for each path,
	# which is what will actually be committed.
	while IFS= read -r -d '' rel; do
		path_in_scope "$rel" || continue
		# Resolve the staged mode and oid for this exact path.
		local info
		info="$(git ls-files --stage -z -- "$rel" | tr -d '\000' | head -n1)"
		[ -n "$info" ] || continue
		mode="${info%% *}"
		oid="$(printf '%s' "$info" | awk '{print $2}')"
		stage="$(printf '%s' "$info" | awk '{print $3}')"
		# 120000 = symlink (content is a path, not data we can scan as a file)
		# 160000 = gitlink (submodule pointer, no blob in this repository)
		case "$mode" in
		120000 | 160000) continue ;;
		esac
		[ "$stage" = "0" ] || continue # skip unmerged stages
		materialize_blob "$oid" "$rel" "$dest_root" || return 1
		count=$((count + 1))
	done < <(git diff --cached --name-only --diff-filter=ACMR -z)
	printf '%s' "$count"
}

# Materialise every unique blob introduced by a set of commits into $1.
#
# $2.. are revision-list arguments (e.g. "abc..def", or "HEAD" "--not" "--remotes").
# Echoes "<files_written> <unique_blobs> <total_occurrences>".
#
# Uses `git rev-list --objects`, which enumerates every object reachable from
# the given commits. That is what makes add-then-delete detectable: a blob
# added in one commit and removed in a later one is still reachable from the
# intermediate commit, so it appears here even though it is absent from the
# range's final diff.
materialize_rev_blobs() {
	local dest_root="$1"
	shift
	local written=0 unique=0 occurrences=0
	local objects seen_file
	objects="$(mktemp)" || return 1
	seen_file="$(mktemp)" || return 1

	# "<oid> <path>" lines; commits/trees/tags come through with an empty path.
	git rev-list --objects "$@" >"$objects" 2>/dev/null || {
		rm -f -- "$objects" "$seen_file"
		return 1
	}

	# Keep only blobs, then take the first path seen per oid (identical blobs
	# at several paths need scanning once -- content is what we are checking).
	local oid rel type
	while read -r oid rel; do
		[ -n "$rel" ] || continue # commit/tree/tag object
		occurrences=$((occurrences + 1))
		path_in_scope "$rel" || continue
		if grep -Fxq "$oid" "$seen_file" 2>/dev/null; then
			continue
		fi
		printf '%s\n' "$oid" >>"$seen_file"
		type="$(git cat-file -t "$oid" 2>/dev/null)" || continue
		[ "$type" = "blob" ] || continue
		unique=$((unique + 1))
		# Every unique blob needs its OWN destination. Across history a single
		# path (README.md, package.json) has dozens of distinct versions, so
		# writing by path alone makes later blobs overwrite earlier ones and
		# silently drops most of history from the scan -- measured at 787
		# unique blobs collapsing onto 211 paths in this repository.
		#
		# Namespacing by oid keeps each version separate while preserving the
		# repository-relative path suffix, so file extensions still drive
		# ferret-scan's preprocessor dispatch and gitleaks' path allowlists
		# still match.
		if materialize_blob "$oid" "${oid:0:12}/${rel}" "$dest_root" 2>/dev/null; then
			written=$((written + 1))
		fi
	done <"$objects"

	rm -f -- "$objects" "$seen_file"
	printf '%s %s %s' "$written" "$unique" "$occurrences"
}

# ---------------------------------------------------------------------------
# ferret-scan
# ---------------------------------------------------------------------------

# Scan a directory tree and print a report.
#
#   $1 tree to scan
#   $2 human label for messages
#   $3 optional: blocking check list (defaults to FERRET_BLOCKING_CHECKS).
#      Commit metadata passes FERRET_METADATA_BLOCKING_CHECKS -- see policy.sh.
#
# Returns 0 = no blocking findings, 1 = blocking findings, 2 = scanner failure.
#
# Deliberately does NOT use --pre-commit-mode. That flag silently replaces the
# check set with CREDIT_CARD,SECRETS,SSN,EMAIL,PHONE,IP_ADDRESS, which drops
# PHYSICAL_ADDRESS, DATE_OF_BIRTH, PASSPORT, DRIVERS_LICENSE, MEDICAL_ID and
# BANK_ACCOUNT -- categories this policy must cover. Verified: a 95%-confidence
# street address passes --pre-commit-mode at exit 0. See .security/README.md.
ferret_scan_tree() {
	local tree="$1" label="$2"
	local blocking="${3:-$FERRET_BLOCKING_CHECKS}"

	# An empty tree is a legitimate "nothing to do", not a failure.
	if [ -z "$(find "$tree" -type f -print -quit 2>/dev/null)" ]; then
		scan_dim "  ferret-scan: no files in scope for ${label}"
		return 0
	fi

	local report stderr_log rc
	report="$(mktemp)" || return 2
	stderr_log="$(mktemp)" || {
		rm -f -- "$report"
		return 2
	}

	local -a args=(
		--file "$tree"
		--recursive
		--checks "${FERRET_BLOCKING_CHECKS},${FERRET_ADVISORY_CHECKS}"
		--confidence all
		--format json
		--limit 0
		--output "$report"
		--exclude "$FERRET_EXCLUDE_GLOBS"
		--no-color
		--quiet
		# Escalate incomplete coverage (timeout, budget, unreadable file) to
		# exit 3 instead of a stderr warning that a hook would never notice.
		--fail-on-incomplete
	)
	[ -f "$FERRET_CONFIG" ] && args+=(--config "$FERRET_CONFIG")
	[ -f "$FERRET_SUPPRESSIONS" ] && args+=(--suppression-file "$FERRET_SUPPRESSIONS")

	# Capture the status with `|| rc=$?` rather than toggling errexit. The
	# callers run with errexit OFF, so a `set -e` here would switch it ON for
	# the rest of the hook -- which previously made the hook exit the moment
	# this function returned non-zero, skipping the credential and metadata
	# scans entirely while still blocking the commit (so no test noticed).
	rc=0
	"$FERRET_BIN" "${args[@]}" 2>"$stderr_log" || rc=$?

	case "$rc" in
	0) ;; # scan ran; findings do NOT affect ferret's exit code
	3)
		scan_err "ferret-scan reported INCOMPLETE coverage for ${label} (exit 3)."
		scan_info "  Some file was not fully scanned, so this result cannot be trusted."
		sed 's/^/  | /' "$stderr_log" >&2
		rm -f -- "$report" "$stderr_log"
		return 2
		;;
	*)
		scan_err "ferret-scan failed for ${label} (exit ${rc})."
		sed 's/^/  | /' "$stderr_log" >&2
		rm -f -- "$report" "$stderr_log"
		return 2
		;;
	esac

	# Coverage notes (unsupported formats, skipped files) are warnings on
	# stderr that do not change the exit code. Surface them rather than
	# letting the scan look more complete than it was.
	#
	# The one note filtered out is "--exclude pattern(s) matched nothing":
	# the hooks scan a materialised tree containing only in-scope git objects,
	# so node_modules/dist/coverage patterns legitimately match nothing every
	# time. It says nothing about coverage. Everything else is shown.
	if [ -s "$stderr_log" ]; then
		grep -v 'exclude pattern(s) matched nothing' "$stderr_log" |
			sed 's/^/  | /' >&2 || true
	fi

	# Classify: blocking-tier type at the blocking level fails; everything
	# else is reported as advisory.
	local classified
	rc=0
	classified="$("$NODE_BIN" "${SECURITY_DIR}/lib/classify.mjs" \
		"$report" "$blocking" "$FERRET_BLOCK_AT_LEVEL" "$tree" "$label" \
		"$SCAN_BENIGN_SKIP_EXTENSIONS")" || rc=$?
	if [ "$rc" -ne 0 ] && [ "$rc" -ne 10 ]; then
		scan_err "could not classify the ferret-scan report for ${label}."
		printf '%s\n' "$classified" >&2
		rm -f -- "$report" "$stderr_log"
		return 2
	fi
	printf '%s\n' "$classified" >&2
	rm -f -- "$report" "$stderr_log"

	# classify.mjs exits 10 when at least one blocking finding was found.
	if [ "$rc" -eq 10 ]; then
		return 1
	fi
	return 0
}

# ---------------------------------------------------------------------------
# gitleaks
# ---------------------------------------------------------------------------

# gitleaks exits 0 when its own `git log` subprocess fails -- it logs
# `ERR ... "stderr is not empty"` and reports zero findings. Verified against
# 8.30.1 with both a bogus --log-opts flag and an unknown revision range. A
# hook trusting that exit code would silently pass. Treat any ERR line as a
# scanner failure.
_gitleaks_stderr_is_clean() {
	! grep -qE '(^|[^A-Za-z])ERR([^A-Za-z]|$)|stderr is not empty|level=error' "$1" 2>/dev/null
}

# Run gitleaks and interpret the result.
#   $1 label, $2.. gitleaks arguments
# Returns 0 = clean, 1 = leaks found, 2 = scanner failure.
#
# Set GITLEAKS_STRIP_PREFIX to a scan-root path to have it removed from
# reported file paths, so findings read as repository-relative rather than
# exposing the temporary directory the objects were materialised into.
gitleaks_run() {
	local label="$1"
	shift
	local report stderr_log rc
	report="$(mktemp)" || return 2
	stderr_log="$(mktemp)" || {
		rm -f -- "$report"
		return 2
	}

	rc=0
	"$GITLEAKS_BIN" "$@" \
		--no-banner \
		--redact \
		--no-color \
		--log-level error \
		--exit-code "$GITLEAKS_LEAK_EXIT_CODE" \
		--max-archive-depth "$GITLEAKS_MAX_ARCHIVE_DEPTH" \
		--report-format json \
		--report-path "$report" \
		${GITLEAKS_CONFIG:+--config "$GITLEAKS_CONFIG"} \
		>/dev/null 2>"$stderr_log" || rc=$?

	if [ "$rc" -eq 0 ] && ! _gitleaks_stderr_is_clean "$stderr_log"; then
		scan_err "gitleaks exited 0 but logged an internal error for ${label}."
		scan_info "  Exit 0 here does NOT mean clean; treating as a scanner failure."
		sed 's/^/  | /' "$stderr_log" >&2
		rm -f -- "$report" "$stderr_log"
		return 2
	fi

	case "$rc" in
	0)
		scan_dim "  gitleaks: clean (${label})"
		rm -f -- "$report" "$stderr_log"
		return 0
		;;
	"$GITLEAKS_LEAK_EXIT_CODE")
		scan_err "gitleaks found credential(s) in ${label}:"
		# --redact keeps the secret out of this output; print only locators.
		# Locators only. --redact already masks the value in the report, and
		# the value is never echoed here regardless.
		"$NODE_BIN" -e '
			const fs = require("fs");
			const strip = process.argv[2] || "";
			let rows = [];
			try { rows = JSON.parse(fs.readFileSync(process.argv[1], "utf8")) || []; } catch {}
			if (!rows.length) { console.log("    (report unreadable -- blocking anyway)"); process.exit(0); }
			const rel = (p) => {
				let s = String(p ?? "");
				if (strip && s.startsWith(strip)) s = s.slice(strip.length).replace(/^\/+/, "");
				// History scans namespace blobs under a 12-char oid prefix.
				const m = /^([0-9a-f]{12})\/(.+)$/.exec(s);
				return m ? `${m[2]}  @ blob ${m[1]}` : s;
			};
			for (const r of rows.slice(0, 50)) {
				const where = r.File ? `${rel(r.File)}:${r.StartLine ?? "?"}` : "?";
				const commit = r.Commit ? `  (commit ${String(r.Commit).slice(0, 12)})` : "";
				console.log(`    ${r.RuleID ?? "rule?"}  ${where}${commit}`);
			}
			if (rows.length > 50) console.log(`    ... and ${rows.length - 50} more`);
		' "$report" "${GITLEAKS_STRIP_PREFIX:-}" >&2 || true
		rm -f -- "$report" "$stderr_log"
		return 1
		;;
	*)
		scan_err "gitleaks failed for ${label} (exit ${rc})."
		sed 's/^/  | /' "$stderr_log" >&2
		rm -f -- "$report" "$stderr_log"
		return 2
		;;
	esac
}

# ---------------------------------------------------------------------------
# Commit metadata
# ---------------------------------------------------------------------------

# Scan commit messages and author/committer identities for a revision range.
# Git attribution is normal and expected, so only the BLOCKING check tier is
# applied here -- a name or email in an author field must not block a push.
#
#   $1 label, $2.. revision-list arguments
# Returns 0 = clean, 1 = blocking findings, 2 = scanner failure.
scan_commit_metadata() {
	local label="$1"
	shift
	local tree
	tree="$(mktemp -d)" || return 2
	# shellcheck disable=SC2064
	trap "rm -rf -- '$tree'" RETURN

	# One text file per field group keeps line numbers meaningful in the report.
	if ! git log --format='%H%n%s%n%b%n' "$@" >"${tree}/commit-messages.txt" 2>/dev/null; then
		scan_err "could not read commit messages for ${label}."
		return 2
	fi
	git log --format='%an <%ae>%n%cn <%ce>' "$@" 2>/dev/null | sort -u >"${tree}/commit-identities.txt" || true

	# Annotated tag messages are not reachable through git log.
	: >"${tree}/tag-messages.txt"
	local tag
	while IFS= read -r tag; do
		[ -n "$tag" ] || continue
		if [ "$(git cat-file -t "$tag" 2>/dev/null)" = "tag" ]; then
			git cat-file tag "$tag" 2>/dev/null >>"${tree}/tag-messages.txt"
		fi
	done < <(git tag 2>/dev/null)

	# Two complementary passes over the same metadata:
	#
	#  * ferret-scan for PII, using FERRET_METADATA_BLOCKING_CHECKS -- the
	#    identifier checks without SECRETS, because its entropy heuristic
	#    false-positives on the opaque identifiers commit messages are full of
	#    (commit SHAs, advisory ids, build and session URLs). See policy.sh.
	#
	#  * gitleaks for credentials, which is the right tool for this: ~180
	#    precise rules plus allowlists rather than an entropy guess. This is
	#    what keeps a real token in a commit message blocked.
	local meta_status=0
	ferret_scan_tree "$tree" "$label" "$FERRET_METADATA_BLOCKING_CHECKS" || meta_status=$?

	local gl_status=0
	GITLEAKS_STRIP_PREFIX="$tree" gitleaks_run "$label" dir "$tree" || gl_status=$?

	# A scanner failure (2) outranks a findings result (1).
	if [ "$meta_status" -eq 2 ] || [ "$gl_status" -eq 2 ]; then
		return 2
	fi
	if [ "$meta_status" -ne 0 ] || [ "$gl_status" -ne 0 ]; then
		return 1
	fi
	return 0
}
