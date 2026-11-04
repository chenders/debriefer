#!/usr/bin/env node
// Classify a ferret-scan JSON report against the repository's two-tier policy.
//
//   argv: <report.json> <blockingChecksCsv> <blockAtLevel> <scanRoot> <label> <benignSkipExtsCsv>
//
// Exit 0  = nothing blocking (advisory findings may still be reported)
// Exit 10 = at least one blocking finding, OR a file was skipped in a format that
//           is not on the benign list -- "unscanned" must not read as "clean"
// Exit 1  = the report could not be read or parsed -> caller treats as failure
//
// Never prints a matched value. ferret-scan already replaces matches with
// "[HIDDEN]" unless --show-match is passed (it never is), but this script
// additionally only ever emits type, confidence, path and line number, so a
// future scanner change cannot leak a value through here.

import { readFileSync } from "node:fs"

const [reportPath, blockingCsv, blockAtLevel, scanRoot, label, benignSkipCsv] =
  process.argv.slice(2)

let report
try {
  const raw = readFileSync(reportPath, "utf8").trim()
  // A clean scan can legitimately produce an empty file.
  report = raw === "" ? { results: [] } : JSON.parse(raw)
} catch (err) {
  console.error(`  could not read ferret-scan report: ${err.message}`)
  process.exit(1)
}

// ferret-scan emits `stats` in file mode but omits it for --stdin, so it must
// not be treated as required.
const findings = Array.isArray(report?.results) ? report.results : []
const stats = report?.stats ?? null

const blocking = new Set(
  String(blockingCsv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
)

// ferret-scan finding `type` is a concrete subtype (US_STREET_ADDRESS,
// VISA, BUSINESS, ...) while the policy names validator-level checks
// (PHYSICAL_ADDRESS, CREDIT_CARD, EMAIL, ...). The report carries both:
// `validator` is the check-level name. Match on either, upper-cased, so the
// policy keeps working if a subtype is renamed upstream.
const validatorToCheck = {
  ssn: "SSN",
  creditcard: "CREDIT_CARD",
  credit_card: "CREDIT_CARD",
  bank_account: "BANK_ACCOUNT",
  bankaccount: "BANK_ACCOUNT",
  passport: "PASSPORT",
  drivers_license: "DRIVERS_LICENSE",
  driverslicense: "DRIVERS_LICENSE",
  medical_id: "MEDICAL_ID",
  medicalid: "MEDICAL_ID",
  date_of_birth: "DATE_OF_BIRTH",
  dateofbirth: "DATE_OF_BIRTH",
  dob: "DATE_OF_BIRTH",
  physical_address: "PHYSICAL_ADDRESS",
  physicaladdress: "PHYSICAL_ADDRESS",
  secrets: "SECRETS",
  secret: "SECRETS",
  api_key: "SECRETS",
  person_name: "PERSON_NAME",
  personname: "PERSON_NAME",
  email: "EMAIL",
  phone: "PHONE",
  ip_address: "IP_ADDRESS",
  ipaddress: "IP_ADDRESS",
  vin: "VIN",
  social_media: "SOCIAL_MEDIA",
  intellectual_property: "INTELLECTUAL_PROPERTY",
  cloud_resources: "CLOUD_RESOURCES",
  metadata: "METADATA",
  otp: "OTP",
}

function checkNameOf(f) {
  const v = String(f.validator ?? "").toLowerCase()
  if (validatorToCheck[v]) return validatorToCheck[v]
  // Fall back to the reported type, and to the raw validator name, so an
  // unmapped validator is never silently treated as advisory.
  return String(f.type ?? v ?? "UNKNOWN").toUpperCase()
}

function isBlockingCheck(f) {
  const name = checkNameOf(f)
  if (blocking.has(name)) return true
  // An unmapped/unknown validator defaults to BLOCKING. Failing closed here
  // means a new upstream detector cannot quietly land in the advisory tier.
  const known = new Set([...blocking, ...Object.values(validatorToCheck)])
  return !known.has(name)
}

const rel = (p) => {
  let s = String(p ?? "")
  if (scanRoot && s.startsWith(scanRoot)) {
    s = s.slice(scanRoot.length).replace(/^\/+/, "")
  }
  // History scans namespace each unique blob under its 12-char oid prefix so
  // that different versions of the same path do not overwrite one another.
  // Render that back as "path @ blob <oid>" instead of a confusing prefix.
  const m = /^([0-9a-f]{12})\/(.+)$/.exec(s)
  return m ? `${m[2]}  @ blob ${m[1]}` : s
}

const atBlockLevel = (f) =>
  String(f.confidence_level ?? "").toUpperCase() === String(blockAtLevel).toUpperCase()

const blockingFindings = findings.filter((f) => isBlockingCheck(f) && atBlockLevel(f))
const advisoryFindings = findings.filter((f) => !blockingFindings.includes(f))

// ---- report -------------------------------------------------------------

const plural = (n, s) => `${n} ${s}${n === 1 ? "" : "s"}`

// Files ferret-scan could not read were NOT scanned. Separate benign media
// formats, which may skip silently, from opaque containers that must block: an
// unscanned archive, keystore or blob is indistinguishable from a clean one,
// and that is exactly how a credential reaches the repository.
const benignSkip = new Set(
  String(benignSkipCsv || "")
    .split(",")
    .map((x) => x.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean)
)
const skippedTypes = (stats && typeof stats.skipped_types === "object" && stats.skipped_types) || {}
// An empty or unknown extension is never benign -- it tells us nothing.
const offendingSkips = Object.entries(skippedTypes).filter(([ext]) => {
  const bare = String(ext).replace(/^\./, "").toLowerCase()
  return !bare || !benignSkip.has(bare)
})
const benignSkipped = Object.entries(skippedTypes).filter(
  ([e]) => !offendingSkips.some(([o]) => o === e)
)

if (stats) {
  const skipped = Number(stats.files_skipped ?? 0)
  const bits = [`${plural(Number(stats.files_processed ?? 0), "file")} scanned`]
  if (skipped > 0) bits.push(`${skipped} skipped`)
  if (Number(stats.suppressed ?? 0) > 0) bits.push(`${stats.suppressed} suppressed`)
  console.error(`  ferret-scan (${label}): ${bits.join(", ")}`)
  if (benignSkipped.length > 0) {
    console.error(
      `    not scanned (benign media, allowed): ${benignSkipped
        .map(([e, n]) => `${n}x ${e}`)
        .join(", ")}`
    )
  }
} else {
  console.error(`  ferret-scan (${label}): ${plural(findings.length, "finding")}`)
}

if (advisoryFindings.length > 0) {
  // Advisory findings are summarised, not listed line by line: they are
  // expected in this repository and a wall of them trains people to ignore
  // the output. They remain fully visible via the manual scan commands.
  const byType = new Map()
  for (const f of advisoryFindings) {
    const k = `${checkNameOf(f)} (${String(f.confidence_level ?? "?").toUpperCase()})`
    byType.set(k, (byType.get(k) ?? 0) + 1)
  }
  const summary = [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${v}x ${k}`)
    .join(", ")
  console.error(`    advisory (not blocking): ${summary}`)
}

if (offendingSkips.length > 0) {
  console.error("")
  console.error(
    `  BLOCKED: ${plural(offendingSkips.length, "file type")} could not be scanned in ${label}:`
  )
  for (const [ext, n] of offendingSkips) {
    console.error(`    ${n}x ${ext || "(no extension)"}  -- not scanned, so not known to be clean`)
  }
  console.error("")
  console.error("  A secret or a PII dump inside an unscanned file reaches the repository")
  console.error("  unchecked. Either commit the content in a scannable form, or -- if the")
  console.error("  format genuinely cannot carry one -- add its extension to")
  console.error("  SCAN_BENIGN_SKIP_EXTENSIONS in .security/policy.sh with a stated reason.")
  console.error("  Do not add archive, database or keystore formats.")
  process.exit(10)
}

if (blockingFindings.length === 0) {
  process.exit(0)
}

console.error("")
console.error(
  `  BLOCKED: ${plural(blockingFindings.length, "finding")} at ${blockAtLevel} confidence in a blocking check:`
)
for (const f of blockingFindings.slice(0, 50)) {
  const where = `${rel(f.filename)}:${f.line_number ?? "?"}`
  console.error(
    `    ${checkNameOf(f)}  ${where}  (confidence ${f.confidence ?? "?"}%, value hidden)`
  )
}
if (blockingFindings.length > 50) {
  console.error(`    ... and ${blockingFindings.length - 50} more`)
}
process.exit(10)
