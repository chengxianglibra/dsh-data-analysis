"""Encode the shared typed fixtures in Python for Node contract tests."""

from __future__ import annotations

import json
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import pandas as pd
from dsh_data_analysis_presentation._dataset import encode_dataset, encoded_json

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures"


def fixture_frame(dataset: dict) -> pd.DataFrame:
    """Reconstruct exact typed values; omitted rows repeat the final known row."""
    columns = {}
    for index, column in enumerate(dataset["columns"]):

        def cell(value: object, kind: str = column["type"]) -> object:
            if value is None:
                return None
            if kind == "decimal":
                return Decimal(value)
            if kind == "int64":
                return int(value)
            if kind == "float64":
                return float(value)
            if kind == "date":
                return date.fromisoformat(value)
            if kind == "datetime":
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            return value

        values = [cell(row[index]) for row in dataset["rows"]]
        values += values[-1:] * (dataset["rowCount"] - len(values))
        columns[column["id"]] = pd.Series(values, dtype=object)
    return pd.DataFrame(columns)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: emit_contract_fixtures.py output-directory")
    root = Path(sys.argv[1]).resolve()
    root.mkdir(parents=True, exist_ok=True)
    computed = json.loads((FIXTURES / "computed.dataset.json").read_text())
    artifact = json.loads((FIXTURES / "artifact.dataset.json").read_text())
    outputs = {}
    for name, fixture in (("computed", computed), ("artifact", artifact)):
        dataset = encode_dataset(
            fixture_frame(fixture),
            row_limit=fixture["limit"],
            columns=fixture["columns"],
        )
        if dataset != fixture:
            raise AssertionError(f"{name}: Python encoding differs from shared fixture")
        target = root / f"{name}.dataset.json"
        target.write_bytes(encoded_json(dataset))
        outputs[name] = str(target)
    print(json.dumps(outputs))


if __name__ == "__main__":
    main()
