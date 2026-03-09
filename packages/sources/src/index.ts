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

// Shared utilities — fetch and search
export { fetchPage } from "./shared/fetch-page.js"
export type { FetchPageOptions, FetchPageResult } from "./shared/fetch-page.js"
export {
  searchDuckDuckGo,
  isDuckDuckGoCaptcha,
  extractUrlsFromDuckDuckGoHtml,
  cleanDuckDuckGoUrl,
} from "./shared/duckduckgo-search.js"
export type { DuckDuckGoSearchOptions, SearchResult } from "./shared/duckduckgo-search.js"

// Web search base (for building custom search sources)
export { WebSearchBase } from "./web-search/base.js"
export type { WebSearchOptions, LinkSelectionOptions, WebSearchResult } from "./web-search/base.js"

// Web search sources
export { GoogleSearchSource, googleSearch } from "./web-search/google.js"
export type { GoogleSearchOptions } from "./web-search/google.js"
export { BingSearchSource, bingSearch } from "./web-search/bing.js"
export type { BingSearchOptions } from "./web-search/bing.js"
export { BraveSearchSource, braveSearch } from "./web-search/brave.js"
export type { BraveSearchOptions } from "./web-search/brave.js"
export { DuckDuckGoSearchSource, duckduckgoSearch } from "./web-search/duckduckgo.js"
export type { DuckDuckGoSearchOptions as DuckDuckGoSourceOptions } from "./web-search/duckduckgo.js"
