/**
 * Express application factory — assembles middleware, routes, and error handlers.
 *
 * Centralises app construction so both the production entry point and
 * test suites can create identical app instances without starting a listener.
 */

import express from "express"
import cors from "cors"
import { loadConfig } from "./config.js"
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
export function createApp(): express.Express {
  const config = loadConfig()
  const app = express()

  // Global middleware
  app.use(cors())
  app.use(express.json())
  app.use(createAuthMiddleware(config.apiKeys))

  // API routes
  app.use("/api", healthRouter)
  app.use("/api", sourcesRouter)
  app.use("/api", createDebriefRouter(config))

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" })
  })

  return app
}
