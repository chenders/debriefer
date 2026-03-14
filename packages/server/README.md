# debriefer-server

Express REST API exposing the debriefer research engine over HTTP.

## Run

```bash
# From the repo root
npm run build
node packages/server/dist/index.js
```

The server listens on port 8090 by default.

## Environment Variables

| Variable             | Default                    | Description                                                                                                 |
| -------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `PORT`               | `8090`                     | Port the server listens on                                                                                  |
| `ANTHROPIC_API_KEY`  | —                          | Required for AI synthesis (`synthesis: true` requests)                                                      |
| `DEBRIEFER_API_KEYS` | —                          | Comma-separated Bearer tokens. If set, all requests must supply a valid token. Auth is disabled when unset. |
| `DEFAULT_BUDGET`     | `1.0`                      | Default per-request cost limit in USD                                                                       |
| `DEFAULT_MODEL`      | `claude-sonnet-4-20250514` | Default Claude model used for synthesis                                                                     |
| `CORS_ORIGIN`        | `*`                        | Allowed CORS origin                                                                                         |

## Endpoints

### GET /api/health

Returns server status, version, and uptime.

```json
{ "status": "ok", "version": "0.1.0", "uptime": 42 }
```

### GET /api/sources

Returns metadata for all available research sources. Supports optional category filtering.

**Query parameters**

| Parameter  | Description                                                     |
| ---------- | --------------------------------------------------------------- |
| `category` | Filter by category (repeatable). Omit to return all categories. |

### POST /api/debrief

Runs research on a single subject and returns findings, optionally synthesized by Claude.

**Request body**

| Field        | Type       | Required | Default          | Description                                        |
| ------------ | ---------- | -------- | ---------------- | -------------------------------------------------- |
| `name`       | `string`   | Yes      | —                | Subject name to research                           |
| `categories` | `string[]` | No       | all categories   | Limit sources to these categories                  |
| `budget`     | `number`   | No       | `DEFAULT_BUDGET` | Per-request cost ceiling in USD (must be positive) |
| `synthesis`  | `boolean`  | No       | `true`           | Whether to synthesize findings with Claude         |
| `model`      | `string`   | No       | `DEFAULT_MODEL`  | Claude model to use for synthesis                  |
| `prompt`     | `string`   | No       | built-in default | System prompt override for synthesis               |

## Example curl Commands

**Health check**

```bash
curl http://localhost:8090/api/health
```

**List sources**

```bash
curl http://localhost:8090/api/sources
```

**List sources filtered by category**

```bash
curl "http://localhost:8090/api/sources?category=news&category=encyclopedic"
```

**Debrief with synthesis (requires ANTHROPIC_API_KEY)**

```bash
curl -X POST http://localhost:8090/api/debrief \
  -H "Content-Type: application/json" \
  -d '{"name": "Andrei Tarkovsky"}'
```

**Debrief without synthesis**

```bash
curl -X POST http://localhost:8090/api/debrief \
  -H "Content-Type: application/json" \
  -d '{"name": "Andrei Tarkovsky", "synthesis": false}'
```

**Debrief with authentication**

```bash
curl -X POST http://localhost:8090/api/debrief \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token-here" \
  -d '{"name": "Andrei Tarkovsky", "budget": 0.5}'
```

## Docker

See `docker/` directory for Docker and docker-compose setup.

## Documentation

Full design and API documentation: `docs/plans/2026-03-09-server-design.md`

## License

MIT
