/**
 * AI-powered Wikipedia section filter.
 *
 * Uses Claude Haiku to select the most relevant sections from a Wikipedia
 * article based on the research goal, replacing regex-based section matching.
 */

import type { WikipediaSection } from "@debriefer/sources"
import type { AIClient } from "./ai-client.js"
import type { TelemetryProvider } from "@debriefer/core"

/**
 * Creates an AsyncSectionFilter that uses AI to select relevant Wikipedia sections.
 *
 * When AI is unavailable or fails, falls back to returning all sections
 * (matching the default behavior).
 */
export function createAISectionFilter(options: {
  client: AIClient
  researchGoal?: string
  telemetry?: TelemetryProvider
  fallbackToHeuristics: boolean
}): (sections: WikipediaSection[], articleText: string) => Promise<WikipediaSection[]> {
  const { client, researchGoal, telemetry, fallbackToHeuristics } = options

  return async (sections: WikipediaSection[], articleText: string): Promise<WikipediaSection[]> => {
    if (sections.length === 0) return []

    const sectionList = sections.map((s) => `${s.index}: ${s.title} (depth ${s.depth})`).join("\n")

    // Truncate article text to keep prompt concise
    const truncatedText =
      articleText.length > 3000 ? articleText.slice(0, 3000) + "..." : articleText

    try {
      const response = await client.complete({
        system:
          "You are a research assistant that selects relevant Wikipedia sections. " +
          "Respond ONLY with a JSON array of section indices (numbers). No explanation.",
        user:
          `Research goal: ${researchGoal ?? "Find biographical information"}\n\n` +
          `Article sections:\n${sectionList}\n\n` +
          `Article preview:\n${truncatedText}\n\n` +
          "Which section indices are most relevant to the research goal? " +
          "Return a JSON array of numbers, e.g. [0, 3, 5].",
        maxTokens: 256,
      })

      const indices: unknown = JSON.parse(response.text.trim())
      if (!Array.isArray(indices)) {
        throw new Error("Expected array of indices")
      }

      const validIndices = new Set(
        indices.filter((i): i is number => typeof i === "number" && Number.isInteger(i))
      )

      const selected = sections.filter((s) => validIndices.has(s.index))
      return selected.length > 0 ? selected : sections
    } catch (error) {
      telemetry?.recordEvent("ai.call_failed", {
        callback: "sectionFilter",
        error: error instanceof Error ? error.message : String(error),
        fallback: fallbackToHeuristics,
      })

      if (fallbackToHeuristics) {
        return sections
      }
      return []
    }
  }
}
