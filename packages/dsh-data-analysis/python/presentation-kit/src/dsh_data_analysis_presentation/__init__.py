"""Capture computed DataFrames as bounded presentation snapshots."""

from ._capture import DatasetCaptureReceipt, capture_dataset
from .errors import PresentationDatasetError

__version__ = "1.4.0"
__all__ = ["PresentationDatasetError", "DatasetCaptureReceipt", "capture_dataset"]
