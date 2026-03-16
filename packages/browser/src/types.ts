/**
 * Type definitions for browser automation, CAPTCHA solving, and session management.
 */

import type { BrowserContext, Page } from "playwright-core"

// ============================================================================
// CAPTCHA Types
// ============================================================================

/** Types of CAPTCHAs we can detect and solve. */
export type CaptchaType =
  | "recaptcha_v2"
  | "recaptcha_v3"
  | "hcaptcha"
  | "perimeterx"
  | "datadome"
  | "unknown"

/** Result from CAPTCHA detection. */
export interface CaptchaDetectionResult {
  detected: boolean
  type: CaptchaType | null
  siteKey: string | null
  /** CSS selector where the CAPTCHA is located */
  selector: string | null
  /** Additional context about the CAPTCHA */
  context?: string
  /** DataDome captcha URL (required for DataDome solving) */
  datadomeUrl?: string
  /** DataDome cookie for solving */
  datadomeCookie?: string
}

/** CAPTCHA solving service provider. */
export type CaptchaSolverProvider = "2captcha" | "capsolver"

/** Configuration for CAPTCHA solving service. */
export interface CaptchaSolverConfig {
  provider: CaptchaSolverProvider
  apiKey: string
  /** Timeout in milliseconds for solving (default: 120000) */
  timeoutMs: number
  /** Maximum cost per solve in USD (default: 0.01) */
  maxCostPerSolve: number
}

/** Result from CAPTCHA solving. */
export interface CaptchaSolveResult {
  success: boolean
  token: string | null
  type: CaptchaType
  /** Cost incurred in USD */
  costUsd: number
  /** Time taken in milliseconds */
  solveTimeMs: number
  error?: string
}

// ============================================================================
// Session Management
// ============================================================================

/** Serialized cookie for storage. */
export interface StoredCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: "Strict" | "Lax" | "None"
}

/** Persisted session data for a domain. */
export interface StoredSession {
  domain: string
  cookies: StoredCookie[]
  createdAt: string
  lastUsedAt: string
  loginEmail?: string
}

/** Session manager configuration. */
export interface SessionManagerConfig {
  /** Directory to store session files (default: ~/.debriefer/sessions/) */
  storagePath: string
  /** Session TTL in hours (default: 24) */
  ttlHours: number
}

// ============================================================================
// Site Credentials
// ============================================================================

/** Credentials for a single site. */
export interface SiteCredential {
  email: string
  password: string
}

/** Collection of site credentials. */
export interface SiteCredentials {
  nytimes?: SiteCredential
  washingtonpost?: SiteCredential
}

/** Supported site identifiers for authentication. */
export type SupportedSite = keyof SiteCredentials

// ============================================================================
// Login Handler Types
// ============================================================================

/** Result from a login attempt. */
export interface LoginResult {
  success: boolean
  error?: string
  captchaEncountered: boolean
  captchaSolved?: boolean
  captchaCostUsd?: number
}

/** Interface for site-specific login handlers. */
export interface LoginHandler {
  readonly domain: string
  readonly siteName: string
  hasCredentials(): boolean
  login(page: Page, captchaSolver?: CaptchaSolverConfig): Promise<LoginResult>
  verifySession(page: Page): Promise<boolean>
}

// ============================================================================
// Browser Auth Configuration
// ============================================================================

/** Complete configuration for browser authentication. */
export interface BrowserAuthConfig {
  enabled: boolean
  sessionStoragePath: string
  sessionTtlHours: number
  credentials: SiteCredentials
  captchaSolver?: CaptchaSolverConfig
}

/** Default browser auth configuration. */
export const DEFAULT_BROWSER_AUTH_CONFIG: BrowserAuthConfig = {
  enabled: false,
  sessionStoragePath: "~/.debriefer/sessions",
  sessionTtlHours: 24,
  credentials: {},
}

// ============================================================================
// Context Types
// ============================================================================

/** Result from getting an authenticated context. */
export interface AuthenticatedContextResult {
  context: BrowserContext
  loginPerformed: boolean
  sessionRestored: boolean
  costUsd: number
  site?: SupportedSite
}

// ============================================================================
// Archive Types
// ============================================================================

/** Result from checking archive availability. */
export interface ArchiveAvailability {
  available: boolean
  url: string | null
  timestamp: string | null
  status: number | null
}

/** Result from fetching archived content. */
export interface ArchiveFetchResult {
  success: boolean
  url: string
  archiveUrl: string | null
  title: string
  content: string
  contentLength: number
  timestamp: string | null
  error?: string
}

// ============================================================================
// Fetch Page Types
// ============================================================================

/** Options for fetching a page with the full fallback chain. */
export interface BrowserFetchPageOptions {
  /** Custom User-Agent header */
  userAgent?: string
  /** Additional headers to include in the direct fetch */
  headers?: Record<string, string>
  /** Timeout in milliseconds (default: 15000) */
  timeoutMs?: number
  /** AbortSignal for cancellation */
  signal?: AbortSignal
}

/** Result from fetching a page with fallbacks. */
export interface BrowserFetchPageResult {
  /** Fetched page content (HTML or extracted text) */
  content: string
  /** Page title extracted from HTML */
  title: string
  /** Final URL (may differ from input if archive was used) */
  url: string
  /** Which fetch method succeeded */
  fetchMethod: "direct" | "archive.org" | "archive.is" | "archive.is-browser" | "none"
  /** Error message if all methods failed */
  error?: string
}
