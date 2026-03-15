import { describe, it, expect } from "vitest"
import { ReliabilityTier } from "../reliability.js"
import type { ScoredFinding, ResearchSubject } from "../types.js"
import { stripMarkdownCodeFences, NoopSynthesizer } from "../synthesizer.js"

function makeFinding(overrides: Partial<ScoredFinding> = {}): ScoredFinding {
  return {
    text: "Some finding text",
    confidence: 0.8,
    costUsd: 0,
    sourceType: "wikipedia",
    sourceName: "Wikipedia",
    reliabilityTier: ReliabilityTier.SECONDARY_COMPILATION,
    reliabilityScore: 0.85,
    ...overrides,
  }
}

const testSubject: ResearchSubject = {
  id: 1,
  name: "John Wayne",
  context: { deathday: "1979-06-11" },
}

describe("stripMarkdownCodeFences", () => {
  it("removes ```json fences", () => {
    const input = '```json\n{"key": "value"}\n```'
    expect(stripMarkdownCodeFences(input)).toBe('{"key": "value"}')
  })

  it("removes plain ``` fences", () => {
    const input = '```\n{"key": "value"}\n```'
    expect(stripMarkdownCodeFences(input)).toBe('{"key": "value"}')
  })

  it("passes through plain text unchanged", () => {
    const input = '{"key": "value"}'
    expect(stripMarkdownCodeFences(input)).toBe('{"key": "value"}')
  })
})

describe("NoopSynthesizer", () => {
  it("returns findings as-is with zero cost", async () => {
    const findings = [
      makeFinding({ text: "Finding 1", sourceType: "wikipedia" }),
      makeFinding({ text: "Finding 2", sourceType: "guardian" }),
    ]

    const synthesizer = new NoopSynthesizer()
    const result = await synthesizer.synthesize(testSubject, findings)

    expect(result.data).toEqual(findings)
    expect(result.costUsd).toBe(0)
    expect(result.inputTokens).toBe(0)
    expect(result.outputTokens).toBe(0)
    expect(result.model).toBe("none")
  })
})
