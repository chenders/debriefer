import { describe, it, expect, vi, beforeEach } from "vitest"
import { ReliabilityTier } from "../reliability.js"
import type { ScoredFinding, ResearchSubject } from "../types.js"

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: '```json\n{"result": "test"}\n```' }],
          usage: { input_tokens: 1000, output_tokens: 500 },
        }),
      }
      constructor() {}
    },
  }
})

import { stripMarkdownCodeFences, ClaudeSynthesizer, NoopSynthesizer } from "../synthesizer.js"

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

describe("ClaudeSynthesizer", () => {
  let promptBuilderSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    promptBuilderSpy = vi.fn().mockReturnValue({
      system: "You are a test system",
      user: "Test user prompt",
    })
  })

  it("calls Anthropic with correct model and max_tokens", async () => {
    const synthesizer = new ClaudeSynthesizer({
      promptBuilder: promptBuilderSpy,
      defaultModel: "claude-haiku-3-20250101",
      defaultMaxTokens: 2048,
    })

    await synthesizer.synthesize(testSubject, [makeFinding()])

    // Access the mock to verify the call
    const client = (synthesizer as any).client
    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-3-20250101",
        max_tokens: 2048,
        system: "You are a test system",
        messages: [{ role: "user", content: "Test user prompt" }],
      })
    )
  })

  it("sorts findings by reliability score before passing to promptBuilder", async () => {
    const findings = [
      makeFinding({
        sourceType: "find_a_grave",
        reliabilityScore: 0.35,
        text: "Low reliability",
      }),
      makeFinding({
        sourceType: "ap_news",
        reliabilityScore: 0.95,
        text: "High reliability",
      }),
      makeFinding({
        sourceType: "wikipedia",
        reliabilityScore: 0.85,
        text: "Medium reliability",
      }),
    ]

    const synthesizer = new ClaudeSynthesizer({
      promptBuilder: promptBuilderSpy,
    })

    await synthesizer.synthesize(testSubject, findings)

    const passedFindings = promptBuilderSpy.mock.calls[0][1] as ScoredFinding[]
    expect(passedFindings[0].reliabilityScore).toBe(0.95)
    expect(passedFindings[1].reliabilityScore).toBe(0.85)
    expect(passedFindings[2].reliabilityScore).toBe(0.35)
  })

  it("parses JSON response correctly", async () => {
    const synthesizer = new ClaudeSynthesizer({
      promptBuilder: promptBuilderSpy,
    })

    const result = await synthesizer.synthesize(testSubject, [makeFinding()])

    expect(result.data).toEqual({ result: "test" })
  })

  it("calculates cost from token counts", async () => {
    const synthesizer = new ClaudeSynthesizer({
      promptBuilder: promptBuilderSpy,
      // Default model is Sonnet: input $3/M, output $15/M
    })

    const result = await synthesizer.synthesize(testSubject, [makeFinding()])

    // 1000 input tokens * $3/M + 500 output tokens * $15/M
    const expectedCost = (1000 * 3) / 1_000_000 + (500 * 15) / 1_000_000
    expect(result.costUsd).toBeCloseTo(expectedCost)
    expect(result.inputTokens).toBe(1000)
    expect(result.outputTokens).toBe(500)
  })

  it("uses custom responseParser when provided", async () => {
    interface CustomOutput {
      transformed: string
    }

    const synthesizer = new ClaudeSynthesizer<ResearchSubject, CustomOutput>({
      promptBuilder: promptBuilderSpy,
      responseParser: (raw) => {
        const obj = raw as Record<string, unknown>
        return { transformed: `parsed-${obj.result}` }
      },
    })

    const result = await synthesizer.synthesize(testSubject, [makeFinding()])

    expect(result.data).toEqual({ transformed: "parsed-test" })
  })

  it("uses default model when none specified", async () => {
    const synthesizer = new ClaudeSynthesizer({
      promptBuilder: promptBuilderSpy,
    })

    await synthesizer.synthesize(testSubject, [makeFinding()])

    const client = (synthesizer as any).client
    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-20250514",
      })
    )
  })

  it("uses options.model override", async () => {
    const synthesizer = new ClaudeSynthesizer({
      promptBuilder: promptBuilderSpy,
      defaultModel: "claude-sonnet-4-20250514",
    })

    await synthesizer.synthesize(testSubject, [makeFinding()], {
      model: "claude-opus-4-5-20251101",
    })

    const client = (synthesizer as any).client
    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-opus-4-5-20251101",
      })
    )
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
