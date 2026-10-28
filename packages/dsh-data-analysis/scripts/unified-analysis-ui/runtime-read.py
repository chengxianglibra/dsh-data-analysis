"""Use only schema/read_page and page exports, never full Frame export."""
import dataclasses
import json
import os
import sys
from decimal import Decimal

import marivo.analysis as mv
import pandas as pd

ref = json.loads(sys.argv[1])
frame = mv.session.resume(ref["sessionId"]).persisted_frame(ref["artifactId"])
schema = frame.schema
assert tuple(schema.values) == ("revenue", "account")
assert len(schema.axes) == 1
rows, pages, cursor = [], [], None
while True:
    page = frame.read_page(columns=("revenue", "account"), limit=1, cursor=cursor)
    assert page.input_id == schema.input_id
    values = page.to_pandas()
    def scalar(v):
        return None if v is None or pd.isna(v) else str(v)
    rows.extend([[scalar(v) for v in row] for row in values.itertuples(index=False, name=None)])
    pages.append({"count": len(page), "total": page.total_count, "hasMore": page.has_more,
                  "layout": [dataclasses.asdict(v) for v in page.layout],
                  "coordinates": {k: list(v) for k, v in page.coordinates.items()},
                  "stats": dataclasses.asdict(page.read_stats)})
    if not page.has_more:
        break
    assert page.next_cursor
    cursor = page.next_cursor
    assert len(pages) < 3
print(json.dumps({"pid": os.getpid(), "inputId": schema.input_id,
                  "axes": [dataclasses.asdict(v) for v in schema.axes],
                  "fields": {k: dataclasses.asdict(v) for k, v in schema.values.items()},
                  "layout": [dataclasses.asdict(v) for v in schema.layout],
                  "rows": rows, "pages": pages}, default=str))
