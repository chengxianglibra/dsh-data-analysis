"""TypedDataset v1 encoding shared by the writer and fixed Artifact reader.

Object columns are inferred from retained values only. Empty/all-null object
columns use nullable string; the helper does not guess business semantics.
Row/cell budgets truncate; an oversized cell or encoded dataset fails before write.
"""

from __future__ import annotations

import json
import math
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from pandas.api import types as dtype

from .errors import PresentationDatasetError

MAX_ROWS = 5_000
MAX_COLUMNS = 64
MAX_CELLS = 100_000
MAX_BYTES = 2 * 1024 * 1024
MAX_TEXT = 32_768
MAX_SAFE_INTEGER = 9_007_199_254_740_991
INT64_MIN = -(2**63)
INT64_MAX = 2**63 - 1
TYPES = {"string", "boolean", "float64", "int64", "decimal", "date", "datetime"}
INTEGER = re.compile(r"-?(?:0|[1-9]\d*)\Z", re.ASCII)
DECIMAL = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?\Z", re.ASCII)
DATE = re.compile(r"\d{4}-\d{2}-\d{2}\Z", re.ASCII)
DATETIME = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})\Z",
    re.ASCII,
)


@dataclass(frozen=True, slots=True)
class DatasetWriteReceipt:
    path: str
    bytes: int
    row_count: int
    written_rows: int
    limit: int
    truncated: bool


def _fail(path: str, message: str, code: str = "invalid_value") -> Any:
    raise PresentationDatasetError(code, path, message)


def _string(value: object, path: str, maximum: int, *, empty: bool = False) -> str:
    # JS contracts count UTF-16 code units, not Python Unicode code points.
    if not isinstance(value, str) or (not value and not empty) or "\0" in value:
        _fail(path, "Expected a bounded string.")
    try:
        length = len(value.encode("utf-16-le")) // 2
    except UnicodeEncodeError:
        _fail(path, "Expected valid Unicode text.")
    if length > maximum:
        _fail(path, "String exceeds the character budget.", "budget")
    return value


def _missing(value: object) -> bool:
    return (
        value is None
        or value is pd.NA
        or value is pd.NaT
        or (isinstance(value, (float, np.floating)) and math.isnan(float(value)))
        or (isinstance(value, np.datetime64) and bool(np.isnat(value)))
    )


def _kind(value: object) -> str:
    if isinstance(value, (bool, np.bool_)):
        return "boolean"
    if isinstance(value, (int, np.integer)):
        return "int64" if INT64_MIN <= int(value) <= INT64_MAX else "decimal"
    if isinstance(value, (float, np.floating)):
        return "float64"
    if isinstance(value, Decimal):
        return "decimal"
    if isinstance(value, (datetime, pd.Timestamp, np.datetime64)):
        return "datetime"
    if isinstance(value, date):
        return "date"
    if isinstance(value, str):
        return "string"
    return "unsupported"


def _infer(series: pd.Series, values: list[object], path: str) -> str:
    observed = {_kind(value) for value in values if not _missing(value)}
    if dtype.is_bool_dtype(series.dtype):
        return "boolean"
    if dtype.is_integer_dtype(series.dtype):
        return "decimal" if "decimal" in observed else "int64"
    if dtype.is_float_dtype(series.dtype):
        if getattr(series.dtype, "itemsize", 8) > 8:
            _fail(
                path,
                "Floating-point precision beyond float64 is unsupported.",
                "numeric_precision",
            )
        return "float64"
    if dtype.is_datetime64_any_dtype(series.dtype):
        return "datetime"
    if dtype.is_timedelta64_dtype(series.dtype) or dtype.is_complex_dtype(series.dtype):
        _fail(path, "Unsupported column type.", "unsupported_type")
    if not observed:
        return "string"
    if observed <= {"int64", "decimal"}:
        return "decimal" if "decimal" in observed else "int64"
    if observed <= {"int64", "float64"}:
        return "float64"
    if len(observed) != 1 or "unsupported" in observed:
        _fail(
            path, "Column must contain one supported scalar type.", "unsupported_type"
        )
    return next(iter(observed))


def _column(value: object, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(path, "Expected a column descriptor.")
    required = {"id", "label", "type", "nullable"}
    if not required <= value.keys() or value.keys() - required - {"unit"}:
        _fail(path, "Invalid column descriptor fields.")
    _string(value["id"], path + "/id", 256)
    _string(value["label"], path + "/label", 256)
    if not isinstance(value["type"], str) or value["type"] not in TYPES:
        _fail(path + "/type", "Unknown presentation column type.")
    if type(value["nullable"]) is not bool:
        _fail(path + "/nullable", "Expected a boolean.")
    if "unit" in value:
        _string(value["unit"], path + "/unit", 128)
    return dict(value)


def _time(value: str, path: str, *, timestamp: bool) -> str:
    expression = DATETIME if timestamp else DATE
    if not expression.fullmatch(value):
        _fail(path, "Expected ISO date/time with explicit timestamp offset.")
    if timestamp and not value.endswith("Z"):
        hours, minutes = int(value[-5:-3]), int(value[-2:])
        if hours > 23 or minutes > 59:
            _fail(path, "Invalid timezone offset.")
    try:
        if timestamp:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        else:
            date.fromisoformat(value)
    except ValueError:
        _fail(path, "Invalid calendar date/time.")
    return value


def _cell(value: object, column: dict[str, Any], path: str, *, encode: bool) -> Any:
    if (encode and _missing(value)) or value is None:
        if not column["nullable"]:
            _fail(path, "Column does not allow null.")
        return None
    kind = column["type"]
    if kind == "boolean":
        if not isinstance(value, (bool, np.bool_)):
            _fail(path, "Expected a boolean.")
        return bool(value)
    if kind == "float64":
        if isinstance(value, (bool, np.bool_)) or not isinstance(
            value, (int, float, np.integer, np.floating)
        ):
            _fail(path, "Expected a finite number.")
        # Check integers before float() so exact inputs cannot be rounded first.
        if isinstance(value, (int, np.integer)) and abs(int(value)) > MAX_SAFE_INTEGER:
            _fail(
                path,
                "Unsafe integer requires exact decimal/int64 encoding.",
                "numeric_precision",
            )
        if isinstance(value, np.floating) and value.dtype.itemsize > 8:
            _fail(
                path,
                "Floating-point precision beyond float64 is unsupported.",
                "numeric_precision",
            )
        number = float(value)
        if not math.isfinite(number):
            _fail(path, "Expected a finite number.")
        if number.is_integer() and abs(number) > MAX_SAFE_INTEGER:
            _fail(
                path,
                "Unsafe integer requires exact decimal/int64 encoding.",
                "numeric_precision",
            )
        return number
    if kind in {"int64", "decimal"}:
        if encode:
            if isinstance(value, (bool, np.bool_)) or not isinstance(
                value, (int, np.integer, Decimal)
            ):
                _fail(path, "Expected an exact integer or Decimal value.")
            if isinstance(value, Decimal) and (
                kind == "int64" or not value.is_finite()
            ):
                _fail(path, "Expected an exact finite value of the declared type.")
            if isinstance(value, (int, np.integer)) and int(value).bit_length() > 851:
                _fail(
                    path, "Exact numeric string exceeds the character budget.", "budget"
                )
            value = str(value)
        text = _string(value, path, 21 if kind == "int64" else 256)
        if not (INTEGER if kind == "int64" else DECIMAL).fullmatch(text):
            _fail(path, "Expected an exact finite numeric string.")
        if kind == "int64" and not INT64_MIN <= int(text) <= INT64_MAX:
            _fail(path, "Integer is outside signed int64; use decimal.")
        return text
    if kind in {"date", "datetime"}:
        if encode:
            if kind == "datetime" and isinstance(value, (pd.Timestamp, np.datetime64)):
                value = pd.Timestamp(value)
                if value.nanosecond:
                    _fail(
                        path,
                        "Sub-microsecond timestamp precision is unsupported.",
                        "numeric_precision",
                    )
            if kind == "datetime" and isinstance(value, datetime):
                if value.tzinfo is None or value.utcoffset() is None:
                    _fail(path, "Datetime requires an explicit timezone offset.")
            elif (
                kind == "date"
                and isinstance(value, date)
                and not isinstance(value, datetime)
            ):
                pass
            else:
                _fail(path, "Expected a value of the declared date/time type.")
            value = value.isoformat()
        return _time(_string(value, path, 64), path, timestamp=kind == "datetime")
    return _string(value, path, MAX_TEXT, empty=True)


def encoded_json(dataset: dict[str, Any]) -> bytes:
    try:
        content = json.dumps(
            dataset, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeEncodeError):
        _fail("", "Expected serializable JSON.")
    if len(content) > MAX_BYTES:
        _fail("", "Dataset exceeds the 2097152 byte budget.", "budget")
    return content


def validate_dataset(value: object) -> dict[str, Any]:
    """Internal Python contract check, tested with the same fixtures as TypeScript."""
    if not isinstance(value, dict) or set(value) != {
        "schemaVersion",
        "columns",
        "rows",
        "rowCount",
        "limit",
        "truncated",
    }:
        _fail("", "Invalid TypedDataset fields.")
    if type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1:
        _fail("/schemaVersion", "Only schemaVersion 1 is accepted.")
    columns = value["columns"]
    if not isinstance(columns, list) or not 1 <= len(columns) <= MAX_COLUMNS:
        _fail("/columns", "Column budget exceeded.", "budget")
    columns = [
        _column(column, f"/columns/{index}") for index, column in enumerate(columns)
    ]
    if len({column["id"] for column in columns}) != len(columns):
        _fail("/columns", "Duplicate identifiers.", "duplicate_id")
    rows, count, limit = value["rows"], value["rowCount"], value["limit"]
    if type(count) is not int or not 0 <= count <= MAX_SAFE_INTEGER:
        _fail("/rowCount", "Expected a nonnegative safe integer.")
    if type(limit) is not int or not 1 <= limit <= MAX_ROWS:
        _fail("/limit", "Expected a bounded positive row limit.")
    if (
        not isinstance(rows, list)
        or len(rows) > MAX_ROWS
        or len(rows) * len(columns) > MAX_CELLS
    ):
        _fail("/rows", "Row or cell budget exceeded.", "budget")
    if len(rows) != min(count, limit):
        _fail("/rows", "Row count must equal min(rowCount, limit).")
    if type(value["truncated"]) is not bool or value["truncated"] != (
        count > len(rows)
    ):
        _fail("/truncated", "Truncation must agree with rowCount and written rows.")
    for i, row in enumerate(rows):
        if not isinstance(row, list) or len(row) != len(columns):
            _fail(f"/rows/{i}", "Row width must equal column count.", "budget")
        for j, cell in enumerate(row):
            _cell(cell, columns[j], f"/rows/{i}/{j}", encode=False)
    encoded_json(value)
    return value


def encode_dataset(
    frame: pd.DataFrame,
    *,
    row_limit: int = MAX_ROWS,
    columns: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Encode a DataFrame without reading sources or writing files."""
    if not isinstance(frame, pd.DataFrame):
        _fail("/frame", "Expected a pandas DataFrame.", "unsupported_type")
    if type(row_limit) is not int or not 1 <= row_limit <= MAX_ROWS:
        _fail("/limit", "Expected a row limit from 1 to 5000.")
    width = len(frame.columns)
    if not 1 <= width <= MAX_COLUMNS:
        _fail("/columns", "Expected 1 to 64 columns.", "budget")
    names = [
        _string(name, f"/columns/{index}/id", 256)
        for index, name in enumerate(frame.columns)
    ]
    if len(set(names)) != width:
        _fail("/columns", "Duplicate identifiers.", "duplicate_id")
    limit = min(row_limit, MAX_CELLS // width)
    retained = frame.iloc[:limit]
    values = [retained.iloc[:, index].tolist() for index in range(width)]
    if columns is None:
        resolved = [
            {
                "id": name,
                "label": name,
                "type": _infer(
                    frame.iloc[:, index], values[index], f"/columns/{index}/type"
                ),
                "nullable": not values[index]
                or any(_missing(value) for value in values[index]),
            }
            for index, name in enumerate(names)
        ]
    else:
        if not isinstance(columns, list) or len(columns) != width:
            _fail("/columns", "Descriptors must match DataFrame columns.")
        resolved = [
            _column(column, f"/columns/{index}") for index, column in enumerate(columns)
        ]
        if [column["id"] for column in resolved] != names:
            _fail(
                "/columns", "Descriptor identities must match DataFrame column order."
            )
    rows = [
        [
            _cell(values[j][i], resolved[j], f"/rows/{i}/{j}", encode=True)
            for j in range(width)
        ]
        for i in range(len(retained))
    ]
    result = {
        "schemaVersion": 1,
        "columns": resolved,
        "rows": rows,
        "rowCount": len(frame),
        "limit": limit,
        "truncated": len(frame) > len(rows),
    }
    return validate_dataset(result)


def write_dataset(
    frame: pd.DataFrame, path: str | os.PathLike[str], *, row_limit: int = MAX_ROWS
) -> DatasetWriteReceipt:
    """Atomically write bounded pure JSON; source references belong in the draft."""
    dataset = encode_dataset(frame, row_limit=row_limit)
    content = encoded_json(dataset)
    try:
        raw = os.fspath(path)
        _string(raw, "/path", 4096)
        target = Path(raw).absolute()
    except TypeError:
        _fail("/path", "Expected a text filesystem path.")
    if target.suffix != ".json" or not target.parent.is_dir():
        _fail("/path", "Expected a .json path with an existing parent directory.")
    _string(str(target), "/path", 4096)
    temporary: str | None = None
    try:
        descriptor, temporary = tempfile.mkstemp(
            prefix=".presentation-", suffix=".tmp", dir=target.parent
        )
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        temporary = None
    except OSError:
        _fail("/path", "Failed to atomically write the dataset.", "write_failed")
    finally:
        if temporary is not None:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
    return DatasetWriteReceipt(
        str(target),
        len(content),
        dataset["rowCount"],
        len(dataset["rows"]),
        dataset["limit"],
        dataset["truncated"],
    )
