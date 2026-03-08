/**
 * Source reliability scoring based on Wikipedia's Reliable Sources Perennial list (RSP).
 * https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources
 *
 * RSP is a community-maintained assessment of source trustworthiness for encyclopedic use.
 * We map their ratings to numeric scores (0.0-1.0).
 *
 * This is independent from content confidence:
 * - Reliability = "how trustworthy is this publisher?" (Reuters vs TMZ)
 * - Confidence = "does this specific page answer the question?" (Reuters weather article vs Reuters obituary)
 */

export enum ReliabilityTier {
  /** Wikidata, government databases: community-curated structured data */
  STRUCTURED_DATA = "structured_data",
  /** AP, NYT, BBC, Guardian, Reuters, WaPo: independent, fact-checking reputation */
  TIER_1_NEWS = "tier_1_news",
  /** Variety, Deadline, THR, BFI, Nature, Lancet: reliable within their domain */
  TRADE_PRESS = "trade_press",
  /** Trove, Europeana, Chronicling America: institutional archives */
  ARCHIVAL = "archival",
  /** Wikipedia: secondary compilation, varies by article */
  SECONDARY_COMPILATION = "secondary",
  /** Google, Bing, DDG, Brave, NewsAPI: depends on linked pages */
  SEARCH_AGGREGATOR = "search_aggregator",
  /** Internet Archive: mirrors of other sources */
  ARCHIVE_MIRROR = "archive_mirror",
  /** People Magazine: celebrity magazine, decent for announcements */
  MARGINAL_EDITORIAL = "marginal_editorial",
  /** Legacy.com, FamilySearch: mix of official and user-submitted */
  MARGINAL_MIXED = "marginal_mixed",
  /** Claude, GPT, Gemini: hallucination risk, no original reporting */
  AI_MODEL = "ai_model",
  /** TMZ: fast on announcements, weak on cause details */
  UNRELIABLE_FAST = "unreliable_fast",
  /** Find a Grave: user-generated, no editorial oversight */
  UNRELIABLE_UGC = "unreliable_ugc",
}

/**
 * Numeric reliability scores for each tier (0.0-1.0).
 *
 * Higher scores indicate more trustworthy publishers. These are based on
 * Wikipedia's RSP community assessments mapped to our tier system.
 */
export const RELIABILITY_SCORES: Record<ReliabilityTier, number> = {
  [ReliabilityTier.STRUCTURED_DATA]: 1.0,
  [ReliabilityTier.TIER_1_NEWS]: 0.95,
  [ReliabilityTier.TRADE_PRESS]: 0.9,
  [ReliabilityTier.ARCHIVAL]: 0.9,
  [ReliabilityTier.SECONDARY_COMPILATION]: 0.85,
  [ReliabilityTier.SEARCH_AGGREGATOR]: 0.7,
  [ReliabilityTier.ARCHIVE_MIRROR]: 0.7,
  [ReliabilityTier.MARGINAL_EDITORIAL]: 0.65,
  [ReliabilityTier.MARGINAL_MIXED]: 0.6,
  [ReliabilityTier.AI_MODEL]: 0.55,
  [ReliabilityTier.UNRELIABLE_FAST]: 0.5,
  [ReliabilityTier.UNRELIABLE_UGC]: 0.35,
}

/** Get the numeric reliability score for a tier */
export function getReliabilityScore(tier: ReliabilityTier): number {
  return RELIABILITY_SCORES[tier]
}

/** Check if a source meets a minimum reliability threshold */
export function meetsReliabilityThreshold(tier: ReliabilityTier, threshold: number): boolean {
  return RELIABILITY_SCORES[tier] >= threshold
}
