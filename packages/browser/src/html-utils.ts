/**
 * Minimal HTML-to-text utility for archive content extraction.
 *
 * Inlined to avoid depending on @debriefer/sources for a single utility.
 * For the full-featured version, see @debriefer/sources htmlToText.
 */

/** Strip <script> tags and their contents. */
function removeScriptTags(html: string): string {
  return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
}

/** Strip <style> tags and their contents. */
function removeStyleTags(html: string): string {
  return html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
}

/** Strip all HTML tags. */
function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ")
}

/** Decode common HTML entities. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(Number(dec)))
}

/**
 * Convert HTML to plain text by stripping tags, scripts, styles, and entities.
 */
export function htmlToText(html: string): string {
  let text = removeScriptTags(html)
  text = removeStyleTags(text)
  text = stripHtmlTags(text)
  text = decodeEntities(text)
  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim()
  return text
}
