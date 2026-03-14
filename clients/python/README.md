# debriefer (Python client)

Async Python HTTP client for the [debriefer](https://github.com/chenders/debriefer) multi-source research orchestration server.

## Install

Not yet published to PyPI. Install from source:

```bash
cd clients/python && pip install -e ".[dev]"
```

**Requirements:** Python >= 3.10, httpx >= 0.27, pydantic >= 2

## Quick start

```python
import asyncio
from debriefer import AsyncDebriefer

async def main():
    async with AsyncDebriefer("http://localhost:8090") as client:
        # Check server health
        health = await client.health()
        print(health.status, health.version)

        # List available sources
        sources = await client.list_sources()
        print(f"{len(sources)} sources available")

        # Research a subject
        result = await client.debrief("John Wayne")
        print(f"Found {len(result.findings)} findings")
        print(f"Total cost: ${result.total_cost_usd:.4f}")
        if result.synthesis_result:
            print(result.synthesis_result.data)

asyncio.run(main())
```

## Auth

When the server is started with `DEBRIEFER_API_KEYS` set, pass the key as `api_key`:

```python
client = AsyncDebriefer("https://your-server.example.com", api_key="your-key")
```

The key is sent as a `Bearer` token in the `Authorization` header.

## Methods

### `debrief(name, *, categories, budget, synthesis, model, prompt)`

Run single-subject research across multiple sources. Returns a `DebriefResult`.

| Parameter    | Type        | Description                                   |
| ------------ | ----------- | --------------------------------------------- |
| `name`       | `str`       | Subject name to research (required)           |
| `categories` | `list[str]` | Source categories to use (optional)           |
| `budget`     | `float`     | Per-subject budget in USD (optional)          |
| `synthesis`  | `bool`      | Whether to run AI synthesis (optional)        |
| `model`      | `str`       | AI model for synthesis (optional)             |
| `prompt`     | `str`       | Custom system prompt for synthesis (optional) |

### `list_sources(*, category)`

List available research sources. Accepts an optional `category` filter (`"structured"`, `"news"`, `"search"`, `"books"`, `"archives"`, `"obituary"`). Returns `list[Source]`.

### `health()`

Check server health. Returns `HealthStatus`.

## Models

| Model             | Key fields                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `DebriefResult`   | `subject`, `findings`, `synthesis_result`, `total_cost_usd`, `sources_attempted`, `duration_ms`    |
| `Finding`         | `text`, `url`, `confidence`, `source_type`, `source_name`, `reliability_tier`, `reliability_score` |
| `SynthesisResult` | `data`, `cost_usd`, `input_tokens`, `output_tokens`, `model`                                       |
| `Source`          | `name`, `type`, `category`, `reliability_tier`, `reliability_score`, `is_free`, `available`        |
| `HealthStatus`    | `status`, `version`, `uptime`                                                                      |

All models use Pydantic v2 and accept both camelCase (server JSON) and snake_case field names.

## Exceptions

| Exception                  | When raised                          | Key attributes                      |
| -------------------------- | ------------------------------------ | ----------------------------------- |
| `DebrieferAPIError`        | Server returns a 4xx or 5xx response | `status_code`, `message`, `details` |
| `DebrieferConnectionError` | Client cannot reach the server       | —                                   |

Both inherit from `DebrieferError`.

```python
from debriefer.exceptions import DebrieferAPIError, DebrieferConnectionError

try:
    result = await client.debrief("Jane Doe")
except DebrieferAPIError as e:
    print(f"API error {e.status_code}: {e.message}")
except DebrieferConnectionError:
    print("Server unreachable")
```

## Docs

Full documentation lives in the [debriefer monorepo](https://github.com/chenders/debriefer).

## License

MIT
