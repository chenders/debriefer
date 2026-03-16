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
import { htmlToText } from "./html-utils.js"
import { setBrowserAuthConfig, expandHomePath } from "./auth/config.js"

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

// Re-export auth utilities
export {
  expandHomePath,
  loadBrowserAuthConfig,
  getBrowserAuthConfig,
  setBrowserAuthConfig,
  resetBrowserAuthConfig,
  hasAnyCredentials,
  hasCredentialsForSite,
  hasCaptchaSolver,
} from "./auth/config.js"
export {
  loadSession,
  saveSession,
  isSessionValid,
  applySessionToContext,
  touchSession,
  deleteSession,
  listSessions,
  clearExpiredSessions,
  getSessionInfo,
} from "./auth/session-manager.js"
export { BaseLoginHandler } from "./auth/base-handler.js"
export { NYTimesLoginHandler } from "./auth/handlers/nytimes.js"
export { WashingtonPostLoginHandler } from "./auth/handlers/washingtonpost.js"

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

    // WebSearchBase.fetchPage expects extracted text (it skips extractArticleContent
    // when a custom fetchPage is provided). Direct fetch returns raw HTML, so strip it.
    // Archive fallbacks already return extracted text.
    if (result.fetchMethod === "direct") {
      return htmlToText(result.content)
    }

    return result.content
  }
}

// ============================================================================
// createBrowserDefaults
// ============================================================================

/**
 * Options for creating browser defaults with auth and session management.
 */
export interface BrowserDefaultsOptions extends BrowserFetchPageFactoryOptions {
  /** Site credentials for authenticated access. */
  credentials?: {
    "nytimes.com"?: { email: string; password: string }
    "washingtonpost.com"?: { email: string; password: string }
  }
  /** Session storage path. Default: ~/.debriefer/sessions/ */
  sessionPath?: string
  /** Session TTL in hours. Default: 24. */
  sessionTtlHours?: number
}

/**
 * Browser defaults with fetchPage and session management.
 */
export interface BrowserDefaults {
  /** fetchPage callback with full fallback chain. */
  fetchPage: (url: string, signal: AbortSignal) => Promise<string | null>
  /** Login to a site and persist the session. */
  login: (site: "nytimes.com" | "washingtonpost.com") => Promise<import("./types.js").LoginResult>
  /** Clear expired sessions from disk. */
  clearExpiredSessions: () => Promise<number>
}

/**
 * Create browser defaults with fetchPage, login, and session management.
 *
 * @example
 * ```typescript
 * import { createBrowserDefaults } from "@debriefer/browser"
 *
 * const browser = createBrowserDefaults({
 *   captchaSolver: { provider: "2captcha", apiKey: "..." },
 *   credentials: {
 *     "nytimes.com": { email: "...", password: "..." },
 *   },
 * })
 *
 * const google = googleSearch({ fetchPage: browser.fetchPage })
 * await browser.login("nytimes.com")
 * ```
 */
export function createBrowserDefaults(options: BrowserDefaultsOptions = {}): BrowserDefaults {
  // Configure auth if credentials provided
  if (options.credentials) {
    setBrowserAuthConfig({
      enabled: true,
      sessionStoragePath: expandHomePath(options.sessionPath ?? "~/.debriefer/sessions"),
      sessionTtlHours: options.sessionTtlHours ?? 24,
      credentials: {
        nytimes: options.credentials["nytimes.com"],
        washingtonpost: options.credentials["washingtonpost.com"],
      },
      captchaSolver: options.captchaSolver?.apiKey
        ? {
            provider: options.captchaSolver.provider,
            apiKey: options.captchaSolver.apiKey,
            timeoutMs: options.captchaSolver.timeoutMs,
            maxCostPerSolve: options.captchaSolver.maxCostPerSolve,
          }
        : undefined,
    })
  }

  const fetchPage = createBrowserFetchPage(options)

  return {
    fetchPage,

    async login(site) {
      const { chromium } = await import("playwright-core")
      const { createStealthContext } = await import("./stealth.js")
      const { getBrowserAuthConfig } = await import("./auth/config.js")
      const { saveSession } = await import("./auth/session-manager.js")

      const config = getBrowserAuthConfig()
      const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      })

      try {
        const context = await createStealthContext(browser)
        const page = await context.newPage()

        let handler: import("./types.js").LoginHandler
        if (site === "nytimes.com") {
          const { NYTimesLoginHandler } = await import("./auth/handlers/nytimes.js")
          handler = new NYTimesLoginHandler()
        } else {
          const { WashingtonPostLoginHandler } = await import("./auth/handlers/washingtonpost.js")
          handler = new WashingtonPostLoginHandler()
        }

        const result = await handler.login(page, config.captchaSolver)

        if (result.success) {
          await saveSession(site, context)
        }

        return result
      } finally {
        await browser.close()
      }
    },

    async clearExpiredSessions() {
      const { clearExpiredSessions: clear } = await import("./auth/session-manager.js")
      return clear()
    },
  }
}
