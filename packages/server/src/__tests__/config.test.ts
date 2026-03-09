/**
 * Tests for the server configuration module.
 *
 * Verifies env-var parsing with defaults, type coercion,
 * API key splitting with empty-segment filtering, and authEnabled derivation.
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
  it("returns default port 8090", () => {
    const config = loadConfig()
    expect(config.port).toBe(8090)
  })

  it("returns empty apiKeys by default", () => {
    const config = loadConfig()
    expect(config.apiKeys).toEqual([])
  })

  it("returns authEnabled false when no keys", () => {
    const config = loadConfig()
    expect(config.authEnabled).toBe(false)
  })

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
// PORT
// ============================================================================

describe("PORT env var", () => {
  it("reads PORT from environment", () => {
    vi.stubEnv("PORT", "3000")
    const config = loadConfig()
    expect(config.port).toBe(3000)
  })

  it("falls back to default on invalid PORT", () => {
    vi.stubEnv("PORT", "not-a-number")
    const config = loadConfig()
    expect(config.port).toBe(8090)
  })
})

// ============================================================================
// API Keys
// ============================================================================

describe("DEBRIEFER_API_KEYS env var", () => {
  it("splits comma-separated keys", () => {
    vi.stubEnv("DEBRIEFER_API_KEYS", "key1,key2,key3")
    const config = loadConfig()
    expect(config.apiKeys).toEqual(["key1", "key2", "key3"])
  })

  it("filters empty segments", () => {
    vi.stubEnv("DEBRIEFER_API_KEYS", "key1,,key2,,,key3,")
    const config = loadConfig()
    expect(config.apiKeys).toEqual(["key1", "key2", "key3"])
  })

  it("sets authEnabled true when keys present", () => {
    vi.stubEnv("DEBRIEFER_API_KEYS", "secret")
    const config = loadConfig()
    expect(config.authEnabled).toBe(true)
  })

  it("sets authEnabled false when only empty segments", () => {
    vi.stubEnv("DEBRIEFER_API_KEYS", ",,")
    const config = loadConfig()
    expect(config.authEnabled).toBe(false)
  })
})

// ============================================================================
// DEFAULT_BUDGET
// ============================================================================

describe("DEFAULT_BUDGET env var", () => {
  it("reads budget from environment", () => {
    vi.stubEnv("DEFAULT_BUDGET", "5.50")
    const config = loadConfig()
    expect(config.defaultBudget).toBe(5.5)
  })

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

// ============================================================================
// DEFAULT_MODEL
// ============================================================================

describe("DEFAULT_MODEL env var", () => {
  it("reads model from environment", () => {
    vi.stubEnv("DEFAULT_MODEL", "claude-opus-4-20250514")
    const config = loadConfig()
    expect(config.defaultModel).toBe("claude-opus-4-20250514")
  })
})

// ============================================================================
// ANTHROPIC_API_KEY
// ============================================================================

describe("ANTHROPIC_API_KEY env var", () => {
  it("reads anthropic key from environment", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-12345")
    const config = loadConfig()
    expect(config.anthropicApiKey).toBe("sk-ant-12345")
  })
})
