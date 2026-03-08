/**
 * Final safety-net text sanitization.
 *
 * Runs on source text before AI prompt assembly, catching remaining
 * artifacts regardless of source (Wikipedia footnotes, navigation text,
 * boilerplate phrases, etc.). This is the last line of defense against
 * noisy input reaching the synthesis step.
 */

/**
 * Sanitize source text before sending to an AI model for synthesis.
 *
 * Catches remaining artifacts from any source:
 * - Wikipedia citation markers ([1], [2][3])
 * - Editorial tags ([edit], [citation needed])
 * - Footnote reference lines (lines starting with ^)
 * - Navigation-like pipe-separated text (e.g., "News | Sports | Weather")
 * - Common web boilerplate (sign in, subscribe, cookie policy)
 * - Excess whitespace and blank lines
 *
 * @param text - Raw source text to sanitize
 * @returns Cleaned text ready for prompt assembly
 */
export function sanitizeSourceText(text: string): string {
  let cleaned = text

  // 1. Strip Wikipedia citation markers (with and without spaces)
  cleaned = cleaned.replace(/\[\s*\d+\s*\]/g, "")

  // 2. Strip [edit], [citation needed], etc.
  cleaned = cleaned.replace(
    /\[\s*(?:edit|citation needed|clarification needed|when\?|who\?|where\?|dubious|discuss|further explanation needed|original research\??|not in citation given|failed verification|unreliable source\??|needs? update|verification needed)\s*\]/gi,
    ""
  )

  // 3. Strip Wikipedia footnote blocks (lines starting with ^)
  cleaned = cleaned.replace(/^\s*\^[^\n]+$/gm, "")

  // 4. Strip navigation-like text patterns:
  //    pipe-separated short items (e.g. "News | Sports | Weather | ...")
  /* eslint-disable-next-line security/detect-unsafe-regex --
     Bounded quantifier on short pipe-separated nav text; no backtracking risk */
  const navPattern = /^(?:[A-Z][a-z]+\s*\|\s*){3,}[A-Z][a-z]+\s*$/gm
  cleaned = cleaned.replace(navPattern, "")

  // 5. Strip common boilerplate phrases
  cleaned = cleaned.replace(
    /\b(?:Sign [Ii]n|Sign [Uu]p|Subscribe|Newsletter|Cookie [Pp]olicy|Privacy [Pp]olicy|Terms (?:of|and) (?:Service|Use)|Accept (?:All )?Cookies|Manage Preferences)\b[^\n]*/g,
    ""
  )

  // 6. Collapse whitespace
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n")
  cleaned = cleaned.replace(/[ \t]+/g, " ")
  cleaned = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n")

  return cleaned.trim()
}
