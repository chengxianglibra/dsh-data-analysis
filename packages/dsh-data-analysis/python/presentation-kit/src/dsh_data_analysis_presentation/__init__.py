"""Capture computed DataFrames and completed Frames as bounded presentation snapshots."""

from ._capture import DatasetCaptureReceipt, FrameCaptureReceipt, capture_dataset, capture_frame
from .errors import PresentationDatasetError

__version__ = "1.5.0"
__all__ = ["PresentationDatasetError", "DatasetCaptureReceipt", "FrameCaptureReceipt", "capture_dataset",
           "capture_frame"]
