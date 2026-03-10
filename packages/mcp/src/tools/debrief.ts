/**
 * debrief tool handler — runs single-subject research across multiple sources.
 *
 * Creates sources filtered by category and availability, builds a synthesizer
 * (Noop by default, Claude when synthesis is requested), splits sources into
 * free/paid phases, and runs the orchestrator.
 */

import { ResearchOrchestrator, ClaudeSynthesizer, NoopSynthesizer } from "debriefer"
import type { ResearchSubject, ResearchConfig, SourcePhaseGroup, Synthesizer } from "debriefer"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { createSourcesWithCategory, VALID_CATEGORIES } from "../source-registry.js"
import type { McpConfig } from "../config.js"

export interface DebriefArgs {
  name: string
  categories?: string[]
  budget?: number
  synthesis?: boolean
  model?: string
  prompt?: string
}

/**
 * Handles the debrief MCP tool call.
 *
 * Orchestrates research across configured sources and returns the result
 * as a JSON text content block. Synthesis defaults to false — set
 * synthesis=true to use ClaudeSynthesizer (requires ANTHROPIC_API_KEY).
 */
export async function debriefHandler(
  args: DebriefArgs,
  config: McpConfig,
  signal?: AbortSignal
): Promise<CallToolResult> {
  try {
    // 1. Validate categories
    if (args.categories) {
      const invalid = args.categories.filter(
        (c) => !VALID_CATEGORIES.includes(c as (typeof VALID_CATEGORIES)[number])
      )
      if (invalid.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `Unknown categories: ${invalid.join(", ")}. Valid: ${VALID_CATEGORIES.join(", ")}`,
            },
          ],
          isError: true,
        }
      }
    }

    // 2. Create sources and filter to available
    const tagged = createSourcesWithCategory(args.categories)
    const available = tagged.filter(({ source }) => source.isAvailable())

    if (available.length === 0) {
      return {
        content: [{ type: "text", text: "No sources available for the requested categories" }],
        isError: true,
      }
    }

    // 3. Build synthesizer
    const useSynthesis = args.synthesis ?? false
    let synthesizer: Synthesizer<ResearchSubject, unknown>

    if (useSynthesis) {
      if (!config.anthropicApiKey) {
        return {
          content: [
            {
              type: "text",
              text: "Synthesis requires ANTHROPIC_API_KEY to be configured",
            },
          ],
          isError: true,
        }
      }

      const jsonSuffix =
        '\nRespond ONLY with a valid JSON object: { "summary": "your synthesized summary" }'
      const defaultPrompt =
        "You are a research assistant. Synthesize the following findings into a clear, factual summary."

      synthesizer = new ClaudeSynthesizer<ResearchSubject, string>({
        promptBuilder: (subject, findings) => ({
          system: (args.prompt?.trim() || defaultPrompt) + jsonSuffix,
          user:
            `Subject: ${subject.name}\n\nFindings:\n${findings.map((f) => `[${f.sourceName}] ${f.text}`).join("\n\n")}\n\n` +
            'Respond with JSON: { "summary": "..." }',
        }),
        responseParser: (data: unknown): string => {
          if (
            data &&
            typeof data === "object" &&
            "summary" in data &&
            typeof (data as { summary: unknown }).summary === "string"
          ) {
            return (data as { summary: string }).summary
          }
          throw new Error("Synthesis response missing required 'summary' string field")
        },
        apiKey: config.anthropicApiKey,
      })
    } else {
      synthesizer = new NoopSynthesizer<ResearchSubject>()
    }

    // 4. Split into free (phase 1) and paid (phase 2)
    const sources = available.map(({ source }) => source)
    const freeSources = sources.filter((s) => s.isFree)
    const paidSources = sources.filter((s) => !s.isFree)

    const phases: SourcePhaseGroup<ResearchSubject>[] = []
    if (freeSources.length > 0) {
      phases.push({ phase: 1, name: "Free Sources", sources: freeSources })
    }
    if (paidSources.length > 0) {
      phases.push({ phase: 2, name: "Paid Sources", sources: paidSources })
    }

    // 5. Build config — normalize empty strings and validate budget
    const effectiveBudget =
      typeof args.budget === "number" && Number.isFinite(args.budget) && args.budget > 0
        ? args.budget
        : config.defaultBudget
    const effectiveModel = args.model?.trim() || config.defaultModel
    const orchestratorConfig: ResearchConfig = {
      costLimits: {
        maxCostPerSubject: effectiveBudget,
      },
      synthesis: {
        model: effectiveModel,
      },
    }

    // 6. Run orchestrator
    const orchestrator = new ResearchOrchestrator(phases, synthesizer, orchestratorConfig)
    const result = await orchestrator.debrief({ id: args.name, name: args.name }, { signal })

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Research failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}
