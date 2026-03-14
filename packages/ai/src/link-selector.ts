/**
 * AI-powered link selector for web search sources.
 *
 * Uses Claude Haiku to rank and filter search result URLs by relevance
 * to the research subject, replacing heuristic domain/keyword scoring.
 */

import type { ResearchSubject } from "debriefer"
import type { WebSearchResult } from "debriefer-sources"
import type { AIClient } from "./ai-client.js"
import type { TelemetryProvider } from "debriefer"

/**
 * Creates a link selector callback that uses AI to rank search results.
 *
 * When AI is unavailable or fails, falls back to returning results
 * unchanged (preserving the search engine's original ordering).
 */
export function createAILinkSelector(options: {
  client: AIClient
  researchGoal?: string
  telemetry?: TelemetryProvider
  fallbackToHeuristics: boolean
}): (results: WebSearchResult[], subject: ResearchSubject) => Promise<WebSearchResult[]> {
  const { client, researchGoal, telemetry, fallbackToHeuristics } = options

  return async (
    results: WebSearchResult[],
    subject: ResearchSubject
  ): Promise<WebSearchResult[]> => {
    if (results.length === 0) return []

    const resultList = results
      .map((r, i) => `${i}: ${r.title} — ${r.url}\n   ${r.snippet}`)
      .join("\n")

    try {
      const response = await client.complete({
        system:
          "You are a research assistant that ranks web search results by relevance. " +
          "Respond ONLY with a JSON array of result indices in order of relevance " +
          "(most relevant first). No explanation.",
        user:
          `Subject: ${subject.name}\n` +
          `Research goal: ${researchGoal ?? "Find information about this subject"}\n\n` +
          `Search results:\n${resultList}\n\n` +
          "Rank these results by relevance. Return a JSON array of indices, e.g. [2, 0, 1].",
        maxTokens: 256,
      })

      const indices: unknown = JSON.parse(response.text.trim())
      if (!Array.isArray(indices)) {
        throw new Error("Expected array of indices")
      }

      const validIndices = indices.filter(
        (i): i is number =>
          typeof i === "number" && Number.isInteger(i) && i >= 0 && i < results.length
      )

      // Build reordered list; append any results not mentioned by AI at the end
      const reordered: WebSearchResult[] = []
      const used = new Set<number>()
      for (const idx of validIndices) {
        if (!used.has(idx)) {
          reordered.push(results[idx])
          used.add(idx)
        }
      }
      for (let i = 0; i < results.length; i++) {
        if (!used.has(i)) {
          reordered.push(results[i])
        }
      }

      return reordered
    } catch (error) {
      telemetry?.recordEvent("ai.call_failed", {
        callback: "linkSelector",
        error: error instanceof Error ? error.message : String(error),
        fallback: fallbackToHeuristics,
      })

      if (fallbackToHeuristics) {
        return results
      }
      return []
    }
  }
}
