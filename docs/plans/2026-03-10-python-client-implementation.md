# Python Client Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an async Python HTTP client for the debriefer server, with Pydantic response models and full test coverage.

**Architecture:** `AsyncDebriefer` class wrapping `httpx.AsyncClient`, calling the 3 server endpoints (`/api/health`, `/api/sources`, `/api/debrief`). Responses are parsed into Pydantic v2 models. Tests use `respx` to mock HTTP.

**Tech Stack:** Python 3.10+, httpx, pydantic v2, pytest, pytest-asyncio, respx

**Design doc:** `docs/plans/2026-03-10-python-client-design.md`

---

### Task 1: Exceptions

Define the error hierarchy. Small, standalone, no dependencies on other modules.

**Files:**

- Create: `clients/python/debriefer/exceptions.py`
- Test: `clients/python/tests/test_exceptions.py`

**Step 1: Write exceptions.py**

```python
"""Debriefer client exceptions."""


class DebrieferError(Exception):
    """Base exception for all debriefer client errors."""


class DebrieferAPIError(DebrieferError):
    """Raised when the server returns a 4xx/5xx response."""

    def __init__(self, status_code: int, message: str, details: list[str] | None = None):
        self.status_code = status_code
        self.message = message
        self.details = details
        super().__init__(f"HTTP {status_code}: {message}")


class DebrieferConnectionError(DebrieferError):
    """Raised when the client cannot reach the server."""
```

**Step 2: Write test**

```python
"""Tests for exception classes."""

from debriefer.exceptions import DebrieferError, DebrieferAPIError, DebrieferConnectionError


def test_api_error_inherits_from_base():
    assert issubclass(DebrieferAPIError, DebrieferError)


def test_connection_error_inherits_from_base():
    assert issubclass(DebrieferConnectionError, DebrieferError)


def test_api_error_attributes():
    err = DebrieferAPIError(400, "Invalid request", ["name is required"])
    assert err.status_code == 400
    assert err.message == "Invalid request"
    assert err.details == ["name is required"]
    assert "400" in str(err)


def test_api_error_without_details():
    err = DebrieferAPIError(500, "Internal error")
    assert err.details is None
```

**Step 3: Run tests**

Run: `cd clients/python && python -m pytest tests/test_exceptions.py -v`
Expected: PASS (4 tests)

**Step 4: Commit**

```bash
git add clients/python/debriefer/exceptions.py clients/python/tests/test_exceptions.py
git commit -m "feat(python): add exception classes"
```

---

### Task 2: Pydantic Models

Define response models matching the server's JSON shapes. All field names use camelCase aliases.

**Files:**

- Create: `clients/python/debriefer/models.py`
- Test: `clients/python/tests/test_models.py`

**Step 1: Write models.py**

```python
"""Pydantic response models for the debriefer server API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class Subject(BaseModel):
    """Research subject identifier."""

    model_config = ConfigDict(populate_by_name=True)

    id: str | int
    name: str
    context: dict[str, Any] | None = None


class Finding(BaseModel):
    """A single research finding from one source."""

    model_config = ConfigDict(populate_by_name=True)

    text: str
    url: str | None = None
    publication: str | None = None
    article_title: str | None = Field(default=None, alias="articleTitle")
    confidence: float
    cost_usd: float = Field(alias="costUsd")
    metadata: dict[str, Any] | None = None
    source_type: str = Field(alias="sourceType")
    source_name: str = Field(alias="sourceName")
    reliability_tier: str = Field(alias="reliabilityTier")
    reliability_score: float = Field(alias="reliabilityScore")


class SynthesisResult(BaseModel):
    """Result from AI synthesis of findings."""

    model_config = ConfigDict(populate_by_name=True)

    data: str | None = None
    cost_usd: float = Field(alias="costUsd")
    input_tokens: int = Field(alias="inputTokens")
    output_tokens: int = Field(alias="outputTokens")
    model: str


class DebriefResult(BaseModel):
    """Complete result from a debrief research run."""

    model_config = ConfigDict(populate_by_name=True)

    subject: Subject
    data: str | None = None
    findings: list[Finding]
    synthesis_result: SynthesisResult | None = Field(default=None, alias="synthesisResult")
    total_cost_usd: float = Field(alias="totalCostUsd")
    sources_attempted: int = Field(alias="sourcesAttempted")
    sources_succeeded: int = Field(alias="sourcesSucceeded")
    stopped_at_phase: int | None = Field(default=None, alias="stoppedAtPhase")
    duration_ms: int = Field(alias="durationMs")


class Source(BaseModel):
    """Source metadata from the server."""

    model_config = ConfigDict(populate_by_name=True)

    name: str
    type: str
    category: str
    reliability_tier: str = Field(alias="reliabilityTier")
    reliability_score: float = Field(alias="reliabilityScore")
    domain: str
    is_free: bool = Field(alias="isFree")
    estimated_cost_per_query: float = Field(alias="estimatedCostPerQuery")
    available: bool


class HealthStatus(BaseModel):
    """Server health check response."""

    status: str
    version: str
    uptime: int
```

Note: Add `from pydantic import Field` to the imports.

**Step 2: Write test**

```python
"""Tests for Pydantic response models."""

from debriefer.models import DebriefResult, Finding, Source, HealthStatus, SynthesisResult, Subject


def test_health_status_from_json():
    data = {"status": "ok", "version": "0.1.0", "uptime": 1234}
    health = HealthStatus.model_validate(data)
    assert health.status == "ok"
    assert health.version == "0.1.0"
    assert health.uptime == 1234


def test_source_from_json():
    data = {
        "name": "Wikipedia",
        "type": "wikipedia",
        "category": "structured",
        "reliabilityTier": "SECONDARY_COMPILATION",
        "reliabilityScore": 0.85,
        "domain": "en.wikipedia.org",
        "isFree": True,
        "estimatedCostPerQuery": 0.0,
        "available": True,
    }
    source = Source.model_validate(data)
    assert source.name == "Wikipedia"
    assert source.reliability_tier == "SECONDARY_COMPILATION"
    assert source.is_free is True


def test_finding_from_json():
    data = {
        "text": "Some finding text",
        "url": "https://example.com",
        "confidence": 0.9,
        "costUsd": 0.01,
        "sourceType": "wikipedia",
        "sourceName": "Wikipedia",
        "reliabilityTier": "SECONDARY_COMPILATION",
        "reliabilityScore": 0.85,
    }
    finding = Finding.model_validate(data)
    assert finding.text == "Some finding text"
    assert finding.source_type == "wikipedia"
    assert finding.cost_usd == 0.01


def test_debrief_result_from_json():
    data = {
        "subject": {"id": "test", "name": "Test Subject"},
        "data": None,
        "findings": [],
        "totalCostUsd": 0.0,
        "sourcesAttempted": 5,
        "sourcesSucceeded": 0,
        "durationMs": 100,
    }
    result = DebriefResult.model_validate(data)
    assert result.subject.name == "Test Subject"
    assert result.total_cost_usd == 0.0
    assert result.findings == []
    assert result.synthesis_result is None


def test_debrief_result_with_synthesis():
    data = {
        "subject": {"id": "test", "name": "Test"},
        "data": "Synthesized summary",
        "findings": [
            {
                "text": "Raw text",
                "confidence": 0.8,
                "costUsd": 0.0,
                "sourceType": "wikipedia",
                "sourceName": "Wikipedia",
                "reliabilityTier": "SECONDARY_COMPILATION",
                "reliabilityScore": 0.85,
            }
        ],
        "synthesisResult": {
            "data": "Synthesized summary",
            "costUsd": 0.025,
            "inputTokens": 450,
            "outputTokens": 120,
            "model": "claude-sonnet-4-20250514",
        },
        "totalCostUsd": 0.025,
        "sourcesAttempted": 5,
        "sourcesSucceeded": 1,
        "stoppedAtPhase": 1,
        "durationMs": 3420,
    }
    result = DebriefResult.model_validate(data)
    assert result.data == "Synthesized summary"
    assert result.synthesis_result is not None
    assert result.synthesis_result.model == "claude-sonnet-4-20250514"
    assert result.stopped_at_phase == 1
    assert len(result.findings) == 1
```

**Step 3: Run tests**

Run: `cd clients/python && python -m pytest tests/test_models.py -v`
Expected: PASS (5 tests)

**Step 4: Commit**

```bash
git add clients/python/debriefer/models.py clients/python/tests/test_models.py
git commit -m "feat(python): add Pydantic response models"
```

---

### Task 3: Client

The `AsyncDebriefer` class with all 3 methods, auth, error handling.

**Files:**

- Create: `clients/python/debriefer/client.py`
- Create: `clients/python/tests/conftest.py`
- Test: `clients/python/tests/test_client.py`

**Step 1: Write conftest.py**

```python
"""Shared test fixtures."""

import pytest


@pytest.fixture
def base_url() -> str:
    return "http://localhost:8090"


@pytest.fixture
def api_key() -> str:
    return "test-api-key"
```

**Step 2: Write client.py**

```python
"""Async HTTP client for the debriefer server."""

from __future__ import annotations

from typing import Any

import httpx

from .exceptions import DebrieferAPIError, DebrieferConnectionError
from .models import DebriefResult, HealthStatus, Source


class AsyncDebriefer:
    """Async client for the debriefer research orchestration server.

    Usage::

        async with AsyncDebriefer("http://localhost:8090", api_key="sk-...") as db:
            result = await db.debrief("Steve McQueen")
            sources = await db.list_sources()
            health = await db.health()
    """

    def __init__(
        self,
        base_url: str,
        *,
        api_key: str | None = None,
        timeout: float = 120.0,
    ) -> None:
        headers: dict[str, str] = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers=headers,
            timeout=timeout,
        )

    async def __aenter__(self) -> AsyncDebriefer:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        """Make an HTTP request and handle errors."""
        try:
            response = await self._client.request(method, path, **kwargs)
        except httpx.ConnectError as exc:
            raise DebrieferConnectionError(str(exc)) from exc
        except httpx.TransportError as exc:
            raise DebrieferConnectionError(str(exc)) from exc

        if response.status_code >= 400:
            body = response.json()
            raise DebrieferAPIError(
                status_code=response.status_code,
                message=body.get("error", "Unknown error"),
                details=body.get("details"),
            )

        return response.json()

    async def health(self) -> HealthStatus:
        """Check server health."""
        data = await self._request("GET", "/api/health")
        return HealthStatus.model_validate(data)

    async def list_sources(self, *, category: str | None = None) -> list[Source]:
        """List available research sources."""
        params: dict[str, str] = {}
        if category:
            params["category"] = category
        data = await self._request("GET", "/api/sources", params=params)
        return [Source.model_validate(item) for item in data]

    async def debrief(
        self,
        name: str,
        *,
        categories: list[str] | None = None,
        budget: float | None = None,
        synthesis: bool | None = None,
        model: str | None = None,
        prompt: str | None = None,
    ) -> DebriefResult:
        """Research a subject across multiple sources."""
        body: dict[str, Any] = {"name": name}
        if categories is not None:
            body["categories"] = categories
        if budget is not None:
            body["budget"] = budget
        if synthesis is not None:
            body["synthesis"] = synthesis
        if model is not None:
            body["model"] = model
        if prompt is not None:
            body["prompt"] = prompt

        data = await self._request("POST", "/api/debrief", json=body)
        return DebriefResult.model_validate(data)
```

**Step 3: Write test_client.py**

```python
"""Tests for the AsyncDebriefer client."""

import httpx
import pytest
import respx

from debriefer.client import AsyncDebriefer
from debriefer.exceptions import DebrieferAPIError, DebrieferConnectionError
from debriefer.models import DebriefResult, HealthStatus, Source

HEALTH_RESPONSE = {"status": "ok", "version": "0.1.0", "uptime": 42}

SOURCES_RESPONSE = [
    {
        "name": "Wikipedia",
        "type": "wikipedia",
        "category": "structured",
        "reliabilityTier": "SECONDARY_COMPILATION",
        "reliabilityScore": 0.85,
        "domain": "en.wikipedia.org",
        "isFree": True,
        "estimatedCostPerQuery": 0.0,
        "available": True,
    }
]

DEBRIEF_RESPONSE = {
    "subject": {"id": "Test", "name": "Test"},
    "data": None,
    "findings": [],
    "totalCostUsd": 0.0,
    "sourcesAttempted": 5,
    "sourcesSucceeded": 0,
    "durationMs": 100,
}


# ============================================================================
# Health
# ============================================================================


@pytest.mark.asyncio
@respx.mock
async def test_health(base_url: str) -> None:
    respx.get(f"{base_url}/api/health").mock(return_value=httpx.Response(200, json=HEALTH_RESPONSE))
    async with AsyncDebriefer(base_url) as db:
        result = await db.health()
    assert isinstance(result, HealthStatus)
    assert result.status == "ok"


# ============================================================================
# Sources
# ============================================================================


@pytest.mark.asyncio
@respx.mock
async def test_list_sources(base_url: str) -> None:
    respx.get(f"{base_url}/api/sources").mock(
        return_value=httpx.Response(200, json=SOURCES_RESPONSE)
    )
    async with AsyncDebriefer(base_url) as db:
        sources = await db.list_sources()
    assert len(sources) == 1
    assert isinstance(sources[0], Source)
    assert sources[0].name == "Wikipedia"


@pytest.mark.asyncio
@respx.mock
async def test_list_sources_with_category(base_url: str) -> None:
    respx.get(f"{base_url}/api/sources", params={"category": "news"}).mock(
        return_value=httpx.Response(200, json=[])
    )
    async with AsyncDebriefer(base_url) as db:
        sources = await db.list_sources(category="news")
    assert sources == []


# ============================================================================
# Debrief
# ============================================================================


@pytest.mark.asyncio
@respx.mock
async def test_debrief(base_url: str) -> None:
    respx.post(f"{base_url}/api/debrief").mock(
        return_value=httpx.Response(200, json=DEBRIEF_RESPONSE)
    )
    async with AsyncDebriefer(base_url) as db:
        result = await db.debrief("Test")
    assert isinstance(result, DebriefResult)
    assert result.subject.name == "Test"


@pytest.mark.asyncio
@respx.mock
async def test_debrief_sends_optional_params(base_url: str) -> None:
    route = respx.post(f"{base_url}/api/debrief").mock(
        return_value=httpx.Response(200, json=DEBRIEF_RESPONSE)
    )
    async with AsyncDebriefer(base_url) as db:
        await db.debrief("Test", categories=["news"], budget=5.0, synthesis=True)
    body = route.calls[0].request.content
    import json

    sent = json.loads(body)
    assert sent["name"] == "Test"
    assert sent["categories"] == ["news"]
    assert sent["budget"] == 5.0
    assert sent["synthesis"] is True


# ============================================================================
# Auth
# ============================================================================


@pytest.mark.asyncio
@respx.mock
async def test_auth_header(base_url: str, api_key: str) -> None:
    route = respx.get(f"{base_url}/api/health").mock(
        return_value=httpx.Response(200, json=HEALTH_RESPONSE)
    )
    async with AsyncDebriefer(base_url, api_key=api_key) as db:
        await db.health()
    assert route.calls[0].request.headers["authorization"] == f"Bearer {api_key}"


@pytest.mark.asyncio
@respx.mock
async def test_no_auth_header_when_no_key(base_url: str) -> None:
    route = respx.get(f"{base_url}/api/health").mock(
        return_value=httpx.Response(200, json=HEALTH_RESPONSE)
    )
    async with AsyncDebriefer(base_url) as db:
        await db.health()
    assert "authorization" not in route.calls[0].request.headers


# ============================================================================
# Error handling
# ============================================================================


@pytest.mark.asyncio
@respx.mock
async def test_api_error_on_400(base_url: str) -> None:
    respx.post(f"{base_url}/api/debrief").mock(
        return_value=httpx.Response(
            400, json={"error": "Invalid request", "details": ["name is required"]}
        )
    )
    async with AsyncDebriefer(base_url) as db:
        with pytest.raises(DebrieferAPIError) as exc_info:
            await db.debrief("Test")
    assert exc_info.value.status_code == 400
    assert exc_info.value.details == ["name is required"]


@pytest.mark.asyncio
@respx.mock
async def test_connection_error(base_url: str) -> None:
    respx.get(f"{base_url}/api/health").mock(side_effect=httpx.ConnectError("refused"))
    async with AsyncDebriefer(base_url) as db:
        with pytest.raises(DebrieferConnectionError):
            await db.health()
```

**Step 4: Run tests**

Run: `cd clients/python && python -m pytest tests/test_client.py -v`
Expected: PASS (9 tests)

**Step 5: Commit**

```bash
git add clients/python/debriefer/client.py clients/python/tests/conftest.py clients/python/tests/test_client.py
git commit -m "feat(python): add AsyncDebriefer client"
```

---

### Task 4: Public API and **init**.py

Update `__init__.py` to re-export the public API.

**Files:**

- Modify: `clients/python/debriefer/__init__.py`

**Step 1: Update **init**.py**

```python
"""Debriefer: Python client for multi-source research orchestration."""

__version__ = "0.1.0"

from .client import AsyncDebriefer
from .exceptions import DebrieferAPIError, DebrieferConnectionError, DebrieferError
from .models import DebriefResult, Finding, HealthStatus, Source, Subject, SynthesisResult

__all__ = [
    "AsyncDebriefer",
    "DebriefResult",
    "DebrieferAPIError",
    "DebrieferConnectionError",
    "DebrieferError",
    "Finding",
    "HealthStatus",
    "Source",
    "Subject",
    "SynthesisResult",
]
```

**Step 2: Run all tests**

Run: `cd clients/python && python -m pytest tests/ -v`
Expected: PASS (all 18 tests)

**Step 3: Commit**

```bash
git add clients/python/debriefer/__init__.py
git commit -m "feat(python): update __init__.py with public API exports"
```

---

### Task 5: Create tests/**init**.py and verify install

Ensure the test directory is a proper package and the client installs correctly.

**Files:**

- Create: `clients/python/tests/__init__.py` (empty)

**Step 1: Create empty **init**.py**

```python

```

**Step 2: Install in dev mode and run full test suite**

```bash
cd clients/python
pip install -e ".[dev]"
python -m pytest tests/ -v
```

Expected: All tests pass.

**Step 3: Verify import works**

```bash
python -c "from debriefer import AsyncDebriefer, DebriefResult; print('OK')"
```

Expected: `OK`

**Step 4: Commit**

```bash
git add clients/python/tests/__init__.py
git commit -m "chore(python): add tests __init__.py"
```

---

### Task 6: Pre-Push Verification and PR

**Step 1: Run full monorepo checks**

```bash
npx turbo test lint type-check
npx prettier --check .
```

**Step 2: Run Python tests**

```bash
cd clients/python && python -m pytest tests/ -v
```

**Step 3: Create feature branch and push**

```bash
git checkout -b feat/python-client
git push -u origin feat/python-client
```

**Step 4: Create PR**

```bash
gh pr create --title "Phase 9: Python HTTP client (AsyncDebriefer)" --body "## Summary

Implements Phase 9 — an async Python HTTP client wrapping the debriefer server API.

### Features

- **AsyncDebriefer** — async context manager with debrief(), list_sources(), health()
- **Pydantic models** — typed response objects (DebriefResult, Source, HealthStatus, etc.)
- **Error handling** — DebrieferAPIError (4xx/5xx), DebrieferConnectionError (network)
- **Bearer auth** — optional api_key parameter

### Usage

\`\`\`python
from debriefer import AsyncDebriefer

async with AsyncDebriefer('http://localhost:8090', api_key='sk-...') as db:
    result = await db.debrief('Steve McQueen', categories=['news'])
    sources = await db.list_sources()
\`\`\`

## Test plan

- [x] Exception tests (4)
- [x] Model validation tests (5)
- [x] Client tests with respx mocks (9)
- [x] Import verification"
```

---

## Task Order

1. **Task 1** — Exceptions
2. **Task 2** — Pydantic models
3. **Task 3** — Client
4. **Task 4** — Public API (**init**.py)
5. **Task 5** — Install verification
6. **Task 6** — Pre-push + PR
