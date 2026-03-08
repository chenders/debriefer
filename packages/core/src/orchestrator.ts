/**
 * Research Orchestrator — the core engine that wires sources, phases,
 * rate limiting, cost tracking, and synthesis into a complete pipeline.
 *
 * Two entry points:
 * - `debrief(subject)` — research a single subject through all phases
 * - `debriefBatch(subjects, hooks)` — research multiple subjects with
 *   concurrency, cost limits, and lifecycle hooks
 *
 * Algorithm (per subject):
 * 1. For each phase in order:
 *    a. Filter to available sources (isAvailable())
 *    b. Fire all sources concurrently via Promise.allSettled()
 *    c. Collect successful findings, tag with reliability info → ScoredFinding
 *    d. Check early-stop: do we have earlyStopThreshold+ high-quality families?
 *    e. Check per-subject cost limit
 * 2. Synthesize all accumulated findings via the injected Synthesizer
 * 3. Return DebriefResult
 */

import type {
  ResearchSubject,
  ResearchConfig,
  ScoredFinding,
  DebriefResult,
  SourcePhaseGroup,
  Synthesizer,
  LifecycleHooks,
  TelemetryProvider,
} from "./types.js"
import type { BaseResearchSource } from "./base-source.js"
import { SourceRateLimiter } from "./rate-limiter.js"
import { BatchCostTracker } from "./cost-tracker.js"
import { ParallelBatchRunner } from "./batch-runner.js"
import { NoopTelemetry } from "./telemetry/noop.js"

const DEFAULT_CONFIG = {
  concurrency: 5,
  confidenceThreshold: 0.6,
  reliabilityThreshold: 0.6,
  earlyStopThreshold: 3,
} as const

/**
 * Generic research orchestrator that coordinates source phases, rate limiting,
 * cost tracking, and AI synthesis into a complete research pipeline.
 *
 * @typeParam TSubject - The research subject type (extends ResearchSubject)
 * @typeParam TOutput - The structured output type produced by synthesis
 */
export class ResearchOrchestrator<TSubject extends ResearchSubject, TOutput> {
  private phases: SourcePhaseGroup<TSubject>[]
  private synthesizer: Synthesizer<TSubject, TOutput>
  private config: ResearchConfig
  private rateLimiter: SourceRateLimiter
  private telemetry: TelemetryProvider

  constructor(
    phases: SourcePhaseGroup<TSubject>[],
    synthesizer: Synthesizer<TSubject, TOutput>,
    config: ResearchConfig = {}
  ) {
    this.phases = phases
    this.synthesizer = synthesizer
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.rateLimiter = new SourceRateLimiter()
    this.telemetry = config.telemetry ?? new NoopTelemetry()

    // Inject infrastructure into all sources
    for (const phase of phases) {
      for (const source of phase.sources) {
        const src = source as BaseResearchSource<TSubject>
        if (typeof src.setRateLimiter === "function") {
          src.setRateLimiter(this.rateLimiter)
        }
        if (typeof src.setCache === "function" && config.cache) {
          src.setCache(config.cache)
        }
        if (typeof src.setTelemetry === "function") {
          src.setTelemetry(this.telemetry)
        }
      }
    }
  }

  /**
   * Research a single subject through all configured phases.
   *
   * Iterates through phases sequentially. Within each phase, all sources run
   * concurrently via Promise.allSettled. Accumulates findings, checks early
   * stopping between phases, then runs synthesis on all collected findings.
   *
   * @param subject - The subject to research
   * @param signal - Optional abort signal for cancellation
   * @returns Complete debrief result with findings, synthesis, and cost data
   */
  async debrief(subject: TSubject, signal?: AbortSignal): Promise<DebriefResult<TOutput>> {
    const startTime = Date.now()
    const allFindings: ScoredFinding[] = []
    let totalCostUsd = 0
    let sourcesAttempted = 0
    let sourcesSucceeded = 0
    let stoppedAtPhase: number | undefined

    const confidenceThreshold =
      this.config.confidenceThreshold ?? DEFAULT_CONFIG.confidenceThreshold
    const reliabilityThreshold =
      this.config.reliabilityThreshold ?? DEFAULT_CONFIG.reliabilityThreshold
    const earlyStopThreshold = this.config.earlyStopThreshold ?? DEFAULT_CONFIG.earlyStopThreshold

    for (const phaseGroup of this.phases) {
      if (signal?.aborted) break

      // Filter to available sources
      const availableSources = phaseGroup.sources.filter((s) => s.isAvailable())
      if (availableSources.length === 0) continue

      // Fire all sources in this phase concurrently
      const timeoutSignal = AbortSignal.timeout(120_000)
      const phaseSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

      const results = await Promise.allSettled(
        availableSources.map((source) => {
          sourcesAttempted++
          return source.lookup(subject, phaseSignal)
        })
      )

      // Collect successful findings
      for (let i = 0; i < results.length; i++) {
        const result = results[i]!
        const source = availableSources[i]!
        if (result.status === "fulfilled" && result.value) {
          const finding = result.value
          totalCostUsd += finding.costUsd
          sourcesSucceeded++

          allFindings.push({
            ...finding,
            sourceType: source.type,
            sourceName: source.name,
            reliabilityTier: source.reliabilityTier,
            reliabilityScore: source.reliabilityScore,
          })
        }
      }

      // Check early stopping — count distinct high-quality source families.
      // A "family" is a unique sourceType (e.g., "wikipedia", "guardian").
      // Multiple findings from the same source count as one family.
      const highQualityFamilies = new Set(
        allFindings
          .filter(
            (f) => f.confidence >= confidenceThreshold && f.reliabilityScore >= reliabilityThreshold
          )
          .map((f) => f.sourceType)
      )

      if (highQualityFamilies.size >= earlyStopThreshold) {
        stoppedAtPhase = phaseGroup.phase
        break
      }

      // Check per-subject cost limit
      if (
        this.config.costLimits?.maxCostPerSubject &&
        totalCostUsd >= this.config.costLimits.maxCostPerSubject
      ) {
        stoppedAtPhase = phaseGroup.phase
        break
      }
    }

    // Synthesize all findings
    let synthesisResult = undefined
    if (allFindings.length > 0) {
      try {
        synthesisResult = await this.synthesizer.synthesize(
          subject,
          allFindings,
          this.config.synthesis ?? {}
        )
        totalCostUsd += synthesisResult.costUsd
      } catch (error) {
        this.telemetry.recordError(error instanceof Error ? error : new Error(String(error)), {
          subject: subject.name,
          phase: "synthesis",
        })
      }
    }

    return {
      subject,
      data: synthesisResult?.data ?? null,
      findings: allFindings,
      synthesisResult,
      totalCostUsd,
      sourcesAttempted,
      sourcesSucceeded,
      stoppedAtPhase,
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * Research multiple subjects with bounded concurrency and lifecycle hooks.
   *
   * Uses ParallelBatchRunner for concurrent subject processing with shared
   * rate limiting. Fires lifecycle hooks at each stage for observability:
   * database writes, progress bars, monitoring dashboards, etc.
   *
   * @param subjects - Array of subjects to research
   * @param hooks - Optional lifecycle hooks for progress and monitoring
   * @returns Map of subject ID → DebriefResult
   */
  async debriefBatch(
    subjects: TSubject[],
    hooks?: LifecycleHooks<TSubject, TOutput>
  ): Promise<Map<string | number, DebriefResult<TOutput>>> {
    const startTime = Date.now()
    const concurrency = this.config.concurrency ?? DEFAULT_CONFIG.concurrency
    const resultMap = new Map<string | number, DebriefResult<TOutput>>()

    const costTracker = this.config.costLimits?.maxTotalCost
      ? new BatchCostTracker({
          maxTotalCost: this.config.costLimits.maxTotalCost,
        })
      : undefined

    hooks?.onRunStart?.(subjects.length, this.config)

    const runner = new ParallelBatchRunner<TSubject, DebriefResult<TOutput>>({
      concurrency,
      onItemComplete: (subject, result, progress) => {
        resultMap.set(subject.id, result)

        if (costTracker) {
          costTracker.addSubjectCost(subject.id, result.totalCostUsd)
        }

        hooks?.onSubjectComplete?.(subject, result)

        // Calculate running total cost across all completed subjects
        const runningCost =
          costTracker?.getTotalCost() ??
          Array.from(resultMap.values()).reduce((sum, r) => sum + r.totalCostUsd, 0)

        hooks?.onBatchProgress?.({
          completed: progress.completed,
          total: progress.total,
          costUsd: runningCost,
          elapsedMs: Date.now() - startTime,
        })
      },
      onItemError: (subject, error) => {
        // Per-subject errors are not batch failures — the batch continues.
        // Report via onSubjectComplete with null data.
        const errorResult: DebriefResult<TOutput> = {
          subject,
          data: null,
          findings: [],
          totalCostUsd: 0,
          sourcesAttempted: 0,
          sourcesSucceeded: 0,
          durationMs: 0,
        }
        resultMap.set(subject.id, errorResult)
        hooks?.onSubjectComplete?.(subject, errorResult)
        this.telemetry.recordError(error, { subject: subject.name, phase: "batch" })
      },
    })

    const batchResults = await runner.run(subjects, async (subject) => {
      // Check total cost limit before starting
      if (costTracker?.isTotalLimitExceeded()) {
        return {
          subject,
          data: null,
          findings: [],
          totalCostUsd: 0,
          sourcesAttempted: 0,
          sourcesSucceeded: 0,
          durationMs: 0,
        }
      }

      hooks?.onSubjectStart?.(subject, resultMap.size, subjects.length)
      return this.debrief(subject)
    })

    // Ensure results from cost-limited subjects (which still succeed via
    // onItemComplete) and any edge cases are captured in the map
    for (const entry of batchResults) {
      if (entry.result && !resultMap.has(entry.item.id)) {
        resultMap.set(entry.item.id, entry.result)
      }
    }

    const totalCost =
      costTracker?.getTotalCost() ??
      Array.from(resultMap.values()).reduce((sum, r) => sum + r.totalCostUsd, 0)

    const succeeded = Array.from(resultMap.values()).filter((r) => r.data !== null).length

    hooks?.onRunComplete?.({
      completed: resultMap.size,
      total: subjects.length,
      costUsd: totalCost,
      elapsedMs: Date.now() - startTime,
      succeeded,
      failed: resultMap.size - succeeded,
      avgCostPerSubject: resultMap.size > 0 ? totalCost / resultMap.size : 0,
      avgDurationMs:
        resultMap.size > 0
          ? Array.from(resultMap.values()).reduce((sum, r) => sum + r.durationMs, 0) /
            resultMap.size
          : 0,
    })

    return resultMap
  }
}
