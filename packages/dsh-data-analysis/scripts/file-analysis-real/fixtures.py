"""Tiny equivalent files with independent expected values; no user files or models."""
import csv
import json
import sys
import zipfile
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
# Minimal XLSX uses the standard library rather than assuming an Excel writer dependency.
with zipfile.ZipFile(root / "sales.xlsx", "w", zipfile.ZIP_DEFLATED) as archive:
    archive.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
    archive.writestr("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets></workbook>')
    archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
    rows = ['<row r="1"><c r="A1" t="inlineStr"><is><t>item</t></is></c><c r="B1" t="inlineStr"><is><t>amount</t></is></c></row>']
    rows.extend(f'<row r="{i}"><c r="A{i}" t="inlineStr"><is><t>{row["item"]}</t></is></c><c r="B{i}"><v>{row["amount"]}</v></c></row>' for i, row in enumerate(records, 2))
    archive.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B4"/><sheetData>' + "".join(rows) + '</sheetData></worksheet>')
print(json.dumps({"formats": ["csv", "json", "jsonl", "parquet", "xlsx"], "rows": 3, "total": 71}))
