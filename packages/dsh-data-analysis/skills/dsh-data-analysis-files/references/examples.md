# 文件分析示例

以下代码通过 `marivo_python` 执行，两例都使用 `datasources: []`。将 `path` 替换为 Harness 提供的附件可读路径或用户指定的 Workspace 文件，列名按实际结构调整。

## pandas

```python
import pandas as pd

path = "/actual/readable/file.csv"
frame = pd.read_csv(path)
result = frame.groupby("category", dropna=False)["amount"].sum().reset_index()
print(result.to_string(index=False))
```

JSON、JSON Lines 和 Parquet 可分别使用 `pd.read_json`、`pd.read_json(..., lines=True)` 和 `pd.read_parquet`；读取选项由实际文件决定。默认 Runtime 未提供 `openpyxl`，`.xlsx` 可用下例的 DuckDB reader 后转成 DataFrame。

## 原生 DuckDB

```python
import duckdb

path = "/actual/readable/file.csv"
with duckdb.connect(":memory:") as con:
    result = con.execute(
        "SELECT category, SUM(amount) AS amount "
        "FROM read_csv_auto(?) GROUP BY category ORDER BY amount DESC LIMIT 20",
        [path],
    ).df()
print(result.to_string(index=False))
```

按文件改用 `read_json_auto(?)`、`read_parquet(?)` 或 `read_xlsx(?)`。`.xlsx` 的指定工作表可用 `read_xlsx(?, sheet = ?)` 并传入路径与 sheet 名；首次加载 `excel` 扩展需要获取官方扩展。参数避免将路径或 sheet 名直接拼入 SQL；reader 支持 glob，含通配符的文件名需先确认只命中目标文件。

原生连接支持同一调用内的多条 SQL 和临时表，无需另建 Marivo datasource。

## 单个报告组件的完整脚本

报告任务先按展示 Skill 创建草稿。下面是一个类别汇总组件的完整调用代码；其他计算从准确输入读取，不依赖它的 source/result 变量；同一结果的多个视图共享返回资源。

```python
import pandas as pd

path = "/actual/readable/file.csv"
source = pd.read_csv(path)
result = source.groupby("category", dropna=False)["amount"].sum(min_count=1).reset_index()
```

直接声明已计算的 DataFrame，由工具持久化并组装 resource。通过 `marivo_python` 调用执行，传 `project:"required"`、`datasources:[]` 和 `resultVariables:{"result":"result"}`。原样把 `results.result.resource` 作为 marivo_report_write 的资源，及时更新同一草稿，不等待其他组件全部完成。不从 stdout 解析引用。governed 输入和受支持的类型化分析优先产生并保留 AnalysisFrame，用 AnalysisFrameView 展示，不从文件示例推断需要先建模。
持久化的输入约束与原值精度以 Marivo live Help 为准；需要保留的业务 index 先显式变成列。
结果由绑定 Python Runtime 读取，无需 HTTP 服务；展示不会自动重跑原分析。

## 导出 CSV 或 JSON

仅在用户要求实际文件时执行；`result` 是本次调用内已计算的 DataFrame。使用当前绑定 Workspace 的实际路径，不把附件路径当输出目录。

```python
from pathlib import Path

output_dir = Path("/actual/workspace/exports")
output_dir.mkdir(parents=True, exist_ok=True)
csv_path = output_dir / "summary.csv"
result.to_csv(csv_path, index=False)
# 用户要求 JSON 时可改为：
# json_path = output_dir / "summary.json"
# result.to_json(json_path, orient="records", force_ascii=False)
print(str(csv_path.resolve()))
```

执行成功后，将实际输出路径交给当前 Harness 原生 `present`（参数以当前工具契约为准）：

```json
{"files":[{"path":"/actual/workspace/exports/summary.csv","description":"按类别汇总的金额"}]}
```

只交付用户要求的文件；当前没有 `present` 时报告已生成文件的准确路径和原生交付能力缺失。

## 导出 PNG

不要假设 Runtime 安装了 matplotlib 或 Pillow。以下标准库示例生成无文字的简单条形缩略图，适用于用户明确要求 PNG；颜色、顺序、数值和分析范围应在回复中说明。

```python
from pathlib import Path
import struct
import zlib

# 替换为本次分析得出的非负数值；依次为 A、B、C。
values = [11, 23, 37]
width, height = 240, 120
pixels = bytearray([255] * (width * height * 3))
for index, value in enumerate(values):
    bar_height = round(value / max(values, default=1) * 100) if max(values, default=0) else 0
    for y in range(height - 10 - bar_height, height - 10):
        for x in range(20 + index * 70, 60 + index * 70):
            offset = (y * width + x) * 3
            pixels[offset:offset + 3] = bytes((45, 110, 210))
def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
rows = b"".join(b"\x00" + pixels[y * width * 3:(y + 1) * width * 3] for y in range(height))
png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))
output = Path("/actual/workspace/exports/amounts.png")
output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(png)
print(str(output.resolve()))
```

成功后通过原生 `present` 交付实际 PNG 路径。文件生成失败不调用 `present`；声明失败仅修复交付，不重新计算。
