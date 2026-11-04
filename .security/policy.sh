#!/usr/bin/env bash
# Shared PII / secrets scanning policy for the debriefer repository.
#
# Sourced by .githooks/*, .security/*.sh and the CI workflow so that every
# checkpoint enforces exactly the same policy. Changing a threshold here
# changes it everywhere; there is deliberately no second copy.
#
# Verified tool behaviour this policy depends on is recorded in
# .security/README.md ("Verified exit-code behaviour"). Re-verify after a
# scanner upgrade -- neither tool documents these guarantees as stable API.

# ---------------------------------------------------------------------------
# Pinned tool versions
# ---------------------------------------------------------------------------
# Exact versions verified against this policy. CI installs these precisely
# (see .security/install-tools.sh, checksums in .security/tools.lock).
# Local runs accept >= the pinned version and warn on a mismatch, because a
# developer machine is managed by Homebrew/pip rather than by this repo.
FERRET_SCAN_PINNED_VERSION="2.5.5"
GITLEAKS_PINNED_VERSION="8.30.1"

# ---------------------------------------------------------------------------
# Detection tiers
# ---------------------------------------------------------------------------
# Every check below runs on every scan. The tiers decide only what *blocks*.
# Nothing is excluded from detection, and no finding is ever auto-baselined.
#
# BLOCKING: identifier types that are almost never a false positive at HIGH
# confidence, and are never legitimately committed to this repository.
FERRET_BLOCKING_CHECKS="SSN,CREDIT_CARD,BANK_ACCOUNT,PASSPORT,DRIVERS_LICENSE,MEDICAL_ID,DATE_OF_BIRTH,PHYSICAL_ADDRESS,SECRETS"
#
# ADVISORY: types that are structurally present in this repository as
# *intended public information* and would otherwise block routine work:
#   PERSON_NAME            - debriefer researches public figures; test
#                            fixtures carry real public names by design, and
#                            every packages/*/package.json has an author field
#   EMAIL                  - normal git attribution and lockfile maintainer data
#   IP_ADDRESS             - SSRF-guard private-range literals in
#                            packages/sources/src/web-search/base.ts
#   VIN, SOCIAL_MEDIA,     - observed only as false positives on hashes and
#   INTELLECTUAL_PROPERTY,   generated lockfile content
#   CLOUD_RESOURCES, METADATA, OTP
# These are reported on every scan and must still be triaged by a human; they
# simply do not fail the checkpoint. This is a documented policy decision, not
# a suppression file, so the findings stay visible.
FERRET_ADVISORY_CHECKS="PERSON_NAME,EMAIL,IP_ADDRESS,VIN,SOCIAL_MEDIA,INTELLECTUAL_PROPERTY,CLOUD_RESOURCES,METADATA,OTP"

# ---------------------------------------------------------------------------
# Blocking checks for COMMIT AND TAG METADATA
# ---------------------------------------------------------------------------
# Same identifier checks as FERRET_BLOCKING_CHECKS, minus SECRETS.
#
# Commit messages are free text that legitimately carries opaque high-entropy
# identifiers: commit SHAs, GHSA advisory ids, build and session URLs, issue
# links. ferret-scan's SECRETS validator is entropy-based and matches those at
# HIGH confidence -- it scored a `Claude-Session:` trailer URL at 95% while
# scoring the same trailer MEDIUM in a neighbouring commit, so it blocks
# INTERMITTENTLY on identical content. A checkpoint that randomly rejects
# legitimate pushes is the fastest route to habitual --no-verify.
#
# This is NOT a reduction in credential coverage: scan_commit_metadata now
# also runs gitleaks over the metadata, which uses ~180 precise credential
# rules plus allowlists instead of an entropy guess. A real token in a commit
# message is therefore still blocked -- asserted by .security/verify.sh.
# Identifier checks (SSN, CREDIT_CARD, PASSPORT, MEDICAL_ID and the rest) stay
# blocking here, because they do not false-positive on opaque identifiers.
FERRET_METADATA_BLOCKING_CHECKS="SSN,CREDIT_CARD,BANK_ACCOUNT,PASSPORT,DRIVERS_LICENSE,MEDICAL_ID,DATE_OF_BIRTH,PHYSICAL_ADDRESS"

# Confidence level at which a BLOCKING check fails the checkpoint.
# ferret-scan emits HIGH / MEDIUM / LOW. MEDIUM and LOW blocking-check
# findings are reported but do not block.
FERRET_BLOCK_AT_LEVEL="HIGH"

# ---------------------------------------------------------------------------
# Path exclusions
# ---------------------------------------------------------------------------
# Only git internals, vendored dependencies and generated build output are
# excluded. Tests, fixtures, documentation, CSV, JSON and logs are all
# deliberately IN scope -- they are the likeliest places for PII to land.
#
# ferret-scan --exclude takes comma-separated globs ('**' unsupported).
FERRET_EXCLUDE_GLOBS=".git,node_modules,dist,coverage,.turbo,.venv,__pycache__,*.tsbuildinfo"

# Extended-regex of repository-relative paths never materialised for scanning.
# Must stay in sync with FERRET_EXCLUDE_GLOBS above.
SCAN_EXCLUDE_PATH_RE='^(\.git/|node_modules/|.*/node_modules/|dist/|.*/dist/|coverage/|.*/coverage/|\.turbo/|\.venv/|.*/__pycache__/)|\.tsbuildinfo$'

# ---------------------------------------------------------------------------
# Resolved config paths
# ---------------------------------------------------------------------------
# SECURITY_DIR is set by the caller before sourcing; fall back to this file's
# own directory so the policy can also be sourced directly.
: "${SECURITY_DIR:=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)}"
FERRET_CONFIG="${SECURITY_DIR}/ferret-scan.yaml"
GITLEAKS_CONFIG="${SECURITY_DIR}/gitleaks.toml"
FERRET_SUPPRESSIONS="${SECURITY_DIR}/ferret-suppressions.yaml"

# ---------------------------------------------------------------------------
# gitleaks exit-code contract
# ---------------------------------------------------------------------------
# gitleaks' default is to exit 1 on BOTH "leaks found" and "internal error",
# which makes the two indistinguishable. --exit-code remaps the leak case so
# the wrapper can tell them apart:
#   0 = scan completed, no leaks   (but see check_gitleaks_stderr: a failed
#       underlying `git log` ALSO exits 0 -- verified, see README)
#   1 = gitleaks itself failed
#   2 = leaks found
GITLEAKS_LEAK_EXIT_CODE=2
