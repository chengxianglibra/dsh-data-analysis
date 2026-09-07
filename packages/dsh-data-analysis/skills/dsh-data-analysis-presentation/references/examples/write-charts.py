"""合成图表样例：在分析阶段计算统计量，写入当前 Workspace。"""

from dataclasses import asdict
from decimal import Decimal
import json
from pathlib import Path

import pandas as pd

from dsh_data_analysis_presentation import write_dataset


frames = {}
frames["charts-series"] = pd.DataFrame({
    "period": [f"2026-{i:02d}" for i in range(1, 13)],
    "a": [12., 18., 15., 24., 19., 30., 28., 34., 31., 42., 39., 45.],
    "b": [8., 11., 10., 14., 13., 17., 19., 18., 22., 25., 24., 28.],
    "coordinate": [float(i) for i in range(1, 13)],
    "volume": [float(i * 10) for i in range(1, 13)],
    "segment": ["B" if i % 2 else "A" for i in range(12)],
})
denominators = [100., 200., 50.]
a_values = [60., 60., 40.]
frames["charts-shares"] = pd.DataFrame({
    "category": ["A", "B", "C"],
    "a": [value / total for value, total in zip(a_values, denominators)],
    "b": [(total - value) / total for value, total in zip(a_values, denominators)],
    "denominator": denominators,
})
observations = pd.Series([.2, .8, 1.5, 2., 2.8, 5.])
bounds = [0., 1., 3., 6.]
frames["charts-bins"] = pd.DataFrame({
    "bin": ["0–1", "1–3", "3–6"],
    "lower": bounds[:-1], "upper": bounds[1:],
    "frequency": [float(((observations >= lo) & (observations < hi)).sum())
                  for lo, hi in zip(bounds[:-1], bounds[1:])],
})
summary = []
for name, values in [("A", [1., 2., 3., 4., 5.]), ("B", [2., 3., 4., 5., 6.])]:
    series = pd.Series(values)
    summary.append([name, series.min(), series.quantile(.25), series.median(),
                    series.quantile(.75), series.max()])
frames["charts-boxes"] = pd.DataFrame(summary, columns=[
    "group", "minimum", "q1", "median", "q3", "maximum"])
values = [60., 30., 10.]
frames["charts-composition"] = pd.DataFrame({
    "category": ["A", "B", "C"], "value": values,
    "share": [value / sum(values) for value in values], "rank": [1., 2., 3.],
})
stages = [100., 60., 20.]
frames["charts-funnel"] = pd.DataFrame({
    "stage": ["访问", "注册", "购买"], "value": stages,
    "share": [value / stages[0] for value in stages],
})
initial, decreases, increases = 100., -20., 30.
after_decrease = initial + decreases
final = after_decrease + increases
frames["charts-waterfall"] = pd.DataFrame({
    "step": ["期初", "减少", "增加", "期末"],
    "change": [initial, decreases, increases, final],
    "start": [0., initial, after_decrease, 0.],
    "end": [initial, after_decrease, final, final],
    "role": ["start", "delta", "delta", "total"],
})
frames["charts-precision"] = pd.DataFrame({
    "label": ["精确值", "缺失", "长小数"],
    "amount": [Decimal("0.1000"), None, Decimal("12345678901234.5678")],
})
root = Path("presentation-example")
root.mkdir(parents=True, exist_ok=True)
receipts = [asdict(write_dataset(frame, root / f"{name}.dataset.json"))
            for name, frame in frames.items()]
print(json.dumps(receipts, ensure_ascii=False))
