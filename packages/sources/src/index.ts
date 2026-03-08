// Shared utilities — consumers may need these for custom sources
export {
  htmlToText,
  htmlToTextClean,
  decodeHtmlEntities,
  looksLikeCode,
  stripCodeFromText,
} from "./shared/html-utils.js"
export { extractArticleContent } from "./shared/readability-extract.js"
export type { ArticleExtractionResult } from "./shared/readability-extract.js"
export { sanitizeSourceText } from "./shared/sanitize-text.js"
export { splitSearchWords } from "./shared/search-utils.js"

// Structured data sources
export {
  WikidataSource,
  wikidata,
  escapeSparql,
  isValidLabel,
  getValidLabel,
  filterValidLabels,
} from "./structured/wikidata.js"
export type {
  WikidataOptions,
  SparqlQueryBuilder,
  SparqlResultParser,
  SparqlBinding,
  SparqlResponse,
} from "./structured/wikidata.js"

export { WikipediaSource, wikipedia } from "./structured/wikipedia.js"
export type { WikipediaOptions, WikipediaSection, SectionFilter } from "./structured/wikipedia.js"
