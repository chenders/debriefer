/**
 * Sources command — lists available research sources.
 *
 * Supports text table output (default) and JSON format, with optional
 * category filtering. Uses the source registry to instantiate sources
 * and the formatter for human-readable table output.
 */

import { Command } from "commander"
import type { BaseResearchSource, ResearchSubject } from "@debriefer/core"
import { SOURCE_CATEGORIES, type SourceCategory } from "../source-registry.js"
import { formatSourceList } from "../formatters.js"

/**
 * Create sources with category metadata attached, avoiding double instantiation.
 * Returns { source, category } pairs from the given categories (or all).
 */
function createSourcesWithCategory(
  categories?: string[]
): { source: BaseResearchSource<ResearchSubject>; category: SourceCategory }[] {
  const cats = categories ?? Object.keys(SOURCE_CATEGORIES)
  const results: { source: BaseResearchSource<ResearchSubject>; category: SourceCategory }[] = []

  for (const cat of cats) {
    if (!Object.hasOwn(SOURCE_CATEGORIES, cat)) continue
    const factories = SOURCE_CATEGORIES[cat as SourceCategory]
    for (const factory of factories) {
      results.push({ source: factory(), category: cat as SourceCategory })
    }
  }

  return results
}

/**
 * Builds the `sources` subcommand for the CLI.
 *
 * Usage:
 *   debriefer sources                    — list all sources as a text table
 *   debriefer sources --category news    — list only news sources
 *   debriefer sources --format json      — output as JSON array
 */
export function buildSourcesCommand(): Command {
  return new Command("sources")
    .description("List available sources")
    .option("--category <cat>", "Filter to a specific category")
    .option("--format <fmt>", "Output format: text or json", "text")
    .action((options: { category?: string; format: string }) => {
      const categories = options.category ? [options.category] : undefined
      const tagged = createSourcesWithCategory(categories)
      const sources = tagged.map((t) => t.source)

      if (options.format === "json") {
        const data = tagged.map(({ source, category }) => ({
          name: source.name,
          type: source.type,
          category,
          reliabilityTier: source.reliabilityTier,
          reliabilityScore: source.reliabilityScore,
          domain: source.domain,
          isFree: source.isFree,
          estimatedCostPerQuery: source.estimatedCostPerQuery,
          available: source.isAvailable(),
        }))
        // eslint-disable-next-line no-console -- CLI: stdout is the intended output channel
        console.log(JSON.stringify(data, null, 2))
      } else {
        const output = formatSourceList(sources, options.category)
        // eslint-disable-next-line no-console -- CLI: stdout is the intended output channel
        console.log(output)
      }
    })
}
