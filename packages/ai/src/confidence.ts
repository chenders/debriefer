/**
 * AI-powered confidence scorer.
 *
 * Uses Claude Haiku to assess how relevant a piece of extracted text is
 * to the research subject and goal, replacing keyword-based heuristics.
 */

import type { ResearchSubject } from "debriefer"
import type { AIClient } from "./ai-client.js"
import type { TelemetryProvider } from "debriefer"

/**
 * Creates a confidence scorer callback that uses AI to assess content relevance.
 *
 * When AI is unavailable or fails, falls back to a baseline score of 0.5
 * (the same base score keyword matching gives when a required keyword is found).
 */
export function createAIConfidenceScorer(options: {
  client: AIClient
  researchGoal?: string
  telemetry?: TelemetryProvider
  fallbackToHeuristics: boolean
}): (text: string, subject: ResearchSubject) => Promise<number> {
  const { client, researchGoal, telemetry, fallbackToHeuristics } = options

  return async (text: string, subject: ResearchSubject): Promise<number> => {
    if (!text || text.length === 0) return 0

    // Truncate to keep prompt concise — first 2000 chars is enough for relevance
    const truncatedText = text.length > 2000 ? text.slice(0, 2000) + "..." : text

    try {
      const response = await client.complete({
        system:
          "You are a research relevance scorer. Given a text and a research subject, " +
          "rate how relevant the text is to the subject on a scale of 0.0 to 1.0. " +
          "Respond ONLY with a single decimal number. No explanation.",
        user:
          `Subject: ${subject.name}\n` +
          `Research goal: ${researchGoal ?? "Find information about this subject"}\n\n` +
          `Text:\n${truncatedText}\n\n` +
          "Relevance score (0.0-1.0):",
        maxTokens: 32,
      })

      const score = parseFloat(response.text.trim())
      if (!Number.isFinite(score) || score < 0 || score > 1) {
        throw new Error(`Invalid score: ${response.text.trim()}`)
      }

      return score
    } catch (error) {
      telemetry?.recordEvent("ai.call_failed", {
        callback: "confidenceScorer",
        error: error instanceof Error ? error.message : String(error),
        fallback: fallbackToHeuristics,
      })

      if (fallbackToHeuristics) {
        // Baseline score — equivalent to keyword match finding a required keyword
        return 0.5
      }
      return 0
    }
  }
}
