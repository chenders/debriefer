# HTTP Server Design: `debriefer-server`

## Overview

Phase 7 of the debriefer project — a minimal Express REST API wrapping the core orchestration engine. Synchronous single-subject research only (no async batch/run tracking in v1).

## Endpoints

### `POST /api/debrief`

Research a single subject (synchronous).

**Request body:**

```json
{
  "name": "Audrey Hepburn",
  "categories": ["structured", "news"],
  "budget": 0.5,
  "synthesis": true,
  "model": "claude-sonnet-4-20250514",
  "prompt": "optional custom system prompt"
}
```

Only `name` is required. Everything else has defaults.

**Response:** The `DebriefResult` object (same shape as CLI `--format json`).

### `GET /api/sources`

List available sources.

**Query params:** `?category=structured` (optional)

**Response:** JSON array of source metadata objects:

```json
[
  {
    "name": "Wikipedia",
    "type": "wikipedia",
    "category": "structured",
    "reliabilityTier": "secondary",
    "reliabilityScore": 0.85,
    "domain": "en.wikipedia.org",
    "isFree": true,
    "estimatedCostPerQuery": 0,
    "available": true
  }
]
```

### `GET /api/health`

**Response:**

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 12345
}
```

## Authentication

- Off by default — no env var means no auth check
- Set `DEBRIEFER_API_KEYS=sk-abc,sk-def` to enable
- Requests must include `Authorization: Bearer sk-abc` header when enabled
- Returns 401 with `{ "error": "Unauthorized" }` when missing/invalid

## Configuration

Environment variables only (no YAML for v1):

| Env Var              | Default                  | Description                               |
| -------------------- | ------------------------ | ----------------------------------------- |
| `PORT`               | 8090                     | Server port                               |
| `DEBRIEFER_API_KEYS` | (none)                   | Comma-separated API keys; empty = no auth |
| `ANTHROPIC_API_KEY`  | (none)                   | Required for synthesis                    |
| `DEFAULT_BUDGET`     | 1.0                      | Default per-subject cost limit            |
| `DEFAULT_MODEL`      | claude-sonnet-4-20250514 | Default synthesis model                   |

Plus source-specific API keys read by the sources themselves.

## Validation

Zod schemas for request validation:

- `debriefRequestSchema`: `name` (string, required), `categories` (string array, optional), `budget` (positive number, optional), `synthesis` (boolean, optional), `model` (string, optional), `prompt` (string, optional)
- Invalid requests return 400 with `{ "error": "...", "details": [...] }`

## Error Handling

- Zod validation errors -> 400
- Auth failures -> 401
- Orchestrator errors -> 500 with `{ "error": "Research failed", "message": "..." }`
- Unhandled errors caught by Express error middleware -> 500

## Project Structure

```
packages/server/src/
├── index.ts           # Start server (listen)
├── app.ts             # Express app factory (for testing)
├── config.ts          # Read env vars, typed config object
├── schemas.ts         # Zod request/response schemas
├── source-registry.ts # Server's own source registry
├── middleware/
│   └── auth.ts        # API key auth middleware
└── routes/
    ├── debrief.ts     # POST /api/debrief
    ├── sources.ts     # GET /api/sources
    └── health.ts      # GET /api/health
```

Split `app.ts` from `index.ts` so tests can import the Express app without starting the server.

## Dependencies

Existing: `express`, `cors`, `zod`, `debriefer`, `debriefer-sources`

Add: `@types/express`, `@types/cors` (dev deps), `@anthropic-ai/sdk` (regular dep, same reason as CLI)

Remove: `js-yaml` (not needed for v1)

## Decisions

- **No async batch/run tracking** — deferred to a follow-up; sync single-subject covers the Python client and MCP server needs
- **No YAML config** — env vars only for v1
- **No auth by default** — opt-in via `DEBRIEFER_API_KEYS` env var
- **Server has its own source registry** — separate from CLI; server may configure sources differently in the future
- **Zod for request validation** — already a dependency; validates at the trust boundary
