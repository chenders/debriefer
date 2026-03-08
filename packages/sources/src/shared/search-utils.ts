/**
 * Search query utilities.
 *
 * Helpers for splitting and normalizing search strings, used by sources
 * that need multi-word ILIKE matching or search term tokenization.
 */

/**
 * Split a search string into individual words for multi-word matching.
 *
 * Trims leading/trailing whitespace, splits on one or more whitespace
 * characters, and filters out empty strings. Returns an empty array
 * for blank or whitespace-only input.
 *
 * @param query - Search string to split
 * @returns Array of individual search words
 */
export function splitSearchWords(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean)
}
