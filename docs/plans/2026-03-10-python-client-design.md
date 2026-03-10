# Python Client v1 Design

**Date**: 2026-03-10
**Status**: Approved
**Phase**: 9

## Overview

Async-only Python HTTP client for the debriefer server, published to PyPI as `debriefer`. Wraps all 3 server endpoints with typed Pydantic response models.

## Client Class

`AsyncDebriefer` — async context manager wrapping `httpx.AsyncClient`.

```python
from debriefer import AsyncDebriefer

async with AsyncDebriefer("http://localhost:8090", api_key="sk-...") as db:
    result = await db.debrief("Steve McQueen", categories=["news", "structured"])
    sources = await db.list_sources(category="news")
    health = await db.health()
```

Constructor: `base_url` (required), `api_key` (optional), `timeout` (optional, default 120s).

## Methods

| Method                                                           | Endpoint            | Returns         |
| ---------------------------------------------------------------- | ------------------- | --------------- |
| `debrief(name, *, categories, budget, synthesis, model, prompt)` | `POST /api/debrief` | `DebriefResult` |
| `list_sources(*, category)`                                      | `GET /api/sources`  | `list[Source]`  |
| `health()`                                                       | `GET /api/health`   | `HealthStatus`  |

## Pydantic Models

- **`DebriefResult`** — subject, findings, data, totalCostUsd, sourcesAttempted, sourcesSucceeded, durationMs
- **`Finding`** — sourceName, sourceType, reliabilityTier, reliabilityScore, confidence, text, url, metadata
- **`Subject`** — id, name
- **`Source`** — name, type, category, reliabilityTier, reliabilityScore, domain, isFree, estimatedCostPerQuery, available
- **`HealthStatus`** — status, version, uptime

All models use `model_config = ConfigDict(populate_by_name=True)` with camelCase aliases to match the server's JSON field names.

## Error Handling

- `DebrieferError` — base exception
- `DebrieferAPIError(status_code, message, details)` — 4xx/5xx responses
- `DebrieferConnectionError` — network failures (wraps httpx transport errors)

## File Structure

```
clients/python/
├── pyproject.toml
├── debriefer/
│   ├── __init__.py       # Re-export public API
│   ├── client.py         # AsyncDebriefer class
│   ├── models.py         # Pydantic response models
│   └── exceptions.py     # Error classes
└── tests/
    ├── conftest.py       # Shared fixtures
    ├── test_client.py    # Async tests with respx mock
    └── test_models.py    # Pydantic model validation
```

## Key Decisions

- Async only (`httpx.AsyncClient`) — no sync wrapper
- Pydantic v2 models with camelCase aliases for JSON compatibility
- `respx` for HTTP mocking in tests
- Bearer token auth via `api_key` parameter
- 120s default timeout (research can be slow)
