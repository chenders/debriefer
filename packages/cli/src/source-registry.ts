/**
 * Source registry — maps category names to source factory functions.
 *
 * Provides a structured way to create source instances by category,
 * used by CLI commands to select which sources to run.
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

/** Valid source category names. */
export type SourceCategory = "structured" | "news" | "search" | "books" | "archives" | "obituary"

/**
 * Maps category names to arrays of source factory functions.
 */
export const SOURCE_CATEGORIES: Record<SourceCategory, SourceFactory[]> = {
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

/**
 * Creates source instances for the given categories.
 * If no categories are specified, creates sources from all categories.
 * Unknown category names are silently ignored.
 */
export function createSources(categories?: string[]): BaseResearchSource<ResearchSubject>[] {
  const selected = categories ?? (Object.keys(SOURCE_CATEGORIES) as SourceCategory[])
  return selected.flatMap((category) => {
    if (!Object.hasOwn(SOURCE_CATEGORIES, category)) return []
    const factories = SOURCE_CATEGORIES[category as SourceCategory]
    return factories.map((factory: SourceFactory) => factory())
  })
}
