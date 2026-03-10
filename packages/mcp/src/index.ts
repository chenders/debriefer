#!/usr/bin/env node

/**
 * debriefer-mcp — MCP server entry point.
 *
 * Exports a `createServer()` factory that returns an McpServer with two
 * registered tools: `debrief` (single-subject research orchestration)
 * and `list_sources` (source metadata listing).
 *
 * When run directly (via `debriefer-mcp` bin or `node index.js`), the
 * server connects over stdio transport for use by MCP-compatible clients.
 */

import { z } from "zod/v3"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { debriefHandler, type DebriefArgs } from "./tools/debrief.js"
import { listSourcesHandler, type ListSourcesArgs } from "./tools/list-sources.js"
import { loadConfig } from "./config.js"
import { VALID_CATEGORIES } from "./source-registry.js"

const categoriesDesc = `Source categories to include (default: all). Valid: ${VALID_CATEGORIES.join(", ")}`

/**
 * Creates and returns an McpServer instance with debrief and list_sources
 * tools registered. The server is ready to be connected to any MCP transport.
 */
export function createServer(): McpServer {
  const config = loadConfig()

  const server = new McpServer({
    name: "debriefer-mcp",
    version: "0.1.0",
  })

  // ── debrief tool ──────────────────────────────────────────────────────
  const debriefSchema = {
    name: z.string().describe("Name of the subject to research"),
    categories: z.array(z.string()).optional().describe(categoriesDesc),
    budget: z.number().optional().describe("Maximum cost in USD (default: 1.0)"),
    synthesis: z
      .boolean()
      .optional()
      .describe("Enable AI synthesis of findings (requires ANTHROPIC_API_KEY)"),
    model: z.string().optional().describe("Anthropic model for synthesis"),
    prompt: z.string().optional().describe("Custom system prompt for synthesis"),
  }

  server.registerTool(
    "debrief",
    {
      description:
        "Run multi-source research on a subject. Orchestrates 60+ data sources " +
        "with reliability scoring, phased execution, and optional AI synthesis.",
      inputSchema: debriefSchema,
    },
    // @ts-expect-error — TS2589: deep type instantiation from MCP SDK generics + Zod v3 with 6 fields
    async (args: DebriefArgs, extra: { signal: AbortSignal }) =>
      debriefHandler(args, config, extra.signal)
  )

  // ── list_sources tool ─────────────────────────────────────────────────
  server.registerTool(
    "list_sources",
    {
      description:
        "List available research sources with metadata including reliability " +
        "tier, cost, and availability. Optionally filter by category.",
      inputSchema: {
        category: z
          .string()
          .optional()
          .describe(`Filter to a single category. Valid: ${VALID_CATEGORIES.join(", ")}`),
      },
    },
    (args: ListSourcesArgs) => listSourcesHandler(args)
  )

  return server
}

export { debriefHandler } from "./tools/debrief.js"
export { listSourcesHandler } from "./tools/list-sources.js"
export { loadConfig } from "./config.js"
export type { McpConfig } from "./config.js"
export {
  VALID_CATEGORIES,
  SOURCE_CATEGORIES,
  createSourcesWithCategory,
} from "./source-registry.js"
export type { SourceCategory } from "./source-registry.js"

// ── Direct-run: connect via stdio ─────────────────────────────────────
const isDirectRun =
  process.argv[1]?.includes("debriefer-mcp") || process.argv[1]?.endsWith("index.js")

if (isDirectRun) {
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js")
  const server = createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
