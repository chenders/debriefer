/**
 * AI synthesis module for distilling scored findings into structured output.
 *
 * Provides ClaudeSynthesizer (Anthropic Claude API) and NoopSynthesizer
 * (pass-through for users who want raw findings without AI processing).
 *
 * The consumer controls domain-specific behavior via promptBuilder and
 * responseParser callbacks. The synthesizer handles API calls, cost
 * calculation, JSON parsing, and code fence stripping.
 */

import Anthropic from "@anthropic-ai/sdk"
import type {
  ResearchSubject,
  ScoredFinding,
  SynthesisOptions,
  SynthesisResult,
  Synthesizer,
} from "./types.js"

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
 * Options for constructing a ClaudeSynthesizer.
 *
 * @typeParam TSubject - The research subject type (extends ResearchSubject)
 * @typeParam TOutput - The structured output type produced by synthesis
 */
export interface ClaudeSynthesizerOptions<TSubject extends ResearchSubject, TOutput> {
  /**
   * Build the system prompt and user message from the subject and findings.
   * This is where all domain knowledge lives -- the synthesizer itself is
   * domain-agnostic.
   */
  promptBuilder: (subject: TSubject, findings: ScoredFinding[]) => { system: string; user: string }

  /**
   * Parse and validate the raw JSON response into the output type.
   * Required to ensure type safety at runtime — the AI response is untrusted.
   *
   * @example
   * ```typescript
   * responseParser: (raw) => myZodSchema.parse(raw)
   * ```
   */
  responseParser: (raw: unknown) => TOutput

  /** Anthropic API key. Defaults to ANTHROPIC_API_KEY env var. */
  apiKey?: string

  /** Default model. Can be overridden per-call via SynthesisOptions. */
  defaultModel?: string

  /** Default max tokens. Can be overridden per-call. */
  defaultMaxTokens?: number
}

/**
 * Approximate cost per million tokens by model family (USD).
 * Used for cost estimation in SynthesisResult.
 *
 * These are approximate and may not reflect current Anthropic pricing.
 * Consumers should verify costs against https://docs.anthropic.com/en/docs/about-claude/models
 * Falls back to Sonnet pricing for unrecognized model families.
 */
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "claude-sonnet": { input: 3, output: 15 },
  "claude-opus": { input: 15, output: 75 },
  "claude-haiku": { input: 0.25, output: 1.25 },
}

/**
 * Look up per-million-token costs for a model string.
 * Falls back to Sonnet pricing if the model family is unrecognized.
 */
function getModelCosts(model: string): { input: number; output: number } {
  for (const [family, costs] of Object.entries(MODEL_COSTS)) {
    if (model.includes(family)) return costs
  }
  // Default to Sonnet pricing if unknown
  return { input: 3, output: 15 }
}

/**
 * Claude-powered synthesizer that distills scored findings into structured output.
 *
 * The consumer provides:
 * - `promptBuilder`: converts subject + findings into system/user prompts
 * - `responseParser`: validates/transforms the raw JSON response
 *
 * The synthesizer handles:
 * - Anthropic API calls with configurable model and max tokens
 * - JSON parsing with code fence stripping
 * - Cost calculation from token usage
 * - Sorting findings by reliability before passing to the prompt builder
 *
 * @typeParam TSubject - The research subject type
 * @typeParam TOutput - The structured output type
 *
 * @example
 * ```typescript
 * const synthesizer = new ClaudeSynthesizer<ActorSubject, DeathInfo>({
 *   promptBuilder: (actor, findings) => ({
 *     system: "You are extracting death information...",
 *     user: `Actor: ${actor.name}\nFindings:\n${findings.map(f => f.text).join("\n")}`,
 *   }),
 *   responseParser: (raw) => DeathInfoSchema.parse(raw),
 * })
 * ```
 */
export class ClaudeSynthesizer<TSubject extends ResearchSubject, TOutput> implements Synthesizer<
  TSubject,
  TOutput
> {
  private client: Anthropic
  private options: ClaudeSynthesizerOptions<TSubject, TOutput>

  constructor(options: ClaudeSynthesizerOptions<TSubject, TOutput>) {
    this.options = options
    this.client = new Anthropic({ apiKey: options.apiKey })
  }

  /**
   * Synthesize scored findings into structured output via Claude API.
   *
   * Findings are sorted by reliability score (highest first) before being
   * passed to the prompt builder, so higher-quality sources appear first
   * in the prompt.
   *
   * @param subject - The research subject
   * @param findings - Scored findings from source lookups
   * @param options - Per-call overrides for model, max tokens, etc.
   * @returns Synthesis result with structured output and cost metadata
   * @throws Error if Claude returns no text content or unparseable JSON
   */
  async synthesize(
    subject: TSubject,
    findings: ScoredFinding[],
    options: SynthesisOptions = {}
  ): Promise<SynthesisResult<TOutput>> {
    const model = options.model ?? this.options.defaultModel ?? "claude-sonnet-4-20250514"
    const maxTokens = options.maxTokens ?? this.options.defaultMaxTokens ?? 4096

    // Sort findings by reliability score (highest first) so the prompt
    // builder receives the most trustworthy sources at the top
    const sortedFindings = [...findings].sort((a, b) => b.reliabilityScore - a.reliabilityScore)

    // Build prompt via consumer-provided builder
    const { system, user } = this.options.promptBuilder(subject, sortedFindings)

    // Call Claude API
    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    })

    // Extract text content from response blocks
    const responseText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")

    if (!responseText) {
      throw new Error("No text response from Claude")
    }

    // Parse JSON, stripping any code fences Claude may have added
    const cleanJson = stripMarkdownCodeFences(responseText)
    const rawParsed: unknown = JSON.parse(cleanJson)

    // Validate through consumer's parser (required for type safety)
    const data = this.options.responseParser(rawParsed)

    // Calculate cost from token usage
    const inputTokens = response.usage.input_tokens
    const outputTokens = response.usage.output_tokens
    const costs = getModelCosts(model)
    const costUsd =
      (inputTokens * costs.input) / 1_000_000 + (outputTokens * costs.output) / 1_000_000

    return {
      data,
      costUsd,
      inputTokens,
      outputTokens,
      model,
    }
  }
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
