/**
 * Tests for the sources route.
 *
 * Verifies that GET /sources returns all sources as JSON, supports
 * category filtering via query parameter, and returns empty array
 * for unknown categories.
 */

import { describe, it, expect } from "vitest"
import express from "express"
import request from "supertest"
import { sourcesRouter } from "../../routes/sources.js"

function createApp(): express.Express {
  const app = express()
  app.use("/api", sourcesRouter)
  return app
}

// ============================================================================
// GET /api/sources (all)
// ============================================================================

describe("GET /api/sources", () => {
  it("returns 200 with an array of sources", async () => {
    const res = await request(createApp()).get("/api/sources")
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
  })

  it("each source has required fields", async () => {
    const res = await request(createApp()).get("/api/sources")
    for (const source of res.body) {
      expect(source).toHaveProperty("name")
      expect(source).toHaveProperty("type")
      expect(source).toHaveProperty("category")
      expect(source).toHaveProperty("reliabilityTier")
      expect(source).toHaveProperty("reliabilityScore")
      expect(source).toHaveProperty("domain")
      expect(source).toHaveProperty("isFree")
      expect(source).toHaveProperty("estimatedCostPerQuery")
      expect(source).toHaveProperty("available")
    }
  })
})

// ============================================================================
// GET /api/sources?category=structured
// ============================================================================

describe("GET /api/sources?category=structured", () => {
  it("returns only structured sources", async () => {
    const res = await request(createApp()).get("/api/sources?category=structured")
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
    for (const source of res.body) {
      expect(source.category).toBe("structured")
    }
  })
})

// ============================================================================
// GET /api/sources?category=unknown
// ============================================================================

describe("GET /api/sources?category=unknown", () => {
  it("returns empty array for unknown category", async () => {
    const res = await request(createApp()).get("/api/sources?category=nonexistent")
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})
