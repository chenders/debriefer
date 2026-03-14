/**
 * Tests for the Express app factory.
 *
 * Verifies that createApp() assembles middleware, routes, and the 404
 * fallback correctly. Mocks the debriefer module to avoid real API calls.
 */

import { describe, it, expect, vi } from "vitest"
import request from "supertest"

// ============================================================================
// Module mock — must be before any import of the module under test
// ============================================================================

vi.mock("@debriefer/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@debriefer/core")>()
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
    NoopSynthesizer: vi.fn().mockImplementation(() => ({})),
  }
})

vi.mock("@debriefer/ai", () => ({
  ClaudeSynthesizer: vi.fn().mockImplementation(() => ({})),
}))

import { createApp } from "../app.js"
import type { ServerConfig } from "../config.js"

const testConfig: ServerConfig = {
  port: 8090,
  apiKeys: [],
  authEnabled: false,
  defaultBudget: 1.0,
  defaultModel: "claude-sonnet-4-20250514",
  anthropicApiKey: undefined,
  corsOrigin: undefined,
}

// ============================================================================
// Health endpoint
// ============================================================================

describe("createApp — health", () => {
  it("GET /api/health returns 200", async () => {
    const app = createApp(testConfig)
    const res = await request(app).get("/api/health")
    expect(res.status).toBe(200)
    expect(res.body.status).toBe("ok")
  })
})

// ============================================================================
// Sources endpoint
// ============================================================================

describe("createApp — sources", () => {
  it("GET /api/sources returns 200 with array", async () => {
    const app = createApp(testConfig)
    const res = await request(app).get("/api/sources")
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

// ============================================================================
// Debrief endpoint
// ============================================================================

describe("createApp — debrief", () => {
  it("POST /api/debrief returns 200 for valid request", async () => {
    const app = createApp(testConfig)
    const res = await request(app).post("/api/debrief").send({ name: "Test", synthesis: false })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty("subject")
  })
})

// ============================================================================
// 404 fallback
// ============================================================================

describe("createApp — 404", () => {
  it("returns 404 with JSON error for unknown route", async () => {
    const app = createApp(testConfig)
    const res = await request(app).get("/api/nonexistent")
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: "Not found" })
  })

  it("returns 404 for routes outside /api", async () => {
    const app = createApp(testConfig)
    const res = await request(app).get("/something")
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: "Not found" })
  })
})
