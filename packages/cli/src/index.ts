#!/usr/bin/env node

/**
 * CLI entry point for debriefer.
 *
 * Exports `buildProgram()` for programmatic usage and testing.
 * When executed directly (via `npx debriefer` or `node dist/index.js`),
 * auto-parses process.argv.
 */

import { Command } from "commander"
import { buildDebriefCommand } from "./commands/debrief.js"
import { buildSourcesCommand } from "./commands/sources.js"

/**
 * Builds the top-level Commander program with all registered subcommands.
 */
export function buildProgram(): Command {
  const program = new Command()
    .name("debriefer")
    .description("Multi-source research orchestration engine")
    .version("0.1.0")

  program.addCommand(buildDebriefCommand())
  program.addCommand(buildSourcesCommand())

  return program
}

// Auto-parse when executed directly (not when imported in tests)
const executedScript = process.argv[1]
if (
  executedScript &&
  (executedScript.endsWith("/debriefer") ||
    executedScript.endsWith("/index.js") ||
    executedScript.endsWith("/index.ts"))
) {
  buildProgram().parse()
}
