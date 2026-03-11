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
  RawFinding,
  ScoredFinding,
  DebriefResult,
  SourcePhaseGroup,
  MinimalSource,
  Synthesizer,
  LifecycleHooks,
  TelemetryProvider,
} from "./types.js"
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
        if ("setRateLimiter" in source && typeof source.setRateLimiter === "function") {
          source.setRateLimiter(this.rateLimiter)
        }
        if ("setCache" in source && typeof source.setCache === "function" && config.cache) {
          source.setCache(config.cache)
        }
        if ("setTelemetry" in source && typeof source.setTelemetry === "function") {
          source.setTelemetry(this.telemetry)
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
   * @param options - Optional abort signal and lifecycle hooks
   * @returns Complete debrief result with findings, synthesis, and cost data
   */
  async debrief(
    subject: TSubject,
    options?: { signal?: AbortSignal; hooks?: LifecycleHooks<TSubject, TOutput> }
  ): Promise<DebriefResult<TOutput>> {
    const startTime = Date.now()
    const allFindings: ScoredFinding[] = []
    let totalCostUsd = 0
    let sourcesAttempted = 0
    let sourcesSucceeded = 0
    let stoppedAtPhase: number | undefined

    const signal = options?.signal
    const hooks = options?.hooks

    for (const phaseGroup of this.phases) {
      if (signal?.aborted) break

      const phaseResult = await this.executePhase(subject, phaseGroup, signal, hooks)
      sourcesAttempted += phaseResult.sourcesAttempted
      sourcesSucceeded += phaseResult.sourcesSucceeded
      totalCostUsd += phaseResult.costUsd
      allFindings.push(...phaseResult.findings)

      hooks?.onPhaseComplete?.(subject, phaseGroup.phase, phaseResult.findings)

      const earlyStopReason = this.checkEarlyStop(allFindings, totalCostUsd)
      if (earlyStopReason) {
        stoppedAtPhase = phaseGroup.phase
        hooks?.onEarlyStop?.(subject, phaseGroup.phase, earlyStopReason)
        if (earlyStopReason === "cost_limit") {
          hooks?.onCostLimitReached?.(
            subject,
            totalCostUsd,
            this.config.costLimits!.maxCostPerSubject!
          )
        }
        break
      }
    }

    // Synthesize all findings
    let synthesisResult = undefined
    if (allFindings.length > 0) {
      hooks?.onSynthesisStart?.(subject, allFindings.length)
      try {
        synthesisResult = await this.synthesizer.synthesize(
          subject,
          allFindings,
          this.config.synthesis ?? {}
        )
        totalCostUsd += synthesisResult.costUsd
        hooks?.onSynthesisComplete?.(subject, synthesisResult)
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
   * Execute all available sources in a single phase.
   *
   * By default, sources run concurrently via Promise.allSettled(). When
   * `phaseGroup.sequential` is true, sources run one at a time in order,
   * stopping at the first source that returns a non-null finding.
   *
   * Fires onSourceAttempt before each lookup and onSourceComplete after.
   * Returns the phase's findings, attempt/success counts, and cost.
   */
  private async executePhase(
    subject: TSubject,
    phaseGroup: SourcePhaseGroup<TSubject>,
    signal: AbortSignal | undefined,
    hooks: LifecycleHooks<TSubject, TOutput> | undefined
  ): Promise<{
    findings: ScoredFinding[]
    sourcesAttempted: number
    sourcesSucceeded: number
    costUsd: number
  }> {
    const availableSources = phaseGroup.sources.filter((s) => s.isAvailable())
    if (availableSources.length === 0) {
      return { findings: [], sourcesAttempted: 0, sourcesSucceeded: 0, costUsd: 0 }
    }

    if (phaseGroup.sequential) {
      return this.executePhaseSequentially(
        subject,
        availableSources,
        phaseGroup.phase,
        signal,
        hooks
      )
    }

    return this.executePhaseConcurrently(subject, availableSources, phaseGroup.phase, signal, hooks)
  }

  /**
   * Execute sources concurrently via Promise.allSettled().
   */
  private async executePhaseConcurrently(
    subject: TSubject,
    availableSources: MinimalSource<TSubject>[],
    phase: number,
    signal: AbortSignal | undefined,
    hooks: LifecycleHooks<TSubject, TOutput> | undefined
  ): Promise<{
    findings: ScoredFinding[]
    sourcesAttempted: number
    sourcesSucceeded: number
    costUsd: number
  }> {
    const timeoutSignal = AbortSignal.timeout(120_000)
    const phaseSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

    const results = await Promise.allSettled(
      availableSources.map((source) => {
        hooks?.onSourceAttempt?.(subject, source.name, phase)
        return source.lookup(subject, phaseSignal)
      })
    )

    const findings: ScoredFinding[] = []
    let costUsd = 0
    let sourcesSucceeded = 0

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!
      const source = availableSources[i]!
      const finding = result.status === "fulfilled" ? (result.value as RawFinding | null) : null

      if (result.status === "rejected") {
        this.telemetry.recordError(
          result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
          { source: source.name, subject: subject.name, phase }
        )
      }

      hooks?.onSourceComplete?.(subject, source.name, finding, finding?.costUsd ?? 0)

      if (finding) {
        costUsd += finding.costUsd
        sourcesSucceeded++
        findings.push({
          ...finding,
          sourceType: source.type,
          sourceName: source.name,
          reliabilityTier: source.reliabilityTier,
          reliabilityScore: source.reliabilityScore,
        })
      }
    }

    return { findings, sourcesAttempted: availableSources.length, sourcesSucceeded, costUsd }
  }

  /**
   * Execute sources sequentially, stopping at the first non-null finding.
   * Used for AI model phases where cheapest-first ordering controls cost.
   */
  private async executePhaseSequentially(
    subject: TSubject,
    availableSources: MinimalSource<TSubject>[],
    phase: number,
    signal: AbortSignal | undefined,
    hooks: LifecycleHooks<TSubject, TOutput> | undefined
  ): Promise<{
    findings: ScoredFinding[]
    sourcesAttempted: number
    sourcesSucceeded: number
    costUsd: number
  }> {
    const timeoutSignal = AbortSignal.timeout(120_000)
    const phaseSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

    const findings: ScoredFinding[] = []
    let costUsd = 0
    let sourcesAttempted = 0
    let sourcesSucceeded = 0

    for (const source of availableSources) {
      if (phaseSignal.aborted) break

      sourcesAttempted++
      hooks?.onSourceAttempt?.(subject, source.name, phase)

      let finding: RawFinding | null = null
      try {
        finding = await source.lookup(subject, phaseSignal)
      } catch (error) {
        // Source errors are swallowed — consistent with concurrent path.
        // BaseResearchSource.lookup() already records errors internally,
        // but record here too for defense-in-depth.
        this.telemetry.recordError(error instanceof Error ? error : new Error(String(error)), {
          source: source.name,
          subject: subject.name,
          phase,
        })
      }

      hooks?.onSourceComplete?.(subject, source.name, finding, finding?.costUsd ?? 0)

      if (finding) {
        costUsd += finding.costUsd
        sourcesSucceeded++
        findings.push({
          ...finding,
          sourceType: source.type,
          sourceName: source.name,
          reliabilityTier: source.reliabilityTier,
          reliabilityScore: source.reliabilityScore,
        })
        break // Stop at first success
      }
    }

    return { findings, sourcesAttempted, sourcesSucceeded, costUsd }
  }

  /**
   * Check whether early stopping criteria are met.
   *
   * Returns a reason string if stopping should occur, or null to continue.
   */
  private checkEarlyStop(allFindings: ScoredFinding[], totalCostUsd: number): string | null {
    const confidenceThreshold =
      this.config.confidenceThreshold ?? DEFAULT_CONFIG.confidenceThreshold
    const reliabilityThreshold =
      this.config.reliabilityThreshold ?? DEFAULT_CONFIG.reliabilityThreshold
    const earlyStopThreshold = this.config.earlyStopThreshold ?? DEFAULT_CONFIG.earlyStopThreshold

    const highQualityFamilies = new Set(
      allFindings
        .filter(
          (f) => f.confidence >= confidenceThreshold && f.reliabilityScore >= reliabilityThreshold
        )
        .map((f) => f.sourceType)
    )

    if (highQualityFamilies.size >= earlyStopThreshold) {
      return `${highQualityFamilies.size} high-quality source families met threshold of ${earlyStopThreshold}`
    }

    if (
      this.config.costLimits?.maxCostPerSubject &&
      totalCostUsd >= this.config.costLimits.maxCostPerSubject
    ) {
      return "cost_limit"
    }

    return null
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
      return this.debrief(subject, { hooks })
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
