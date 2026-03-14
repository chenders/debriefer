/**
 * Synthesis utilities and NoopSynthesizer for the debriefer core.
 *
 * ClaudeSynthesizer has been moved to @debriefer/ai. This module retains
 * NoopSynthesizer (pass-through) and the stripMarkdownCodeFences utility
 * which has no AI dependency.
 */

import type { ResearchSubject, ScoredFinding, SynthesisResult, Synthesizer } from "./types.js"

/**
 * Strip markdown code fences from Claude's response.
 *
 * Claude sometimes wraps JSON responses in ```json ... ``` or ``` ... ```
 * code fences despite being told to return raw JSON. This utility removes
 * those wrappings to allow JSON.parse to succeed.
 */
export function stripMarkdownCodeFences(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith("```")) {
    const lines = trimmed.split("\n")
    // Remove first line (```json or ```) and last line (```)
    const inner = lines.slice(1, lines.length - 1).join("\n")
    return inner.trim()
  }
  return trimmed
}

/**
 * No-op synthesizer that returns findings as-is without AI processing.
 *
 * Useful for consumers who want raw gathered data without paying for
 * AI synthesis, or for testing/debugging the source gathering pipeline.
 *
 * @typeParam TSubject - The research subject type
 */
export class NoopSynthesizer<TSubject extends ResearchSubject> implements Synthesizer<
  TSubject,
  ScoredFinding[]
> {
  /**
   * Returns the findings array unchanged with zero cost.
   */
  async synthesize(
    _subject: TSubject,
    findings: ScoredFinding[]
  ): Promise<SynthesisResult<ScoredFinding[]>> {
    return {
      data: findings,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      model: "none",
    }
  }
}
