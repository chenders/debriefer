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

// ============================================================================
// Category reverse map
// ============================================================================

/**
 * Reverse map from source type string to category name.
 * Built once at module load by instantiating each factory to read its type.
 */
let typeToCategory: Map<string, SourceCategory> | undefined

function getTypeToCategory(): Map<string, SourceCategory> {
  if (typeToCategory) return typeToCategory
  typeToCategory = new Map<string, SourceCategory>()
  for (const [category, factories] of Object.entries(SOURCE_CATEGORIES)) {
    for (const factory of factories) {
      const source = factory()
      typeToCategory.set(source.type, category as SourceCategory)
    }
  }
  return typeToCategory
}

// ============================================================================
// Command builder
// ============================================================================

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
        const categoryMap = getTypeToCategory()
        const data = sources.map((source) => ({
          name: source.name,
          type: source.type,
          category: categoryMap.get(source.type) ?? "unknown",
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
