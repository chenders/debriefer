/**
 * HTML sanitization and text extraction utilities.
 *
 * Provides a complete pipeline for converting raw HTML to clean plain text:
 * script/style tag removal (via state machines for robustness), HTML tag
 * stripping, entity decoding, whitespace normalization, and optional
 * code-fragment detection/removal.
 */

import he from "he"

/**
 * Decode HTML entities in a string using the `he` library.
 *
 * Handles all HTML entities including named (&amp;), decimal (&#38;),
 * and hexadecimal (&#x26;) numeric entities.
 *
 * @param text - Text containing HTML entities
 * @returns Decoded text
 */
export function decodeHtmlEntities(text: string): string {
  return he.decode(text)
}

/**
 * Remove script tags and their content from HTML.
 *
 * Uses a state-machine approach that handles edge cases like malformed
 * tags better than a single regex would.
 *
 * @param html - HTML string
 * @returns HTML with script tags and their content removed
 */
export function removeScriptTags(html: string): string {
  let result = ""
  let i = 0
  const lowerHtml = html.toLowerCase()

  while (i < html.length) {
    const scriptStart = lowerHtml.indexOf("<script", i)
    if (scriptStart === -1) {
      result += html.slice(i)
      break
    }

    // Add content before script tag
    result += html.slice(i, scriptStart)

    // Find the end of the opening script tag
    const tagEnd = html.indexOf(">", scriptStart)
    if (tagEnd === -1) {
      // Malformed - no closing bracket, skip rest
      break
    }

    // Find closing </script> tag
    const scriptEnd = lowerHtml.indexOf("</script", tagEnd)
    if (scriptEnd === -1) {
      // No closing tag, skip rest of document
      break
    }

    // Find end of closing tag
    const closeEnd = html.indexOf(">", scriptEnd)
    if (closeEnd === -1) {
      break
    }

    i = closeEnd + 1
  }

  return result
}

/**
 * Remove style tags and their content from HTML.
 *
 * Uses the same state-machine approach as removeScriptTags.
 *
 * @param html - HTML string
 * @returns HTML with style tags and their content removed
 */
export function removeStyleTags(html: string): string {
  let result = ""
  let i = 0
  const lowerHtml = html.toLowerCase()

  while (i < html.length) {
    const styleStart = lowerHtml.indexOf("<style", i)
    if (styleStart === -1) {
      result += html.slice(i)
      break
    }

    result += html.slice(i, styleStart)

    const tagEnd = html.indexOf(">", styleStart)
    if (tagEnd === -1) {
      break
    }

    const styleEnd = lowerHtml.indexOf("</style", tagEnd)
    if (styleEnd === -1) {
      break
    }

    const closeEnd = html.indexOf(">", styleEnd)
    if (closeEnd === -1) {
      break
    }

    i = closeEnd + 1
  }

  return result
}

/**
 * Strip all HTML tags from a string, replacing them with spaces.
 *
 * @param html - HTML string
 * @returns Plain text with tags replaced by spaces
 */
export function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ")
}

/**
 * Convert HTML to clean plain text.
 *
 * Applies the full sanitization pipeline:
 * 1. Remove script tags and content (state machine)
 * 2. Remove style tags and content (state machine)
 * 3. Strip remaining HTML tags
 * 4. Decode HTML entities
 * 5. Normalize whitespace
 *
 * @param html - HTML string to clean
 * @returns Clean plain text
 */
export function htmlToText(html: string): string {
  let text = html

  // Remove script and style tags first (before stripping all tags)
  text = removeScriptTags(text)
  text = removeStyleTags(text)

  // Remove all other HTML tags
  text = stripHtmlTags(text)

  // Decode HTML entities
  text = decodeHtmlEntities(text)

  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim()

  return text
}

/**
 * Decode HTML entities and normalize whitespace without removing tags.
 *
 * Useful when you want to preserve HTML structure but decode entities.
 *
 * @param html - HTML string
 * @returns HTML with decoded entities and normalized whitespace
 */
export function cleanHtmlEntities(html: string): string {
  let text = decodeHtmlEntities(html)
  text = text.replace(/\s+/g, " ").trim()
  return text
}

// Patterns that strongly indicate JavaScript/TypeScript code.
// Hoisted to module level to avoid re-allocation on each call.
const CODE_PATTERNS = [
  /\bfunction\s*\(/,
  /\b(?:const|let|var)\s+\w+\s*=/,
  /\bif\s*\([^)]+\)\s*\{/,
  /\bdocument\.\w+/,
  /=>\s*[{(]/,
  /\bthis\.\w+\s*[=;]/,
  /\breturn\s+(?:this|null|true|false|undefined)\b/,
  /\bclass\s+\w+\s*\{/,
  /\b(?:async|await)\s+\w+/,
  /\b(?:try|catch|throw)\s*[{(]/,
  /\bwindow\.\w+/,
  /\bconsole\.\w+/,
  /\.(?:push|pop|shift|unshift|slice|splice|map|filter|reduce)\s*\(/,
  /\b(?:new|delete|typeof|instanceof)\s+\w+/,
  /\[\s*\d+\s*\]/,
  /===|!==|&&|\|\|/,
  /\bfor\s*\([^)]+\)/,
  /\bwhile\s*\([^)]+\)/,
  /\bswitch\s*\([^)]+\)/,
  /\)\s*\{|\{\s*$/,
  /\.innerHTML\s*=/,
  /\.innerText\s*=/,
  /\.textContent\s*=/,
  /\.value\s*=/,
  /\.style\.\w+\s*=/,
  /\.getElementById\s*\(/,
  /\.querySelector\s*\(/,
  /\.addEventListener\s*\(/,
]

/** Minimum number of pattern matches required to classify text as code. */
const CODE_PATTERN_THRESHOLD = 2

/**
 * Detect if text looks like programming code using heuristics.
 *
 * Designed to catch JavaScript/TypeScript code fragments that might
 * appear in scraped web pages from client-side rendered sites.
 *
 * @param text - Text to analyze
 * @returns True if text appears to be programming code
 */
export function looksLikeCode(text: string): boolean {
  if (!text || text.length < 20) return false

  let matchCount = 0
  for (const pattern of CODE_PATTERNS) {
    if (pattern.test(text)) {
      matchCount++
      if (matchCount >= CODE_PATTERN_THRESHOLD) {
        return true
      }
    }
  }

  return false
}

/**
 * Strip code segments from text, keeping natural language content.
 *
 * If the entire text looks like code, returns an empty string.
 * Otherwise splits by sentence/code boundaries and filters out
 * segments that match code heuristics.
 *
 * @param text - Text that may contain code segments
 * @returns Text with code segments removed
 */
export function stripCodeFromText(text: string): string {
  if (!text) return ""

  // If the whole text looks like code, return empty
  if (looksLikeCode(text)) {
    return ""
  }

  // Split into segments by sentence endings or code delimiters
  const segments = text.split(/(?<=[.!?])\s+|(?<=[;{}])\s+/)

  // Filter out code segments
  const filtered = segments
    .map((segment) => segment.trim())
    .filter((segment) => {
      if (segment.length < 15) return false
      return !looksLikeCode(segment)
    })

  return filtered.join(" ").trim()
}

/**
 * Convert HTML to clean plain text, also stripping code-like content.
 *
 * Combines the full HTML cleaning pipeline with code detection for
 * maximum safety when processing scraped web pages.
 *
 * @param html - HTML string to clean
 * @returns Clean plain text with code segments removed
 */
export function htmlToTextClean(html: string): string {
  const text = htmlToText(html)
  return stripCodeFromText(text)
}
