"""Tests for debriefer Pydantic models."""

from __future__ import annotations

from debriefer.models import (
    DebriefResult,
    Finding,
    HealthStatus,
    Source,
    Subject,
    SynthesisResult,
)


class TestSubject:
    def test_with_string_id(self) -> None:
        s = Subject(id="abc", name="John Wayne")
        assert s.id == "abc"
        assert s.name == "John Wayne"
        assert s.context is None

    def test_with_numeric_id(self) -> None:
        s = Subject(id=42, name="Jane Doe")
        assert s.id == 42

    def test_with_context(self) -> None:
        s = Subject(id=1, name="Test", context={"year": 1979})
        assert s.context == {"year": 1979}

    def test_from_json_dict(self) -> None:
        data = {"id": "x", "name": "Test Subject", "context": None}
        s = Subject.model_validate(data)
        assert s.name == "Test Subject"


class TestFinding:
    def test_from_camel_case_json(self) -> None:
        data = {
            "text": "Found relevant info",
            "url": "https://example.com",
            "publication": "Reuters",
            "articleTitle": "Breaking News",
            "confidence": 0.85,
            "costUsd": 0.001,
            "metadata": {"key": "value"},
            "sourceType": "news_wire",
            "sourceName": "Reuters",
            "reliabilityTier": "TIER_1_NEWS",
            "reliabilityScore": 0.95,
        }
        f = Finding.model_validate(data)
        assert f.text == "Found relevant info"
        assert f.article_title == "Breaking News"
        assert f.cost_usd == 0.001
        assert f.source_type == "news_wire"
        assert f.source_name == "Reuters"
        assert f.reliability_tier == "TIER_1_NEWS"
        assert f.reliability_score == 0.95

    def test_optional_fields_default_none(self) -> None:
        data = {
            "text": "Some text",
            "confidence": 0.5,
            "costUsd": 0.0,
            "sourceType": "test",
            "sourceName": "Test",
            "reliabilityTier": "UNRELIABLE_UGC",
            "reliabilityScore": 0.35,
        }
        f = Finding.model_validate(data)
        assert f.url is None
        assert f.publication is None
        assert f.article_title is None
        assert f.metadata is None

    def test_populate_by_name(self) -> None:
        """Fields can be set via snake_case Python names."""
        f = Finding(
            text="test",
            confidence=0.5,
            cost_usd=0.0,
            source_type="x",
            source_name="X",
            reliability_tier="T",
            reliability_score=0.5,
        )
        assert f.source_type == "x"


class TestSynthesisResult:
    def test_from_camel_case_json(self) -> None:
        data = {
            "data": "Synthesized summary here",
            "costUsd": 0.02,
            "inputTokens": 1500,
            "outputTokens": 300,
            "model": "claude-sonnet-4-20250514",
        }
        sr = SynthesisResult.model_validate(data)
        assert sr.data == "Synthesized summary here"
        assert sr.cost_usd == 0.02
        assert sr.input_tokens == 1500
        assert sr.output_tokens == 300
        assert sr.model == "claude-sonnet-4-20250514"

    def test_data_can_be_list(self) -> None:
        """NoopSynthesizer returns findings array as data."""
        findings = [{"text": "found", "sourceType": "wiki"}]
        data = {
            "data": findings,
            "costUsd": 0.0,
            "inputTokens": 0,
            "outputTokens": 0,
            "model": "noop",
        }
        sr = SynthesisResult.model_validate(data)
        assert sr.data == findings


class TestDebriefResult:
    def test_full_response(self) -> None:
        data = {
            "subject": {"id": "john-wayne", "name": "John Wayne"},
            "data": "John Wayne was an American actor.",
            "findings": [
                {
                    "text": "Wikipedia article",
                    "confidence": 0.9,
                    "costUsd": 0.0,
                    "sourceType": "wikipedia",
                    "sourceName": "Wikipedia",
                    "reliabilityTier": "SECONDARY_COMPILATION",
                    "reliabilityScore": 0.85,
                }
            ],
            "synthesisResult": {
                "data": "John Wayne was an American actor.",
                "costUsd": 0.02,
                "inputTokens": 1000,
                "outputTokens": 200,
                "model": "claude-sonnet-4-20250514",
            },
            "totalCostUsd": 0.02,
            "sourcesAttempted": 5,
            "sourcesSucceeded": 3,
            "stoppedAtPhase": 1,
            "durationMs": 2500.0,
        }
        result = DebriefResult.model_validate(data)
        assert result.subject.name == "John Wayne"
        assert result.data == "John Wayne was an American actor."
        assert len(result.findings) == 1
        assert result.findings[0].source_type == "wikipedia"
        assert result.synthesis_result is not None
        assert result.synthesis_result.input_tokens == 1000
        assert result.total_cost_usd == 0.02
        assert result.sources_attempted == 5
        assert result.sources_succeeded == 3
        assert result.stopped_at_phase == 1
        assert result.duration_ms == 2500.0

    def test_minimal_response(self) -> None:
        data = {
            "subject": {"id": 1, "name": "Nobody"},
            "data": None,
            "findings": [],
            "totalCostUsd": 0.0,
            "sourcesAttempted": 2,
            "sourcesSucceeded": 0,
            "durationMs": 100.0,
        }
        result = DebriefResult.model_validate(data)
        assert result.data is None
        assert result.findings == []
        assert result.synthesis_result is None
        assert result.stopped_at_phase is None


class TestSource:
    def test_from_camel_case_json(self) -> None:
        data = {
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
        s = Source.model_validate(data)
        assert s.name == "Wikipedia"
        assert s.type == "wikipedia"
        assert s.category == "reference"
        assert s.reliability_tier == "SECONDARY_COMPILATION"
        assert s.reliability_score == 0.85
        assert s.domain == "en.wikipedia.org"
        assert s.is_free is True
        assert s.estimated_cost_per_query == 0.0
        assert s.available is True


class TestHealthStatus:
    def test_from_json(self) -> None:
        data = {"status": "ok", "version": "0.1.0", "uptime": 3600}
        h = HealthStatus.model_validate(data)
        assert h.status == "ok"
        assert h.version == "0.1.0"
        assert h.uptime == 3600
