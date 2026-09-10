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

原生连接支持同一调用内的多条 SQL 和临时表，无需另建 Marivo datasource。需要展示 `result` 时，使用展示 Skill 的 computed 示例；写入当前 Workspace，`sourceIds` 可为空，dataset 的 `codeRefs` 使用本次成功执行返回的实际引用。
