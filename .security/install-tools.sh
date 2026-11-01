#!/usr/bin/env bash
# Install the pinned scanner binaries from .security/tools.lock.
#
#   .security/install-tools.sh [<dest-dir>]
#
# Downloads the exact pinned release asset, verifies its published SHA-256,
# and installs it into <dest-dir> (default: .security/.tools, which is
# gitignored). Used by CI so that every run scans with the same build the
# policy was verified against; developers normally use Homebrew/pip instead.
#
# Refuses to install on a checksum mismatch -- a mismatch means the asset is
# not the pinned artefact, and scanning with an unverified binary is worse
# than not scanning.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
SECURITY_DIR="${REPO_ROOT}/.security"
# shellcheck source=policy.sh
. "${SECURITY_DIR}/policy.sh"

DEST="${1:-${SECURITY_DIR}/.tools}"
LOCK="${SECURITY_DIR}/tools.lock"
mkdir -p "$DEST"

# --- platform detection ----------------------------------------------------
os="$(uname -s)"
arch="$(uname -m)"
case "${os}/${arch}" in
Linux/x86_64) FERRET_PLAT="linux_amd64"; GITLEAKS_PLAT="linux_x64" ;;
Linux/aarch64 | Linux/arm64) FERRET_PLAT="linux_arm64"; GITLEAKS_PLAT="linux_arm64" ;;
Darwin/arm64) FERRET_PLAT="darwin_arm64"; GITLEAKS_PLAT="darwin_arm64" ;;
*)
	printf 'error: no pinned binaries for %s/%s.\n' "$os" "$arch" >&2
	printf '  Add the platform to .security/tools.lock with its published sha256,\n' >&2
	printf '  or install ferret-scan %s and gitleaks %s by hand.\n' \
		"$FERRET_SCAN_PINNED_VERSION" "$GITLEAKS_PINNED_VERSION" >&2
	exit 1
	;;
esac

# --- lockfile lookup -------------------------------------------------------
lock_row() {
	# $1 tool, $2 platform -> "<version> <sha256> <asset>"
	awk -v t="$1" -v p="$2" '!/^#/ && NF>=5 && $1==t && $3==p {print $2, $4, $5; exit}' "$LOCK"
}

sha256_of() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | awk '{print $1}'
	else
		shasum -a 256 "$1" | awk '{print $1}'
	fi
}

verify_or_die() {
	local file="$1" expected="$2" actual
	actual="$(sha256_of "$file")"
	if [ "$actual" != "$expected" ]; then
		printf 'error: checksum mismatch for %s\n' "$(basename "$file")" >&2
		printf '  expected %s\n  actual   %s\n' "$expected" "$actual" >&2
		printf '  Refusing to install an unverified scanner binary.\n' >&2
		rm -f -- "$file"
		exit 1
	fi
}

TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT INT TERM

# --- ferret-scan (single static binary) ------------------------------------
read -r f_ver f_sha f_asset < <(lock_row ferret-scan "$FERRET_PLAT")
if [ -z "${f_asset:-}" ]; then
	printf 'error: no ferret-scan row for platform %s in tools.lock\n' "$FERRET_PLAT" >&2
	exit 1
fi
if [ "$f_ver" != "$FERRET_SCAN_PINNED_VERSION" ]; then
	printf 'error: tools.lock has ferret-scan %s but policy.sh pins %s.\n' \
		"$f_ver" "$FERRET_SCAN_PINNED_VERSION" >&2
	exit 1
fi
printf 'ferret-scan %s (%s)\n' "$f_ver" "$FERRET_PLAT"
curl -fsSL --retry 3 -o "${TMP}/${f_asset}" \
	"https://github.com/awslabs/ferret-scan/releases/download/v${f_ver}/${f_asset}"
verify_or_die "${TMP}/${f_asset}" "$f_sha"
install -m 0755 "${TMP}/${f_asset}" "${DEST}/ferret-scan"
printf '  checksum ok -> %s/ferret-scan\n' "$DEST"

# --- gitleaks (tarball) ----------------------------------------------------
read -r g_ver g_sha g_asset < <(lock_row gitleaks "$GITLEAKS_PLAT")
if [ -z "${g_asset:-}" ]; then
	printf 'error: no gitleaks row for platform %s in tools.lock\n' "$GITLEAKS_PLAT" >&2
	exit 1
fi
if [ "$g_ver" != "$GITLEAKS_PINNED_VERSION" ]; then
	printf 'error: tools.lock has gitleaks %s but policy.sh pins %s.\n' \
		"$g_ver" "$GITLEAKS_PINNED_VERSION" >&2
	exit 1
fi
printf 'gitleaks %s (%s)\n' "$g_ver" "$GITLEAKS_PLAT"
curl -fsSL --retry 3 -o "${TMP}/${g_asset}" \
	"https://github.com/gitleaks/gitleaks/releases/download/v${g_ver}/${g_asset}"
verify_or_die "${TMP}/${g_asset}" "$g_sha"
tar -xzf "${TMP}/${g_asset}" -C "$TMP" gitleaks
install -m 0755 "${TMP}/gitleaks" "${DEST}/gitleaks"
printf '  checksum ok -> %s/gitleaks\n' "$DEST"

# --- confirm the installed binaries report the pinned versions -------------
printf '\nInstalled:\n'
"${DEST}/ferret-scan" --version | sed 's/^/  /'
printf '  gitleaks %s\n' "$("${DEST}/gitleaks" version)"
printf '\nUse them by exporting:\n  export SECURITY_TOOLS_DIR=%s\n\n' "$DEST"
