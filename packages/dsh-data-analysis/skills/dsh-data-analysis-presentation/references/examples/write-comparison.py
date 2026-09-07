"""仅演示已有数据的比较展示，不是业务分析流程。"""

from dataclasses import asdict
import json
from pathlib import Path

import pandas as pd

from dsh_data_analysis_presentation import write_dataset


full = pd.DataFrame({
    "category": ["A", "B", "C"],
    "baseline": [100, 80, 20],
    "current": [50, 50, 50],
})
full["delta_current_minus_baseline"] = full["current"] - full["baseline"]
ranked = full.assign(decrease_baseline_minus_current=-full["delta_current_minus_baseline"])
# 这是 Agent 侧预选：writer 收到两行，truncated=False 不表示原始范围只有两项。
selected = ranked.sort_values("decrease_baseline_minus_current", ascending=False).head(2)
other = full.loc[~full["category"].isin(selected["category"])]
summary = pd.DataFrame([
    {
        "scope": scope,
        "baseline": int(frame["baseline"].sum()),
        "current": int(frame["current"].sum()),
        "delta_current_minus_baseline": int(frame["delta_current_minus_baseline"].sum()),
    }
    for scope, frame in [("全量", full), ("选中 A、B", selected), ("其他 C", other)]
])

output_dir = Path("presentation-example")
output_dir.mkdir(parents=True, exist_ok=True)
receipts = [
    asdict(write_dataset(frame, output_dir / filename))
    for filename, frame in [
        ("comparison.dataset.json", full),
        ("comparison-selected.dataset.json", selected),
        ("comparison-summary.dataset.json", summary),
    ]
]
print(json.dumps(receipts, ensure_ascii=False))
