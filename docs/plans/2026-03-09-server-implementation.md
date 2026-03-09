# HTTP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a minimal Express REST API (`debriefer-server`) with three endpoints: `POST /api/debrief`, `GET /api/sources`, `GET /api/health`, plus optional API key auth.

**Architecture:** Express app factory (`app.ts`) separated from server start (`index.ts`) for testability. Zod schemas validate requests at the trust boundary. Source registry and config are server-specific modules. Auth middleware is opt-in via env var.

**Tech Stack:** Express 4, Zod 3, debriefer (core), debriefer-sources, vitest, supertest

**Design doc:** `docs/plans/2026-03-09-server-design.md`

---

## Task 0: Package Setup

Install missing dependencies and configure the project.

**Files:**

- Modify: `packages/server/package.json`

**Step 1: Install dev dependencies and update package.json**

```bash
cd /Users/chris/Source/debriefer
npm install -D @types/express @types/cors supertest @types/supertest -w packages/server
```

Also add `@anthropic-ai/sdk` as a regular dependency (same reason as CLI — `debriefer` imports it at module load):

```bash
npm install @anthropic-ai/sdk -w packages/server
```

Remove `js-yaml` (not needed for v1):

```bash
npm uninstall js-yaml -w packages/server
```

**Step 2: Create vitest config**

Create `packages/server/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: false,
    include: ["src/**/*.test.ts"],
  },
})
```

**Step 3: Commit**

```bash
git add packages/server/package.json packages/server/vitest.config.ts package-lock.json
git commit -m "chore(server): add dev dependencies and vitest config"
```

---

## Task 1: Config Module

Reads environment variables into a typed config object.

**Files:**

- Create: `packages/server/src/config.ts`
- Test: `packages/server/src/__tests__/config.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/server/src/__tests__/config.test.ts
import { describe, it, expect, vi, afterEach } from "vitest"
import { loadConfig } from "../config.js"

describe("loadConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns defaults when no env vars are set", () => {
    const config = loadConfig()
    expect(config.port).toBe(8090)
    expect(config.apiKeys).toEqual([])
    expect(config.defaultBudget).toBe(1.0)
    expect(config.defaultModel).toBe("claude-sonnet-4-20250514")
  })

  it("reads PORT from env", () => {
    vi.stubEnv("PORT", "3000")
    const config = loadConfig()
    expect(config.port).toBe(3000)
  })

  it("reads DEBRIEFER_API_KEYS from env", () => {
    vi.stubEnv("DEBRIEFER_API_KEYS", "sk-abc,sk-def")
    const config = loadConfig()
    expect(config.apiKeys).toEqual(["sk-abc", "sk-def"])
  })

  it("filters empty API key segments", () => {
    vi.stubEnv("DEBRIEFER_API_KEYS", "sk-abc,,sk-def,")
    const config = loadConfig()
    expect(config.apiKeys).toEqual(["sk-abc", "sk-def"])
  })

  it("reads DEFAULT_BUDGET from env", () => {
    vi.stubEnv("DEFAULT_BUDGET", "0.50")
    const config = loadConfig()
    expect(config.defaultBudget).toBe(0.5)
  })

  it("reads DEFAULT_MODEL from env", () => {
    vi.stubEnv("DEFAULT_MODEL", "claude-opus-4-20250514")
    const config = loadConfig()
    expect(config.defaultModel).toBe("claude-opus-4-20250514")
  })

  it("authEnabled is true when API keys are configured", () => {
    vi.stubEnv("DEBRIEFER_API_KEYS", "sk-abc")
    const config = loadConfig()
    expect(config.authEnabled).toBe(true)
  })

  it("authEnabled is false when no API keys", () => {
    const config = loadConfig()
    expect(config.authEnabled).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/__tests__/config.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// packages/server/src/config.ts
/**
 * Server configuration from environment variables.
 */

export interface ServerConfig {
  port: number
  apiKeys: string[]
  authEnabled: boolean
  defaultBudget: number
  defaultModel: string
  anthropicApiKey: string | undefined
}

/**
 * Load server configuration from environment variables.
 * All values have sensible defaults for local development.
 */
export function loadConfig(): ServerConfig {
  const apiKeys = (process.env.DEBRIEFER_API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)

  return {
    port: parseInt(process.env.PORT ?? "8090", 10) || 8090,
    apiKeys,
    authEnabled: apiKeys.length > 0,
    defaultBudget: parseFloat(process.env.DEFAULT_BUDGET ?? "1.0") || 1.0,
    defaultModel: process.env.DEFAULT_MODEL ?? "claude-sonnet-4-20250514",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/__tests__/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/config.ts packages/server/src/__tests__/config.test.ts
git commit -m "feat(server): add config module reading env vars"
```

---

## Task 2: Zod Request Schemas

Validates incoming request bodies at the trust boundary.

**Files:**

- Create: `packages/server/src/schemas.ts`
- Test: `packages/server/src/__tests__/schemas.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/server/src/__tests__/schemas.test.ts
import { describe, it, expect } from "vitest"
import { debriefRequestSchema } from "../schemas.js"

describe("debriefRequestSchema", () => {
  it("accepts minimal valid request (name only)", () => {
    const result = debriefRequestSchema.safeParse({ name: "Audrey Hepburn" })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe("Audrey Hepburn")
      expect(result.data.synthesis).toBe(true) // default
      expect(result.data.budget).toBeUndefined()
    }
  })

  it("accepts full valid request", () => {
    const result = debriefRequestSchema.safeParse({
      name: "Audrey Hepburn",
      categories: ["structured", "news"],
      budget: 0.5,
      synthesis: false,
      model: "claude-opus-4-20250514",
      prompt: "Custom prompt",
    })
    expect(result.success).toBe(true)
  })

  it("rejects missing name", () => {
    const result = debriefRequestSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it("rejects empty name", () => {
    const result = debriefRequestSchema.safeParse({ name: "" })
    expect(result.success).toBe(false)
  })

  it("rejects negative budget", () => {
    const result = debriefRequestSchema.safeParse({ name: "Test", budget: -1 })
    expect(result.success).toBe(false)
  })

  it("rejects zero budget", () => {
    const result = debriefRequestSchema.safeParse({ name: "Test", budget: 0 })
    expect(result.success).toBe(false)
  })

  it("rejects non-array categories", () => {
    const result = debriefRequestSchema.safeParse({ name: "Test", categories: "structured" })
    expect(result.success).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/__tests__/schemas.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// packages/server/src/schemas.ts
/**
 * Zod schemas for request validation.
 */

import { z } from "zod"

export const debriefRequestSchema = z.object({
  name: z.string().min(1, "Subject name is required"),
  categories: z.array(z.string()).optional(),
  budget: z.number().positive("Budget must be positive").optional(),
  synthesis: z.boolean().default(true),
  model: z.string().optional(),
  prompt: z.string().optional(),
})

export type DebriefRequest = z.infer<typeof debriefRequestSchema>
```

**Step 4: Run test, verify pass**

**Step 5: Commit**

```bash
git add packages/server/src/schemas.ts packages/server/src/__tests__/schemas.test.ts
git commit -m "feat(server): add Zod request validation schemas"
```

---

## Task 3: Source Registry

Server's own source registry mapping categories to factory functions.

**Files:**

- Create: `packages/server/src/source-registry.ts`
- Test: `packages/server/src/__tests__/source-registry.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/server/src/__tests__/source-registry.test.ts
import { describe, it, expect } from "vitest"
import { createSourcesWithCategory, SOURCE_CATEGORIES } from "../source-registry.js"

describe("SOURCE_CATEGORIES", () => {
  it("has 6 categories", () => {
    expect(Object.keys(SOURCE_CATEGORIES)).toHaveLength(6)
  })
})

describe("createSourcesWithCategory", () => {
  it("returns all sources when no filter", () => {
    const results = createSourcesWithCategory()
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      expect(r.source.name).toBeTruthy()
      expect(r.category).toBeTruthy()
    }
  })

  it("filters by category", () => {
    const results = createSourcesWithCategory(["structured"])
    expect(results.every((r) => r.category === "structured")).toBe(true)
    expect(results.length).toBe(SOURCE_CATEGORIES.structured.length)
  })

  it("ignores unknown categories", () => {
    const results = createSourcesWithCategory(["nonexistent"])
    expect(results).toEqual([])
  })
})
```

**Step 2: Run test, verify fail**

**Step 3: Write implementation**

Same pattern as CLI's source registry but exports `createSourcesWithCategory` directly (returns `{ source, category }` pairs). Use `Object.hasOwn()` for prototype safety. Import all source factory functions from `debriefer-sources`.

```typescript
// packages/server/src/source-registry.ts
/**
 * Source registry for the HTTP server.
 * Maps category names to source factory functions.
 */

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

export type SourceCategory = "structured" | "news" | "search" | "books" | "archives" | "obituary"

export const SOURCE_CATEGORIES: Record<SourceCategory, SourceFactory[]> = {
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

export function createSourcesWithCategory(
  categories?: string[]
): { source: BaseResearchSource<ResearchSubject>; category: SourceCategory }[] {
  const cats = categories ?? Object.keys(SOURCE_CATEGORIES)
  const results: { source: BaseResearchSource<ResearchSubject>; category: SourceCategory }[] = []

  for (const cat of cats) {
    if (!Object.hasOwn(SOURCE_CATEGORIES, cat)) continue
    const factories = SOURCE_CATEGORIES[cat as SourceCategory]
    for (const factory of factories) {
      results.push({ source: factory(), category: cat as SourceCategory })
    }
  }

  return results
}
```

**Step 4: Run test, verify pass**

**Step 5: Commit**

```bash
git add packages/server/src/source-registry.ts packages/server/src/__tests__/source-registry.test.ts
git commit -m "feat(server): add source registry"
```

---

## Task 4: Auth Middleware

Optional API key authentication middleware.

**Files:**

- Create: `packages/server/src/middleware/auth.ts`
- Test: `packages/server/src/__tests__/middleware/auth.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/server/src/__tests__/middleware/auth.test.ts
import { describe, it, expect, vi } from "vitest"
import type { Request, Response, NextFunction } from "express"
import { createAuthMiddleware } from "../../middleware/auth.js"

function mockReq(headers: Record<string, string> = {}): Partial<Request> {
  return { headers }
}

function mockRes(): Partial<Response> & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(data: unknown) {
      res.body = data
      return res
    },
  }
  return res
}

describe("createAuthMiddleware", () => {
  it("calls next() when auth is disabled (no keys)", () => {
    const middleware = createAuthMiddleware([])
    const next = vi.fn()
    middleware(mockReq() as Request, mockRes() as Response, next)
    expect(next).toHaveBeenCalled()
  })

  it("calls next() with valid Bearer token", () => {
    const middleware = createAuthMiddleware(["sk-abc", "sk-def"])
    const next = vi.fn()
    middleware(mockReq({ authorization: "Bearer sk-abc" }) as Request, mockRes() as Response, next)
    expect(next).toHaveBeenCalled()
  })

  it("returns 401 with missing Authorization header", () => {
    const middleware = createAuthMiddleware(["sk-abc"])
    const next = vi.fn()
    const res = mockRes()
    middleware(mockReq() as Request, res as unknown as Response, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: "Unauthorized" })
  })

  it("returns 401 with invalid token", () => {
    const middleware = createAuthMiddleware(["sk-abc"])
    const next = vi.fn()
    const res = mockRes()
    middleware(
      mockReq({ authorization: "Bearer sk-wrong" }) as Request,
      res as unknown as Response,
      next
    )
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })

  it("returns 401 with non-Bearer scheme", () => {
    const middleware = createAuthMiddleware(["sk-abc"])
    const next = vi.fn()
    const res = mockRes()
    middleware(
      mockReq({ authorization: "Basic sk-abc" }) as Request,
      res as unknown as Response,
      next
    )
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })
})
```

**Step 2: Run test, verify fail**

**Step 3: Write implementation**

```typescript
// packages/server/src/middleware/auth.ts
/**
 * Optional API key authentication middleware.
 * When no keys are configured, all requests pass through.
 */

import type { Request, Response, NextFunction } from "express"

/**
 * Creates an auth middleware that checks Bearer tokens against a list of valid API keys.
 * Returns a pass-through middleware when the keys list is empty (auth disabled).
 */
export function createAuthMiddleware(
  apiKeys: string[]
): (req: Request, res: Response, next: NextFunction) => void {
  const keySet = new Set(apiKeys)

  return (req: Request, res: Response, next: NextFunction): void => {
    if (keySet.size === 0) {
      next()
      return
    }

    const header = req.headers.authorization
    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" })
      return
    }

    const token = header.slice(7)
    if (!keySet.has(token)) {
      res.status(401).json({ error: "Unauthorized" })
      return
    }

    next()
  }
}
```

**Step 4: Run test, verify pass**

**Step 5: Commit**

```bash
git add packages/server/src/middleware/auth.ts packages/server/src/__tests__/middleware/auth.test.ts
git commit -m "feat(server): add API key auth middleware"
```

---

## Task 5: Route Handlers

All three route handlers: health, sources, debrief.

**Files:**

- Create: `packages/server/src/routes/health.ts`
- Create: `packages/server/src/routes/sources.ts`
- Create: `packages/server/src/routes/debrief.ts`
- Test: `packages/server/src/__tests__/routes/health.test.ts`
- Test: `packages/server/src/__tests__/routes/sources.test.ts`
- Test: `packages/server/src/__tests__/routes/debrief.test.ts`

### 5a: Health Route

**Test:**

```typescript
// packages/server/src/__tests__/routes/health.test.ts
import { describe, it, expect } from "vitest"
import express from "express"
import request from "supertest"
import { healthRouter } from "../../routes/health.js"

const app = express()
app.use("/api", healthRouter)

describe("GET /api/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/api/health")
    expect(res.status).toBe(200)
    expect(res.body.status).toBe("ok")
    expect(res.body).toHaveProperty("version")
    expect(res.body).toHaveProperty("uptime")
    expect(typeof res.body.uptime).toBe("number")
  })
})
```

**Implementation:**

```typescript
// packages/server/src/routes/health.ts
import { Router } from "express"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { version } = require("../../package.json") as { version: string }

export const healthRouter = Router()

healthRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version,
    uptime: Math.floor(process.uptime()),
  })
})
```

### 5b: Sources Route

**Test:**

```typescript
// packages/server/src/__tests__/routes/sources.test.ts
import { describe, it, expect } from "vitest"
import express from "express"
import request from "supertest"
import { sourcesRouter } from "../../routes/sources.js"

const app = express()
app.use("/api", sourcesRouter)

describe("GET /api/sources", () => {
  it("returns all sources", async () => {
    const res = await request(app).get("/api/sources")
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
    expect(res.body[0]).toHaveProperty("name")
    expect(res.body[0]).toHaveProperty("type")
    expect(res.body[0]).toHaveProperty("category")
    expect(res.body[0]).toHaveProperty("reliabilityTier")
    expect(res.body[0]).toHaveProperty("available")
  })

  it("filters by category query param", async () => {
    const res = await request(app).get("/api/sources?category=structured")
    expect(res.status).toBe(200)
    expect(res.body.every((s: { category: string }) => s.category === "structured")).toBe(true)
  })

  it("returns empty array for unknown category", async () => {
    const res = await request(app).get("/api/sources?category=nonexistent")
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})
```

**Implementation:**

```typescript
// packages/server/src/routes/sources.ts
import { Router } from "express"
import { createSourcesWithCategory } from "../source-registry.js"

export const sourcesRouter = Router()

sourcesRouter.get("/sources", (req, res) => {
  const category = req.query.category as string | undefined
  const categories = category ? [category] : undefined
  const tagged = createSourcesWithCategory(categories)

  const data = tagged.map(({ source, category: cat }) => ({
    name: source.name,
    type: source.type,
    category: cat,
    reliabilityTier: source.reliabilityTier,
    reliabilityScore: source.reliabilityScore,
    domain: source.domain,
    isFree: source.isFree,
    estimatedCostPerQuery: source.estimatedCostPerQuery,
    available: source.isAvailable(),
  }))

  res.json(data)
})
```

### 5c: Debrief Route

**Test:**

```typescript
// packages/server/src/__tests__/routes/debrief.test.ts
import { describe, it, expect, vi } from "vitest"
import express from "express"
import request from "supertest"

// Mock the orchestrator
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

import { createDebriefRouter } from "../../routes/debrief.js"
import { loadConfig } from "../../config.js"

const config = loadConfig()
const app = express()
app.use(express.json())
app.use("/api", createDebriefRouter(config))

describe("POST /api/debrief", () => {
  it("returns 400 for missing name", async () => {
    const res = await request(app).post("/api/debrief").send({})
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty("error")
  })

  it("returns 400 for empty name", async () => {
    const res = await request(app).post("/api/debrief").send({ name: "" })
    expect(res.status).toBe(400)
  })

  it("returns 200 with valid request (no synthesis)", async () => {
    const res = await request(app)
      .post("/api/debrief")
      .send({ name: "Test Person", synthesis: false })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty("subject")
    expect(res.body).toHaveProperty("findings")
    expect(res.body).toHaveProperty("totalCostUsd")
  })

  it("returns 400 for negative budget", async () => {
    const res = await request(app).post("/api/debrief").send({ name: "Test", budget: -1 })
    expect(res.status).toBe(400)
  })
})
```

**Implementation:**

```typescript
// packages/server/src/routes/debrief.ts
import { Router } from "express"
import { ResearchOrchestrator, ClaudeSynthesizer, NoopSynthesizer } from "debriefer"
import type { ResearchSubject, SourcePhaseGroup, Synthesizer, ResearchConfig } from "debriefer"
import { debriefRequestSchema } from "../schemas.js"
import { createSourcesWithCategory } from "../source-registry.js"
import type { ServerConfig } from "../config.js"

export function createDebriefRouter(config: ServerConfig): Router {
  const router = Router()

  router.post("/debrief", async (req, res) => {
    // 1. Validate request
    const parsed = debriefRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request",
        details: parsed.error.issues.map((i) => i.message),
      })
      return
    }

    const { name, categories, budget, synthesis, model, prompt } = parsed.data

    try {
      // 2. Create sources
      const tagged = createSourcesWithCategory(categories)
      const available = tagged.map((t) => t.source).filter((s) => s.isAvailable())

      if (available.length === 0) {
        res.status(400).json({
          error: "No sources available for the requested categories",
        })
        return
      }

      // 3. Build synthesizer
      let synthesizer: Synthesizer<ResearchSubject, unknown>
      if (synthesis) {
        if (!config.anthropicApiKey) {
          res.status(400).json({
            error: "Synthesis requires ANTHROPIC_API_KEY to be configured",
          })
          return
        }
        const jsonSuffix =
          '\nRespond ONLY with a valid JSON object: { "summary": "your synthesized summary" }'
        const defaultPrompt =
          "You are a research assistant. Synthesize the following findings into a clear, factual summary."

        synthesizer = new ClaudeSynthesizer<ResearchSubject, string>({
          promptBuilder: (subject, findings) => ({
            system: (prompt ?? defaultPrompt) + jsonSuffix,
            user:
              `Subject: ${subject.name}\n\nFindings:\n${findings.map((f) => `[${f.sourceName}] ${f.text}`).join("\n\n")}\n\n` +
              'Respond with JSON: { "summary": "..." }',
          }),
          responseParser: (data: unknown): string => {
            if (data && typeof data === "object" && "summary" in data) {
              return String((data as { summary: unknown }).summary)
            }
            return String(data)
          },
          apiKey: config.anthropicApiKey,
        })
      } else {
        synthesizer = new NoopSynthesizer<ResearchSubject>()
      }

      // 4. Build phases (free first, paid second)
      const freeSources = available.filter((s) => s.isFree)
      const paidSources = available.filter((s) => !s.isFree)

      const phases: SourcePhaseGroup<ResearchSubject>[] = []
      if (freeSources.length > 0) {
        phases.push({ phase: 1, name: "Free Sources", sources: freeSources })
      }
      if (paidSources.length > 0) {
        phases.push({ phase: 2, name: "Paid Sources", sources: paidSources })
      }

      // 5. Build config
      const orchConfig: ResearchConfig = {
        costLimits: {
          maxCostPerSubject: budget ?? config.defaultBudget,
        },
        synthesis: {
          model: model ?? config.defaultModel,
          systemPrompt: prompt,
        },
      }

      // 6. Run orchestrator
      const orchestrator = new ResearchOrchestrator(phases, synthesizer, orchConfig)
      const subject: ResearchSubject = { id: name, name }
      const result = await orchestrator.debrief(subject)

      res.json(result)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(500).json({ error: "Research failed", message })
    }
  })

  return router
}
```

**Step: Run all tests, verify pass. Commit.**

```bash
git add packages/server/src/routes/ packages/server/src/__tests__/routes/
git commit -m "feat(server): add health, sources, and debrief route handlers"
```

---

## Task 6: App Factory and Entry Point

Wire everything together.

**Files:**

- Create: `packages/server/src/app.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/src/__tests__/app.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/server/src/__tests__/app.test.ts
import { describe, it, expect, vi } from "vitest"
import request from "supertest"

// Mock orchestrator to avoid real API calls
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

import { createApp } from "../app.js"

describe("Express app", () => {
  const app = createApp()

  it("serves health endpoint", async () => {
    const res = await request(app).get("/api/health")
    expect(res.status).toBe(200)
    expect(res.body.status).toBe("ok")
  })

  it("serves sources endpoint", async () => {
    const res = await request(app).get("/api/sources")
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it("serves debrief endpoint", async () => {
    const res = await request(app).post("/api/debrief").send({ name: "Test", synthesis: false })
    expect(res.status).toBe(200)
  })

  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/api/nonexistent")
    expect(res.status).toBe(404)
  })

  it("returns JSON error for 404", async () => {
    const res = await request(app).get("/api/nonexistent")
    expect(res.body).toHaveProperty("error")
  })
})
```

**Step 2: Run test, verify fail**

**Step 3: Write app.ts**

```typescript
// packages/server/src/app.ts
/**
 * Express app factory.
 * Separated from index.ts so tests can import the app without starting the server.
 */

import express from "express"
import cors from "cors"
import { loadConfig } from "./config.js"
import { createAuthMiddleware } from "./middleware/auth.js"
import { healthRouter } from "./routes/health.js"
import { sourcesRouter } from "./routes/sources.js"
import { createDebriefRouter } from "./routes/debrief.js"

export function createApp(): express.Express {
  const config = loadConfig()
  const app = express()

  // Middleware
  app.use(cors())
  app.use(express.json())
  app.use(createAuthMiddleware(config.apiKeys))

  // Routes
  app.use("/api", healthRouter)
  app.use("/api", sourcesRouter)
  app.use("/api", createDebriefRouter(config))

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" })
  })

  return app
}
```

**Step 4: Write index.ts (replace stub)**

```typescript
// packages/server/src/index.ts
/**
 * HTTP server entry point.
 * Starts the Express server on the configured port.
 */

import { createApp } from "./app.js"
import { loadConfig } from "./config.js"

const config = loadConfig()
const app = createApp()

app.listen(config.port, () => {
  console.log(`debriefer-server listening on port ${config.port}`)
  if (config.authEnabled) {
    console.log(`Auth enabled (${config.apiKeys.length} API key(s) configured)`)
  } else {
    console.log("Auth disabled (no DEBRIEFER_API_KEYS set)")
  }
})
```

**Step 5: Run all tests, verify pass. Commit.**

```bash
git add packages/server/src/app.ts packages/server/src/index.ts packages/server/src/__tests__/app.test.ts
git commit -m "feat(server): wire up Express app factory and entry point"
```

---

## Task 7: Full CI Check and Smoke Test

**Step 1: Run full CI**

```bash
npx turbo test lint type-check
npx prettier --check .
```

Fix any issues.

**Step 2: Build and smoke test**

```bash
npx turbo build --filter=debriefer-server
node packages/server/dist/index.js &
SERVER_PID=$!
sleep 2

# Health check
curl -s http://localhost:8090/api/health | jq

# Sources
curl -s http://localhost:8090/api/sources?category=structured | jq

# Debrief (no synthesis — works without ANTHROPIC_API_KEY)
curl -s -X POST http://localhost:8090/api/debrief \
  -H 'Content-Type: application/json' \
  -d '{"name": "Albert Einstein", "synthesis": false, "categories": ["structured"]}' | jq '.subject.name, .findings | length'

# Validation error
curl -s -X POST http://localhost:8090/api/debrief \
  -H 'Content-Type: application/json' \
  -d '{}' | jq

kill $SERVER_PID
```

**Step 3: Fix any issues, commit, push**

```bash
git push -u origin feat/server
```
