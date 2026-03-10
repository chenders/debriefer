/**
 * list_sources tool handler — returns metadata for all or filtered sources.
 *
 * Maps source instances to a JSON array of metadata objects containing
 * name, type, category, reliability scoring, cost, and availability.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { createSourcesWithCategory } from "../source-registry.js"

export interface ListSourcesArgs {
  category?: string
}

/**
 * Handles the list_sources MCP tool call.
 *
 * Returns source metadata as a JSON text content block. If a category
 * is specified, only sources from that category are returned. Unknown
 * categories silently return an empty array.
 */
export function listSourcesHandler(args: ListSourcesArgs): CallToolResult {
  const categories = args.category ? [args.category] : undefined
  const tagged = createSourcesWithCategory(categories)

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

  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  }
}
