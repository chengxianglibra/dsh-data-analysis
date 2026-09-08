"""全局筛选的合成测试数据；所有汇总均在 Python 中准备，不代表真实业务。"""
from dataclasses import asdict
from decimal import Decimal
import json
from pathlib import Path

import pandas as pd
from dsh_data_analysis_presentation import write_dataset

# 日期、集群、查询类别、查询数、失败数。
raw = [
    ("mon", "a", "交互查询", 100, 2), ("mon", "a", "批量查询", 50, 1),
    ("mon", "b", "交互查询", 80, 4), ("mon", "b", "批量查询", 20, 1),
    ("tue", "a", "交互查询", 120, 3), ("tue", "a", "批量查询", 60, 0),
    ("tue", "b", "交互查询", 90, 2), ("tue", "b", "批量查询", 30, 2),
]
summary, detail = [], []
for day in ["any", "mon", "tue"]:
    for cluster in ["any", "a", "b"]:
        selected = [r for r in raw if (day == "any" or r[0] == day) and (cluster == "any" or r[1] == cluster)]
        total = sum(r[3] for r in selected)
        failures = sum(r[4] for r in selected)
        summary.append({"query_count": total, "failed_count": failures,
                        "failure_rate": (Decimal(failures) * 100 / Decimal(total)).quantize(Decimal("0.01"))})
        for category in ["交互查询", "批量查询"]:
            detail.append({"category": category,
                           "query_count": sum(r[3] for r in selected if r[2] == category)})
output_dir = Path("presentation-example")
output_dir.mkdir(parents=True, exist_ok=True)
receipts = [asdict(write_dataset(pd.DataFrame(rows), output_dir / filename)) for filename, rows in [
    ("interaction-summary.dataset.json", summary), ("interaction-detail.dataset.json", detail),
]]
print(json.dumps(receipts, ensure_ascii=False))
