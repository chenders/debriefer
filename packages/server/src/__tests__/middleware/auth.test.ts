/**
 * Tests for the auth middleware.
 *
 * Verifies pass-through when no keys are configured, Bearer token
 * validation, and 401 responses for missing/invalid/wrong-scheme auth.
 */

import { describe, it, expect, vi } from "vitest"
import { createAuthMiddleware } from "../../middleware/auth.js"

/** Creates a minimal mock request with optional Authorization header. */
function mockReq(authorization?: string) {
  return {
    headers: authorization !== undefined ? { authorization } : {},
  } as any
}

/** Creates a mock response with chainable status/json. */
function mockRes() {
  const res: any = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}

// ============================================================================
// No keys configured — pass-through
// ============================================================================

describe("auth middleware — no keys", () => {
  it("calls next() when apiKeys is empty", () => {
    const middleware = createAuthMiddleware([])
    const next = vi.fn()
    middleware(mockReq(), mockRes(), next)
    expect(next).toHaveBeenCalledOnce()
  })

  it("calls next() even without Authorization header", () => {
    const middleware = createAuthMiddleware([])
    const next = vi.fn()
    middleware(mockReq(), mockRes(), next)
    expect(next).toHaveBeenCalledOnce()
  })
})

// ============================================================================
// Valid Bearer token
// ============================================================================

describe("auth middleware — valid token", () => {
  it("calls next() for a valid Bearer token", () => {
    const middleware = createAuthMiddleware(["secret-key"])
    const next = vi.fn()
    middleware(mockReq("Bearer secret-key"), mockRes(), next)
    expect(next).toHaveBeenCalledOnce()
  })

  it("accepts any of multiple configured keys", () => {
    const middleware = createAuthMiddleware(["key-a", "key-b"])
    const next = vi.fn()
    middleware(mockReq("Bearer key-b"), mockRes(), next)
    expect(next).toHaveBeenCalledOnce()
  })
})

// ============================================================================
// Rejection cases
// ============================================================================

describe("auth middleware — rejection", () => {
  it("returns 401 when Authorization header is missing", () => {
    const middleware = createAuthMiddleware(["secret"])
    const res = mockRes()
    const next = vi.fn()
    middleware(mockReq(), res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" })
  })

  it("returns 401 for invalid token", () => {
    const middleware = createAuthMiddleware(["secret"])
    const res = mockRes()
    const next = vi.fn()
    middleware(mockReq("Bearer wrong-key"), res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" })
  })

  it("returns 401 for non-Bearer scheme", () => {
    const middleware = createAuthMiddleware(["secret"])
    const res = mockRes()
    const next = vi.fn()
    middleware(mockReq("Basic secret"), res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" })
  })
})
