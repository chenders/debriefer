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
