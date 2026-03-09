/**
 * Tests for the sources command.
 *
 * Verifies text and JSON output modes, category filtering,
 * and correct mapping of source properties.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { buildSourcesCommand } from "../../commands/sources.js"

// ============================================================================
// Setup
// ============================================================================

let logSpy: ReturnType<typeof vi.spyOn>

afterEach(() => {
  logSpy?.mockRestore()
})

function captureLog(): string[] {
  const calls: string[] = []
  logSpy = vi.spyOn(globalThis.console, "log").mockImplementation((...args: unknown[]) => {
    calls.push(args.map(String).join(" "))
  })
  return calls
}

// ============================================================================
// Text format (default)
// ============================================================================

describe("sources command — text format", () => {
  it("lists all sources with summary footer", async () => {
    const output = captureLog()
    const cmd = buildSourcesCommand()
    await cmd.parseAsync([], { from: "user" })

    expect(output.length).toBeGreaterThan(0)
    const text = output.join("\n")

    // Should contain well-known source names
    expect(text).toContain("Wikipedia")
    expect(text).toContain("Wikidata")

    // Footer summary
    expect(text).toContain("sources available")
  })

  it("filters by --category books", async () => {
    const output = captureLog()
    const cmd = buildSourcesCommand()
    await cmd.parseAsync(["--category", "books"], { from: "user" })

    const text = output.join("\n")

    // Should contain book sources
    expect(text).toContain("Google Books")
    expect(text).toContain("Open Library")

    // Should NOT contain sources from other categories
    expect(text).not.toContain("Wikipedia")
  })
})

// ============================================================================
// JSON format
// ============================================================================

describe("sources command — JSON format", () => {
  it("outputs parseable JSON array with expected properties", async () => {
    const output = captureLog()
    const cmd = buildSourcesCommand()
    await cmd.parseAsync(["--format", "json"], { from: "user" })

    expect(output.length).toBeGreaterThan(0)
    const data = JSON.parse(output.join(""))

    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)

    // Verify each entry has the required properties
    for (const entry of data) {
      expect(entry).toHaveProperty("name")
      expect(entry).toHaveProperty("type")
      expect(entry).toHaveProperty("category")
      expect(entry).toHaveProperty("reliabilityTier")
      expect(entry).toHaveProperty("reliabilityScore")
      expect(entry).toHaveProperty("domain")
      expect(entry).toHaveProperty("isFree")
      expect(entry).toHaveProperty("estimatedCostPerQuery")
      expect(entry).toHaveProperty("available")
    }

    // Spot-check a known source
    const wikipedia = data.find((s: Record<string, unknown>) => s.type === "wikipedia")
    expect(wikipedia).toBeDefined()
    expect(wikipedia.name).toBe("Wikipedia")
    expect(wikipedia.category).toBe("structured")
    expect(typeof wikipedia.reliabilityScore).toBe("number")
    expect(typeof wikipedia.available).toBe("boolean")
  })

  it("respects --category filter in JSON mode", async () => {
    const output = captureLog()
    const cmd = buildSourcesCommand()
    await cmd.parseAsync(["--format", "json", "--category", "search"], { from: "user" })

    const data = JSON.parse(output.join(""))

    expect(Array.isArray(data)).toBe(true)
    // All entries should be in the search category
    for (const entry of data) {
      expect(entry.category).toBe("search")
    }
  })
})
