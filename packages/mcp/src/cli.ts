#!/usr/bin/env node
/**
 * CLI entry point — connects the MCP server over stdio transport.
 *
 * Run: npx debriefer-mcp
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createServer } from "./index.js"

const server = createServer()
const transport = new StdioServerTransport()
await server.connect(transport)
