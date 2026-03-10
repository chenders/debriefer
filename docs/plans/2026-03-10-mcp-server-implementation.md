# MCP Server v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose debriefer as an MCP server with `debrief` and `list_sources` tools, runnable via `npx debriefer-mcp`.

**Architecture:** Two MCP tools registered on `McpServer` from `@modelcontextprotocol/sdk`, communicating over `StdioServerTransport`. Each tool handler reuses the same orchestrator patterns as `packages/server` — source registry, free/paid phase splitting, synthesizer selection. Config from env vars.

**Tech Stack:** `@modelcontextprotocol/sdk` (McpServer, StdioServerTransport), `debriefer` core, `debriefer-sources`, `zod` for input schemas, `vitest` for tests.

**Design doc:** `docs/plans/2026-03-10-mcp-server-design.md`

---

### Task 1: Source Registry

Duplicate the source registry from `packages/server/src/source-registry.ts` into the MCP package. Identical logic — same imports, same category map, same `satisfies` + `keyof typeof` pattern.

**Files:**

- Create: `packages/mcp/src/source-registry.ts`
- Test: `packages/mcp/src/__tests__/source-registry.test.ts`

**Step 1: Write the test**

```typescript
/**
 * Tests for the MCP source registry.
 */

import { describe, it, expect } from "vitest"
import {
  SOURCE_CATEGORIES,
  VALID_CATEGORIES,
  createSourcesWithCategory,
} from "../source-registry.js"

describe("SOURCE_CATEGORIES", () => {
  it("has exactly 6 categories", () => {
    expect(Object.keys(SOURCE_CATEGORIES)).toHaveLength(6)
  })

  it("contains expected category names", () => {
    const expected = ["structured", "news", "search", "books", "archives", "obituary"]
    expect(Object.keys(SOURCE_CATEGORIES).sort()).toEqual(expected.sort())
  })

  it("VALID_CATEGORIES matches SOURCE_CATEGORIES keys", () => {
    expect(VALID_CATEGORIES.sort()).toEqual(Object.keys(SOURCE_CATEGORIES).sort())
  })

  it("every category has at least one factory", () => {
    for (const [name, factories] of Object.entries(SOURCE_CATEGORIES)) {
      expect(factories.length, `${name} should have factories`).toBeGreaterThan(0)
    }
  })
})

describe("createSourcesWithCategory", () => {
  it("returns all sources when no categories specified", () => {
    const results = createSourcesWithCategory()
    const totalFactories = Object.values(SOURCE_CATEGORIES).reduce(
      (sum, arr) => sum + arr.length,
      0
    )
    expect(results).toHaveLength(totalFactories)
  })

  it("filters by category", () => {
    const results = createSourcesWithCategory(["structured"])
    expect(results).toHaveLength(SOURCE_CATEGORIES.structured.length)
    for (const r of results) {
      expect(r.category).toBe("structured")
    }
  })

  it("ignores unknown categories", () => {
    const results = createSourcesWithCategory(["structured", "nonexistent"])
    expect(results).toHaveLength(SOURCE_CATEGORIES.structured.length)
  })

  it("returns empty array when all categories are unknown", () => {
    const results = createSourcesWithCategory(["nonexistent"])
    expect(results).toHaveLength(0)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/mcp && npx vitest run src/__tests__/source-registry.test.ts`
Expected: FAIL — module not found

**Step 3: Write source-registry.ts**

Copy `packages/server/src/source-registry.ts` exactly — same imports from `debriefer` and `debriefer-sources`, same `SOURCE_CATEGORIES_DEF` with `satisfies`, same `SourceCategory` type derivation, same `VALID_CATEGORIES`, same `createSourcesWithCategory` function.

**Step 4: Run test to verify it passes**

Run: `cd packages/mcp && npx vitest run src/__tests__/source-registry.test.ts`
Expected: PASS (all 8 tests)

**Step 5: Commit**

```bash
git add packages/mcp/src/source-registry.ts packages/mcp/src/__tests__/source-registry.test.ts
git commit -m "feat(mcp): add source registry"
```

---

### Task 2: Config

Simple config loader reading env vars — `ANTHROPIC_API_KEY`, `DEFAULT_BUDGET`, `DEFAULT_MODEL`. Reuse the `safeParseFloat` pattern from the server.

**Files:**

- Create: `packages/mcp/src/config.ts`
- Test: `packages/mcp/src/__tests__/config.test.ts`

**Step 1: Write the test**

```typescript
/**
 * Tests for MCP server configuration.
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import { loadConfig } from "../config.js"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("loadConfig defaults", () => {
  it("returns default budget of 1.0", () => {
    const config = loadConfig()
    expect(config.defaultBudget).toBe(1.0)
  })

  it("returns default model", () => {
    const config = loadConfig()
    expect(config.defaultModel).toBe("claude-sonnet-4-20250514")
  })

  it("returns undefined anthropicApiKey when not set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "")
    const config = loadConfig()
    expect(config.anthropicApiKey).toBeUndefined()
  })
})

describe("DEFAULT_BUDGET env var", () => {
  it("reads budget from environment", () => {
    vi.stubEnv("DEFAULT_BUDGET", "5.50")
    const config = loadConfig()
    expect(config.defaultBudget).toBe(5.5)
  })

  it("falls back to default on invalid budget", () => {
    vi.stubEnv("DEFAULT_BUDGET", "abc")
    const config = loadConfig()
    expect(config.defaultBudget).toBe(1.0)
  })

  it("falls back to default on zero budget", () => {
    vi.stubEnv("DEFAULT_BUDGET", "0")
    const config = loadConfig()
    expect(config.defaultBudget).toBe(1.0)
  })
})

describe("ANTHROPIC_API_KEY env var", () => {
  it("reads anthropic key from environment", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-12345")
    const config = loadConfig()
    expect(config.anthropicApiKey).toBe("sk-ant-12345")
  })
})

describe("DEFAULT_MODEL env var", () => {
  it("reads model from environment", () => {
    vi.stubEnv("DEFAULT_MODEL", "claude-opus-4-20250514")
    const config = loadConfig()
    expect(config.defaultModel).toBe("claude-opus-4-20250514")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/mcp && npx vitest run src/__tests__/config.test.ts`
Expected: FAIL — module not found

**Step 3: Write config.ts**

```typescript
/**
 * MCP server configuration — reads environment variables with defaults.
 */

export interface McpConfig {
  defaultBudget: number
  defaultModel: string
  anthropicApiKey: string | undefined
}

/**
 * Reads environment variables and returns a validated McpConfig.
 *
 * - DEFAULT_BUDGET: float, default 1.0
 * - DEFAULT_MODEL: string, default "claude-sonnet-4-20250514"
 * - ANTHROPIC_API_KEY: string or undefined
 */
export function loadConfig(): McpConfig {
  const defaultBudget = safeParseFloat(process.env.DEFAULT_BUDGET, 1.0)
  const defaultModel = process.env.DEFAULT_MODEL || "claude-sonnet-4-20250514"
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || undefined

  return {
    defaultBudget,
    defaultModel,
    anthropicApiKey,
  }
}

/** parseFloat with NaN fallback. Values ≤ 0 fall back to the default. */
function safeParseFloat(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = parseFloat(value)
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/mcp && npx vitest run src/__tests__/config.test.ts`
Expected: PASS (all 8 tests)

**Step 5: Commit**

```bash
git add packages/mcp/src/config.ts packages/mcp/src/__tests__/config.test.ts
git commit -m "feat(mcp): add config loader"
```

---

### Task 3: list_sources Tool Handler

The simpler of the two tools. Creates sources, returns metadata. No orchestrator needed.

**Files:**

- Create: `packages/mcp/src/tools/list-sources.ts`
- Test: `packages/mcp/src/__tests__/tools/list-sources.test.ts`

**Step 1: Write the test**

```typescript
/**
 * Tests for the list_sources MCP tool handler.
 */

import { describe, it, expect } from "vitest"
import { listSourcesHandler } from "../../tools/list-sources.js"

describe("listSourcesHandler", () => {
  it("returns all sources when no category specified", () => {
    const result = listSourcesHandler({})
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")

    const sources = JSON.parse(result.content[0].text)
    expect(Array.isArray(sources)).toBe(true)
    expect(sources.length).toBeGreaterThan(0)
    expect(sources[0]).toHaveProperty("name")
    expect(sources[0]).toHaveProperty("type")
    expect(sources[0]).toHaveProperty("category")
    expect(sources[0]).toHaveProperty("reliabilityTier")
    expect(sources[0]).toHaveProperty("reliabilityScore")
    expect(sources[0]).toHaveProperty("isFree")
  })

  it("filters by category", () => {
    const result = listSourcesHandler({ category: "structured" })
    const sources = JSON.parse(result.content[0].text)
    expect(sources.length).toBeGreaterThan(0)
    for (const s of sources) {
      expect(s.category).toBe("structured")
    }
  })

  it("returns empty array for unknown category", () => {
    const result = listSourcesHandler({ category: "nonexistent" })
    const sources = JSON.parse(result.content[0].text)
    expect(sources).toEqual([])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/mcp && npx vitest run src/__tests__/tools/list-sources.test.ts`
Expected: FAIL — module not found

**Step 3: Write list-sources.ts**

```typescript
/**
 * list_sources MCP tool — returns available research sources with metadata.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { createSourcesWithCategory } from "../source-registry.js"

export interface ListSourcesArgs {
  category?: string
}

export function listSourcesHandler(args: ListSourcesArgs): CallToolResult {
  const categories = args.category ? [args.category] : undefined
  const tagged = createSourcesWithCategory(categories)

  const sources = tagged.map(({ source, category }) => ({
    name: source.name,
    type: source.type,
    category,
    reliabilityTier: source.reliabilityTier,
    reliabilityScore: source.reliabilityScore,
    domain: source.domain,
    isFree: source.isFree,
    estimatedCostPerQuery: source.estimatedCostPerQuery,
    available: source.isAvailable(),
  }))

  return {
    content: [{ type: "text", text: JSON.stringify(sources, null, 2) }],
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/mcp && npx vitest run src/__tests__/tools/list-sources.test.ts`
Expected: PASS (all 3 tests)

**Step 5: Commit**

```bash
git add packages/mcp/src/tools/list-sources.ts packages/mcp/src/__tests__/tools/list-sources.test.ts
git commit -m "feat(mcp): add list_sources tool handler"
```

---

### Task 4: debrief Tool Handler

The main tool. Creates sources, builds synthesizer, splits phases, runs orchestrator, returns results. Mirrors the server's debrief route logic but returns MCP `CallToolResult`.

**Files:**

- Create: `packages/mcp/src/tools/debrief.ts`
- Test: `packages/mcp/src/__tests__/tools/debrief.test.ts`

**Step 1: Write the test**

Mock the `debriefer` module (same pattern as server tests) to avoid real API calls.

```typescript
/**
 * Tests for the debrief MCP tool handler.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("debriefer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("debriefer")>()
  return {
    ...actual,
    ResearchOrchestrator: vi.fn().mockImplementation(() => ({
      debrief: vi.fn().mockResolvedValue({
        subject: { id: "Test", name: "Test" },
        data: null,
        findings: [],
        totalCostUsd: 0,
        sourcesAttempted: 2,
        sourcesSucceeded: 0,
        durationMs: 100,
      }),
    })),
    ClaudeSynthesizer: vi.fn().mockImplementation(() => ({})),
    NoopSynthesizer: vi.fn().mockImplementation(() => ({})),
  }
})

import { debriefHandler } from "../../tools/debrief.js"
import { ResearchOrchestrator, NoopSynthesizer, ClaudeSynthesizer } from "debriefer"
import type { McpConfig } from "../../config.js"

const baseConfig: McpConfig = {
  defaultBudget: 1.0,
  defaultModel: "claude-sonnet-4-20250514",
  anthropicApiKey: undefined,
}

beforeEach(() => {
  vi.mocked(ResearchOrchestrator).mockClear()
  vi.mocked(NoopSynthesizer).mockClear()
  vi.mocked(ClaudeSynthesizer).mockClear()
})

describe("debriefHandler", () => {
  it("returns structured result for valid request", async () => {
    const result = await debriefHandler({ name: "Test" }, baseConfig)
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")
    expect(result.isError).toBeUndefined()

    const data = JSON.parse(result.content[0].text)
    expect(data).toHaveProperty("subject")
    expect(data.subject.name).toBe("Test")
  })

  it("uses NoopSynthesizer by default", async () => {
    await debriefHandler({ name: "Test" }, baseConfig)
    expect(NoopSynthesizer).toHaveBeenCalled()
    expect(ClaudeSynthesizer).not.toHaveBeenCalled()
  })

  it("uses NoopSynthesizer when synthesis is false", async () => {
    await debriefHandler({ name: "Test", synthesis: false }, baseConfig)
    expect(NoopSynthesizer).toHaveBeenCalled()
  })

  it("returns error when synthesis requested without API key", async () => {
    const result = await debriefHandler({ name: "Test", synthesis: true }, baseConfig)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("ANTHROPIC_API_KEY")
  })

  it("uses ClaudeSynthesizer when synthesis is true and key present", async () => {
    const config = { ...baseConfig, anthropicApiKey: "sk-test" }
    await debriefHandler({ name: "Test", synthesis: true }, config)
    expect(ClaudeSynthesizer).toHaveBeenCalled()
  })

  it("passes default budget and model to orchestrator config", async () => {
    await debriefHandler({ name: "Test" }, baseConfig)
    const constructorArgs = vi.mocked(ResearchOrchestrator).mock.calls[0]
    const config = constructorArgs[2]!
    expect(config.costLimits?.maxCostPerSubject).toBe(1.0)
    expect(config.synthesis?.model).toBe("claude-sonnet-4-20250514")
  })

  it("uses request budget and model when provided", async () => {
    await debriefHandler({ name: "Test", budget: 5.0, model: "claude-opus-4-20250514" }, baseConfig)
    const constructorArgs = vi.mocked(ResearchOrchestrator).mock.calls[0]
    const config = constructorArgs[2]!
    expect(config.costLimits?.maxCostPerSubject).toBe(5.0)
    expect(config.synthesis?.model).toBe("claude-opus-4-20250514")
  })

  it("constructs orchestrator with phase groups", async () => {
    await debriefHandler({ name: "Test" }, baseConfig)
    const constructorArgs = vi.mocked(ResearchOrchestrator).mock.calls[0]
    const phases = constructorArgs[0]
    expect(Array.isArray(phases)).toBe(true)
    expect(phases.length).toBeGreaterThan(0)
    expect(phases[0]).toHaveProperty("phase")
    expect(phases[0]).toHaveProperty("sources")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/mcp && npx vitest run src/__tests__/tools/debrief.test.ts`
Expected: FAIL — module not found

**Step 3: Write debrief.ts**

```typescript
/**
 * debrief MCP tool — runs single-subject research across multiple sources.
 *
 * Creates sources filtered by category and availability, builds a synthesizer
 * (NoopSynthesizer by default, ClaudeSynthesizer when synthesis=true),
 * splits sources into free/paid phases, and runs the orchestrator.
 */

import { ResearchOrchestrator, ClaudeSynthesizer, NoopSynthesizer } from "debriefer"
import type { ResearchSubject, ResearchConfig, SourcePhaseGroup, Synthesizer } from "debriefer"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { createSourcesWithCategory } from "../source-registry.js"
import type { McpConfig } from "../config.js"

export interface DebriefArgs {
  name: string
  categories?: string[]
  budget?: number
  synthesis?: boolean
  model?: string
  prompt?: string
}

export async function debriefHandler(
  args: DebriefArgs,
  config: McpConfig
): Promise<CallToolResult> {
  try {
    // 1. Create sources and filter to available
    const tagged = createSourcesWithCategory(args.categories)
    const available = tagged.filter(({ source }) => source.isAvailable())

    if (available.length === 0) {
      return {
        content: [{ type: "text", text: "No sources available for the requested categories" }],
        isError: true,
      }
    }

    // 2. Build synthesizer
    const synthesis = args.synthesis ?? false
    let synthesizer: Synthesizer<ResearchSubject, unknown>

    if (synthesis) {
      if (!config.anthropicApiKey) {
        return {
          content: [
            {
              type: "text",
              text: "Synthesis requires ANTHROPIC_API_KEY to be configured",
            },
          ],
          isError: true,
        }
      }

      const jsonSuffix =
        '\nRespond ONLY with a valid JSON object: { "summary": "your synthesized summary" }'
      const defaultPrompt =
        "You are a research assistant. Synthesize the following findings into a clear, factual summary."

      synthesizer = new ClaudeSynthesizer<ResearchSubject, string>({
        promptBuilder: (subject, findings) => ({
          system: (args.prompt ?? defaultPrompt) + jsonSuffix,
          user:
            `Subject: ${subject.name}\n\nFindings:\n${findings.map((f) => `[${f.sourceName}] ${f.text}`).join("\n\n")}\n\n` +
            'Respond with JSON: { "summary": "..." }',
        }),
        responseParser: (data: unknown): string => {
          if (
            data &&
            typeof data === "object" &&
            "summary" in data &&
            typeof (data as { summary: unknown }).summary === "string"
          ) {
            return (data as { summary: string }).summary
          }
          throw new Error("Synthesis response missing required 'summary' string field")
        },
        apiKey: config.anthropicApiKey,
      })
    } else {
      synthesizer = new NoopSynthesizer<ResearchSubject>()
    }

    // 3. Split into free (phase 1) and paid (phase 2)
    const sources = available.map(({ source }) => source)
    const freeSources = sources.filter((s) => s.isFree)
    const paidSources = sources.filter((s) => !s.isFree)

    const phases: SourcePhaseGroup<ResearchSubject>[] = []
    if (freeSources.length > 0) {
      phases.push({ phase: 1, name: "Free Sources", sources: freeSources })
    }
    if (paidSources.length > 0) {
      phases.push({ phase: 2, name: "Paid Sources", sources: paidSources })
    }

    // 4. Build config
    const orchestratorConfig: ResearchConfig = {
      costLimits: {
        maxCostPerSubject: args.budget ?? config.defaultBudget,
      },
      synthesis: {
        model: args.model ?? config.defaultModel,
      },
    }

    // 5. Run orchestrator
    const orchestrator = new ResearchOrchestrator(phases, synthesizer, orchestratorConfig)
    const result = await orchestrator.debrief({ id: args.name, name: args.name })

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Research failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/mcp && npx vitest run src/__tests__/tools/debrief.test.ts`
Expected: PASS (all 8 tests)

**Step 5: Commit**

```bash
git add packages/mcp/src/tools/debrief.ts packages/mcp/src/__tests__/tools/debrief.test.ts
git commit -m "feat(mcp): add debrief tool handler"
```

---

### Task 5: MCP Server Entry Point

Wire up `McpServer`, register both tools with Zod input schemas, connect via `StdioServerTransport`.

**Files:**

- Modify: `packages/mcp/src/index.ts` (replace stub)
- Test: `packages/mcp/src/__tests__/server.test.ts`

**Step 1: Write the test**

Use `InMemoryTransport` to test the server without stdio. Verify tool listing and basic tool calls.

```typescript
/**
 * Tests for the MCP server entry point.
 *
 * Uses InMemoryTransport to test the server without stdio.
 * Mocks the debriefer module to avoid real API calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

vi.mock("debriefer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("debriefer")>()
  return {
    ...actual,
    ResearchOrchestrator: vi.fn().mockImplementation(() => ({
      debrief: vi.fn().mockResolvedValue({
        subject: { id: "Test", name: "Test" },
        data: null,
        findings: [],
        totalCostUsd: 0,
        sourcesAttempted: 2,
        sourcesSucceeded: 0,
        durationMs: 100,
      }),
    })),
    ClaudeSynthesizer: vi.fn().mockImplementation(() => ({})),
    NoopSynthesizer: vi.fn().mockImplementation(() => ({})),
  }
})

import { createServer } from "../index.js"

describe("MCP server", () => {
  let client: Client

  beforeEach(async () => {
    const server = createServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    client = new Client({ name: "test-client", version: "1.0.0" })
    await client.connect(clientTransport)
  })

  it("lists both tools", async () => {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    expect(names).toContain("debrief")
    expect(names).toContain("list_sources")
    expect(tools).toHaveLength(2)
  })

  it("debrief tool has correct input schema", async () => {
    const { tools } = await client.listTools()
    const debrief = tools.find((t) => t.name === "debrief")!
    expect(debrief.inputSchema.required).toContain("name")
  })

  it("list_sources returns sources", async () => {
    const result = await client.callTool({ name: "list_sources", arguments: {} })
    expect(result.content).toHaveLength(1)
    const sources = JSON.parse((result.content[0] as { text: string }).text)
    expect(Array.isArray(sources)).toBe(true)
    expect(sources.length).toBeGreaterThan(0)
  })

  it("debrief returns result", async () => {
    const result = await client.callTool({
      name: "debrief",
      arguments: { name: "Test" },
    })
    expect(result.content).toHaveLength(1)
    const data = JSON.parse((result.content[0] as { text: string }).text)
    expect(data.subject.name).toBe("Test")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/mcp && npx vitest run src/__tests__/server.test.ts`
Expected: FAIL — `createServer` not exported

**Step 3: Write index.ts**

Replace the stub with the full server implementation. Export `createServer()` for testing; call it and connect stdio when run directly.

```typescript
#!/usr/bin/env node
/**
 * Debriefer MCP server — exposes research orchestration as MCP tools.
 *
 * Tools:
 * - debrief: Research a single subject across multiple sources
 * - list_sources: List available research sources with metadata
 *
 * Run: npx debriefer-mcp
 * Config: ANTHROPIC_API_KEY, DEFAULT_BUDGET, DEFAULT_MODEL env vars
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { loadConfig } from "./config.js"
import { debriefHandler } from "./tools/debrief.js"
import { listSourcesHandler } from "./tools/list-sources.js"
import { VALID_CATEGORIES } from "./source-registry.js"

export function createServer(): McpServer {
  const config = loadConfig()

  const server = new McpServer({
    name: "debriefer",
    version: "0.1.0",
  })

  server.tool(
    "debrief",
    `Research a single subject across ${VALID_CATEGORIES.length} categories of sources (news, archives, books, search, structured data, obituary). Returns findings with reliability scores. Set synthesis=true to get an AI-synthesized summary (requires ANTHROPIC_API_KEY).`,
    {
      name: z.string().describe("Subject to research"),
      categories: z
        .array(z.string())
        .optional()
        .describe(`Filter to specific categories: ${VALID_CATEGORIES.join(", ")}`),
      budget: z.number().positive().optional().describe("Max cost in USD (default: 1.0)"),
      synthesis: z
        .boolean()
        .optional()
        .describe("Run AI synthesis on findings (default: false, requires ANTHROPIC_API_KEY)"),
      model: z.string().optional().describe("Model for synthesis"),
      prompt: z.string().optional().describe("Custom synthesis prompt"),
    },
    async (args) => debriefHandler(args, config)
  )

  server.tool(
    "list_sources",
    "List available research sources with reliability tiers, categories, and availability status.",
    {
      category: z
        .string()
        .optional()
        .describe(`Filter to one category: ${VALID_CATEGORIES.join(", ")}`),
    },
    (args) => listSourcesHandler(args)
  )

  return server
}

// Run when executed directly (not imported for testing)
const isDirectRun =
  process.argv[1]?.includes("debriefer-mcp") || process.argv[1]?.endsWith("index.js")
if (isDirectRun) {
  const server = createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
```

Note: The `McpServer` high-level API uses `.tool(name, description, schema, handler)` rather than `.registerTool()`. The schema is passed as a Zod shape (object of Zod types), not a full `z.object()`. Check the actual SDK API and adjust if needed — the exact method signature may vary.

**Step 4: Run test to verify it passes**

Run: `cd packages/mcp && npx vitest run src/__tests__/server.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add packages/mcp/src/index.ts packages/mcp/src/__tests__/server.test.ts
git commit -m "feat(mcp): add MCP server entry point with tool registration"
```

---

### Task 6: Add zod Dependency and vitest Config

The MCP package needs `zod` for input schemas and a vitest config for testing.

**Note:** This task should be done first if the build fails, or alongside Task 1 if needed. Listed here for completeness.

**Files:**

- Modify: `packages/mcp/package.json` — add `zod` dependency
- Create: `packages/mcp/vitest.config.ts` (if not present — check first)

**Step 1: Add zod to package.json**

```bash
cd packages/mcp && npm install zod
```

**Step 2: Create vitest.config.ts** (if missing)

```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: false,
  },
})
```

**Step 3: Commit**

```bash
git add packages/mcp/package.json packages/mcp/vitest.config.ts ../../package-lock.json
git commit -m "chore(mcp): add zod dependency and vitest config"
```

---

### Task 7: Pre-Push Verification

Run the full CI checklist before pushing.

**Step 1: Run all checks**

```bash
npx turbo test lint type-check
npx prettier --check .
```

Expected: All passing. If prettier fails, run `npx prettier --write .` and commit.

**Step 2: Create feature branch and push**

```bash
git checkout -b feat/mcp-server
git push -u origin feat/mcp-server
```

**Step 3: Create PR**

````bash
gh pr create --title "Phase 8: MCP server (debrief + list_sources tools)" --body "$(cat <<'EOF'
## Summary

Implements Phase 8 — an MCP server wrapping debriefer's research orchestration, exposable as tools for AI assistants.

### Tools

- **debrief** — Research a single subject across 6 categories of sources. Returns findings with reliability scores. Optional AI synthesis.
- **list_sources** — List available sources with reliability tiers and availability.

### Architecture

- `McpServer` from `@modelcontextprotocol/sdk` with `StdioServerTransport`
- Reuses orchestrator patterns from the server package
- Config from env vars: `ANTHROPIC_API_KEY`, `DEFAULT_BUDGET`, `DEFAULT_MODEL`

### Usage

```json
{
  "mcpServers": {
    "debriefer": {
      "command": "npx",
      "args": ["debriefer-mcp"]
    }
  }
}
```

## Test plan

- [ ] Source registry tests
- [ ] Config tests
- [ ] list_sources tool handler tests
- [ ] debrief tool handler tests
- [ ] MCP server integration tests (InMemoryTransport)
- [ ] Type-check, lint, prettier clean
EOF
)"
````

---

## Task Order

Tasks should be implemented in this order:

1. **Task 6** — Dependencies (zod, vitest config) — do this first
2. **Task 1** — Source registry
3. **Task 2** — Config
4. **Task 3** — list_sources tool handler
5. **Task 4** — debrief tool handler
6. **Task 5** — MCP server entry point
7. **Task 7** — Pre-push verification + PR

```

```
