/**
 * AI-powered person validator for Wikipedia source.
 *
 * Uses Claude Haiku to verify that a Wikipedia article is about the
 * intended person, replacing regex/date-based heuristics.
 */

import type { ResearchSubject } from "debriefer"
import type { AIClient } from "./ai-client.js"
import type { TelemetryProvider } from "debriefer"

/**
 * Creates a person validator callback that uses AI to verify article matches.
 *
 * When AI is unavailable or fails, falls back to returning true
 * (optimistically assuming the article matches, same as no validator).
 */
export function createAIPersonValidator(options: {
  client: AIClient
  telemetry?: TelemetryProvider
  fallbackToHeuristics: boolean
}): (articleText: string, subject: ResearchSubject) => Promise<boolean> {
  const { client, telemetry, fallbackToHeuristics } = options

  return async (articleText: string, subject: ResearchSubject): Promise<boolean> => {
    if (!articleText || articleText.length === 0) return false

    // Truncate to intro section — that's usually enough for identification
    const truncatedText =
      articleText.length > 2000 ? articleText.slice(0, 2000) + "..." : articleText

    // Build context hints from subject metadata
    const hints: string[] = []
    if (subject.context) {
      if (subject.context.birthYear || subject.context.birthday) {
        hints.push(`Born: ${subject.context.birthYear ?? subject.context.birthday}`)
      }
      if (subject.context.deathYear || subject.context.deathday) {
        hints.push(`Died: ${subject.context.deathYear ?? subject.context.deathday}`)
      }
      if (subject.context.occupation) {
        hints.push(`Occupation: ${subject.context.occupation}`)
      }
    }

    const contextStr = hints.length > 0 ? `\nKnown details: ${hints.join(", ")}` : ""

    try {
      const response = await client.complete({
        system:
          "You are verifying whether a Wikipedia article is about a specific person. " +
          "Respond ONLY with 'true' or 'false'. No explanation.",
        user:
          `Person: ${subject.name}${contextStr}\n\n` +
          `Article text:\n${truncatedText}\n\n` +
          "Is this article about the person described above? Answer true or false.",
        maxTokens: 8,
      })

      const answer = response.text.trim().toLowerCase()
      return answer === "true" || answer === "yes"
    } catch (error) {
      telemetry?.recordEvent("ai.call_failed", {
        callback: "personValidator",
        error: error instanceof Error ? error.message : String(error),
        fallback: fallbackToHeuristics,
      })

      if (fallbackToHeuristics) {
        // Optimistic fallback — assume it's the right person
        return true
      }
      return false
    }
  }
}
