# DuckDB 文件格式验收

## 安装与边界

2026-09-10：默认安装规格保持 `marivo[duckdb,trino,clickhouse]==0.5.4`，包含 Marivo 的
`duckdb` extra，由上游引入 `ibis-framework[duckdb]`。Runtime probe 新增 DuckDB 后端导入检查，
防止只有 Marivo 主包的解释器被当作依赖齐全的 shared Runtime；管理员解释器仍不自动修改。

CSV、JSON、Parquet 使用 DuckDB 文件 reader。Excel `.xlsx` 使用官方
[excel 扩展](https://duckdb.org/docs/current/guides/file_formats/excel_import)，首次下载需要网络。
该扩展不属于 pip extra；未将扩展下载加入插件启动流程，也未新增 openpyxl 依赖。
旧 `.xls` 需转换后使用。本次不扩展 Marivo 的 Source descriptor schema；Excel 可先导入 DuckDB 表。

## 可复现验证

在仓库根目录执行：

```bash
node --experimental-strip-types packages/dsh-data-analysis/scripts/validate-duckdb-files-real.ts
```

脚本创建全新 managed Runtime，验证已安装 Marivo 的 extra 元数据，通过 Ibis DuckDB 后端生成并
读取 CSV、JSON、Parquet、XLSX 四种 fixture，各自核对 3 行与合计 60。Excel 扩展缓存隔离在临时目录。
结束时清理 Runtime、文件和扩展缓存，不修改用户的安装或服务。

确定性测试覆盖安装命令中完整的 extra 规格，以及 managed/administrator 两种模式下缺少 DuckDB
时拒绝发布 marker；管理员模式不执行 pip。

## 验证结果

- macOS、本机 Python 3.14.4、全新 pip managed Runtime：Marivo 0.5.4、DuckDB 1.5.5。
- CSV、JSON、Parquet、XLSX 四种文件均读取成功，结果各为 3 行、合计 60；Excel 扩展成功下载并加载。
- `npm run check` 通过：578 项测试，574 通过、4 跳过、0 失败；格式、依赖与类型检查通过。
- `npm run build`、`npm run verify:plugin-package`、`git diff --check` 通过。
- 本次验证覆盖 Ibis/DuckDB 的真实文件读取与聚合，不等同于真实模型端到端分析验收；未重装、
  重启或发布插件，也未验证 Windows/Linux。
