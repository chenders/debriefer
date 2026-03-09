/**
 * Health check route — returns server status, version, and uptime.
 *
 * Used by load balancers, monitoring systems, and Docker health checks
 * to verify the server is running and responsive.
 */

import { Router } from "express"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { version } = require("../../package.json") as { version: string }

export const healthRouter = Router()

healthRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", version, uptime: Math.floor(process.uptime()) })
})
