"""Debriefer: Multi-source research orchestration engine."""

from __future__ import annotations

from .client import AsyncDebriefer
from .exceptions import DebrieferAPIError, DebrieferConnectionError, DebrieferError
from .models import (
    DebriefResult,
    Finding,
    HealthStatus,
    Source,
    Subject,
    SynthesisResult,
)

__version__ = "0.1.0"

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
