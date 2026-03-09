/**
 * Debrief command — researches a subject across multiple sources.
 *
 * Supports text and JSON output, optional AI synthesis, category filtering,
 * budget control, and verbose progress logging. Uses the source registry to
 * create sources and the orchestrator for phased execution.
 */

import { Command, InvalidArgumentError } from "commander"
import { ResearchOrchestrator, ClaudeSynthesizer, NoopSynthesizer } from "debriefer"
import type {
  ResearchSubject,
  ResearchConfig,
  SourcePhaseGroup,
  LifecycleHooks,
  Synthesizer,
  RawFinding,
} from "debriefer"
import { createSources, SOURCE_CATEGORIES } from "../source-registry.js"
import { formatDebriefResult } from "../formatters.js"

// ============================================================================
// Types
// ============================================================================

interface DebriefOptions {
  budget: number
  categories?: string
  model: string
  prompt?: string
  synthesis: boolean
  format: string
  verbose: boolean
}

// ============================================================================
// Budget parser
// ============================================================================

/**
 * Parses and validates the --budget option value.
 * Must be a positive number representing USD.
 */
function parseBudget(value: string): number {
  const parsed = parseFloat(value)
  if (isNaN(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("Budget must be a positive number (USD).")
  }
  return parsed
}

// ============================================================================
// Command builder
// ============================================================================

/**
 * Builds the `debrief` subcommand for the CLI.
 *
 * Usage:
 *   debriefer debrief "John Wayne"                          — research with defaults
 *   debriefer debrief "John Wayne" --no-synthesis           — skip AI synthesis
 *   debriefer debrief "John Wayne" --format json            — output as JSON
 *   debriefer debrief "John Wayne" --categories structured  — only structured sources
 *   debriefer debrief "John Wayne" --budget 0.50            — limit cost to $0.50
 */
export function buildDebriefCommand(): Command {
  return new Command("debrief")
    .description("Research a subject across multiple sources")
    .argument("<name>", "Subject name to research")
    .option("--budget <usd>", "Max cost in USD", parseBudget, 1.0)
    .option("--categories <list>", "Comma-separated source categories")
    .option("--model <model>", "Synthesis model", "claude-sonnet-4-20250514")
    .option("--prompt <text>", "Custom synthesis prompt")
    .option("--no-synthesis", "Skip AI synthesis")
    .option("--format <fmt>", "Output format: json or text", "text")
    .option("--verbose", "Show progress", false)
    .action((name: string, options: DebriefOptions) => runDebrief(name, options))
}

// ============================================================================
// Run debrief
// ============================================================================

/**
 * Executes the debrief pipeline: create sources, build orchestrator, run, output.
 */
async function runDebrief(name: string, options: DebriefOptions): Promise<void> {
  // 1. Parse categories from comma-separated string
  const categories = options.categories
    ? options.categories.split(",").map((c) => c.trim())
    : undefined

  // 2. Warn about unknown categories
  if (categories) {
    const known = Object.keys(SOURCE_CATEGORIES)
    for (const cat of categories) {
      if (!known.includes(cat)) {
        console.error(`Warning: unknown category "${cat}" (available: ${known.join(", ")})`)
      }
    }
  }

  // 3. Create sources and filter to available
  const allSources = createSources(categories)
  const availableSources = allSources.filter((s) => s.isAvailable())
  const skippedCount = allSources.length - availableSources.length

  // 3. Check for available sources
  if (availableSources.length === 0) {
    console.error(
      "No sources available. Check that required API keys are configured " +
        "(e.g., GOOGLE_API_KEY, BING_API_KEY). Run `debriefer sources` to see availability."
    )
    process.exitCode = 1
    return
  }

  // 4. Verbose: show source counts
  if (options.verbose) {
    console.error(
      `Sources: ${availableSources.length} available, ${skippedCount} skipped (missing API keys)`
    )
  }

  // 5. Build synthesizer
  let synthesizer: Synthesizer<ResearchSubject, unknown>

  if (options.synthesis) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.error(
        "ANTHROPIC_API_KEY environment variable is required for synthesis. " +
          "Use --no-synthesis to skip AI synthesis."
      )
      process.exitCode = 1
      return
    }
    synthesizer = new ClaudeSynthesizer<ResearchSubject, string>({
      promptBuilder: (subject, findings) => ({
        system:
          options.prompt ??
          "You are a research assistant. Synthesize the following findings into a clear, factual summary. " +
            'Respond ONLY with a valid JSON object: { "summary": "your synthesized summary" }',
        user:
          `Subject: ${subject.name}\n\nFindings:\n${findings.map((f) => `[${f.sourceName}] ${f.text}`).join("\n\n")}\n\n` +
          'Respond with JSON: { "summary": "..." }',
      }),
      responseParser: (data: unknown): string => {
        if (data && typeof data === "object" && "summary" in data) {
          return String((data as { summary: unknown }).summary)
        }
        return String(data)
      },
      apiKey,
    })
  } else {
    synthesizer = new NoopSynthesizer<ResearchSubject>()
  }

  // 6. Split available sources into free (phase 1) and paid (phase 2)
  // This makes --budget effective: cost limits are checked between phases
  const freeSources = availableSources.filter((s) => s.isFree)
  const paidSources = availableSources.filter((s) => !s.isFree)

  const phases: SourcePhaseGroup<ResearchSubject>[] = []
  if (freeSources.length > 0) {
    phases.push({ phase: 1, name: "Free Sources", sources: freeSources })
  }
  if (paidSources.length > 0) {
    phases.push({ phase: 2, name: "Paid Sources", sources: paidSources })
  }

  // 7. Build config
  const config: ResearchConfig = {
    costLimits: {
      maxCostPerSubject: options.budget,
    },
    synthesis: {
      model: options.model,
      systemPrompt: options.prompt,
    },
  }

  // 8. Build lifecycle hooks (verbose only)
  const hooks: LifecycleHooks<ResearchSubject, unknown> = {}
  if (options.verbose) {
    hooks.onSourceComplete = (
      _subject: ResearchSubject,
      sourceName: string,
      finding: RawFinding | null,
      costUsd: number
    ) => {
      const status = finding ? "found" : "no result"
      console.error(`  ${sourceName}: ${status} ($${costUsd.toFixed(4)})`)
    }
  }

  // 9. Create orchestrator
  const orchestrator = new ResearchOrchestrator(phases, synthesizer, config)

  // 10. Create subject
  const subject: ResearchSubject = { id: name, name }

  // 11. Run debrief
  const result = await orchestrator.debrief(subject, { hooks })

  // 12. Output results
  if (options.format === "json") {
    // eslint-disable-next-line no-console -- CLI: stdout is the intended output channel
    console.log(JSON.stringify(result, null, 2))
  } else {
    // eslint-disable-next-line no-console -- CLI: stdout is the intended output channel
    console.log(formatDebriefResult(result))
  }
}
