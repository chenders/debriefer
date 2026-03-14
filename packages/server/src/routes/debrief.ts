/**
 * Debrief route — runs single-subject research across multiple sources.
 *
 * Validates the request body, creates sources filtered by category and
 * availability, builds a synthesizer (Claude or Noop), splits sources
 * into free/paid phases, and runs the orchestrator.
 */

import { Router } from "express"
import type { Request, Response } from "express"
import { ResearchOrchestrator, ClaudeSynthesizer, NoopSynthesizer } from "@debriefer/core"
import type {
  ResearchSubject,
  ResearchConfig,
  SourcePhaseGroup,
  Synthesizer,
} from "@debriefer/core"
import { debriefRequestSchema } from "../schemas.js"
import { createSourcesWithCategory, VALID_CATEGORIES } from "../source-registry.js"
import type { ServerConfig } from "../config.js"

/**
 * Creates the debrief router with access to server configuration.
 *
 * The config provides default budget, default model, and the Anthropic
 * API key needed for AI synthesis.
 */
export function createDebriefRouter(config: ServerConfig): Router {
  const router = Router()

  router.post("/debrief", async (req: Request, res: Response) => {
    try {
      // 1. Validate request body
      const parsed = debriefRequestSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid request",
          details: parsed.error.issues.map((e) => e.message),
        })
        return
      }

      const { name, categories, budget, synthesis, model, prompt } = parsed.data

      // 2. Validate categories
      if (categories) {
        const invalid = categories.filter(
          (c) => !VALID_CATEGORIES.includes(c as (typeof VALID_CATEGORIES)[number])
        )
        if (invalid.length > 0) {
          res.status(400).json({
            error: `Unknown categories: ${invalid.join(", ")}`,
            validCategories: [...VALID_CATEGORIES],
          })
          return
        }
      }

      // 3. Create sources and filter to available
      const tagged = createSourcesWithCategory(categories)
      const available = tagged.filter(({ source }) => source.isAvailable())

      if (available.length === 0) {
        res.status(400).json({
          error: "No sources available for the requested categories",
        })
        return
      }

      // 4. Build synthesizer
      let synthesizer: Synthesizer<ResearchSubject, unknown>

      if (synthesis) {
        if (!config.anthropicApiKey) {
          res.status(400).json({
            error: "Synthesis requires ANTHROPIC_API_KEY to be configured on the server",
          })
          return
        }

        const jsonSuffix =
          '\nRespond ONLY with a valid JSON object: { "summary": "your synthesized summary" }'
        const defaultPrompt =
          "You are a research assistant. Synthesize the following findings into a clear, factual summary."

        synthesizer = new ClaudeSynthesizer<ResearchSubject, string>({
          promptBuilder: (subject, findings) => ({
            system: (prompt ?? defaultPrompt) + jsonSuffix,
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

      // 5. Split into free (phase 1) and paid (phase 2)
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

      // 6. Build config
      const orchestratorConfig: ResearchConfig = {
        costLimits: {
          maxCostPerSubject: budget ?? config.defaultBudget,
        },
        synthesis: {
          model: model ?? config.defaultModel,
        },
      }

      // 7. Run orchestrator
      const orchestrator = new ResearchOrchestrator(phases, synthesizer, orchestratorConfig)
      const result = await orchestrator.debrief({ id: name, name })

      res.json(result)
    } catch (error) {
      console.error("Error in /debrief route:", error)
      const body: { error: string; message?: string } = { error: "Research failed" }
      if (process.env.NODE_ENV !== "production") {
        body.message = error instanceof Error ? error.message : String(error)
      }
      res.status(500).json(body)
    }
  })

  return router
}
