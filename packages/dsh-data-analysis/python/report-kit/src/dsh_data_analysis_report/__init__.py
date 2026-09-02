"""Public report data and Marivo Session Graph projection helpers."""

from ._dataset import DatasetReceipt, emit_computed, emit_dataset
from ._trace import SessionTraceReceipt, emit_session_trace
from .errors import ReportDatasetError, ReportKitError, ReportSessionTraceError

__version__ = "2.1.0"

__all__ = [
    "DatasetReceipt",
    "ReportDatasetError",
    "ReportKitError",
    "ReportSessionTraceError",
    "SessionTraceReceipt",
    "emit_computed",
    "emit_dataset",
    "emit_session_trace",
]
