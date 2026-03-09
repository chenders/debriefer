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
  app.use(cors())
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
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: "Internal server error", message: err.message })
    }
  )

  return app
}
