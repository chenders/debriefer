"""Shared fixtures for debriefer client tests."""

from __future__ import annotations

import pytest


@pytest.fixture()
def base_url() -> str:
    """Base URL for the mock debriefer server."""
    return "http://localhost:3000"


@pytest.fixture()
def api_key() -> str:
    """API key for authenticated requests."""
    return "test-api-key-123"
