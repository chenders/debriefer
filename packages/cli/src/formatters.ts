/**
 * Text formatters for CLI output.
 *
 * Provides human-readable formatting for debrief results (synthesized,
 * raw findings, or structured data) and source list tables.
 */

import type { DebriefResult, ScoredFinding, ResearchSubject, BaseResearchSource } from "debriefer"

// ============================================================================
// Type guards
// ============================================================================

/** Runtime check that an array contains ScoredFinding-shaped objects (or is empty). */
function isScoredFindingArray(data: unknown[]): data is ScoredFinding[] {
  if (data.length === 0) return true
  const first = data[0]
  if (first == null || typeof first !== "object") return false
  const rec = first as Record<string, unknown>
  return typeof rec.sourceName === "string" && typeof rec.text === "string"
}

// ============================================================================
// formatDebriefResult
// ============================================================================

/**
 * Formats a debrief result as human-readable text.
 *
 * Handles four data shapes:
 * - `null` — shows "No findings collected."
 * - `string` — shows under a "--- Synthesis ---" header
 * - `Array` — shows each finding with source name, tier, confidence, URL, and truncated text
 * - Other — JSON-stringifies the structured data
 */
export function formatDebriefResult<TOutput>(result: DebriefResult<TOutput>): string {
  const lines: string[] = []

  // Header
  const durationSec = (result.durationMs / 1000).toFixed(1)
  lines.push(`Subject: ${result.subject.name}`)
  lines.push(
    `Sources: ${result.sourcesSucceeded}/${result.sourcesAttempted}  ` +
      `Cost: $${result.totalCostUsd.toFixed(4)}  ` +
      `Duration: ${durationSec}s`
  )

  if (result.stoppedAtPhase != null) {
    lines.push(`Stopped at phase ${result.stoppedAtPhase}`)
  }

  lines.push("")

  // Data section — when data is null but findings exist, show findings instead of "no findings"
  if (result.data === null && result.findings.length === 0) {
    lines.push("No findings collected.")
  } else if (result.data === null && result.findings.length > 0) {
    lines.push("Synthesis unavailable. Showing raw findings:")
    lines.push("")
    for (const finding of result.findings) {
      lines.push(`  Source: ${finding.sourceName}`)
      lines.push(`  Tier: ${finding.reliabilityTier}  Confidence: ${finding.confidence.toFixed(2)}`)
      if (finding.url) {
        lines.push(`  URL: ${finding.url}`)
      }
      const truncatedText =
        finding.text.length > 300 ? finding.text.slice(0, 300) + "..." : finding.text
      lines.push(`  ${truncatedText}`)
      lines.push("")
    }
  } else if (typeof result.data === "string") {
    lines.push("--- Synthesis ---")
    lines.push(result.data)
  } else if (Array.isArray(result.data) && isScoredFindingArray(result.data)) {
    lines.push(`--- Findings (${result.data.length}) ---`)
    for (const finding of result.data) {
      lines.push("")
      lines.push(`  Source: ${finding.sourceName}`)
      lines.push(`  Tier: ${finding.reliabilityTier}  Confidence: ${finding.confidence.toFixed(2)}`)
      if (finding.url) {
        lines.push(`  URL: ${finding.url}`)
      }
      const truncatedText =
        finding.text.length > 300 ? finding.text.slice(0, 300) + "..." : finding.text
      lines.push(`  ${truncatedText}`)
    }
  } else {
    lines.push("--- Data ---")
    lines.push(JSON.stringify(result.data, null, 2))
  }

  return lines.join("\n")
}

// ============================================================================
// formatSourceList
// ============================================================================

/** Column widths for the source table. */
const COL_NAME = 25
const COL_TYPE = 20
const COL_TIER = 25
const COL_FREE = 6
const COL_AVAILABLE = 10

function pad(value: string, width: number): string {
  return value.padEnd(width)
}

/**
 * Formats sources as a text table.
 *
 * Shows name, type, reliability tier, free status, and availability
 * for each source, with a header and footer summary.
 */
export function formatSourceList(
  sources: BaseResearchSource<ResearchSubject>[],
  category?: string
): string {
  const lines: string[] = []

  // Header
  const header = category ? `Sources in category: ${category}` : "All sources"
  lines.push(header)
  lines.push("")

  // Column headers
  const headerRow =
    pad("Name", COL_NAME) +
    pad("Type", COL_TYPE) +
    pad("Tier", COL_TIER) +
    pad("Free", COL_FREE) +
    pad("Available", COL_AVAILABLE)
  lines.push(headerRow)

  // Separator
  const separator =
    "-".repeat(COL_NAME) +
    "-".repeat(COL_TYPE) +
    "-".repeat(COL_TIER) +
    "-".repeat(COL_FREE) +
    "-".repeat(COL_AVAILABLE)
  lines.push(separator)

  // Rows
  let availableCount = 0
  for (const source of sources) {
    const available = source.isAvailable()
    if (available) availableCount++

    const row =
      pad(source.name, COL_NAME) +
      pad(source.type, COL_TYPE) +
      pad(source.reliabilityTier, COL_TIER) +
      pad(source.isFree ? "Yes" : "No", COL_FREE) +
      pad(available ? "Yes" : "No", COL_AVAILABLE)
    lines.push(row)
  }

  // Footer
  lines.push("")
  lines.push(`${availableCount} of ${sources.length} sources available`)

  return lines.join("\n")
}
