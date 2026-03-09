/**
 * Tests for the CLI entry point.
 *
 * Verifies that buildProgram() creates a Commander program with the correct
 * name, description, and registered subcommands (debrief and sources).
 */

import { describe, it, expect } from "vitest"
import { buildProgram } from "../index.js"

describe("CLI program", () => {
  it("has name and description", () => {
    const program = buildProgram()
    expect(program.name()).toBe("debriefer")
    expect(program.description()).toContain("research")
  })

  it("registers debrief command", () => {
    const program = buildProgram()
    const cmd = program.commands.find((c) => c.name() === "debrief")
    expect(cmd).toBeDefined()
  })

  it("registers sources command", () => {
    const program = buildProgram()
    const cmd = program.commands.find((c) => c.name() === "sources")
    expect(cmd).toBeDefined()
  })
})
