"""Tiny equivalent files with independent expected values; no user files or models."""
import csv
import json
import shutil
import sys
from pathlib import Path
import pandas as pd

root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
records = [{"item": "A", "amount": 11}, {"item": "B", "amount": 23}, {"item": "C", "amount": 37}]
frame = pd.DataFrame(records)
frame.to_csv(root / "sales.csv", index=False)
frame.to_parquet(root / "sales.parquet", index=False)
(root / "sales.json").write_text(json.dumps(records))
(root / "sales.jsonl").write_text("\n".join(json.dumps(row) for row in records))
with (root / "replacement.csv").open("w") as file:
    writer = csv.writer(file)
    writer.writerows([["item", "amount"], ["NEW-A", 100], ["NEW-B", 200]])
# Standard workbook fixture, created once with ExcelJS; no Excel writer dependency at runtime.
shutil.copyfile(Path(__file__).with_name("sales.xlsx"), root / "sales.xlsx")
print(json.dumps({"formats": ["csv", "json", "jsonl", "parquet", "xlsx"], "rows": 3, "total": 71}))
