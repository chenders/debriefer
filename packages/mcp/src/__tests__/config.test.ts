/**
 * Tests for the MCP configuration module.
 *
 * Verifies env-var parsing with defaults, type coercion,
 * and fallback behaviour for invalid values.
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import { loadConfig } from "../config.js"

afterEach(() => {
  vi.unstubAllEnvs()
})

// ============================================================================
// Defaults
// ============================================================================

describe("loadConfig defaults", () => {
  it("returns default budget of 1.0", () => {
    const config = loadConfig()
    expect(config.defaultBudget).toBe(1.0)
  })

  it("returns default model", () => {
    const config = loadConfig()
    expect(config.defaultModel).toBe("claude-sonnet-4-20250514")
  })

  it("returns undefined anthropicApiKey when not set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "")
    const config = loadConfig()
    expect(config.anthropicApiKey).toBeUndefined()
  })
})

// ============================================================================
// Environment overrides
// ============================================================================

describe("loadConfig environment overrides", () => {
  it("reads budget from environment", () => {
    vi.stubEnv("DEFAULT_BUDGET", "5.50")
    const config = loadConfig()
    expect(config.defaultBudget).toBe(5.5)
  })

  it("reads model from environment", () => {
    vi.stubEnv("DEFAULT_MODEL", "claude-opus-4-20250514")
    const config = loadConfig()
    expect(config.defaultModel).toBe("claude-opus-4-20250514")
  })

  it("reads anthropic key from environment", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-12345")
    const config = loadConfig()
    expect(config.anthropicApiKey).toBe("sk-ant-12345")
  })
})

// ============================================================================
// Budget validation
// ============================================================================

describe("DEFAULT_BUDGET validation", () => {
  it("falls back to default on invalid budget", () => {
    vi.stubEnv("DEFAULT_BUDGET", "abc")
    const config = loadConfig()
    expect(config.defaultBudget).toBe(1.0)
  })

  it("falls back to default on zero budget", () => {
    vi.stubEnv("DEFAULT_BUDGET", "0")
    const config = loadConfig()
    expect(config.defaultBudget).toBe(1.0)
  })

  it("falls back to default on negative budget", () => {
    vi.stubEnv("DEFAULT_BUDGET", "-5")
    const config = loadConfig()
    expect(config.defaultBudget).toBe(1.0)
  })
})
