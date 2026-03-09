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
}

/**
 * Reads environment variables and returns a validated ServerConfig.
 *
 * - PORT: integer, default 8090
 * - DEBRIEFER_API_KEYS: comma-separated tokens, default []
 * - DEFAULT_BUDGET: float, default 1.0
 * - DEFAULT_MODEL: string, default "claude-sonnet-4-20250514"
 * - ANTHROPIC_API_KEY: string or undefined
 */
export function loadConfig(): ServerConfig {
  const port = safeParseInt(process.env.PORT, 8090)
  const apiKeys = (process.env.DEBRIEFER_API_KEYS ?? "").split(",").filter((k) => k.length > 0)
  const defaultBudget = safeParseFloat(process.env.DEFAULT_BUDGET, 1.0)
  const defaultModel = process.env.DEFAULT_MODEL || "claude-sonnet-4-20250514"
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || undefined

  return {
    port,
    apiKeys,
    authEnabled: apiKeys.length > 0,
    defaultBudget,
    defaultModel,
    anthropicApiKey,
  }
}

/** parseInt with NaN fallback. */
function safeParseInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

/** parseFloat with NaN fallback. */
function safeParseFloat(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = parseFloat(value)
  return Number.isNaN(parsed) ? fallback : parsed
}
