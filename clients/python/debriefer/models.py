"""Pydantic models matching the debriefer server JSON responses."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Subject(BaseModel):
    """A research subject returned in debrief results."""

    model_config = ConfigDict(populate_by_name=True)

    id: str | int
    name: str
    context: dict[str, object] | None = None


class Finding(BaseModel):
    """A scored finding from a single source lookup."""

    model_config = ConfigDict(populate_by_name=True)

    text: str
    url: str | None = None
    publication: str | None = None
    article_title: str | None = Field(default=None, alias="articleTitle")
    confidence: float
    cost_usd: float = Field(alias="costUsd")
    metadata: dict[str, object] | None = None
    source_type: str = Field(alias="sourceType")
    source_name: str = Field(alias="sourceName")
    reliability_tier: str = Field(alias="reliabilityTier")
    reliability_score: float = Field(alias="reliabilityScore")


class SynthesisResult(BaseModel):
    """Result of AI synthesis including cost metadata."""

    model_config = ConfigDict(populate_by_name=True)

    data: Any
    cost_usd: float = Field(alias="costUsd")
    input_tokens: int = Field(alias="inputTokens")
    output_tokens: int = Field(alias="outputTokens")
    model: str


class DebriefResult(BaseModel):
    """Complete result of debriefing a single subject."""

    model_config = ConfigDict(populate_by_name=True)

    subject: Subject
    data: Any = None
    findings: list[Finding]
    synthesis_result: SynthesisResult | None = Field(
        default=None, alias="synthesisResult"
    )
    total_cost_usd: float = Field(alias="totalCostUsd")
    sources_attempted: int = Field(alias="sourcesAttempted")
    sources_succeeded: int = Field(alias="sourcesSucceeded")
    stopped_at_phase: int | None = Field(default=None, alias="stoppedAtPhase")
    duration_ms: float = Field(alias="durationMs")


class Source(BaseModel):
    """Metadata about an available research source."""

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

    model_config = ConfigDict(populate_by_name=True)

    status: str
    version: str
    uptime: int
