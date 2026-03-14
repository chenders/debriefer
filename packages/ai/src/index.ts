/**
 * @debriefer/ai — AI-first defaults for the debriefer research engine.
 *
 * Provides `createAIDefaults()` which returns pre-built AI callbacks for
 * section filtering, confidence scoring, link selection, and person validation.
 * Also houses `ClaudeSynthesizer` (moved from @debriefer/core) making the
 * core package fully zero-AI.
 *
 * @packageDocumentation
 */

import type { ResearchSubject, TelemetryProvider } from "debriefer"
import type { AsyncSectionFilter, WebSearchResult, WikipediaSection } from "debriefer-sources"
import type { AIClient } from "./ai-client.js"
import { HaikuClient } from "./ai-client.js"
import { createAISectionFilter } from "./section-filter.js"
import { createAIConfidenceScorer } from "./confidence.js"
import { createAILinkSelector } from "./link-selector.js"
import { createAIPersonValidator } from "./person-validator.js"

// Re-export synthesizer (moved from core)
export { ClaudeSynthesizer } from "./synthesizer.js"
export type { ClaudeSynthesizerOptions } from "./synthesizer.js"

// Re-export AI client types
export type { AIClient, AICompletionRequest, AICompletionResponse } from "./ai-client.js"
export { HaikuClient } from "./ai-client.js"

// ============================================================================
// createAIDefaults
// ============================================================================

/**
 * Options for creating AI-powered defaults.
 */
export interface AIDefaultsOptions {
  /** Anthropic API key. Defaults to ANTHROPIC_API_KEY env var. */
  apiKey?: string
  /** Model to use for AI callbacks. Defaults to claude-haiku-4-5-20251001. */
  model?: string
  /** Research goal injected into AI prompts for better relevance. */
  researchGoal?: string
  /** Telemetry provider for logging AI call failures. */
  telemetry?: TelemetryProvider
  /**
   * Whether to fall back to heuristic behavior when AI calls fail.
   * Default: true. When false, failures propagate as empty/zero results.
   */
  fallbackToHeuristics?: boolean
  /** Custom AI client for non-Anthropic providers. */
  client?: AIClient
}

/**
 * Pre-built AI callbacks returned by `createAIDefaults()`.
 */
export interface AIDefaults {
  /** AI section filter for Wikipedia sources. */
  sectionFilter: AsyncSectionFilter
  /** AI confidence scorer for any source. */
  confidenceScorer: (text: string, subject: ResearchSubject) => Promise<number>
  /** AI link ranker for web search sources. */
  linkSelector: (results: WebSearchResult[], subject: ResearchSubject) => Promise<WebSearchResult[]>
  /** AI person validator for Wikipedia sources. */
  personValidator: (articleText: string, subject: ResearchSubject) => Promise<boolean>
  /** Whether the AI client is available (API key is set). */
  readonly isAvailable: boolean
}

/**
 * Create AI-powered defaults for debriefer source callbacks.
 *
 * Returns pre-built callbacks using Claude Haiku for section filtering,
 * confidence scoring, link selection, and person validation. When
 * `ANTHROPIC_API_KEY` is not set and no custom client is provided,
 * logs a warning and all callbacks fall through to heuristic behavior.
 *
 * @example
 * ```typescript
 * const ai = createAIDefaults({ researchGoal: "Find biographical information" })
 *
 * const sources = [
 *   wikipedia({
 *     asyncSectionFilter: ai.sectionFilter,
 *     validatePerson: ai.personValidator,
 *   }),
 *   googleSearch({
 *     linkSelector: ai.linkSelector,
 *     confidenceScorer: ai.confidenceScorer,
 *   }),
 * ]
 * ```
 */
export function createAIDefaults(options: AIDefaultsOptions = {}): AIDefaults {
  const { apiKey, model, researchGoal, telemetry, fallbackToHeuristics = true } = options

  // Determine availability
  const hasApiKey = !!(apiKey ?? process.env.ANTHROPIC_API_KEY)
  const hasCustomClient = !!options.client
  const available = hasApiKey || hasCustomClient

  // If unavailable, warn and return passthrough callbacks
  if (!available) {
    console.warn(
      "[debriefer-ai] ANTHROPIC_API_KEY not set. AI features disabled — using heuristic fallbacks."
    )
    return {
      sectionFilter: async (sections: WikipediaSection[]) => sections,
      confidenceScorer: async () => 0.5,
      linkSelector: async (results: WebSearchResult[]) => results,
      personValidator: async () => true,
      get isAvailable() {
        return false
      },
    }
  }

  // Create AI client (or use custom)
  const client: AIClient = options.client ?? new HaikuClient({ apiKey, model })
  const commonOptions = { client, researchGoal, telemetry, fallbackToHeuristics }

  return {
    sectionFilter: createAISectionFilter(commonOptions),
    confidenceScorer: createAIConfidenceScorer(commonOptions),
    linkSelector: createAILinkSelector(commonOptions),
    personValidator: createAIPersonValidator(commonOptions),
    get isAvailable() {
      return true
    },
  }
}
