/**
 * Express application factory — assembles middleware, routes, and error handlers.
 *
 * Centralises app construction so both the production entry point and
 * test suites can create identical app instances without starting a listener.
 */

import express from "express"
import cors from "cors"
import { loadConfig, type ServerConfig } from "./config.js"
import { createAuthMiddleware } from "./middleware/auth.js"
import { healthRouter } from "./routes/health.js"
import { sourcesRouter } from "./routes/sources.js"
import { createDebriefRouter } from "./routes/debrief.js"

/**
 * Builds a fully-configured Express app.
 *
 * Reads configuration from environment variables via `loadConfig()`,
 * then wires up CORS, JSON parsing, auth, API routes, and a 404 fallback.
 */
export function createApp(config?: ServerConfig): express.Express {
  const resolvedConfig = config ?? loadConfig()
  const app = express()

  // Global middleware
  app.use(cors(resolvedConfig.corsOrigin ? { origin: resolvedConfig.corsOrigin } : undefined))
  app.use(express.json())
  app.use(createAuthMiddleware(resolvedConfig.apiKeys))

  // API routes
  app.use("/api", healthRouter)
  app.use("/api", sourcesRouter)
  app.use("/api", createDebriefRouter(resolvedConfig))

  // 404 fallback
  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: "Not found" })
  })

  // Global error handler (4-arg signature tells Express this is error middleware)
  app.use(
    (
      err: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error(err)
      // Honor status from body-parser SyntaxError (e.g., malformed JSON → 400)
      const status = typeof err.status === "number" ? err.status : 500
      res.status(status).json({ error: status < 500 ? err.message : "Internal server error" })
    }
  )

  return app
}
