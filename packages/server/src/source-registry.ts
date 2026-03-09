/**
 * Source registry — maps category names to source factory functions.
 *
 * Provides a structured way to create source instances by category,
 * used by route handlers to select which sources to run. Each created
 * source is paired with its category for downstream filtering/logging.
 */

import type { BaseResearchSource, ResearchSubject } from "debriefer"
import {
  // Structured
  wikidata,
  wikipedia,
  // News
  apNews,
  bbcNews,
  reuters,
  npr,
  independent,
  telegraph,
  washingtonPost,
  laTimes,
  time,
  newYorker,
  pbs,
  britannica,
  rollingStone,
  smithsonian,
  nationalGeographic,
  historyCom,
  tcm,
  allMusic,
  people,
  biographyCom,
  guardian,
  nytimes,
  // Search
  googleSearch,
  bingSearch,
  braveSearch,
  duckduckgoSearch,
  // Books
  googleBooks,
  openLibrary,
  // Archives
  chroniclingAmerica,
  trove,
  europeana,
  internetArchive,
  // Obituary
  legacy,
  findAGrave,
} from "debriefer-sources"

export type SourceFactory = () => BaseResearchSource<ResearchSubject>

/**
 * Maps category names to arrays of source factory functions.
 * This is the single source of truth for both the category type
 * and the VALID_CATEGORIES list — derived, never duplicated.
 */
export const SOURCE_CATEGORIES: Record<string, SourceFactory[]> = {
  structured: [wikidata, wikipedia],
  news: [
    apNews,
    bbcNews,
    reuters,
    npr,
    independent,
    telegraph,
    washingtonPost,
    laTimes,
    time,
    newYorker,
    pbs,
    britannica,
    rollingStone,
    smithsonian,
    nationalGeographic,
    historyCom,
    tcm,
    allMusic,
    people,
    biographyCom,
    guardian,
    nytimes,
  ],
  search: [googleSearch, bingSearch, braveSearch, duckduckgoSearch],
  books: [googleBooks, openLibrary],
  archives: [chroniclingAmerica, trove, europeana, internetArchive],
  obituary: [legacy, findAGrave],
}

/** Valid source category names, derived from SOURCE_CATEGORIES. */
export type SourceCategory = "structured" | "news" | "search" | "books" | "archives" | "obituary"

/** Runtime list of valid categories — derived from SOURCE_CATEGORIES keys. */
export const VALID_CATEGORIES = Object.keys(SOURCE_CATEGORIES) as SourceCategory[]

/**
 * Creates source instances for the given categories, each paired with
 * its category name. If no categories are specified, creates sources
 * from all categories. Unknown category names are silently ignored.
 */
export function createSourcesWithCategory(
  categories?: string[]
): { source: BaseResearchSource<ResearchSubject>; category: SourceCategory }[] {
  const selected = categories ?? VALID_CATEGORIES
  return selected.flatMap((category) => {
    if (!Object.hasOwn(SOURCE_CATEGORIES, category)) return []
    const factories = SOURCE_CATEGORIES[category]
    return factories.map((factory: SourceFactory) => ({
      source: factory(),
      category: category as SourceCategory,
    }))
  })
}
