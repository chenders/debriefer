/**
 * Debriefer — Multi-source research orchestration engine.
 *
 * Orchestrates 60+ data sources with Wikipedia RSP-based reliability scoring,
 * phased execution with early stopping, per-query cost control, and AI synthesis.
 *
 * @packageDocumentation
 */

// Core engine
export { ResearchOrchestrator } from "./orchestrator.js"
export { BaseResearchSource } from "./base-source.js"
export type { BaseSourceOptions } from "./base-source.js"

// AI synthesis
export { ClaudeSynthesizer, NoopSynthesizer, stripMarkdownCodeFences } from "./synthesizer.js"
export type { ClaudeSynthesizerOptions } from "./synthesizer.js"

// Reliability scoring
export { ReliabilityTier, RELIABILITY_SCORES, getReliabilityScore, meetsReliabilityThreshold } from "./reliability.js"

// Infrastructure
export { SourceRateLimiter } from "./rate-limiter.js"
export type { RateLimiterStats } from "./rate-limiter.js"
export { BatchCostTracker } from "./cost-tracker.js"
export { ParallelBatchRunner } from "./batch-runner.js"
export type { BatchProgress, BatchResult, ParallelBatchRunnerOptions } from "./batch-runner.js"
export { calculateConfidence } from "./confidence.js"

// Cache implementations
export { InMemoryCache } from "./cache/in-memory.js"

// Telemetry implementations
export { ConsoleTelemetry } from "./telemetry/console.js"
export { NoopTelemetry } from "./telemetry/noop.js"

// Types
export type {
  ResearchSubject,
  RawFinding,
  ScoredFinding,
  MinimalSource,
  SourcePhaseGroup,
  SynthesisOptions,
  SynthesisResult,
  Synthesizer,
  DebriefResult,
  ResearchConfig,
  CacheProvider,
  TelemetryProvider,
  TelemetrySpan,
  BatchProgressStats,
  BatchStats,
  LifecycleHooks,
} from "./types.js"

// Error types
export {
  CostLimitExceededError,
  SourceTimeoutError,
  SourceAccessBlockedError,
} from "./types.js"
