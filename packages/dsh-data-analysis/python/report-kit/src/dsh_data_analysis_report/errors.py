"""Stable, value-safe public errors for report snapshot emission."""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType


class ReportKitError(ValueError):
    """Base error carrying a stable machine-readable code and bounded context."""

    def __init__(
        self, code: str, message: str, context: Mapping[str, object] | None = None
    ) -> None:
        super().__init__(message)
        self.code = code
        self.context = MappingProxyType(dict(context or {}))


class ReportDatasetError(ReportKitError):
    """Dataset snapshot emission failed."""


class ReportSessionTraceError(ReportKitError):
    """Session trace snapshot emission failed."""


__all__ = ["ReportDatasetError", "ReportKitError", "ReportSessionTraceError"]
