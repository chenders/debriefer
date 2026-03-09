/**
 * Bearer-token authentication middleware.
 *
 * When API keys are configured, requests must include a valid
 * `Authorization: Bearer <token>` header. When no keys are
 * configured, all requests pass through unauthenticated.
 */

import type { Request, Response, NextFunction } from "express"

/**
 * Creates Express middleware that validates Bearer tokens against
 * the provided list of API keys.
 *
 * - Empty `apiKeys` array → pass-through (no auth required)
 * - Valid Bearer token → next()
 * - Missing / invalid / wrong scheme → 401 { error: "Unauthorized" }
 *
 * Uses a Set for O(1) token lookup.
 */
export function createAuthMiddleware(
  apiKeys: string[]
): (req: Request, res: Response, next: NextFunction) => void {
  const validKeys = new Set(apiKeys)

  return (req: Request, res: Response, next: NextFunction): void => {
    // No keys configured — auth disabled
    if (validKeys.size === 0) {
      next()
      return
    }

    const header = req.headers.authorization
    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" })
      return
    }

    const token = header.slice("Bearer ".length)
    if (!validKeys.has(token)) {
      res.status(401).json({ error: "Unauthorized" })
      return
    }

    next()
  }
}
