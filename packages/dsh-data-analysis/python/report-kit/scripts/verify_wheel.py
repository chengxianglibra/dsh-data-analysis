"""Verify the exact pure-Python report-kit wheel before Runtime/package use."""

from __future__ import annotations

import email
import importlib
import sys
import zipfile
from pathlib import Path

WHEEL_NAME = "dsh_data_analysis_report_kit-2.0.0-py3-none-any.whl"
ALLOWED_PACKAGE_FILES = {
    "dsh_data_analysis_report/__init__.py",
    "dsh_data_analysis_report/_common.py",
    "dsh_data_analysis_report/_dataset.py",
    "dsh_data_analysis_report/_trace.py",
    "dsh_data_analysis_report/errors.py",
    "dsh_data_analysis_report/py.typed",
}


def main() -> None:
    if len(sys.argv) > 2:
        raise SystemExit("usage: verify_wheel.py [wheel]")
    wheel = (
        Path(sys.argv[1])
        if len(sys.argv) == 2
        else Path(__file__).parents[1] / "dist" / WHEEL_NAME
    )
    wheel = wheel.resolve()
    if wheel.name != WHEEL_NAME:
        raise SystemExit(f"unexpected wheel name: {wheel.name}")
    if not wheel.is_file():
        raise SystemExit(f"missing wheel: {wheel}")
    with zipfile.ZipFile(wheel) as archive:
        names = set(archive.namelist())
        package_files = {
            name for name in names if name.startswith("dsh_data_analysis_report/")
        }
        if package_files != ALLOWED_PACKAGE_FILES:
            raise SystemExit(
                f"unexpected package files: {sorted(package_files ^ ALLOWED_PACKAGE_FILES)}"
            )
        metadata_name = next(
            name for name in names if name.endswith(".dist-info/METADATA")
        )
        wheel_metadata_name = next(
            name for name in names if name.endswith(".dist-info/WHEEL")
        )
        metadata = email.message_from_bytes(archive.read(metadata_name))
        if metadata["Name"] != "dsh-data-analysis-report-kit":
            raise SystemExit("wheel distribution identity mismatch")
        if metadata["Version"] != "2.0.0" or metadata["Requires-Python"] != ">=3.10":
            raise SystemExit("wheel version or Python requirement mismatch")
        requires = set(metadata.get_all("Requires-Dist", []))
        if requires != {"marivo==0.5.2", "pandas<3.0.0,>=2.2.0"}:
            raise SystemExit(f"wheel dependency metadata mismatch: {sorted(requires)}")
        wheel_metadata = archive.read(wheel_metadata_name).decode()
        if (
            "Root-Is-Purelib: true" not in wheel_metadata
            or "Tag: py3-none-any" not in wheel_metadata
        ):
            raise SystemExit("wheel is not the expected pure-Python tag")

    sys.path.insert(0, str(wheel))
    for name in tuple(sys.modules):
        if name == "dsh_data_analysis_report" or name.startswith(
            "dsh_data_analysis_report."
        ):
            del sys.modules[name]
    package = importlib.import_module("dsh_data_analysis_report")
    if package.__version__ != "2.0.0":
        raise SystemExit("wheel public version mismatch")
    if not callable(package.emit_dataset) or not callable(package.emit_session_trace):
        raise SystemExit("wheel public emitters are unavailable")
    print(
        f"verified {wheel.name}: {len(names)} files, exact metadata and public imports"
    )


if __name__ == "__main__":
    main()
