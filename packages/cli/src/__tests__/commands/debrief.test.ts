/**
 * Tests for the debrief command.
 *
 * Mocks the core `debriefer` module to avoid real API calls,
 * then verifies text/JSON output, no-synthesis mode, and category filtering.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import type { SourcePhaseGroup, ResearchSubject } from "debriefer"

// ============================================================================
// Module mock — must be before any import of the module under test
// ============================================================================

const MOCK_RESULT = {
  subject: { id: "John Wayne", name: "John Wayne" },
  data: "John Wayne was an American actor.",
  findings: [
    {
      text: "Test finding",
      confidence: 0.8,
      costUsd: 0,
      sourceType: "wikipedia",
      sourceName: "Wikipedia",
      reliabilityTier: "secondary",
      reliabilityScore: 0.85,
    },
  ],
  totalCostUsd: 0.001,
  sourcesAttempted: 5,
  sourcesSucceeded: 1,
  durationMs: 2500,
}

vi.mock("debriefer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("debriefer")>()
  return {
    ...actual,
    ResearchOrchestrator: vi.fn().mockImplementation(() => ({
      debrief: vi.fn().mockResolvedValue(MOCK_RESULT),
    })),
    ClaudeSynthesizer: vi.fn().mockImplementation(() => ({})),
    NoopSynthesizer: vi.fn().mockImplementation(() => ({})),
  }
})

import { buildDebriefCommand } from "../../commands/debrief.js"
import { ResearchOrchestrator, NoopSynthesizer } from "debriefer"

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  // Reset call counts but preserve mock implementations from vi.mock()
  vi.mocked(ResearchOrchestrator).mockClear()
  vi.mocked(NoopSynthesizer).mockClear()
})

afterEach(() => {
  // Restore console spies but NOT module mocks (vi.mock implementations must persist)
  vi.unstubAllGlobals()
  process.exitCode = undefined
})

function captureLog(): string[] {
  const calls: string[] = []
  vi.spyOn(globalThis.console, "log").mockImplementation((...args: unknown[]) => {
    calls.push(args.map(String).join(" "))
  })
  return calls
}

function captureError(): string[] {
  const calls: string[] = []
  vi.spyOn(globalThis.console, "error").mockImplementation((...args: unknown[]) => {
    calls.push(args.map(String).join(" "))
  })
  return calls
}

// ============================================================================
// Text output with --no-synthesis
// ============================================================================

describe("debrief command — text output", () => {
  it("runs debrief with --no-synthesis and shows text output", async () => {
    const output = captureLog()
    captureError()
    const cmd = buildDebriefCommand()
    await cmd.parseAsync(["John Wayne", "--no-synthesis"], { from: "user" })

    expect(output.length).toBeGreaterThan(0)
    const text = output.join("\n")

    // Output should contain the subject name
    expect(text).toContain("John Wayne")

    // NoopSynthesizer should have been used
    expect(NoopSynthesizer).toHaveBeenCalled()
  })
})

// ============================================================================
// JSON output
// ============================================================================

describe("debrief command — JSON output", () => {
  it("outputs parseable JSON with --format json", async () => {
    const output = captureLog()
    captureError()
    const cmd = buildDebriefCommand()
    await cmd.parseAsync(["John Wayne", "--no-synthesis", "--format", "json"], { from: "user" })

    expect(output.length).toBeGreaterThan(0)
    const data = JSON.parse(output.join(""))

    expect(data).toHaveProperty("subject")
    expect(data.subject.name).toBe("John Wayne")
    expect(data).toHaveProperty("findings")
    expect(data).toHaveProperty("totalCostUsd")
    expect(data).toHaveProperty("sourcesAttempted")
    expect(data).toHaveProperty("durationMs")
  })
})

// ============================================================================
// Category filtering
// ============================================================================

describe("debrief command — category filtering", () => {
  it("filters by --categories structured", async () => {
    captureLog()
    captureError()
    const cmd = buildDebriefCommand()
    await cmd.parseAsync(["John Wayne", "--no-synthesis", "--categories", "structured"], {
      from: "user",
    })

    // Verify ResearchOrchestrator was called with phases containing only
    // sources from the structured category
    expect(ResearchOrchestrator).toHaveBeenCalled()
    const constructorCall = vi.mocked(ResearchOrchestrator).mock.calls[0]
    const phases = constructorCall[0] as SourcePhaseGroup<ResearchSubject>[]

    expect(phases.length).toBe(1)
    // Structured category has Wikipedia and Wikidata
    for (const source of phases[0].sources) {
      expect(["wikipedia", "wikidata"]).toContain(source.type)
    }
  })
})

// ============================================================================
// Error paths
// ============================================================================

describe("debrief command — error handling", () => {
  it("sets exitCode 1 when no sources are available (unknown category)", async () => {
    captureLog()
    const errors = captureError()
    const cmd = buildDebriefCommand()
    await cmd.parseAsync(["Test", "--no-synthesis", "--categories", "nonexistent"], {
      from: "user",
    })

    expect(process.exitCode).toBe(1)
    expect(errors.join("\n")).toContain("No sources available")
  })

  it("warns about unknown category names", async () => {
    captureLog()
    const errors = captureError()
    const cmd = buildDebriefCommand()
    // Both "bogus" and "fake" are unknown — no sources will be available, so
    // the command exits early before hitting the orchestrator
    await cmd.parseAsync(["Test", "--no-synthesis", "--categories", "bogus,fake"], {
      from: "user",
    })

    expect(errors.join("\n")).toContain('unknown category "bogus"')
    expect(errors.join("\n")).toContain('unknown category "fake"')
  })

  it("sets exitCode 1 when ANTHROPIC_API_KEY is missing for synthesis", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    captureLog()
    const errors = captureError()
    const cmd = buildDebriefCommand()
    await cmd.parseAsync(["Test"], { from: "user" })

    expect(process.exitCode).toBe(1)
    expect(errors.join("\n")).toContain("ANTHROPIC_API_KEY")

    // Restore
    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey
  })
})
