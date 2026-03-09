/**
 * Sources command — lists available research sources.
 *
 * Supports text table output (default) and JSON format, with optional
 * category filtering. Uses the source registry to instantiate sources
 * and the formatter for human-readable table output.
 */

import { Command } from "commander"
import { createSources, SOURCE_CATEGORIES, type SourceCategory } from "../source-registry.js"
import { formatSourceList } from "../formatters.js"

/**
 * Build a reverse map from source type to category name.
 * Instantiates each factory once to read its type.
 */
function buildTypeToCategoryMap(): Map<string, SourceCategory> {
  const map = new Map<string, SourceCategory>()
  for (const [category, factories] of Object.entries(SOURCE_CATEGORIES)) {
    for (const factory of factories) {
      map.set(factory().type, category as SourceCategory)
    }
  }
  return map
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
      const sources = createSources(categories)

      if (options.format === "json") {
        // When a category filter is set, all sources share that category.
        // Otherwise build a reverse map (one extra instantiation set).
        const categoryMap = options.category ? null : buildTypeToCategoryMap()
        const data = sources.map((source) => ({
          name: source.name,
          type: source.type,
          category: options.category ?? categoryMap?.get(source.type) ?? "unknown",
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
