"""Tests for the async HTTP client."""

from __future__ import annotations

import httpx
import pytest
import respx

from debriefer.client import AsyncDebriefer
from debriefer.exceptions import DebrieferAPIError, DebrieferConnectionError
from debriefer.models import DebriefResult, HealthStatus, Source


@pytest.fixture()
def mock_health_response() -> dict:
    return {"status": "ok", "version": "0.1.0", "uptime": 42}


@pytest.fixture()
def mock_sources_response() -> list[dict]:
    return [
        {
            "name": "Wikipedia",
            "type": "wikipedia",
            "category": "reference",
            "reliabilityTier": "SECONDARY_COMPILATION",
            "reliabilityScore": 0.85,
            "domain": "en.wikipedia.org",
            "isFree": True,
            "estimatedCostPerQuery": 0.0,
            "available": True,
        }
    ]


@pytest.fixture()
def mock_debrief_response() -> dict:
    return {
        "subject": {"id": "john-wayne", "name": "John Wayne"},
        "data": "Summary text",
        "findings": [
            {
                "text": "Found info",
                "confidence": 0.9,
                "costUsd": 0.0,
                "sourceType": "wikipedia",
                "sourceName": "Wikipedia",
                "reliabilityTier": "SECONDARY_COMPILATION",
                "reliabilityScore": 0.85,
            }
        ],
        "totalCostUsd": 0.01,
        "sourcesAttempted": 3,
        "sourcesSucceeded": 2,
        "durationMs": 1500.0,
    }


class TestAsyncDebrieferInit:
    def test_defaults(self, base_url: str) -> None:
        client = AsyncDebriefer(base_url)
        assert client.base_url == base_url
        assert client.api_key is None
        assert client.timeout == 120.0

    def test_custom_options(self, base_url: str, api_key: str) -> None:
        client = AsyncDebriefer(base_url, api_key=api_key, timeout=30.0)
        assert client.api_key == api_key
        assert client.timeout == 30.0

    def test_trailing_slash_stripped(self) -> None:
        client = AsyncDebriefer("http://localhost:3000/")
        assert client.base_url == "http://localhost:3000"


class TestAsyncDebrieferContextManager:
    @pytest.mark.asyncio()
    async def test_enter_exit(self, base_url: str) -> None:
        client = AsyncDebriefer(base_url)
        assert client._client is None
        async with client as ctx:
            assert ctx is client
            assert client._client is not None
        assert client._client is None


class TestHealth:
    @pytest.mark.asyncio()
    @respx.mock
    async def test_health(
        self, base_url: str, mock_health_response: dict
    ) -> None:
        respx.get(f"{base_url}/api/health").mock(
            return_value=httpx.Response(200, json=mock_health_response)
        )
        async with AsyncDebriefer(base_url) as client:
            result = await client.health()
        assert isinstance(result, HealthStatus)
        assert result.status == "ok"
        assert result.version == "0.1.0"
        assert result.uptime == 42


class TestListSources:
    @pytest.mark.asyncio()
    @respx.mock
    async def test_list_sources(
        self, base_url: str, mock_sources_response: list[dict]
    ) -> None:
        respx.get(f"{base_url}/api/sources").mock(
            return_value=httpx.Response(200, json=mock_sources_response)
        )
        async with AsyncDebriefer(base_url) as client:
            sources = await client.list_sources()
        assert len(sources) == 1
        assert isinstance(sources[0], Source)
        assert sources[0].name == "Wikipedia"

    @pytest.mark.asyncio()
    @respx.mock
    async def test_list_sources_with_category(
        self, base_url: str, mock_sources_response: list[dict]
    ) -> None:
        route = respx.get(f"{base_url}/api/sources", params={"category": "news"}).mock(
            return_value=httpx.Response(200, json=mock_sources_response)
        )
        async with AsyncDebriefer(base_url) as client:
            await client.list_sources(category="news")
        assert route.called


class TestDebrief:
    @pytest.mark.asyncio()
    @respx.mock
    async def test_debrief_minimal(
        self, base_url: str, mock_debrief_response: dict
    ) -> None:
        route = respx.post(f"{base_url}/api/debrief").mock(
            return_value=httpx.Response(200, json=mock_debrief_response)
        )
        async with AsyncDebriefer(base_url) as client:
            result = await client.debrief("John Wayne")
        assert isinstance(result, DebriefResult)
        assert result.subject.name == "John Wayne"
        assert len(result.findings) == 1
        # Verify the request body
        request = route.calls[0].request
        body = request.content.decode()
        import json

        parsed = json.loads(body)
        assert parsed["name"] == "John Wayne"
        # Only name should be sent for minimal call
        assert "categories" not in parsed
        assert "budget" not in parsed

    @pytest.mark.asyncio()
    @respx.mock
    async def test_debrief_with_options(
        self, base_url: str, mock_debrief_response: dict
    ) -> None:
        route = respx.post(f"{base_url}/api/debrief").mock(
            return_value=httpx.Response(200, json=mock_debrief_response)
        )
        async with AsyncDebriefer(base_url) as client:
            await client.debrief(
                "John Wayne",
                categories=["news", "reference"],
                budget=0.50,
                synthesis=True,
                model="claude-sonnet-4-20250514",
                prompt="Custom prompt",
            )
        import json

        body = json.loads(route.calls[0].request.content.decode())
        assert body["name"] == "John Wayne"
        assert body["categories"] == ["news", "reference"]
        assert body["budget"] == 0.50
        assert body["synthesis"] is True
        assert body["model"] == "claude-sonnet-4-20250514"
        assert body["prompt"] == "Custom prompt"


class TestErrorHandling:
    @pytest.mark.asyncio()
    @respx.mock
    async def test_api_error_400(self, base_url: str) -> None:
        respx.post(f"{base_url}/api/debrief").mock(
            return_value=httpx.Response(
                400,
                json={
                    "error": "Invalid request",
                    "details": ["name is required"],
                },
            )
        )
        async with AsyncDebriefer(base_url) as client:
            with pytest.raises(DebrieferAPIError) as exc_info:
                await client.debrief("")
        assert exc_info.value.status_code == 400
        assert exc_info.value.message == "Invalid request"
        assert exc_info.value.details == ["name is required"]

    @pytest.mark.asyncio()
    @respx.mock
    async def test_api_error_401(self, base_url: str) -> None:
        respx.get(f"{base_url}/api/health").mock(
            return_value=httpx.Response(401, json={"error": "Unauthorized"})
        )
        async with AsyncDebriefer(base_url) as client:
            with pytest.raises(DebrieferAPIError) as exc_info:
                await client.health()
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio()
    @respx.mock
    async def test_api_error_500(self, base_url: str) -> None:
        respx.get(f"{base_url}/api/health").mock(
            return_value=httpx.Response(500, json={"error": "Research failed"})
        )
        async with AsyncDebriefer(base_url) as client:
            with pytest.raises(DebrieferAPIError) as exc_info:
                await client.health()
        assert exc_info.value.status_code == 500
        assert exc_info.value.message == "Research failed"

    @pytest.mark.asyncio()
    @respx.mock
    async def test_connection_error(self, base_url: str) -> None:
        respx.get(f"{base_url}/api/health").mock(
            side_effect=httpx.ConnectError("Connection refused")
        )
        async with AsyncDebriefer(base_url) as client:
            with pytest.raises(DebrieferConnectionError):
                await client.health()

    @pytest.mark.asyncio()
    @respx.mock
    async def test_transport_error(self, base_url: str) -> None:
        respx.get(f"{base_url}/api/health").mock(
            side_effect=httpx.TransportError("network down")
        )
        async with AsyncDebriefer(base_url) as client:
            with pytest.raises(DebrieferConnectionError):
                await client.health()


class TestAuthHeader:
    @pytest.mark.asyncio()
    @respx.mock
    async def test_bearer_token_sent(
        self,
        base_url: str,
        api_key: str,
        mock_health_response: dict,
    ) -> None:
        route = respx.get(f"{base_url}/api/health").mock(
            return_value=httpx.Response(200, json=mock_health_response)
        )
        async with AsyncDebriefer(base_url, api_key=api_key) as client:
            await client.health()
        request = route.calls[0].request
        assert request.headers["authorization"] == f"Bearer {api_key}"

    @pytest.mark.asyncio()
    @respx.mock
    async def test_no_auth_header_when_no_key(
        self,
        base_url: str,
        mock_health_response: dict,
    ) -> None:
        route = respx.get(f"{base_url}/api/health").mock(
            return_value=httpx.Response(200, json=mock_health_response)
        )
        async with AsyncDebriefer(base_url) as client:
            await client.health()
        request = route.calls[0].request
        assert "authorization" not in request.headers
