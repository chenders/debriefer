/**
 * Tests for the MCP server entry point.
 *
 * Uses InMemoryTransport to connect a test Client to the McpServer,
 * verifying tool registration, schema validation, and end-to-end
 * tool invocation via the MCP protocol.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"

// ============================================================================
// Module mock — must precede imports of module under test
// ============================================================================

vi.mock("debriefer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("debriefer")>()
  return {
    ...actual,
    ResearchOrchestrator: vi.fn().mockImplementation(() => ({
      debrief: vi.fn().mockResolvedValue({
        subject: { id: "Ada Lovelace", name: "Ada Lovelace" },
        data: null,
        findings: [
          {
            sourceType: "wikipedia",
            sourceName: "Wikipedia",
            text: "Ada Lovelace was an English mathematician.",
            confidence: 0.9,
            reliabilityScore: 0.85,
            url: "https://en.wikipedia.org/wiki/Ada_Lovelace",
          },
        ],
        totalCostUsd: 0,
        sourcesAttempted: 2,
        sourcesSucceeded: 1,
        durationMs: 150,
      }),
    })),
    NoopSynthesizer: vi.fn().mockImplementation(() => ({})),
  }
})

vi.mock("@debriefer/ai", () => ({
  ClaudeSynthesizer: vi.fn().mockImplementation(() => ({})),
}))

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createServer } from "../index.js"

// ============================================================================
// Shared client/server setup
// ============================================================================

let client: Client
let closeServer: () => Promise<void>

beforeAll(async () => {
  const server = createServer()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  client = new Client({ name: "test-client", version: "1.0.0" })

  await server.connect(serverTransport)
  await client.connect(clientTransport)

  closeServer = async () => {
    await client.close()
    await server.close()
  }
})

afterAll(async () => {
  await closeServer()
})

// ============================================================================
// createServer
// ============================================================================

describe("createServer", () => {
  it("returns an McpServer instance", () => {
    const server = createServer()
    expect(server).toBeDefined()
    expect(typeof server.connect).toBe("function")
    expect(typeof server.close).toBe("function")
  })
})

// ============================================================================
// Tool listing
// ============================================================================

describe("listTools", () => {
  it("returns exactly two tools", async () => {
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(2)
  })

  it("includes debrief tool", async () => {
    const { tools } = await client.listTools()
    const debrief = tools.find((t) => t.name === "debrief")
    expect(debrief).toBeDefined()
    expect(debrief!.description).toContain("multi-source research")
  })

  it("includes list_sources tool", async () => {
    const { tools } = await client.listTools()
    const listSources = tools.find((t) => t.name === "list_sources")
    expect(listSources).toBeDefined()
    expect(listSources!.description).toContain("research sources")
  })

  it("debrief tool requires name in input schema", async () => {
    const { tools } = await client.listTools()
    const debrief = tools.find((t) => t.name === "debrief")!
    expect(debrief.inputSchema.required).toContain("name")
  })

  it("debrief tool has optional categories, budget, synthesis, model, prompt", async () => {
    const { tools } = await client.listTools()
    const debrief = tools.find((t) => t.name === "debrief")!
    const properties = debrief.inputSchema.properties ?? {}
    expect(properties).toHaveProperty("categories")
    expect(properties).toHaveProperty("budget")
    expect(properties).toHaveProperty("synthesis")
    expect(properties).toHaveProperty("model")
    expect(properties).toHaveProperty("prompt")
    // These should NOT be required
    const required = debrief.inputSchema.required ?? []
    expect(required).not.toContain("categories")
    expect(required).not.toContain("budget")
    expect(required).not.toContain("synthesis")
  })

  it("list_sources tool has optional category parameter", async () => {
    const { tools } = await client.listTools()
    const listSources = tools.find((t) => t.name === "list_sources")!
    const properties = listSources.inputSchema.properties ?? {}
    expect(properties).toHaveProperty("category")
    const required = listSources.inputSchema.required ?? []
    expect(required).not.toContain("category")
  })
})

// ============================================================================
// list_sources invocation
// ============================================================================

describe("list_sources invocation", () => {
  it("returns source metadata as JSON text", async () => {
    const result = await client.callTool({ name: "list_sources", arguments: {} })
    expect(result.isError).toBeFalsy()
    expect(result.content).toHaveLength(1)

    const block = (result.content as Array<{ type: string; text: string }>)[0]
    expect(block.type).toBe("text")

    const data = JSON.parse(block.text)
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
    expect(data[0]).toHaveProperty("name")
    expect(data[0]).toHaveProperty("type")
    expect(data[0]).toHaveProperty("category")
    expect(data[0]).toHaveProperty("reliabilityTier")
  })

  it("filters by category when specified", async () => {
    const result = await client.callTool({
      name: "list_sources",
      arguments: { category: "structured" },
    })
    const data = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text)
    expect(data.length).toBeGreaterThan(0)
    for (const source of data) {
      expect(source.category).toBe("structured")
    }
  })
})

// ============================================================================
// debrief invocation
// ============================================================================

describe("debrief invocation", () => {
  it("returns research result as JSON text", async () => {
    const result = await client.callTool({
      name: "debrief",
      arguments: { name: "Ada Lovelace" },
    })
    expect(result.isError).toBeFalsy()
    expect(result.content).toHaveLength(1)

    const block = (result.content as Array<{ type: string; text: string }>)[0]
    expect(block.type).toBe("text")

    const data = JSON.parse(block.text)
    expect(data).toHaveProperty("subject")
    expect(data.subject.name).toBe("Ada Lovelace")
    expect(data).toHaveProperty("findings")
    expect(data.findings).toHaveLength(1)
    expect(data).toHaveProperty("totalCostUsd")
    expect(data).toHaveProperty("durationMs")
  })

  it("passes optional parameters through to handler", async () => {
    const result = await client.callTool({
      name: "debrief",
      arguments: {
        name: "Ada Lovelace",
        categories: ["structured"],
        budget: 2.5,
      },
    })
    expect(result.isError).toBeFalsy()
    // The mock returns a result regardless — we verify it doesn't error
    const data = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text)
    expect(data).toHaveProperty("subject")
  })
})
