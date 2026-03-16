/**
 * @debriefer/browser — Browser stealth, CAPTCHA solving, and archive fallbacks.
 *
 * Provides `createBrowserFetchPage()` which returns a `fetchPage` callback
 * compatible with `@debriefer/sources` WebSearchOptions. Uses a 4-step
 * fallback chain: direct fetch → archive.org → archive.is → browser + CAPTCHA.
 *
 * @packageDocumentation
 */

import type { CaptchaSolverConfig, CaptchaSolverProvider } from "./types.js"
import { fetchPageWithFallbacks } from "./archives/fallback-chain.js"

// Re-export types
export type {
  CaptchaType,
  CaptchaDetectionResult,
  CaptchaSolverConfig,
  CaptchaSolverProvider,
  CaptchaSolveResult,
  ArchiveAvailability,
  ArchiveFetchResult,
  BrowserFetchPageOptions,
  BrowserFetchPageResult,
  StoredCookie,
  StoredSession,
  SessionManagerConfig,
  SiteCredential,
  SiteCredentials,
  SupportedSite,
  LoginResult,
  LoginHandler,
  BrowserAuthConfig,
  AuthenticatedContextResult,
} from "./types.js"

// Re-export stealth utilities
export {
  createStealthContext,
  applyStealthToContext,
  applyStealthToPage,
  getStealthLaunchArgs,
} from "./stealth.js"

// Re-export CAPTCHA utilities
export { detectCaptcha, waitForCaptcha, isChallengePage } from "./captcha/detector.js"
export { solveCaptcha, injectCaptchaToken, getBalance } from "./captcha/solver.js"

// Re-export archive utilities
export {
  fetchFromArchiveOrg,
  checkArchiveAvailability,
  getArchiveUrl,
} from "./archives/archive-org.js"
export {
  fetchFromArchiveIs,
  checkArchiveIsAvailability,
  searchArchiveIsWithBrowser,
} from "./archives/archive-is.js"
export { fetchPageWithFallbacks } from "./archives/fallback-chain.js"

// ============================================================================
// createBrowserFetchPage
// ============================================================================

/**
 * Options for creating a browser-powered fetchPage callback.
 */
export interface BrowserFetchPageFactoryOptions {
  /** CAPTCHA solver configuration for archive.is browser fallback. */
  captchaSolver?: {
    provider: CaptchaSolverProvider
    apiKey: string
    timeoutMs?: number
    maxCostPerSolve?: number
  }
  /** Default timeout for page fetches in milliseconds. Default: 15000. */
  timeoutMs?: number
  /** Custom User-Agent header. */
  userAgent?: string
}

/**
 * Create a `fetchPage` callback compatible with `@debriefer/sources` WebSearchOptions.
 *
 * Returns a function that fetches pages using a 4-step fallback chain:
 * 1. Direct fetch with browser-like headers
 * 2. archive.org (Wayback Machine)
 * 3. archive.is (HTTP)
 * 4. archive.is (browser + CAPTCHA solver) — if captchaSolver is configured
 *
 * @example
 * ```typescript
 * import { createBrowserFetchPage } from "@debriefer/browser"
 * import { googleSearch } from "@debriefer/sources"
 *
 * const fetchPage = createBrowserFetchPage({
 *   captchaSolver: { provider: "2captcha", apiKey: process.env.TWOCAPTCHA_API_KEY },
 * })
 *
 * const google = googleSearch({ fetchPage })
 * ```
 */
export function createBrowserFetchPage(
  options: BrowserFetchPageFactoryOptions = {}
): (url: string, signal: AbortSignal) => Promise<string | null> {
  const captchaSolver: CaptchaSolverConfig | undefined = options.captchaSolver?.apiKey
    ? {
        provider: options.captchaSolver.provider,
        apiKey: options.captchaSolver.apiKey,
        timeoutMs: options.captchaSolver.timeoutMs ?? 120000,
        maxCostPerSolve: options.captchaSolver.maxCostPerSolve ?? 0.01,
      }
    : undefined

  return async (url: string, signal: AbortSignal): Promise<string | null> => {
    const result = await fetchPageWithFallbacks(
      url,
      {
        signal,
        timeoutMs: options.timeoutMs ?? 15000,
        userAgent: options.userAgent,
      },
      captchaSolver
    )

    if (result.fetchMethod === "none" || !result.content) {
      return null
    }

    return result.content
  }
}
