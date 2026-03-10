/**
 * Server configuration — reads environment variables with sensible defaults.
 *
 * All env-var parsing is centralised here so the rest of the server
 * can depend on a typed config object rather than raw `process.env` lookups.
 */

export interface ServerConfig {
  port: number
  apiKeys: string[]
  authEnabled: boolean
  defaultBudget: number
  defaultModel: string
  anthropicApiKey: string | undefined
  corsOrigin: string | undefined
}

/**
 * Reads environment variables and returns a validated ServerConfig.
 *
 * - PORT: integer, default 8090
 * - DEBRIEFER_API_KEYS: comma-separated tokens, default []
 * - DEFAULT_BUDGET: float, default 1.0
 * - DEFAULT_MODEL: string, default "claude-sonnet-4-20250514"
 * - ANTHROPIC_API_KEY: string or undefined
 * - CORS_ORIGIN: allowed origin for CORS, default permissive (*)
 */
export function loadConfig(): ServerConfig {
  const port = safeParsePort(process.env.PORT, 8090)
  const apiKeys = (process.env.DEBRIEFER_API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
  const defaultBudget = safeParseFloat(process.env.DEFAULT_BUDGET, 1.0)
  const defaultModel = process.env.DEFAULT_MODEL || "claude-sonnet-4-20250514"
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || undefined
  const corsOrigin = process.env.CORS_ORIGIN || undefined

  return {
    port,
    apiKeys,
    authEnabled: apiKeys.length > 0,
    defaultBudget,
    defaultModel,
    anthropicApiKey,
    corsOrigin,
  }
}

/** parseInt with NaN fallback. Values outside 1–65535 fall back to the default. */
function safeParsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = parseInt(value, 10)
  return Number.isNaN(parsed) || parsed < 1 || parsed > 65535 ? fallback : parsed
}

/** parseFloat with NaN fallback. Values ≤ 0 fall back to the default. */
function safeParseFloat(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = parseFloat(value)
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed
}
