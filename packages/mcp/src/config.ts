/**
 * MCP server configuration — reads environment variables with sensible defaults.
 *
 * All env-var parsing is centralised here so the rest of the MCP server
 * can depend on a typed config object rather than raw `process.env` lookups.
 */

export interface McpConfig {
  defaultBudget: number
  defaultModel: string
  anthropicApiKey: string | undefined
}

/**
 * Reads environment variables and returns a validated McpConfig.
 *
 * - DEFAULT_BUDGET: float, default 1.0 (rejects <= 0)
 * - DEFAULT_MODEL: string, default "claude-sonnet-4-20250514"
 * - ANTHROPIC_API_KEY: string or undefined
 */
export function loadConfig(): McpConfig {
  const defaultBudget = safeParseFloat(process.env.DEFAULT_BUDGET, 1.0)
  const defaultModel = process.env.DEFAULT_MODEL || "claude-sonnet-4-20250514"
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || undefined

  return {
    defaultBudget,
    defaultModel,
    anthropicApiKey,
  }
}

/** parseFloat with NaN/Infinity fallback. Only finite values > 0 are accepted. */
function safeParseFloat(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = parseFloat(value)
  return !Number.isFinite(parsed) || parsed <= 0 ? fallback : parsed
}
