/**
 * Tests for the debrief tool handler.
 *
 * Mocks the core `debriefer` module to avoid real API calls and
 * verifies synthesizer selection, config passing, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ============================================================================
// Module mock — must be before any import of the module under test
// ============================================================================

vi.mock("debriefer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("debriefer")>()
  return {
    ...actual,
    ResearchOrchestrator: vi.fn().mockImplementation(() => ({
      debrief: vi.fn().mockResolvedValue({
        subject: { id: "Test", name: "Test" },
        data: null,
        findings: [],
        totalCostUsd: 0,
        sourcesAttempted: 2,
        sourcesSucceeded: 0,
        durationMs: 100,
      }),
    })),
    ClaudeSynthesizer: vi.fn().mockImplementation(() => ({})),
    NoopSynthesizer: vi.fn().mockImplementation(() => ({})),
  }
})

import { debriefHandler } from "../../tools/debrief.js"
import { ResearchOrchestrator, ClaudeSynthesizer, NoopSynthesizer } from "debriefer"
import type { McpConfig } from "../../config.js"

// ============================================================================
// Setup
// ============================================================================

const baseConfig: McpConfig = {
  defaultBudget: 1.0,
  defaultModel: "claude-sonnet-4-20250514",
  anthropicApiKey: undefined,
}

beforeEach(() => {
  vi.mocked(ResearchOrchestrator).mockClear()
  vi.mocked(ClaudeSynthesizer).mockClear()
  vi.mocked(NoopSynthesizer).mockClear()
})

// ============================================================================
// Successful result
// ============================================================================

describe("debriefHandler — success", () => {
  it("returns structured result as JSON", async () => {
    const result = await debriefHandler({ name: "Test" }, baseConfig)
    expect(result.isError).toBeUndefined()
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")

    const data = JSON.parse((result.content[0] as { type: "text"; text: string }).text)
    expect(data).toHaveProperty("subject")
    expect(data.subject.name).toBe("Test")
    expect(data).toHaveProperty("findings")
    expect(data).toHaveProperty("totalCostUsd")
    expect(data).toHaveProperty("durationMs")
  })
})

// ============================================================================
// Synthesizer selection
// ============================================================================

describe("debriefHandler — synthesizer", () => {
  it("uses NoopSynthesizer by default (synthesis not specified)", async () => {
    await debriefHandler({ name: "Test" }, baseConfig)
    expect(NoopSynthesizer).toHaveBeenCalled()
    expect(ClaudeSynthesizer).not.toHaveBeenCalled()
  })

  it("uses NoopSynthesizer when synthesis is false", async () => {
    await debriefHandler({ name: "Test", synthesis: false }, baseConfig)
    expect(NoopSynthesizer).toHaveBeenCalled()
    expect(ClaudeSynthesizer).not.toHaveBeenCalled()
  })

  it("returns error when synthesis is true but no API key configured", async () => {
    const result = await debriefHandler({ name: "Test", synthesis: true }, baseConfig)
    expect(result.isError).toBe(true)
    expect((result.content[0] as { type: "text"; text: string }).text).toContain(
      "ANTHROPIC_API_KEY"
    )
  })

  it("uses ClaudeSynthesizer when synthesis is true with API key", async () => {
    const configWithKey: McpConfig = {
      ...baseConfig,
      anthropicApiKey: "sk-ant-test",
    }
    await debriefHandler({ name: "Test", synthesis: true }, configWithKey)
    expect(ClaudeSynthesizer).toHaveBeenCalled()
    expect(NoopSynthesizer).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Config passing
// ============================================================================

describe("debriefHandler — config", () => {
  it("passes default budget and model to orchestrator config", async () => {
    await debriefHandler({ name: "Test" }, baseConfig)
    const constructorArgs = vi.mocked(ResearchOrchestrator).mock.calls[0]
    const config = constructorArgs[2]!
    expect(config.costLimits?.maxCostPerSubject).toBe(1.0)
    expect(config.synthesis?.model).toBe("claude-sonnet-4-20250514")
  })

  it("uses request budget and model when provided", async () => {
    await debriefHandler({ name: "Test", budget: 5.0, model: "claude-opus-4-20250514" }, baseConfig)
    const constructorArgs = vi.mocked(ResearchOrchestrator).mock.calls[0]
    const config = constructorArgs[2]!
    expect(config.costLimits?.maxCostPerSubject).toBe(5.0)
    expect(config.synthesis?.model).toBe("claude-opus-4-20250514")
  })

  it("constructs orchestrator with phase groups", async () => {
    await debriefHandler({ name: "Test" }, baseConfig)
    const constructorArgs = vi.mocked(ResearchOrchestrator).mock.calls[0]
    const phases = constructorArgs[0]
    expect(Array.isArray(phases)).toBe(true)
    expect(phases.length).toBeGreaterThan(0)
    expect(phases[0]).toHaveProperty("phase")
    expect(phases[0]).toHaveProperty("name")
    expect(phases[0]).toHaveProperty("sources")
  })
})

// ============================================================================
// Category validation
// ============================================================================

describe("debriefHandler — category validation", () => {
  it("returns error for unknown categories", async () => {
    const result = await debriefHandler({ name: "Test", categories: ["nonexistent"] }, baseConfig)
    expect(result.isError).toBe(true)
    const text = (result.content[0] as { type: "text"; text: string }).text
    expect(text).toContain("Unknown categories")
    expect(text).toContain("nonexistent")
  })
})

// ============================================================================
// Error handling
// ============================================================================

describe("debriefHandler — error handling", () => {
  it("returns error when orchestrator throws", async () => {
    vi.mocked(ResearchOrchestrator).mockImplementationOnce(
      () =>
        ({
          debrief: vi.fn().mockRejectedValue(new Error("Orchestrator failed")),
        }) as unknown as InstanceType<typeof ResearchOrchestrator>
    )
    const result = await debriefHandler({ name: "Test" }, baseConfig)
    expect(result.isError).toBe(true)
    const text = (result.content[0] as { type: "text"; text: string }).text
    expect(text).toContain("Orchestrator failed")
  })
})
