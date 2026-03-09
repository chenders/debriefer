/**
 * Tests for Zod request validation schemas.
 *
 * Verifies parsing, defaults, and error paths for the debrief request schema.
 */

import { describe, it, expect } from "vitest"
import { debriefRequestSchema } from "../schemas.js"

// ============================================================================
// Valid inputs
// ============================================================================

describe("debriefRequestSchema — valid inputs", () => {
  it("accepts minimal request with name only", () => {
    const result = debriefRequestSchema.parse({ name: "John Doe" })
    expect(result.name).toBe("John Doe")
    expect(result.synthesis).toBe(true) // default
  })

  it("defaults synthesis to true", () => {
    const result = debriefRequestSchema.parse({ name: "Jane" })
    expect(result.synthesis).toBe(true)
  })

  it("accepts full valid request", () => {
    const input = {
      name: "John Doe",
      categories: ["news", "structured"],
      budget: 2.5,
      synthesis: false,
      model: "claude-opus-4-20250514",
      prompt: "Find biographical details",
    }
    const result = debriefRequestSchema.parse(input)
    expect(result).toEqual(input)
  })
})

// ============================================================================
// Invalid inputs
// ============================================================================

describe("debriefRequestSchema — invalid inputs", () => {
  it("rejects missing name", () => {
    const result = debriefRequestSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it("rejects empty name", () => {
    const result = debriefRequestSchema.safeParse({ name: "" })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Subject name is required")
    }
  })

  it("rejects negative budget", () => {
    const result = debriefRequestSchema.safeParse({ name: "X", budget: -1 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Budget must be positive")
    }
  })

  it("rejects zero budget", () => {
    const result = debriefRequestSchema.safeParse({ name: "X", budget: 0 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Budget must be positive")
    }
  })

  it("rejects non-array categories", () => {
    const result = debriefRequestSchema.safeParse({
      name: "X",
      categories: "news",
    })
    expect(result.success).toBe(false)
  })
})
