"""Tests for debriefer client exceptions."""

from __future__ import annotations

import pytest

from debriefer.exceptions import (
    DebrieferAPIError,
    DebrieferConnectionError,
    DebrieferError,
)


class TestDebrieferError:
    def test_is_base_exception(self) -> None:
        err = DebrieferError("something went wrong")
        assert isinstance(err, Exception)
        assert str(err) == "something went wrong"

    def test_can_be_caught_as_exception(self) -> None:
        with pytest.raises(Exception):
            raise DebrieferError("test")


class TestDebrieferAPIError:
    def test_inherits_from_debriefer_error(self) -> None:
        err = DebrieferAPIError(404, "Not Found")
        assert isinstance(err, DebrieferError)
        assert isinstance(err, Exception)

    def test_attributes(self) -> None:
        err = DebrieferAPIError(400, "Invalid request", ["name is required"])
        assert err.status_code == 400
        assert err.message == "Invalid request"
        assert err.details == ["name is required"]

    def test_str_representation(self) -> None:
        err = DebrieferAPIError(500, "Server Error")
        assert str(err) == "HTTP 500: Server Error"

    def test_details_default_none(self) -> None:
        err = DebrieferAPIError(401, "Unauthorized")
        assert err.details is None

    def test_can_be_caught_as_debriefer_error(self) -> None:
        with pytest.raises(DebrieferError):
            raise DebrieferAPIError(500, "fail")


class TestDebrieferConnectionError:
    def test_inherits_from_debriefer_error(self) -> None:
        err = DebrieferConnectionError("connection refused")
        assert isinstance(err, DebrieferError)
        assert isinstance(err, Exception)

    def test_str_representation(self) -> None:
        err = DebrieferConnectionError("connection refused")
        assert str(err) == "connection refused"

    def test_can_be_caught_as_debriefer_error(self) -> None:
        with pytest.raises(DebrieferError):
            raise DebrieferConnectionError("timeout")
