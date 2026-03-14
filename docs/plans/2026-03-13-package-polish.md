# Package Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring all debriefer packages to publish-ready quality with READMEs, consistent schemas, Docker fixes, and PyPI publishing.

**Architecture:** Each task is independent and can be done in parallel. Tasks are ordered by impact — Docker/infrastructure fixes first, then package READMEs (npm visibility), then API surface parity across server/MCP/CLI, then Python publish.

**Tech Stack:** TypeScript, Express, MCP SDK, Zod, Python (httpx + Pydantic), Docker

---

## File Structure

| File                                    | Responsibility                           |
| --------------------------------------- | ---------------------------------------- |
| `docker/docker-compose.yml`             | Remove unused Redis service              |
| `packages/core/README.md`               | npm page for debriefer core              |
| `packages/sources/README.md`            | npm page for debriefer-sources           |
| `packages/cli/README.md`                | npm page for debriefer-cli               |
| `packages/server/README.md`             | npm page for debriefer-server            |
| `packages/mcp/README.md`                | npm page for debriefer-mcp               |
| `clients/python/README.md`              | PyPI page for debriefer Python client    |
| `packages/server/src/schemas.ts`        | Add batch and new source option fields   |
| `packages/server/src/routes/debrief.ts` | Wire new schema fields into orchestrator |
| `packages/server/src/routes/batch.ts`   | New batch endpoint                       |
| `packages/mcp/src/tools/debrief.ts`     | Wire new schema fields                   |
| `packages/mcp/src/index.ts`             | Update tool schemas                      |
| `clients/python/debriefer/client.py`    | Add batch method, new params             |
| `clients/python/debriefer/models.py`    | Add batch result model                   |

---

## Chunk 1: Infrastructure Fixes

### Task 1: Remove unused Redis from docker-compose

The docker-compose.yml references a Redis service and `REDIS_URL` env var, but the server doesn't use Redis — caching is an injected interface and InMemoryCache is the only built-in implementation.

**Files:**

- Modify: `docker/docker-compose.yml`

- [ ] **Step 1: Remove Redis service and dependency**

```yaml
services:
  debriefer:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    ports:
      - "8090:8090"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
```

- [ ] **Step 2: Run prettier**

Run: `npx prettier --write docker/docker-compose.yml`

- [ ] **Step 3: Commit**

```bash
git add docker/docker-compose.yml
git commit -m "fix: remove unused Redis from docker-compose

The server uses InMemoryCache by default. Redis is an optional
consumer-provided CacheProvider, not a built-in dependency."
```

---

## Chunk 2: Package READMEs

These READMEs appear on npm package pages. Each should be concise (not a copy of the root README) — just enough for someone landing on the npm page to understand what the package does, how to install it, and see a minimal example.

### Task 2: Core package README

**Files:**

- Create: `packages/core/README.md`

- [ ] **Step 1: Write README**

Content should cover:

- One-line description
- Install command: `npm install @debriefer/core`
- Minimal code example (create orchestrator, run debrief, print findings — same as root Quick Start)
- Link to the monorepo root README for full docs
- Key exports list (ResearchOrchestrator, BaseResearchSource, ClaudeSynthesizer, NoopSynthesizer, ReliabilityTier)
- License

- [ ] **Step 2: Run prettier**

Run: `npx prettier --write packages/core/README.md`

- [ ] **Step 3: Commit**

```bash
git add packages/core/README.md
git commit -m "docs: add core package README for npm"
```

### Task 3: Sources package README

**Files:**

- Create: `packages/sources/README.md`

- [ ] **Step 1: Write README**

Content should cover:

- One-line description
- Install: `npm install @debriefer/core debriefer-sources`
- Source categories table (from root README — structured, news, search, books, archives, obituary with counts)
- Example: creating sources with factory functions
- Link to root README
- License

- [ ] **Step 2: Run prettier and commit**

```bash
npx prettier --write packages/sources/README.md
git add packages/sources/README.md
git commit -m "docs: add sources package README for npm"
```

### Task 4: CLI package README

**Files:**

- Create: `packages/cli/README.md`

- [ ] **Step 1: Write README**

Content should cover:

- One-line description
- Install: `npm install -g @debriefer/cli` (once published) or build from repo
- Command reference: `debriefer debrief <name>` with all flags (--budget, --categories, --model, --prompt, --no-synthesis, --format, --verbose)
- Command reference: `debriefer sources` with flags (--category, --format)
- Example output
- Link to root README
- License

- [ ] **Step 2: Run prettier and commit**

```bash
npx prettier --write packages/cli/README.md
git add packages/cli/README.md
git commit -m "docs: add CLI package README for npm"
```

### Task 5: Server package README

**Files:**

- Create: `packages/server/README.md`

- [ ] **Step 1: Write README**

Content should cover:

- One-line description
- Run from repo: `npm run build && node packages/server/dist/index.js`
- Environment variables table: PORT, ANTHROPIC_API_KEY, DEBRIEFER_API_KEYS, DEFAULT_BUDGET, DEFAULT_MODEL, CORS_ORIGIN
- API endpoints: GET /api/health, GET /api/sources, POST /api/debrief
- POST /api/debrief request body schema (name, categories, budget, synthesis, model, prompt)
- Example curl commands
- Docker: reference docker/ directory
- Link to root README
- License

- [ ] **Step 2: Run prettier and commit**

```bash
npx prettier --write packages/server/README.md
git add packages/server/README.md
git commit -m "docs: add server package README for npm"
```

### Task 6: MCP package README

**Files:**

- Create: `packages/mcp/README.md`

- [ ] **Step 1: Write README**

Content should cover:

- One-line description
- Run: `npm run build && node packages/mcp/dist/cli.js`
- Claude Desktop config example (mcpServers JSON)
- Tools: debrief (params: name, categories, budget, synthesis, model, prompt), list_sources (params: category)
- Environment variables: ANTHROPIC_API_KEY, DEFAULT_BUDGET, DEFAULT_MODEL
- Link to root README
- License

- [ ] **Step 2: Run prettier and commit**

```bash
npx prettier --write packages/mcp/README.md
git add packages/mcp/README.md
git commit -m "docs: add MCP package README for npm"
```

### Task 7: Python client README

**Files:**

- Create: `clients/python/README.md`

- [ ] **Step 1: Write README**

Content should cover:

- One-line description
- Install: `pip install debriefer` (once published) or from source
- Quick start: AsyncDebriefer context manager, debrief, list_sources, health
- Auth: api_key parameter
- Models: DebriefResult, Finding, SynthesisResult, Source, HealthStatus
- Exceptions: DebrieferAPIError, DebrieferConnectionError
- Link to root README
- License

- [ ] **Step 2: Run prettier and commit**

```bash
npx prettier --write clients/python/README.md
git add clients/python/README.md
git commit -m "docs: add Python client README"
```

---

## Chunk 3: Server Batch Endpoint

### Task 8: Add POST /api/batch endpoint

The server only supports single-subject research. Adding a batch endpoint lets consumers research multiple subjects in one request with shared rate limiting and cost tracking.

**Files:**

- Create: `packages/server/src/routes/batch.ts`
- Modify: `packages/server/src/schemas.ts` — add batch request schema
- Modify: `packages/server/src/app.ts` — mount batch router
- Create: `packages/server/src/__tests__/routes/batch.test.ts`

- [ ] **Step 1: Write batch request schema**

Add to `schemas.ts`:

```typescript
export const batchRequestSchema = z.object({
  subjects: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]),
        name: z.string().min(1),
        context: z.record(z.unknown()).optional(),
      })
    )
    .min(1, "At least one subject is required")
    .max(100, "Maximum 100 subjects per batch"),
  categories: z.array(z.string()).optional(),
  budget: z.number().positive().optional(),
  maxTotalCost: z.number().positive().optional(),
  concurrency: z.number().int().min(1).max(20).optional(),
  synthesis: z.boolean().default(true),
  model: z.string().optional(),
  prompt: z.string().optional(),
})
```

- [ ] **Step 2: Write failing test for batch endpoint**

Test: POST /api/batch with 2 subjects returns results map.

- [ ] **Step 3: Implement batch route**

Create `routes/batch.ts` following the same pattern as `routes/debrief.ts` but calling `orchestrator.debriefBatch()`.

- [ ] **Step 4: Mount in app.ts**

- [ ] **Step 5: Run tests, commit**

```bash
npx turbo test --filter=debriefer-server
git add packages/server/src/
git commit -m "feat(server): add POST /api/batch endpoint for multi-subject research"
```

---

## Chunk 4: Server & MCP Schema Parity

### Task 9: Add earlyStopThreshold and reliabilityThreshold to server schema

The server's POST /api/debrief doesn't expose `earlyStopThreshold`, `reliabilityThreshold`, or `confidenceThreshold` from ResearchConfig. Consumers can't tune quality vs speed tradeoffs.

**Files:**

- Modify: `packages/server/src/schemas.ts` — add fields
- Modify: `packages/server/src/routes/debrief.ts` — wire into ResearchConfig
- Modify: `packages/server/src/__tests__/routes/debrief.test.ts` — test new fields

- [ ] **Step 1: Add fields to schema**

```typescript
earlyStopThreshold: z.number().int().min(1).optional()
  .describe("Number of high-quality source families before stopping"),
reliabilityThreshold: z.number().min(0).max(1).optional()
  .describe("Minimum source reliability score (0-1) for quality check"),
confidenceThreshold: z.number().min(0).max(1).optional()
  .describe("Minimum content confidence (0-1) for quality check"),
```

- [ ] **Step 2: Wire into orchestrator config in debrief route**

Pass through to `ResearchConfig` in the orchestrator constructor.

- [ ] **Step 3: Write tests for new fields**

- [ ] **Step 4: Run tests, commit**

```bash
npx turbo test --filter=debriefer-server
git commit -m "feat(server): expose earlyStopThreshold, reliabilityThreshold, confidenceThreshold"
```

### Task 10: Add same fields to MCP tool schema

Mirror the server schema additions in the MCP debrief tool.

**Files:**

- Modify: `packages/mcp/src/index.ts` — add to debriefSchema
- Modify: `packages/mcp/src/tools/debrief.ts` — wire into orchestrator config
- Modify: `packages/mcp/src/__tests__/tools/debrief.test.ts`

- [ ] **Step 1: Add fields to MCP debrief schema**

Same three fields as server.

- [ ] **Step 2: Wire into orchestrator config**

- [ ] **Step 3: Write tests, run, commit**

```bash
npx turbo test --filter=debriefer-mcp
git commit -m "feat(mcp): expose earlyStopThreshold, reliabilityThreshold, confidenceThreshold"
```

---

## Chunk 5: Python Client Updates

### Task 11: Add batch method to Python client

**Files:**

- Modify: `clients/python/debriefer/client.py` — add `batch()` method
- Modify: `clients/python/debriefer/models.py` — add `BatchResult` model
- Create: `clients/python/tests/test_batch.py`

- [ ] **Step 1: Add BatchResult model**

```python
class BatchResult(BaseModel):
    results: dict[str, DebriefResult]
    total_cost_usd: float = Field(alias="totalCostUsd")
    duration_ms: int = Field(alias="durationMs")
```

- [ ] **Step 2: Add batch method to AsyncDebriefer**

```python
async def batch(
    self,
    subjects: list[dict],
    *,
    categories: list[str] | None = None,
    budget: float | None = None,
    max_total_cost: float | None = None,
    concurrency: int | None = None,
    synthesis: bool | None = None,
    model: str | None = None,
    prompt: str | None = None,
) -> BatchResult:
```

- [ ] **Step 3: Write tests with respx mocks**

- [ ] **Step 4: Run tests, commit**

```bash
cd clients/python && pytest
git commit -m "feat(python): add batch() method to AsyncDebriefer"
```

### Task 12: Add threshold parameters to Python client

**Files:**

- Modify: `clients/python/debriefer/client.py` — add params to `debrief()` and `batch()`

- [ ] **Step 1: Add optional parameters**

Add `early_stop_threshold`, `reliability_threshold`, `confidence_threshold` to both `debrief()` and `batch()`.

- [ ] **Step 2: Write tests, commit**

```bash
cd clients/python && pytest
git commit -m "feat(python): add threshold parameters to debrief and batch"
```

---

## Chunk 6: PyPI Publishing

### Task 13: Publish Python client to PyPI

**Files:**

- Modify: `clients/python/pyproject.toml` — verify metadata
- Create or modify: `.github/workflows/publish-python.yml` — PyPI publish on release

- [ ] **Step 1: Verify pyproject.toml metadata**

Check: name, version, description, author, license, classifiers, URLs, dependencies.

- [ ] **Step 2: Create publish workflow**

```yaml
name: Publish Python to PyPI
on:
  release:
    types: [published]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install build tools
        run: pip install build twine
      - name: Build
        run: cd clients/python && python -m build
      - name: Publish
        run: cd clients/python && twine upload dist/*
        env:
          TWINE_USERNAME: __token__
          TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }}
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish-python.yml clients/python/pyproject.toml
git commit -m "ci: add PyPI publish workflow for Python client"
```

- [ ] **Step 4: Test publish with a release tag**

After merging, create a release to trigger the workflow.

---

## Task Order

| Task                                | Chunk | Depends On | Priority |
| ----------------------------------- | ----- | ---------- | -------- |
| 1. Remove Redis from docker-compose | 1     | —          | Critical |
| 2. Core README                      | 2     | —          | High     |
| 3. Sources README                   | 2     | —          | High     |
| 4. CLI README                       | 2     | —          | High     |
| 5. Server README                    | 2     | —          | High     |
| 6. MCP README                       | 2     | —          | High     |
| 7. Python README                    | 2     | —          | High     |
| 8. Batch endpoint                   | 3     | —          | Medium   |
| 9. Server schema parity             | 4     | —          | Medium   |
| 10. MCP schema parity               | 4     | —          | Medium   |
| 11. Python batch method             | 5     | Task 8     | Medium   |
| 12. Python threshold params         | 5     | Task 9     | Medium   |
| 13. PyPI publish                    | 6     | Task 7     | Medium   |

Tasks 1-7 are fully independent. Tasks 8-10 are independent of each other. Tasks 11-12 depend on server changes. Task 13 depends on the Python README.
