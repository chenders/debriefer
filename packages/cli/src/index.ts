#!/usr/bin/env node

/**
 * CLI entry point for debriefer.
 *
 * Exports `buildProgram()` for programmatic usage and testing.
 * When executed directly (via `npx debriefer` or `node dist/index.js`),
 * auto-parses process.argv.
 */

import { createRequire } from "node:module"
import path from "node:path"
import { Command } from "commander"
import { buildDebriefCommand } from "./commands/debrief.js"
import { buildSourcesCommand } from "./commands/sources.js"

const require = createRequire(import.meta.url)
const { version } = require("../package.json") as { version: string }

/**
 * Builds the top-level Commander program with all registered subcommands.
 */
export function buildProgram(): Command {
  const program = new Command()
    .name("debriefer")
    .description("Multi-source research orchestration engine")
    .version(version)

  program.addCommand(buildDebriefCommand())
  program.addCommand(buildSourcesCommand())

  return program
}

// Auto-parse when executed directly (not when imported in tests)
// Uses path.basename() for cross-platform support (Windows backslashes)
const scriptBase = process.argv[1] ? path.basename(process.argv[1]) : ""
if (scriptBase === "debriefer" || scriptBase === "index.js" || scriptBase === "index.ts") {
  buildProgram().parse()
}
