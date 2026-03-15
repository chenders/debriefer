/**
 * Abstract base class for all research source implementations.
 *
 * Provides common functionality: rate limiting via injected SourceRateLimiter,
 * caching via injected CacheProvider, timeout signal creation, and confidence
 * calculation delegation.
 *
 * Key design differences from deadonfilm's BaseDataSource / BaseBiographySource:
 * - No hardcoded New Relic — uses injected TelemetryProvider
 * - No hardcoded cache module — uses injected CacheProvider
 * - No DataSourceType enum — uses plain string `type`
 * - Keyword lists passed via constructor options, not hardcoded
 * - `buildQuery()` is a simple default consumers override
 * - Generic over TSubject
 */

import { calculateConfidence } from "./confidence.js"
import type { ReliabilityTier } from "./reliability.js"
import { getReliabilityScore } from "./reliability.js"
import type {
  ResearchSubject,
  RawFinding,
  MinimalSource,
  CacheProvider,
  TelemetryProvider,
} from "./types.js"
import type { SourceRateLimiter } from "./rate-limiter.js"

// ============================================================================
// Options
// ============================================================================

export interface BaseSourceOptions {
  /** Keywords — at least one must be present for non-zero confidence */
  requiredKeywords?: string[]
  /** Keywords that increase confidence when found */
  bonusKeywords?: string[]
  /** Minimum delay between requests to this source's domain (ms) */
  rateLimitMs?: number
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number
  /** Whether to ignore cache and make fresh requests */
  ignoreCache?: boolean
  /** Cache TTL in seconds (default: 86400 = 24 hours) */
  cacheTtlSeconds?: number
  /**
   * Custom confidence scorer that replaces keyword-based heuristics.
   * Called when result.confidence is -1 (source delegated scoring).
   * Takes precedence over keyword-based scoring when provided.
   *
   * @param text - The extracted text content from the source
   * @param subject - The research subject being investigated
   * @returns Confidence score from 0.0 to 1.0
   */
  confidenceScorer?: (text: string, subject: ResearchSubject) => Promise<number> | number
}

// ============================================================================
// Base Class
// ============================================================================

/**
 * Abstract base class for research sources.
 *
 * Subclasses must implement:
 * - `name`, `type`, `reliabilityTier`, `domain`, `isFree`, `estimatedCostPerQuery` (abstract properties)
 * - `fetchResult()` (abstract method) — the actual data fetching logic
 *
 * The `lookup()` method orchestrates caching, rate limiting, timeout signals,
 * confidence calculation, and telemetry around the subclass's `fetchResult()`.
 */
export abstract class BaseResearchSource<
  TSubject extends ResearchSubject,
> implements MinimalSource<TSubject> {
  abstract readonly name: string
  abstract readonly type: string
  abstract readonly reliabilityTier: ReliabilityTier
  abstract readonly domain: string
  abstract readonly isFree: boolean
  abstract readonly estimatedCostPerQuery: number

  /** Numeric reliability score (0.0-1.0) derived from the tier */
  get reliabilityScore(): number {
    return getReliabilityScore(this.reliabilityTier)
  }

  protected rateLimiter?: SourceRateLimiter
  protected cache?: CacheProvider
  protected telemetry?: TelemetryProvider
  protected options: BaseSourceOptions

  constructor(options: BaseSourceOptions = {}) {
    this.options = {
      rateLimitMs: 1000,
      timeoutMs: 30000,
      ignoreCache: false,
      cacheTtlSeconds: 86400,
      ...options,
    }
  }

  /** Inject rate limiter (called by orchestrator) */
  setRateLimiter(limiter: SourceRateLimiter): void {
    this.rateLimiter = limiter
  }

  /** Inject cache provider (called by orchestrator) */
  setCache(cache: CacheProvider): void {
    this.cache = cache
  }

  /** Inject telemetry provider (called by orchestrator) */
  setTelemetry(telemetry: TelemetryProvider): void {
    this.telemetry = telemetry
  }

  /** Override to check if required API keys/config are available */
  isAvailable(): boolean {
    return true
  }

  /**
   * Main entry point. Handles caching, rate limiting, timeout, and telemetry.
   * Subclasses implement fetchResult() for the actual lookup.
   *
   * @param subject - The research subject to look up
   * @param signal - Caller-provided abort signal (combined with timeout signal)
   * @returns The raw finding, or null if no relevant data was found or an error occurred
   */
  async lookup(subject: TSubject, signal: AbortSignal): Promise<RawFinding | null> {
    const cacheKey = this.buildCacheKey(subject)

    // Check cache
    if (this.cache && !this.options.ignoreCache) {
      const cached = await this.cache.get(cacheKey)
      if (cached) {
        try {
          return JSON.parse(cached) as RawFinding
        } catch {
          // Invalid cache entry, proceed with fresh lookup
        }
      }
    }

    // Rate limit
    if (this.rateLimiter) {
      await this.rateLimiter.acquire(this.domain, this.options.rateLimitMs!)
    }

    // Create timeout signal and combine with caller signal
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs!)
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

    // Execute lookup with telemetry
    const span = this.telemetry?.startSpan(`source:${this.name}`)
    try {
      const result = await this.fetchResult(subject, combinedSignal)

      // Calculate confidence if not already set by the source (confidence === -1)
      // Priority: confidenceScorer callback > keyword heuristics
      if (result && result.confidence === -1) {
        if (this.options.confidenceScorer) {
          try {
            const raw = await this.options.confidenceScorer(result.text, subject)
            result.confidence = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 0))
          } catch (scorerError) {
            // Scorer failed — record via telemetry and fall through to keyword heuristics
            this.telemetry?.recordError(
              scorerError instanceof Error ? scorerError : new Error(String(scorerError)),
              { source: this.name, subject: subject.name, phase: "confidenceScorer" }
            )
            if (this.options.requiredKeywords) {
              result.confidence = calculateConfidence(
                result.text,
                this.options.requiredKeywords,
                this.options.bonusKeywords
              )
            }
          }
        } else if (this.options.requiredKeywords) {
          result.confidence = calculateConfidence(
            result.text,
            this.options.requiredKeywords,
            this.options.bonusKeywords
          )
        }
      }

      // Cache successful result
      if (this.cache && result) {
        await this.cache.set(cacheKey, JSON.stringify(result), this.options.cacheTtlSeconds)
      }

      return result
    } catch (error) {
      this.telemetry?.recordError(error instanceof Error ? error : new Error(String(error)), {
        source: this.name,
        subject: subject.name,
      })
      return null
    } finally {
      span?.end()
    }
  }

  /** Subclasses implement this — the actual data fetching logic */
  protected abstract fetchResult(subject: TSubject, signal: AbortSignal): Promise<RawFinding | null>

  /** Build search query string for this subject. Override for domain-specific queries. */
  buildQuery(subject: TSubject): string {
    return subject.name
  }

  /** Build a cache key for this subject + source combination */
  protected buildCacheKey(subject: TSubject): string {
    return `debriefer:${this.type}:${subject.id}:${this.buildQuery(subject)}`
  }
}
