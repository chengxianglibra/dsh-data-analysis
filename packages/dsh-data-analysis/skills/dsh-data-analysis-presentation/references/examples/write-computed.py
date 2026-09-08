"""演示数据：通过 marivo_python 在当前绑定 Workspace 执行。"""

from dataclasses import asdict
from decimal import Decimal
import json
from pathlib import Path

import pandas as pd

from dsh_data_analysis_presentation import write_dataset


frame = pd.DataFrame({
    "month": ["2026-01", "2026-02", "2026-03"],
    "count": [12, 18, 9],
    "amount": [Decimal("120.5000"), None, Decimal("90.0000")],
})
output = Path("presentation-example/computed.dataset.json")
output.parent.mkdir(parents=True, exist_ok=True)
receipt = write_dataset(frame, output, labels={"month": "月份", "count": "数量", "amount": "金额"})
print(json.dumps(asdict(receipt), ensure_ascii=False))
