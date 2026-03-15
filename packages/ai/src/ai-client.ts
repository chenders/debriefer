/**
 * AIClient abstraction for making AI inference calls.
 *
 * The default implementation uses Anthropic's Claude API via @anthropic-ai/sdk.
 * Consumers can provide their own AIClient for non-Anthropic providers (OpenAI,
 * Gemini, local models, etc.).
 */

import Anthropic from "@anthropic-ai/sdk"

/**
 * A single message completion request.
 */
export interface AICompletionRequest {
  /** System prompt providing context and instructions */
  system: string
  /** User message to respond to */
  user: string
  /** Maximum tokens in the response */
  maxTokens?: number
}

/**
 * Response from an AI completion call.
 */
export interface AICompletionResponse {
  /** The text response from the model */
  text: string
  /** Token usage for cost tracking */
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

/**
 * Interface for AI inference providers. Abstracts the API call so
 * consumers can swap Claude for OpenAI, Gemini, local models, etc.
 */
export interface AIClient {
  /** Make a completion call and return the text response. */
  complete(request: AICompletionRequest): Promise<AICompletionResponse>
}

/**
 * Default AIClient implementation using Anthropic's Claude API.
 * Uses Haiku 4.5 by default for cost-effective AI callbacks.
 */
export class HaikuClient implements AIClient {
  private client: Anthropic
  private model: string

  constructor(options: { apiKey?: string; model?: string } = {}) {
    this.client = new Anthropic({ apiKey: options.apiKey })
    this.model = options.model ?? "claude-haiku-4-5-20251001"
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 1024,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
    })

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")

    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    }
  }
}
