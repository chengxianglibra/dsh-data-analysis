"""Public DSH Workspace report transport helpers."""

from ._dataset import DatasetReceipt, emit_dataset
from ._trace import SessionTraceQuery, SessionTraceReceipt, emit_session_trace
from .errors import ReportDatasetError, ReportKitError, ReportSessionTraceError

__version__ = "2.0.0"

__all__ = [
    "DatasetReceipt",
    "ReportDatasetError",
    "ReportKitError",
    "ReportSessionTraceError",
    "SessionTraceReceipt",
    "SessionTraceQuery",
    "emit_dataset",
    "emit_session_trace",
]
