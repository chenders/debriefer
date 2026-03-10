"""Async HTTP client for the debriefer server."""

from __future__ import annotations

from typing import Any

import httpx

from .exceptions import DebrieferAPIError, DebrieferConnectionError
from .models import DebriefResult, HealthStatus, Source


class AsyncDebriefer:
    """Async client for the debriefer research orchestration server.

    Usage::

        async with AsyncDebriefer("http://localhost:3000") as client:
            health = await client.health()
            sources = await client.list_sources()
            result = await client.debrief("John Wayne")

    Args:
        base_url: Base URL of the debriefer server (e.g. ``http://localhost:3000``).
        api_key: Optional Bearer token for authenticated servers.
        timeout: Request timeout in seconds (default 120.0).
    """

    def __init__(
        self,
        base_url: str,
        *,
        api_key: str | None = None,
        timeout: float = 120.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> AsyncDebriefer:
        self._client = self._build_client()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any,
    ) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _build_client(self) -> httpx.AsyncClient:
        headers: dict[str, str] = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return httpx.AsyncClient(
            base_url=self.base_url,
            headers=headers,
            timeout=self.timeout,
        )

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = self._build_client()
        return self._client

    async def _request(
        self,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> Any:
        """Make an HTTP request and handle errors.

        Raises:
            DebrieferConnectionError: If the server is unreachable.
            DebrieferAPIError: If the server returns a 4xx/5xx status.
        """
        client = self._get_client()
        try:
            response = await client.request(method, path, **kwargs)
        except (httpx.ConnectError, httpx.TransportError) as exc:
            raise DebrieferConnectionError(str(exc)) from exc

        if response.status_code >= 400:
            body: dict[str, Any] = {}
            try:
                body = response.json()
            except Exception:
                pass
            message = body.get("error", response.reason_phrase or "Unknown error")
            details = body.get("details")
            raise DebrieferAPIError(
                status_code=response.status_code,
                message=message,
                details=details,
            )

        return response.json()

    async def health(self) -> HealthStatus:
        """Check server health.

        Returns:
            HealthStatus with status, version, and uptime fields.
        """
        data = await self._request("GET", "/api/health")
        return HealthStatus.model_validate(data)

    async def list_sources(
        self,
        *,
        category: str | None = None,
    ) -> list[Source]:
        """List available research sources.

        Args:
            category: Optional category filter (e.g. ``"news"``, ``"free"``).

        Returns:
            List of Source objects with metadata and availability.
        """
        params: dict[str, str] = {}
        if category is not None:
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
        """Run single-subject research across multiple sources.

        Args:
            name: Subject name to research (required).
            categories: Optional list of source categories to use.
            budget: Optional per-subject budget in USD.
            synthesis: Whether to run AI synthesis (server default: true).
            model: AI model for synthesis (e.g. ``"claude-sonnet-4-20250514"``).
            prompt: Custom system prompt for synthesis.

        Returns:
            DebriefResult with findings, synthesis, and cost data.
        """
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
