"""Debriefer client exceptions."""

from __future__ import annotations


class DebrieferError(Exception):
    """Base exception for all debriefer client errors."""


class DebrieferAPIError(DebrieferError):
    """Raised when the server returns a 4xx/5xx response."""

    def __init__(
        self,
        status_code: int,
        message: str,
        details: list[str] | None = None,
    ) -> None:
        self.status_code = status_code
        self.message = message
        self.details = details
        super().__init__(f"HTTP {status_code}: {message}")


class DebrieferConnectionError(DebrieferError):
    """Raised when the client cannot reach the server."""
