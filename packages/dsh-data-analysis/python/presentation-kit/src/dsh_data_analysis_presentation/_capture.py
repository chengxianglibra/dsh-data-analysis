"""Execution-scoped DataFrame and Frame capture; no stdout protocol or source inference."""
from __future__ import annotations

import hashlib
import json
import os
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pandas as pd

from ._dataset import MAX_BYTES, MAX_ROWS, _fail, _string, encode_dataset
from ._frame import read_frame


@dataclass(frozen=True, slots=True)
class DatasetCaptureReceipt:
    capture_id: str
    row_count: int
    captured_rows: int
    truncated: bool


@dataclass(frozen=True, slots=True)
class FrameCaptureReceipt:
    capture_id: str
    row_count: int
    captured_rows: int
    truncated: bool


_context: ContextVar[dict | None] = ContextVar("presentation_capture", default=None)


def _write(root: Path, relative: str, content: bytes) -> None:
    """Only generated paths under the checked Workspace, published once."""
    target = root / relative
    parent = root
    for part in target.relative_to(root).parts[:-1]:
        parent /= part
        parent.mkdir(exist_ok=True)
        if parent.is_symlink() or not parent.is_dir() or parent.resolve() != parent:
            _fail("/capture", "Capture directory changed.", "write_failed")
    with target.open("xb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


@contextmanager
def _capture_scope(root: str, relative: str, secrets: tuple[str, ...] = ()):
    """Worker-only context; the Host chooses this unique execution directory."""
    state = {"root": Path(root), "directory": relative, "entries": [], "failed": False,
             "attempted": False, "secrets": secrets}
    token = _context.set(state)
    try:
        yield state
    finally:
        _context.reset(token)
        if state["attempted"]:
            manifest = {"schemaVersion": 1, "failed": state["failed"], "entries": state["entries"]}
            try:
                _write(state["root"], relative + "/manifest.json",
                       json.dumps(manifest, separators=(",", ":")).encode())
            except Exception:
                # The worker reports this state through the launcher channel.
                # Never replace an original success or exception with a write error.
                state["failed"] = True


def _publish(build):
    """Record one snapshot in the execution manifest; build returns (snapshot, receipt)."""
    state = _context.get()
    if state is None:
        _fail("/capture", "Capture requires an active marivo_python execution.", "capture_unavailable")
    state["attempted"] = True
    try:
        if len(state["entries"]) >= 16:
            _fail("/capture", "At most 16 captures per execution.", "budget")
        snapshot, receipt = build()
        # Do not alter cells to redact a secret: reject the capture instead.
        def contains_secret(value):
            if isinstance(value, str):
                return any(secret and secret in value for secret in state["secrets"])
            if isinstance(value, dict):
                return any(contains_secret(k) or contains_secret(v) for k, v in value.items())
            if isinstance(value, list):
                return any(contains_secret(v) for v in value)
            return False
        if contains_secret(snapshot):
            _fail("/capture", "Capture contains a Host credential value.", "capture_forbidden")
        content = json.dumps(snapshot, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
        if len(content) > MAX_BYTES:
            _fail("/capture", "Snapshot exceeds the dataset byte budget.", "budget")
        capture_id = str(uuid4())
        relative = state["directory"] + "/" + capture_id + ".json"
        _write(state["root"], relative, content)
        state["entries"].append({"captureId": capture_id, "path": relative,
                                 "sha256": hashlib.sha256(content).hexdigest()})
        return receipt(capture_id)
    except Exception:
        state["failed"] = True
        raise


def capture_dataset(frame: pd.DataFrame, *, row_limit: int = MAX_ROWS,
                    labels=None) -> DatasetCaptureReceipt:
    """Capture a DataFrame during marivo_python; Host returns its snapshotRef.

    Original DataFrame scalar precision must already be intact. No SQL,
    datasource, semantic identity or business coverage is inferred.
    """
    def build():
        data = encode_dataset(frame, row_limit=row_limit)
        if labels is not None:
            from collections.abc import Mapping
            if not isinstance(labels, Mapping):
                _fail("/labels", "Expected a mapping from column identifiers to labels.")
            columns = {c["id"]: c for c in data["columns"]}
            for name, label in labels.items():
                if name not in columns:
                    _fail("/labels", "Label keys must name existing DataFrame columns.")
                columns[name]["label"] = _string(label, "/labels", 256)
        snapshot = {
            "schemaVersion": 1, "kind": "dataset", "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "data": data,
            "coverage": {"start": 0, "totalRows": data["rowCount"],
                         "capturedRows": len(data["rows"]), "complete": not data["truncated"],
                         "columns": [c["id"] for c in data["columns"]], "business": "unknown"},
            "source": {"kind": "dataframe", "details": "not-captured"},
        }
        return snapshot, lambda capture_id: DatasetCaptureReceipt(
            capture_id, data["rowCount"], len(data["rows"]), data["truncated"])
    return _publish(build)


def capture_frame(frame, *, row_limit: int = MAX_ROWS) -> FrameCaptureReceipt:
    """Capture a completed AnalysisFrame during marivo_python; Host returns its snapshotRef.

    Accepts a stored Frame or the memory Frame returned by compute(); a pending
    expression is rejected and never computed here. Only public Frame members are read.
    """
    def build():
        if isinstance(frame, pd.DataFrame):
            _fail("/frame", "capture_frame accepts an AnalysisFrame; capture a pandas DataFrame with capture_dataset.",
                  "unsupported_type")
        if not hasattr(frame, "schema") or not callable(getattr(frame, "read_page", None)):
            _fail("/frame", "capture_frame expects a completed AnalysisFrame.", "unsupported_type")
        snapshot = read_frame(frame, row_limit=row_limit)
        coverage = snapshot["coverage"]
        return snapshot, lambda capture_id: FrameCaptureReceipt(
            capture_id, coverage["totalRows"], coverage["capturedRows"], not coverage["complete"])
    return _publish(build)
