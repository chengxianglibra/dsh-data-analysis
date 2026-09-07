"""Verify the exact pure-Python presentation helper wheel before Runtime use."""

from __future__ import annotations

import email
import importlib
import sys
import zipfile
from pathlib import Path

WHEEL_NAME = "dsh_data_analysis_presentation_kit-1.0.0-py3-none-any.whl"
PACKAGE_FILES = {
    "dsh_data_analysis_presentation/__init__.py",
    "dsh_data_analysis_presentation/_dataset.py",
    "dsh_data_analysis_presentation/errors.py",
    "dsh_data_analysis_presentation/py.typed",
}


def main() -> None:
    if len(sys.argv) > 2:
        raise SystemExit("usage: verify_wheel.py [wheel]")
    wheel = (
        Path(sys.argv[1])
        if len(sys.argv) == 2
        else Path(__file__).parents[1] / "dist" / WHEEL_NAME
    ).resolve()
    if wheel.name != WHEEL_NAME or not wheel.is_file():
        raise SystemExit("expected presentation-kit 1.0.0 wheel is missing")
    with zipfile.ZipFile(wheel) as archive:
        names = set(archive.namelist())
        prefix = "dsh_data_analysis_presentation_kit-1.0.0.dist-info/"
        if names != PACKAGE_FILES | {
            prefix + name for name in ("METADATA", "WHEEL", "top_level.txt", "RECORD")
        }:
            raise SystemExit("unexpected files in presentation-kit wheel")
        metadata = email.message_from_bytes(archive.read(prefix + "METADATA"))
        if (
            metadata["Name"] != "dsh-data-analysis-presentation-kit"
            or metadata["Version"] != "1.0.0"
        ):
            raise SystemExit("wheel distribution identity mismatch")
        if metadata["Requires-Python"] != ">=3.10" or set(
            metadata.get_all("Requires-Dist", [])
        ) != {"pandas<3.0.0,>=2.2.0"}:
            raise SystemExit("wheel dependency metadata mismatch")
        wheel_metadata = archive.read(prefix + "WHEEL").decode()
        if (
            "Root-Is-Purelib: true" not in wheel_metadata
            or "Tag: py3-none-any" not in wheel_metadata
        ):
            raise SystemExit("wheel is not the expected pure-Python tag")
    sys.path.insert(0, str(wheel))
    for name in tuple(sys.modules):
        if name == "dsh_data_analysis_presentation" or name.startswith(
            "dsh_data_analysis_presentation."
        ):
            del sys.modules[name]
    package = importlib.import_module("dsh_data_analysis_presentation")
    if package.__version__ != "1.0.0" or not callable(package.write_dataset):
        raise SystemExit("wheel version or writer import mismatch")
    if not str(package.__file__).startswith(str(wheel) + "/"):
        raise SystemExit("writer was not imported from the checked wheel")
    if set(package.__all__) != {
        "DatasetWriteReceipt",
        "PresentationDatasetError",
        "write_dataset",
    }:
        raise SystemExit("unexpected public helper surface")
    print(f"verified {wheel.name}: exact metadata, package files and writer identity")


if __name__ == "__main__":
    main()
