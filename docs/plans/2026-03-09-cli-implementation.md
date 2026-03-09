# CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement `debriefer` CLI with two commands — `debrief` (single-subject research) and `sources` (list available sources).

**Architecture:** Thin Commander.js wrapper over the core `ResearchOrchestrator` and `debriefer-sources`. Source registry maps category names to factory functions. Text formatter provides human-readable output. JSON mode outputs structured results for piping.

**Tech Stack:** Commander.js 13, debriefer (core), debriefer-sources, vitest

**Design doc:** `docs/plans/2026-03-09-cli-design.md`

---

## Task 1: Source Registry

The source registry maps category names to arrays of factory functions. It's the glue between CLI category selection and the 30+ source factory functions exported by `debriefer-sources`.

**Files:**

- Create: `packages/cli/src/source-registry.ts`
- Test: `packages/cli/src/__tests__/source-registry.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/cli/src/__tests__/source-registry.test.ts
import { describe, it, expect } from "vitest"
import { createSources, SOURCE_CATEGORIES } from "../source-registry.js"

describe("SOURCE_CATEGORIES", () => {
  it("has expected category names", () => {
    const names = Object.keys(SOURCE_CATEGORIES)
    expect(names).toContain("structured")
    expect(names).toContain("news")
    expect(names).toContain("search")
    expect(names).toContain("books")
    expect(names).toContain("archives")
    expect(names).toContain("obituary")
    expect(names.length).toBe(6)
  })
})

describe("createSources", () => {
  it("returns sources for all categories when no filter", () => {
    const sources = createSources()
    expect(sources.length).toBeGreaterThan(0)
    // Every source should have name, type, reliabilityTier
    for (const source of sources) {
      expect(source.name).toBeTruthy()
      expect(source.type).toBeTruthy()
    }
  })

  it("filters by category when categories provided", () => {
    const sources = createSources(["structured"])
    const types = sources.map((s) => s.type)
    expect(types).toContain("wikidata")
    expect(types).toContain("wikipedia")
    // Should NOT contain sources from other categories
    expect(types).not.toContain("google-search")
    expect(types).not.toContain("open-library")
  })

  it("combines multiple categories", () => {
    const sources = createSources(["structured", "books"])
    const types = sources.map((s) => s.type)
    expect(types).toContain("wikidata")
    expect(types).toContain("open-library")
  })

  it("ignores unknown category names", () => {
    const sources = createSources(["structured", "nonexistent"])
    const types = sources.map((s) => s.type)
    expect(types).toContain("wikidata")
    // Should not throw, just skip unknown
  })

  it("returns empty array for only unknown categories", () => {
    const sources = createSources(["nonexistent"])
    expect(sources).toEqual([])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run src/__tests__/source-registry.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// packages/cli/src/source-registry.ts
import type { BaseResearchSource, ResearchSubject } from "debriefer"
import {
  wikidata,
  wikipedia,
  apNews,
  bbcNews,
  reuters,
  npr,
  independent,
  telegraph,
  washingtonPost,
  laTimes,
  time,
  newYorker,
  pbs,
  britannica,
  rollingStone,
  smithsonian,
  nationalGeographic,
  historyCom,
  tcm,
  allMusic,
  people,
  biographyCom,
  guardian,
  nytimes,
  googleSearch,
  bingSearch,
  braveSearch,
  duckduckgoSearch,
  googleBooks,
  openLibrary,
  chroniclingAmerica,
  trove,
  europeana,
  internetArchive,
  legacy,
  findAGrave,
} from "debriefer-sources"

type SourceFactory = () => BaseResearchSource<ResearchSubject>

/**
 * Map from category name to source factory functions.
 *
 * Each factory creates a source with default options. API-key-dependent sources
 * read keys from environment variables — use isAvailable() to check.
 */
export const SOURCE_CATEGORIES: Record<string, SourceFactory[]> = {
  structured: [wikidata, wikipedia],
  news: [
    apNews,
    bbcNews,
    reuters,
    npr,
    independent,
    telegraph,
    washingtonPost,
    laTimes,
    time,
    newYorker,
    pbs,
    britannica,
    rollingStone,
    smithsonian,
    nationalGeographic,
    historyCom,
    tcm,
    allMusic,
    people,
    biographyCom,
    guardian,
    nytimes,
  ],
  search: [googleSearch, bingSearch, braveSearch, duckduckgoSearch],
  books: [googleBooks, openLibrary],
  archives: [chroniclingAmerica, trove, europeana, internetArchive],
  obituary: [legacy, findAGrave],
}

/**
 * Create source instances for the given categories (or all if omitted).
 *
 * Unknown category names are silently ignored.
 */
export function createSources(categories?: string[]): BaseResearchSource<ResearchSubject>[] {
  const cats = categories ?? Object.keys(SOURCE_CATEGORIES)
  const sources: BaseResearchSource<ResearchSubject>[] = []

  for (const cat of cats) {
    const factories = SOURCE_CATEGORIES[cat]
    if (!factories) continue
    for (const factory of factories) {
      sources.push(factory())
    }
  }

  return sources
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run src/__tests__/source-registry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/cli/src/source-registry.ts packages/cli/src/__tests__/source-registry.test.ts
git commit -m "feat(cli): add source registry mapping categories to factory functions"
```

---

## Task 2: Text Formatter

Formats `DebriefResult` and source listings into human-readable terminal output.

**Files:**

- Create: `packages/cli/src/formatters.ts`
- Test: `packages/cli/src/__tests__/formatters.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/cli/src/__tests__/formatters.test.ts
import { describe, it, expect } from "vitest"
import { ReliabilityTier, RELIABILITY_SCORES } from "debriefer"
import type { DebriefResult, ScoredFinding, ResearchSubject } from "debriefer"
import type { BaseResearchSource } from "debriefer"
import { formatDebriefResult, formatSourceList } from "../formatters.js"

const makeFinding = (overrides: Partial<ScoredFinding> = {}): ScoredFinding => ({
  text: "Test finding text",
  confidence: 0.8,
  costUsd: 0,
  sourceType: "wikipedia",
  sourceName: "Wikipedia",
  reliabilityTier: ReliabilityTier.SECONDARY_COMPILATION,
  reliabilityScore: RELIABILITY_SCORES[ReliabilityTier.SECONDARY_COMPILATION],
  ...overrides,
})

describe("formatDebriefResult", () => {
  it("formats a result with synthesis as text", () => {
    const result: DebriefResult<string> = {
      subject: { id: 1, name: "John Wayne" },
      data: "John Wayne was an American actor.",
      findings: [makeFinding()],
      totalCostUsd: 0.001,
      sourcesAttempted: 5,
      sourcesSucceeded: 1,
      durationMs: 2500,
    }

    const text = formatDebriefResult(result)
    expect(text).toContain("John Wayne")
    expect(text).toContain("John Wayne was an American actor.")
    expect(text).toContain("1 of 5")
    expect(text).toContain("$0.0010")
  })

  it("formats a result with raw findings (no synthesis)", () => {
    const result: DebriefResult<ScoredFinding[]> = {
      subject: { id: 1, name: "John Wayne" },
      data: [makeFinding()],
      findings: [makeFinding()],
      totalCostUsd: 0,
      sourcesAttempted: 2,
      sourcesSucceeded: 1,
      durationMs: 1000,
    }

    const text = formatDebriefResult(result)
    expect(text).toContain("Wikipedia")
    expect(text).toContain("Test finding text")
  })

  it("handles zero findings", () => {
    const result: DebriefResult<string> = {
      subject: { id: 1, name: "John Wayne" },
      data: null,
      findings: [],
      totalCostUsd: 0,
      sourcesAttempted: 3,
      sourcesSucceeded: 0,
      durationMs: 500,
    }

    const text = formatDebriefResult(result)
    expect(text).toContain("No findings")
  })
})

/** Minimal source-like object for testing formatSourceList. */
interface SourceInfo {
  name: string
  type: string
  reliabilityTier: ReliabilityTier
  reliabilityScore: number
  domain: string
  isFree: boolean
  estimatedCostPerQuery: number
  isAvailable(): boolean
}

describe("formatSourceList", () => {
  it("formats sources as a table", () => {
    const sources: SourceInfo[] = [
      {
        name: "Wikipedia",
        type: "wikipedia",
        reliabilityTier: ReliabilityTier.SECONDARY_COMPILATION,
        reliabilityScore: 0.85,
        domain: "en.wikipedia.org",
        isFree: true,
        estimatedCostPerQuery: 0,
        isAvailable: () => true,
      },
    ]

    const text = formatSourceList(
      sources as unknown as BaseResearchSource<ResearchSubject>[],
      "structured"
    )
    expect(text).toContain("Wikipedia")
    expect(text).toContain("SECONDARY_COMPILATION")
    // Available marker
    expect(text).toMatch(/yes|✓|available/i)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run src/__tests__/formatters.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// packages/cli/src/formatters.ts
import type { DebriefResult, ScoredFinding, ResearchSubject, BaseResearchSource } from "debriefer"

/**
 * Format a debrief result as human-readable text.
 */
export function formatDebriefResult<TOutput>(result: DebriefResult<TOutput>): string {
  const lines: string[] = []

  lines.push(`Subject: ${result.subject.name}`)
  lines.push(`Sources: ${result.sourcesSucceeded} of ${result.sourcesAttempted} returned findings`)
  lines.push(`Cost: $${result.totalCostUsd.toFixed(4)}`)
  lines.push(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`)
  if (result.stoppedAtPhase !== undefined) {
    lines.push(`Early stop: phase ${result.stoppedAtPhase}`)
  }
  lines.push("")

  if (result.findings.length === 0) {
    lines.push("No findings collected.")
    return lines.join("\n")
  }

  // If data is a string (synthesized), show it
  if (typeof result.data === "string") {
    lines.push("--- Synthesis ---")
    lines.push(result.data)
  } else if (Array.isArray(result.data)) {
    // Raw findings mode (NoopSynthesizer returns ScoredFinding[])
    lines.push(`--- Findings (${result.findings.length}) ---`)
    for (const f of result.findings) {
      lines.push("")
      lines.push(`[${f.sourceName}] (${f.reliabilityTier}, confidence: ${f.confidence.toFixed(2)})`)
      if (f.url) lines.push(`  URL: ${f.url}`)
      lines.push(`  ${f.text.slice(0, 300)}${f.text.length > 300 ? "..." : ""}`)
    }
  } else if (result.data === null) {
    lines.push("No findings collected.")
  } else {
    // Structured output — JSON dump
    lines.push("--- Result ---")
    lines.push(JSON.stringify(result.data, null, 2))
  }

  return lines.join("\n")
}

/**
 * Format a list of sources as a human-readable table.
 */
export function formatSourceList(
  sources: BaseResearchSource<ResearchSubject>[],
  category?: string
): string {
  const lines: string[] = []

  if (category) {
    lines.push(`Sources in category: ${category}`)
  } else {
    lines.push("All available sources")
  }
  lines.push("")

  // Header
  const header = [
    "Name".padEnd(25),
    "Type".padEnd(20),
    "Tier".padEnd(25),
    "Free".padEnd(6),
    "Available".padEnd(10),
  ].join(" ")
  lines.push(header)
  lines.push("-".repeat(header.length))

  for (const s of sources) {
    const row = [
      s.name.padEnd(25),
      s.type.padEnd(20),
      s.reliabilityTier.padEnd(25),
      (s.isFree ? "yes" : "no").padEnd(6),
      (s.isAvailable() ? "yes" : "no").padEnd(10),
    ].join(" ")
    lines.push(row)
  }

  lines.push("")
  const available = sources.filter((s) => s.isAvailable()).length
  lines.push(`${available} of ${sources.length} sources available`)

  return lines.join("\n")
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run src/__tests__/formatters.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/cli/src/formatters.ts packages/cli/src/__tests__/formatters.test.ts
git commit -m "feat(cli): add text formatters for debrief results and source listing"
```

---

## Task 3: `sources` Command

The simpler of the two commands — lists available sources.

**Files:**

- Create: `packages/cli/src/commands/sources.ts`
- Test: `packages/cli/src/__tests__/commands/sources.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/cli/src/__tests__/commands/sources.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildSourcesCommand } from "../../commands/sources.js"

describe("buildSourcesCommand", () => {
  let output: string[]

  beforeEach(() => {
    output = []
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "))
    })
  })

  it("lists all sources in text format", async () => {
    const cmd = buildSourcesCommand()
    await cmd.parseAsync([], { from: "user" })

    const text = output.join("\n")
    expect(text).toContain("Wikipedia")
    expect(text).toContain("Wikidata")
    expect(text).toContain("sources available")
  })

  it("filters by category", async () => {
    const cmd = buildSourcesCommand()
    await cmd.parseAsync(["--category", "books"], { from: "user" })

    const text = output.join("\n")
    expect(text).toContain("Google Books")
    expect(text).toContain("Open Library")
    expect(text).not.toContain("Wikipedia")
  })

  it("outputs JSON when --format json", async () => {
    const cmd = buildSourcesCommand()
    await cmd.parseAsync(["--format", "json"], { from: "user" })

    const text = output.join("\n")
    const parsed = JSON.parse(text)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0]).toHaveProperty("name")
    expect(parsed[0]).toHaveProperty("type")
    expect(parsed[0]).toHaveProperty("available")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run src/__tests__/commands/sources.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// packages/cli/src/commands/sources.ts
import { Command } from "commander"
import { createSources, SOURCE_CATEGORIES } from "../source-registry.js"
import { formatSourceList } from "../formatters.js"

export function buildSourcesCommand(): Command {
  return new Command("sources")
    .description("List available sources")
    .option("--category <cat>", "Filter to a specific category")
    .option("--format <fmt>", "Output format: json or text", "text")
    .action((options: { category?: string; format: string }) => {
      const categories = options.category ? [options.category] : undefined
      const sources = createSources(categories)

      if (options.format === "json") {
        const data = sources.map((s) => ({
          name: s.name,
          type: s.type,
          category: findCategory(s.type),
          reliabilityTier: s.reliabilityTier,
          reliabilityScore: s.reliabilityScore,
          domain: s.domain,
          isFree: s.isFree,
          estimatedCostPerQuery: s.estimatedCostPerQuery,
          available: s.isAvailable(),
        }))
        console.log(JSON.stringify(data, null, 2))
      } else {
        console.log(formatSourceList(sources, options.category))
      }
    })
}

/** Find which category a source type belongs to. */
function findCategory(sourceType: string): string | undefined {
  for (const [cat, factories] of Object.entries(SOURCE_CATEGORIES)) {
    for (const factory of factories) {
      const source = factory()
      if (source.type === sourceType) return cat
    }
  }
  return undefined
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run src/__tests__/commands/sources.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/cli/src/commands/sources.ts packages/cli/src/__tests__/commands/sources.test.ts
git commit -m "feat(cli): add sources command to list available sources"
```

---

## Task 4: `debrief` Command

The main command — researches a single subject across selected source categories.

**Files:**

- Create: `packages/cli/src/commands/debrief.ts`
- Test: `packages/cli/src/__tests__/commands/debrief.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/cli/src/__tests__/commands/debrief.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildDebriefCommand } from "../../commands/debrief.js"

// Mock the core orchestrator
vi.mock("debriefer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("debriefer")>()
  return {
    ...actual,
    ResearchOrchestrator: vi.fn().mockImplementation(() => ({
      debrief: vi.fn().mockResolvedValue({
        subject: { id: 1, name: "John Wayne" },
        data: "John Wayne was an American actor.",
        findings: [
          {
            text: "Test finding",
            confidence: 0.8,
            costUsd: 0,
            sourceType: "wikipedia",
            sourceName: "Wikipedia",
            reliabilityTier: actual.ReliabilityTier.SECONDARY_COMPILATION,
            reliabilityScore: 0.85,
          },
        ],
        totalCostUsd: 0.001,
        sourcesAttempted: 5,
        sourcesSucceeded: 1,
        durationMs: 2500,
      }),
    })),
    ClaudeSynthesizer: vi.fn().mockImplementation(() => ({})),
    NoopSynthesizer: vi.fn().mockImplementation(() => ({})),
  }
})

describe("buildDebriefCommand", () => {
  let output: string[]
  let errorOutput: string[]

  beforeEach(() => {
    output = []
    errorOutput = []
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "))
    })
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errorOutput.push(args.map(String).join(" "))
    })
  })

  it("runs debrief for a subject and shows text output", async () => {
    const cmd = buildDebriefCommand()
    await cmd.parseAsync(["John Wayne", "--no-synthesis"], { from: "user" })

    const text = output.join("\n")
    expect(text).toContain("John Wayne")
  })

  it("outputs JSON when --format json", async () => {
    const cmd = buildDebriefCommand()
    await cmd.parseAsync(["John Wayne", "--no-synthesis", "--format", "json"], {
      from: "user",
    })

    const text = output.join("\n")
    const parsed = JSON.parse(text)
    expect(parsed.subject.name).toBe("John Wayne")
    expect(parsed.findings).toBeDefined()
  })

  it("filters sources by category", async () => {
    const { ResearchOrchestrator } = await import("debriefer")
    const cmd = buildDebriefCommand()
    await cmd.parseAsync(["John Wayne", "--no-synthesis", "--categories", "structured"], {
      from: "user",
    })

    // Verify orchestrator was called (mocked)
    expect(ResearchOrchestrator).toHaveBeenCalled()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run src/__tests__/commands/debrief.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// packages/cli/src/commands/debrief.ts
import { Command, InvalidArgumentError } from "commander"
import {
  ResearchOrchestrator,
  ClaudeSynthesizer,
  NoopSynthesizer,
  type ResearchSubject,
  type ScoredFinding,
  type SourcePhaseGroup,
  type LifecycleHooks,
  type ResearchConfig,
} from "debriefer"
import { createSources } from "../source-registry.js"
import { formatDebriefResult } from "../formatters.js"

function parsePositiveFloat(value: string): number {
  const n = parseFloat(value)
  if (Number.isNaN(n) || n <= 0) {
    throw new InvalidArgumentError("Must be a positive number.")
  }
  return n
}

interface DebriefOptions {
  budget: number
  categories?: string
  model: string
  prompt?: string
  synthesis: boolean
  format: string
  verbose: boolean
}

export function buildDebriefCommand(): Command {
  return new Command("debrief")
    .description("Research a subject across multiple sources")
    .argument("<name>", "Subject name to research")
    .option("--budget <usd>", "Max cost in USD", parsePositiveFloat, 1.0)
    .option("--categories <list>", "Comma-separated source categories")
    .option("--model <model>", "Synthesis model", "claude-sonnet-4-20250514")
    .option("--prompt <text>", "Custom synthesis system prompt")
    .option("--no-synthesis", "Skip AI synthesis, return raw findings only")
    .option("--format <fmt>", "Output format: json or text", "text")
    .option("--verbose", "Show detailed progress", false)
    .action(async (name: string, options: DebriefOptions) => {
      await runDebrief(name, options)
    })
}

async function runDebrief(name: string, options: DebriefOptions): Promise<void> {
  // Parse categories
  const categories = options.categories
    ? options.categories.split(",").map((c) => c.trim())
    : undefined

  // Create sources filtered by category
  const allSources = createSources(categories)
  const availableSources = allSources.filter((s) => s.isAvailable())

  if (availableSources.length === 0) {
    console.error(
      "No sources available. Set API keys for paid sources or use --categories to select free sources."
    )
    console.error(
      "Free categories: structured, archives, obituary. Run 'debriefer sources' to see all."
    )
    process.exitCode = 1
    return
  }

  if (options.verbose) {
    console.error(
      `Using ${availableSources.length} of ${allSources.length} sources (${allSources.length - availableSources.length} skipped — unavailable)`
    )
  }

  // Build synthesizer
  let synthesizer
  if (options.synthesis) {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error(
        "ANTHROPIC_API_KEY is required for synthesis. Set the environment variable or use --no-synthesis."
      )
      process.exitCode = 1
      return
    }
    synthesizer = new ClaudeSynthesizer<ResearchSubject, string>({
      responseParser: (text) => text,
    })
  } else {
    synthesizer = new NoopSynthesizer<ResearchSubject>()
  }

  // Build a single phase with all available sources
  const phases: SourcePhaseGroup<ResearchSubject>[] = [
    { phase: 1, name: "All Sources", sources: availableSources },
  ]

  // Config
  const config: ResearchConfig = {
    costLimits: { maxCostPerSubject: options.budget },
    synthesis: {
      model: options.model,
      systemPrompt: options.prompt,
    },
  }

  // Lifecycle hooks for verbose output
  const hooks: LifecycleHooks<ResearchSubject, unknown> = {}
  if (options.verbose) {
    hooks.onSourceComplete = (_subject, sourceName, finding, costUsd) => {
      const status = finding ? "found" : "no result"
      console.error(`  ${sourceName}: ${status} ($${costUsd.toFixed(4)})`)
    }
  }

  // Build orchestrator and run
  const orchestrator = new ResearchOrchestrator(phases, synthesizer, config)
  const subject: ResearchSubject = { id: 1, name }

  if (options.verbose) {
    console.error(`Researching "${name}"...`)
  }

  const result = await orchestrator.debrief(subject, { hooks })

  // Output
  if (options.format === "json") {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(formatDebriefResult(result))
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run src/__tests__/commands/debrief.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/cli/src/commands/debrief.ts packages/cli/src/__tests__/commands/debrief.test.ts
git commit -m "feat(cli): add debrief command for single-subject research"
```

---

## Task 5: Wire Up `index.ts` Entry Point

Connect the commands to the Commander.js program and add the shebang line.

**Files:**

- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/src/__tests__/cli.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/cli/src/__tests__/cli.test.ts
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
```

**Step 2: Run test to verify it fails**

Run: `cd packages/cli && npx vitest run src/__tests__/cli.test.ts`
Expected: FAIL — `buildProgram` not exported

**Step 3: Write the implementation**

```typescript
// packages/cli/src/index.ts
#!/usr/bin/env node
import { Command } from "commander"
import { buildDebriefCommand } from "./commands/debrief.js"
import { buildSourcesCommand } from "./commands/sources.js"

export function buildProgram(): Command {
  const program = new Command()
    .name("debriefer")
    .description("Multi-source research orchestration engine")
    .version("0.1.0")

  program.addCommand(buildDebriefCommand())
  program.addCommand(buildSourcesCommand())

  return program
}

// Only parse when executed directly (not when imported in tests)
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith("/debriefer") ||
    process.argv[1].endsWith("/index.js") ||
    process.argv[1].endsWith("/index.ts"))

if (isDirectExecution) {
  buildProgram().parse()
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/cli && npx vitest run src/__tests__/cli.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/__tests__/cli.test.ts
git commit -m "feat(cli): wire up entry point with debrief and sources commands"
```

---

## Task 6: Add `@anthropic-ai/sdk` Peer Dependency and Build Verification

**Files:**

- Modify: `packages/cli/package.json` — add `@anthropic-ai/sdk` as optional peer dep

**Step 1: Update package.json**

Add to `packages/cli/package.json`:

```json
"peerDependencies": {
  "@anthropic-ai/sdk": ">=0.30.0"
},
"peerDependenciesMeta": {
  "@anthropic-ai/sdk": {
    "optional": true
  }
}
```

**Step 2: Build the CLI package**

Run: `npx turbo build --filter=debriefer-cli`
Expected: successful build with no type errors

**Step 3: Run all tests across the monorepo**

Run: `npx turbo test lint type-check`
Expected: all pass

**Step 4: Run prettier**

Run: `npx prettier --check .`
Expected: no issues (or fix with `npx prettier --write .`)

**Step 5: Commit**

```bash
git add packages/cli/package.json
git commit -m "feat(cli): add @anthropic-ai/sdk as optional peer dependency"
```

---

## Task 7: Manual Smoke Test and Final Verification

**Step 1: Test `sources` command**

Run: `node packages/cli/dist/index.js sources`
Expected: table of sources with availability status

Run: `node packages/cli/dist/index.js sources --format json`
Expected: JSON array of source objects

Run: `node packages/cli/dist/index.js sources --category structured`
Expected: only Wikidata and Wikipedia shown

**Step 2: Test `debrief --no-synthesis`**

Run: `node packages/cli/dist/index.js debrief "Albert Einstein" --no-synthesis --categories structured --format text`
Expected: findings from Wikipedia/Wikidata (these are free, no API key needed)

Run: `node packages/cli/dist/index.js debrief "Albert Einstein" --no-synthesis --categories structured --format json`
Expected: JSON output with subject, findings, metadata

**Step 3: Test error cases**

Run: `node packages/cli/dist/index.js debrief "Test" --categories nonexistent`
Expected: "No sources available" error

Run: `node packages/cli/dist/index.js debrief "Test"` (without ANTHROPIC_API_KEY)
Expected: "ANTHROPIC_API_KEY is required" error

**Step 4: Full CI check**

Run: `npx turbo test lint type-check && npx prettier --check .`
Expected: all pass

**Step 5: Commit any fixes, then push**

```bash
git push -u origin feat/cli
```
