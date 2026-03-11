/**
 * Core type definitions for the debriefer research orchestration engine.
 *
 * These types are generalized from deadonfilm's death-sources/types.ts and
 * biography-sources/types.ts. They define the contracts for subjects, findings,
 * sources, synthesis, configuration, lifecycle hooks, and error types that
 * the orchestrator and all source implementations share.
 *
 * Domain-specific types (e.g., ActorForEnrichment, BiographyData) live in
 * consumer code, not here. Consumers extend ResearchSubject and provide their
 * own TOutput type to the orchestrator.
 */

import type { ReliabilityTier } from "./reliability.js"

// ============================================================================
// Subject — the thing being researched
// ============================================================================

/**
 * A research subject is the entity being investigated across multiple sources.
 *
 * Consumers extend this with domain-specific fields via the `context` bag.
 * For example, deadonfilm adds `birthday`, `deathday`, `tmdbId`, etc.
 *
 * @example
 * ```typescript
 * const actor: ResearchSubject = {
 *   id: 2157,
 *   name: "John Wayne",
 *   context: { deathday: "1979-06-11", tmdbId: 2157 },
 * }
 * ```
 */
export interface ResearchSubject {
  /** Unique identifier — string or number depending on domain */
  id: string | number
  /** Display name used in search queries and logging */
  name: string
  /** Domain-specific metadata (birthday, deathday, external IDs, etc.) */
  context?: Record<string, unknown>
}

// ============================================================================
// Findings — raw evidence from a single source
// ============================================================================

/**
 * Raw data extracted from a single source lookup, before reliability scoring.
 *
 * This is what a source returns from its `lookup()` method. The orchestrator
 * then tags it with source reliability info to produce a ScoredFinding.
 */
export interface RawFinding {
  /** Extracted text content from the source */
  text: string
  /** URL of the source page, if applicable */
  url?: string
  /** Publisher name (e.g., "The Guardian", "Wikipedia") */
  publication?: string
  /** Article or page title */
  articleTitle?: string
  /**
   * Content confidence (0-1): how well does this page answer the research question?
   * This is independent of source reliability — a Reuters page about weather
   * has high reliability but zero confidence for death research.
   */
  confidence: number
  /** Cost in USD incurred for this lookup (API fees, etc.) */
  costUsd: number
  /** Arbitrary metadata for debugging or downstream processing */
  metadata?: Record<string, unknown>
}

/**
 * A finding tagged with source reliability information.
 *
 * Created by the orchestrator after a source returns a RawFinding.
 * The reliability fields come from the source's declared tier, not
 * from analyzing the content.
 */
export interface ScoredFinding extends RawFinding {
  /** Source type identifier (e.g., "wikipedia", "google_search") */
  sourceType: string
  /** Human-readable source name (e.g., "Wikipedia", "Google Search") */
  sourceName: string
  /** Reliability tier from the ReliabilityTier enum */
  reliabilityTier: ReliabilityTier
  /**
   * Numeric reliability score (0-1): how trustworthy is this publisher?
   * Based on Wikipedia's Reliable Sources Perennial list (RSP).
   */
  reliabilityScore: number
}

// ============================================================================
// Synthesis — AI distillation of findings into structured output
// ============================================================================

/**
 * Options for AI synthesis of accumulated findings.
 */
export interface SynthesisOptions {
  /** AI model identifier (e.g., "claude-sonnet-4-20250514") */
  model?: string
  /** Maximum tokens for the AI response */
  maxTokens?: number
  /** System prompt guiding the synthesis */
  systemPrompt?: string
}

/**
 * Result of AI synthesis, including the structured output and cost metadata.
 */
export interface SynthesisResult<TOutput> {
  /** The structured output produced by the AI */
  data: TOutput
  /** Cost in USD for this synthesis call */
  costUsd: number
  /** Number of input tokens consumed */
  inputTokens: number
  /** Number of output tokens generated */
  outputTokens: number
  /** Model identifier used for synthesis */
  model: string
}

/**
 * Interface for AI synthesizers that distill findings into structured output.
 *
 * Ships with ClaudeSynthesizer. Consumers can implement for OpenAI, Gemini,
 * local models, or skip AI entirely with a pass-through implementation.
 */
export interface Synthesizer<TSubject extends ResearchSubject, TOutput> {
  synthesize(
    subject: TSubject,
    findings: ScoredFinding[],
    options: SynthesisOptions
  ): Promise<SynthesisResult<TOutput>>
}

// ============================================================================
// Source Phase Groups — sources organized into execution phases
// ============================================================================

/**
 * Minimal source interface used in SourcePhaseGroup to avoid circular
 * dependency with BaseResearchSource (which imports from this file).
 *
 * BaseResearchSource implements this interface. The orchestrator works
 * with BaseResearchSource instances but the type system only needs this
 * minimal contract for phase group definitions.
 */
export interface MinimalSource<TSubject extends ResearchSubject> {
  /** Machine-readable source identifier (e.g., "wikipedia", "google_search") */
  readonly name: string
  /** Source type string matching a registry key */
  readonly type: string
  /** Reliability tier from the ReliabilityTier enum */
  readonly reliabilityTier: ReliabilityTier
  /** Numeric reliability score (0-1) */
  readonly reliabilityScore: number
  /** Whether this source is free to query */
  readonly isFree: boolean
  /** Estimated cost per query in USD */
  readonly estimatedCostPerQuery: number
  /** Domain for rate limiting coordination (e.g., "en.wikipedia.org") */
  readonly domain: string
  /** Check if this source is available (API key configured, etc.) */
  isAvailable(): boolean
  /**
   * Look up information about a subject.
   * Returns null if no relevant information was found.
   */
  lookup(subject: TSubject, signal: AbortSignal): Promise<RawFinding | null>
}

/**
 * A group of sources that execute together in a single phase.
 *
 * The orchestrator processes phases sequentially. Within each phase,
 * sources run concurrently via Promise.allSettled() by default. When
 * `sequential` is true, sources run one at a time in order, stopping
 * at the first source that returns a non-null finding.
 */
export interface SourcePhaseGroup<TSubject extends ResearchSubject> {
  /** Phase number — determines execution order (lower = earlier) */
  phase: number
  /** Human-readable phase name for logging (e.g., "Structured Data", "Web Search") */
  name?: string
  /** Sources to execute within this phase (concurrently by default, or sequentially when `sequential: true`) */
  sources: ReadonlyArray<MinimalSource<TSubject>>
  /**
   * If true, execute sources sequentially within this phase instead of
   * concurrently. Stops at the first source that returns a non-null finding.
   * Useful for AI model sources where you want cheapest-first with early exit.
   */
  sequential?: boolean
}

// ============================================================================
// Debrief Results — output of researching a single subject
// ============================================================================

/**
 * Complete result of debriefing (researching) a single subject.
 *
 * Contains the synthesized output, all collected findings, cost tracking,
 * and execution metadata.
 */
export interface DebriefResult<TOutput> {
  /** The subject that was researched */
  subject: ResearchSubject
  /** Synthesized output, or null if synthesis failed or was skipped */
  data: TOutput | null
  /** All scored findings collected across all phases */
  findings: ScoredFinding[]
  /** Synthesis result with token counts and cost, if synthesis ran */
  synthesisResult?: SynthesisResult<TOutput>
  /** Total cost in USD across all source lookups and synthesis */
  totalCostUsd: number
  /** Number of sources that were attempted */
  sourcesAttempted: number
  /** Number of sources that returned findings */
  sourcesSucceeded: number
  /** Phase number where early stopping occurred, if applicable */
  stoppedAtPhase?: number
  /** Total wall-clock time in milliseconds */
  durationMs: number
}

// ============================================================================
// Research Configuration
// ============================================================================

/**
 * Configuration for the research orchestrator.
 *
 * All fields are optional — the orchestrator provides sensible defaults.
 */
export interface ResearchConfig {
  /**
   * Source category flags (e.g., { free: true, news: true, ai: false }).
   * Categories are domain-specific — consumer code uses these when constructing
   * phase groups to decide which sources to include. The orchestrator stores
   * this config for lifecycle hooks but does not filter sources itself.
   */
  categories?: Record<string, boolean>
  /** Number of subjects to process concurrently in batch mode (default: 5, range: 1-20) */
  concurrency?: number
  /** Minimum content confidence to count as a quality finding (default: 0.6) */
  confidenceThreshold?: number
  /** Minimum source reliability to count as a quality finding (default: 0.6) */
  reliabilityThreshold?: number
  /**
   * Number of high-quality source families needed before early stopping (default: 3).
   * A "source family" is a unique sourceType — multiple findings from the same
   * source type count as one family.
   */
  earlyStopThreshold?: number
  /** Cost limits to prevent runaway spending */
  costLimits?: {
    /** Maximum cost per subject in USD — stops processing that subject */
    maxCostPerSubject?: number
    /** Maximum total cost for the entire batch in USD — stops the batch */
    maxTotalCost?: number
  }
  /** AI synthesis options */
  synthesis?: SynthesisOptions
  /** Cache provider for source-level result caching */
  cache?: CacheProvider
  /** Telemetry provider for events, spans, and error recording */
  telemetry?: TelemetryProvider
}

// ============================================================================
// Cache Provider
// ============================================================================

/**
 * Interface for caching source lookup results.
 *
 * Ships with InMemoryCache. Consumers can provide RedisCache, SqliteCache,
 * or any other implementation.
 */
export interface CacheProvider {
  /** Get a cached value by key. Returns null on cache miss. */
  get(key: string): Promise<string | null>
  /** Set a cached value with optional TTL in seconds. */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>
  /** Delete a cached value. */
  delete(key: string): Promise<void>
}

// ============================================================================
// Telemetry Provider
// ============================================================================

/**
 * A telemetry span for timing operations.
 */
export interface TelemetrySpan {
  /** End the span timing. */
  end(): void
  /** Attach attributes to the span (e.g., source name, cost). */
  setAttributes(attrs: Record<string, string | number | boolean>): void
}

/**
 * Interface for recording telemetry events, spans, and errors.
 *
 * Ships with ConsoleTelemetry and NoopTelemetry. Consumers can provide
 * OpenTelemetryProvider, New Relic, Datadog, etc.
 */
export interface TelemetryProvider {
  /** Record a named event with arbitrary data. */
  recordEvent(name: string, data: Record<string, unknown>): void
  /** Start a named timing span. Call span.end() when done. */
  startSpan(name: string): TelemetrySpan
  /** Record an error with optional context. */
  recordError(error: Error, context?: Record<string, unknown>): void
}

// ============================================================================
// Batch Progress and Stats
// ============================================================================

/**
 * Progress stats emitted during batch processing.
 */
export interface BatchProgressStats {
  /** Number of subjects completed so far */
  completed: number
  /** Total number of subjects in the batch */
  total: number
  /** Total cost in USD so far */
  costUsd: number
  /** Elapsed time in milliseconds since batch start */
  elapsedMs: number
}

/**
 * Final stats after a batch completes.
 */
export interface BatchStats extends BatchProgressStats {
  /** Number of subjects that produced a result */
  succeeded: number
  /** Number of subjects that failed */
  failed: number
  /** Average cost per subject in USD */
  avgCostPerSubject: number
  /** Average duration per subject in milliseconds */
  avgDurationMs: number
}

// ============================================================================
// Lifecycle Hooks — all optional
// ============================================================================

/**
 * Lifecycle hooks for observability and integration during batch processing.
 *
 * All hooks are optional. Consumers wire up what they need: database writes,
 * progress bars, logging, monitoring dashboards, etc.
 *
 * Hook naming follows the pattern: on{Event}{Timing}
 * - Start/Complete for paired begin/end events
 * - No suffix for point-in-time events
 */
export interface LifecycleHooks<TSubject extends ResearchSubject, TOutput> {
  /** Fired once at the start of a batch run */
  onRunStart?(subjectCount: number, config: ResearchConfig): void
  /** Fired before processing each subject */
  onSubjectStart?(subject: TSubject, index: number, total: number): void
  /** Fired before each source lookup */
  onSourceAttempt?(subject: TSubject, sourceName: string, phase: number): void
  /** Fired after each source lookup completes (success or failure) */
  onSourceComplete?(
    subject: TSubject,
    sourceName: string,
    finding: RawFinding | null,
    costUsd: number
  ): void
  /** Fired after all sources in a phase complete */
  onPhaseComplete?(subject: TSubject, phase: number, findingsInPhase: ScoredFinding[]): void
  /** Fired when early stopping is triggered */
  onEarlyStop?(subject: TSubject, phase: number, reason: string): void
  /** Fired before AI synthesis begins */
  onSynthesisStart?(subject: TSubject, findingCount: number): void
  /** Fired after AI synthesis completes */
  onSynthesisComplete?(subject: TSubject, result: SynthesisResult<TOutput>): void
  /** Fired after processing each subject (success or failure) */
  onSubjectComplete?(subject: TSubject, result: DebriefResult<TOutput>): void
  /** Fired periodically during batch processing with progress stats */
  onBatchProgress?(stats: BatchProgressStats): void
  /** Fired when a cost limit is reached */
  onCostLimitReached?(subject: TSubject, costUsd: number, limit: number): void
  /** Fired once when the batch run completes successfully */
  onRunComplete?(stats: BatchStats): void
  /** Fired if the batch run fails with an unrecoverable error */
  onRunFailed?(error: Error): void
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when a cost limit is exceeded during research.
 *
 * Can be thrown for per-subject limits (stops that subject) or total batch
 * limits (stops the entire batch).
 *
 * @example
 * ```typescript
 * try {
 *   await orchestrator.debriefBatch(subjects)
 * } catch (error) {
 *   if (error instanceof CostLimitExceededError) {
 *     console.log(`Cost limit: $${error.costUsd.toFixed(4)} > $${error.limit.toFixed(4)}`)
 *   }
 * }
 * ```
 */
export class CostLimitExceededError extends Error {
  readonly name = "CostLimitExceededError"

  constructor(
    /** ID of the subject being processed when the limit was hit */
    public readonly subjectId: string | number,
    /** The cost in USD that triggered the limit */
    public readonly costUsd: number,
    /** The configured limit that was exceeded in USD */
    public readonly limit: number
  ) {
    super(
      `Cost limit exceeded for subject ${subjectId}: $${costUsd.toFixed(4)} > $${limit.toFixed(4)}`
    )
  }
}

/**
 * Error thrown when a source request times out.
 *
 * The orchestrator catches this and continues with remaining sources.
 * High-priority source timeouts may be logged for investigation.
 *
 * @example
 * ```typescript
 * throw new SourceTimeoutError("Wikipedia", 30000)
 * ```
 */
export class SourceTimeoutError extends Error {
  readonly name = "SourceTimeoutError"

  constructor(
    /** Name of the source that timed out */
    public readonly sourceName: string,
    /** Timeout duration in milliseconds */
    public readonly timeoutMs: number
  ) {
    super(`Source ${sourceName} timed out after ${timeoutMs}ms`)
  }
}

/**
 * Error thrown when a source access is blocked (403, 429, etc.).
 *
 * The orchestrator catches this and caches the blocked status to avoid
 * re-hitting the same source. Blocked sources should be investigated
 * for alternative access methods (browser automation, API access, etc.).
 *
 * @example
 * ```typescript
 * throw new SourceAccessBlockedError("NYTimes", 403)
 * ```
 */
export class SourceAccessBlockedError extends Error {
  readonly name = "SourceAccessBlockedError"

  constructor(
    /** Name of the source that blocked access */
    public readonly sourceName: string,
    /** HTTP status code (403, 429, etc.) */
    public readonly statusCode: number
  ) {
    super(`Source ${sourceName} blocked with status ${statusCode}`)
  }
}
