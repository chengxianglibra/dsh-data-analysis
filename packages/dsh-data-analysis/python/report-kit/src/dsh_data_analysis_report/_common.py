"""Shared bounded projection and atomic-write primitives."""

from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
from collections.abc import Mapping
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, TypeVar

import numpy as np
import pandas as pd

from .errors import ReportKitError, ReportSessionTraceError

ID_MAX_LENGTH = 128
STRING_MAX_LENGTH = 2_048
ISSUE_MAX_BYTES = 8 * 1_024
ISSUE_LIMIT = 100
QUALITY_FIELDS = (
    "coverage",
    "null_rate",
    "sample_size",
    "sample_coverage_min",
    "sample_coverage_avg",
    "sample_coverage_partial_buckets",
    "zero_denominator_rows",
    "evaluated_check_count",
    "failed_check_count",
    "warning_check_count",
)

ErrorT = TypeVar("ErrorT", bound=ReportKitError)


def fail(error_type: type[ErrorT], code: str, message: str, **context: object) -> None:
    raise error_type(code, message, context)


def contract_error_code(error_type: type[ErrorT]) -> str:
    return (
        "session-graph-unsupported"
        if issubclass(error_type, ReportSessionTraceError)
        else "artifact-contract-unsupported"
    )


def bounded_string(
    value: object,
    *,
    location: str,
    error_type: type[ErrorT],
    nullable: bool = False,
    allow_empty: bool = False,
) -> str | None:
    if value is None and nullable:
        return None
    if (
        not isinstance(value, str)
        or (not value and not allow_empty)
        or len(value.encode("utf-8")) > STRING_MAX_LENGTH
    ):
        fail(
            error_type,
            "session-trace-identity-invalid"
            if location.startswith("graph.")
            else "artifact-contract-unsupported",
            f"{location} must be a non-empty UTF-8 string of at most {STRING_MAX_LENGTH} bytes",
            location=location,
        )
    return value


def safe_identifier(value: object, *, location: str, error_type: type[ErrorT]) -> str:
    if not isinstance(value, str) or not value or len(value) > ID_MAX_LENGTH:
        fail(
            error_type,
            f"{location}-invalid",
            f"{location} is not a safe report identifier",
        )
    if not value[0].isalnum() or not all(
        character.isalnum() or character in "._-" for character in value
    ):
        fail(
            error_type,
            f"{location}-invalid",
            f"{location} is not a safe report identifier",
        )
    if not value.isascii():
        fail(
            error_type,
            f"{location}-invalid",
            f"{location} must contain ASCII characters only",
        )
    return value


def utc_timestamp(value: datetime | None = None) -> str:
    resolved = value or datetime.now(timezone.utc)
    if resolved.tzinfo is None:
        resolved = resolved.replace(tzinfo=timezone.utc)
    rendered = resolved.astimezone(timezone.utc).isoformat()
    return rendered.replace("+00:00", "Z")


def source_timestamp(value: object, *, location: str, error_type: type[ErrorT]) -> str:
    if not isinstance(value, datetime) or value.tzinfo is None:
        fail(
            error_type,
            contract_error_code(error_type),
            f"{location} must be timezone-aware",
            location=location,
        )
    return utc_timestamp(value)


def nonnegative_integer(
    value: object, *, location: str, error_type: type[ErrorT]
) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        fail(
            error_type,
            contract_error_code(error_type),
            f"{location} must be a non-negative integer",
            location=location,
        )
    return value


def nullable_finite_number(
    value: object, *, location: str, error_type: type[ErrorT]
) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(
        value, (int, float, np.integer, np.floating)
    ):
        fail(
            error_type,
            contract_error_code(error_type),
            f"{location} must be a finite number or null",
            location=location,
        )
    resolved = float(value)
    if not math.isfinite(resolved):
        fail(
            error_type,
            contract_error_code(error_type),
            f"{location} must be finite",
            location=location,
        )
    return resolved


def nullable_nonnegative_integer(
    value: object, *, location: str, error_type: type[ErrorT]
) -> int | None:
    if value is None:
        return None
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, np.integer))
        or int(value) < 0
    ):
        fail(
            error_type,
            contract_error_code(error_type),
            f"{location} must be a non-negative integer or null",
            location=location,
        )
    return int(value)


def project_quality(
    value: object, *, error_type: type[ErrorT]
) -> dict[str, object] | None:
    if value is None:
        return None
    result: dict[str, object] = {}
    for field in QUALITY_FIELDS:
        if not hasattr(value, field):
            fail(
                error_type,
                contract_error_code(error_type),
                "QualitySummary has an unsupported shape",
                field=field,
            )
        raw = getattr(value, field)
        if field in {
            "coverage",
            "null_rate",
            "sample_coverage_min",
            "sample_coverage_avg",
        }:
            result[field] = nullable_finite_number(
                raw, location=f"quality.{field}", error_type=error_type
            )
        else:
            result[field] = nullable_nonnegative_integer(
                raw, location=f"quality.{field}", error_type=error_type
            )
    return result


def project_repair(
    value: object, *, error_type: type[ErrorT], nullable: bool
) -> dict[str, str] | None:
    if value is None:
        if nullable:
            return None
        fail(
            error_type, contract_error_code(error_type), "A required repair is missing"
        )
    kind = getattr(value, "kind", None)
    if kind not in {
        "retry",
        "inspect",
        "user_choice",
        "semantic_authoring",
        "environment",
    }:
        fail(error_type, contract_error_code(error_type), "Repair kind is unsupported")
    target = getattr(value, "help_target", None)
    surface = getattr(target, "surface", None)
    canonical_id = getattr(target, "canonical_id", None)
    if not isinstance(surface, str) or not surface:
        fail(
            error_type,
            contract_error_code(error_type),
            "Repair help target is unsupported",
        )
    help_target = surface if canonical_id is None else f"{surface}.{canonical_id}"
    return {
        "kind": kind,
        "action": bounded_string(
            getattr(value, "action", None),
            location="repair.action",
            error_type=error_type,
        ),
        "help_target": bounded_string(
            help_target, location="repair.help_target", error_type=error_type
        ),
    }


def strict_boolean(value: object, *, location: str, error_type: type[ErrorT]) -> bool:
    if not isinstance(value, bool):
        fail(
            error_type,
            contract_error_code(error_type),
            f"{location} must be a boolean",
            location=location,
        )
    return value


def json_scalar(value: object, *, location: str, error_type: type[ErrorT]) -> object:
    if value is None or value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, np.datetime64):
        if pd.isna(value):
            return None
        return str(value)
    if isinstance(value, pd.Timestamp):
        if pd.isna(value):
            return None
        return value.isoformat()
    if isinstance(value, (np.timedelta64, pd.Timedelta)):
        if pd.isna(value):
            return None
        return pd.Timedelta(value).isoformat()
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (date, time)):
        return value.isoformat()
    if isinstance(value, timedelta):
        return pd.Timedelta(value).isoformat()
    if isinstance(value, str):
        return value
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        resolved = int(value)
        if abs(resolved) > 9_007_199_254_740_991:
            fail(
                error_type,
                "cell-type-unsupported",
                "An integer cell exceeds the JavaScript safe range",
                location=location,
            )
        return resolved
    if isinstance(value, (float, np.floating)):
        resolved = float(value)
        return resolved if math.isfinite(resolved) else None
    fail(
        error_type,
        "cell-type-unsupported",
        "A cell cannot be converted losslessly to a JSON scalar",
        location=location,
        valueType=type(value).__name__,
    )


def encoded_registration(
    registry: str, identity: str, payload: Mapping[str, Any]
) -> bytes:
    identity_json = json.dumps(identity, ensure_ascii=True, separators=(",", ":"))
    payload_json = json.dumps(
        payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")
    )
    payload_json = (
        payload_json.replace("<", "\\u003c")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )
    return f"{registry}.register({identity_json}, {payload_json});\n".encode()


def resolve_target(target: str | os.PathLike[str], *, error_type: type[ErrorT]) -> Path:
    try:
        raw = os.fspath(target)
    except TypeError:
        fail(error_type, "target-invalid", "target must be a string or path-like value")
    if not isinstance(raw, str):
        fail(error_type, "target-invalid", "target must resolve to a text path")
    path = Path(raw)
    if path.suffix != ".js":
        fail(
            error_type,
            "target-invalid",
            "target must use the .js suffix",
            targetSuffix=path.suffix,
        )
    if not path.parent.is_dir():
        fail(error_type, "target-invalid", "target parent directory must already exist")
    return path


def atomic_write(path: Path, content: bytes, *, error_type: type[ErrorT]) -> None:
    descriptor = -1
    temporary: str | None = None
    try:
        descriptor, temporary = tempfile.mkstemp(
            prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
        )
        with os.fdopen(descriptor, "wb") as stream:
            descriptor = -1
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
    except Exception as cause:
        if descriptor >= 0:
            os.close(descriptor)
        if temporary is not None:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
        raise error_type(
            "write-failed",
            "Failed to atomically write the report snapshot",
            {"target": str(path), "causeType": type(cause).__name__},
        ) from cause


def content_hash(content: bytes) -> str:
    return f"sha256:{hashlib.sha256(content).hexdigest()}"
