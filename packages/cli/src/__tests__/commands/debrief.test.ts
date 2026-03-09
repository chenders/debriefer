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

const mockDebrief = vi.fn()

vi.mock("debriefer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("debriefer")>()
  return {
    ...actual,
    ResearchOrchestrator: vi.fn().mockImplementation(() => ({
      debrief: mockDebrief.mockResolvedValue({
        subject: { id: 1, name: "John Wayne" },
        data: "John Wayne was an American actor.",
        findings: [
          {
            text: "Test finding",
            confidence: 0.8,
            costUsd: 0,
            sourceType: "wikipedia",
            sourceName: "Wikipedia",
            reliabilityTier: actual.ReliabilityTier.SECONDARY_COMPILATION,
            reliabilityScore: 0.85,
          },
        ],
        totalCostUsd: 0.001,
        sourcesAttempted: 5,
        sourcesSucceeded: 1,
        durationMs: 2500,
      }),
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

let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  logSpy?.mockRestore()
  errorSpy?.mockRestore()
})

function captureLog(): string[] {
  const calls: string[] = []
  logSpy = vi.spyOn(globalThis.console, "log").mockImplementation((...args: unknown[]) => {
    calls.push(args.map(String).join(" "))
  })
  return calls
}

function captureError(): string[] {
  const calls: string[] = []
  errorSpy = vi.spyOn(globalThis.console, "error").mockImplementation((...args: unknown[]) => {
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
