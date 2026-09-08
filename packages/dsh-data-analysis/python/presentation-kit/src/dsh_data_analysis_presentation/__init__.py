"""Write computed DataFrames as bounded presentation TypedDataset JSON."""

from ._dataset import DatasetWriteReceipt, write_dataset
from .errors import PresentationDatasetError

__version__ = "1.1.0"
__all__ = ["DatasetWriteReceipt", "PresentationDatasetError", "write_dataset"]
