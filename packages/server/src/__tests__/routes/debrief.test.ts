/**
 * Tests for the debrief route.
 *
 * Mocks the core `debriefer` module to avoid real API calls and
 * verifies request validation, error responses, and successful execution.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import express from "express"
import request from "supertest"

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

import { createDebriefRouter } from "../../routes/debrief.js"
import { ResearchOrchestrator, NoopSynthesizer } from "debriefer"
import type { ServerConfig } from "../../config.js"

// ============================================================================
// Setup
// ============================================================================

const baseConfig: ServerConfig = {
  port: 8090,
  apiKeys: [],
  authEnabled: false,
  defaultBudget: 1.0,
  defaultModel: "claude-sonnet-4-20250514",
  anthropicApiKey: undefined,
}

function createApp(config: ServerConfig = baseConfig): express.Express {
  const app = express()
  app.use(express.json())
  app.use("/api", createDebriefRouter(config))
  return app
}

beforeEach(() => {
  vi.mocked(ResearchOrchestrator).mockClear()
  vi.mocked(NoopSynthesizer).mockClear()
})

// ============================================================================
// Validation errors
// ============================================================================

describe("POST /api/debrief — validation", () => {
  it("returns 400 when name is missing", async () => {
    const res = await request(createApp()).post("/api/debrief").send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("Invalid request")
    expect(res.body.details).toBeDefined()
  })

  it("returns 400 when name is empty string", async () => {
    const res = await request(createApp()).post("/api/debrief").send({ name: "" })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("Invalid request")
  })

  it("returns 400 when budget is negative", async () => {
    const res = await request(createApp()).post("/api/debrief").send({ name: "Test", budget: -1 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("Invalid request")
  })
})

// ============================================================================
// Successful request
// ============================================================================

describe("POST /api/debrief — success", () => {
  it("returns 200 with debrief result for valid request", async () => {
    const res = await request(createApp())
      .post("/api/debrief")
      .send({ name: "Test", synthesis: false })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty("subject")
    expect(res.body.subject.name).toBe("Test")
    expect(res.body).toHaveProperty("findings")
    expect(res.body).toHaveProperty("totalCostUsd")
    expect(res.body).toHaveProperty("durationMs")
  })

  it("uses NoopSynthesizer when synthesis is false", async () => {
    await request(createApp()).post("/api/debrief").send({ name: "Test", synthesis: false })
    expect(NoopSynthesizer).toHaveBeenCalled()
  })
})

// ============================================================================
// Synthesis without API key
// ============================================================================

describe("POST /api/debrief — synthesis errors", () => {
  it("returns 400 when synthesis is true but no API key configured", async () => {
    const res = await request(createApp())
      .post("/api/debrief")
      .send({ name: "Test", synthesis: true })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain("ANTHROPIC_API_KEY")
  })
})
