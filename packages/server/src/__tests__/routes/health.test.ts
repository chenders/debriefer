/**
 * Tests for the health route.
 *
 * Verifies that GET /health returns 200 with status, version (string),
 * and uptime (number).
 */

import { describe, it, expect } from "vitest"
import express from "express"
import request from "supertest"
import { healthRouter } from "../../routes/health.js"

function createApp(): express.Express {
  const app = express()
  app.use("/api", healthRouter)
  return app
}

// ============================================================================
// GET /api/health
// ============================================================================

describe("GET /api/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(createApp()).get("/api/health")
    expect(res.status).toBe(200)
    expect(res.body.status).toBe("ok")
  })

  it("includes version as a string", async () => {
    const res = await request(createApp()).get("/api/health")
    expect(typeof res.body.version).toBe("string")
    expect(res.body.version.length).toBeGreaterThan(0)
  })

  it("includes uptime as a number", async () => {
    const res = await request(createApp()).get("/api/health")
    expect(typeof res.body.uptime).toBe("number")
    expect(res.body.uptime).toBeGreaterThanOrEqual(0)
  })
})
