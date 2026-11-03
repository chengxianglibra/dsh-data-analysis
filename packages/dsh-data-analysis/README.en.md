# @chengxianglibra/dsh-data-analysis

[简体中文](README.md) | English

Analyze data with natural language in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
Explore and reuse business metric definitions, then save findings as exact analysis views, reports,
and dashboards. Semantic analysis is powered by [Marivo](https://github.com/chengxianglibra/marivo).

This is an independently maintained community plugin. It is not an official DeepSeek product.

## Capabilities and features

| What you want to do | What the plugin offers |
| --- | --- |
| Answer business questions | Analyze metric trends, compare periods or business segments, and explore reasons for changes using natural language |
| Analyze local files | Upload files or use files in your workspace to analyze data and create analysis views and reports |
| Connect to data | Configure data sources, manage credentials, and test connections; DuckDB, Trino, and ClickHouse are supported by default |
| Keep definitions consistent | Work with the assistant to define and reuse metrics and dimensions, and explore their relationships |
| Specify what to analyze | Search for and reference existing semantic objects with `@` in the chat input |
| Present findings | Save existing Frame/DataFrame results as exact tables, single values or charts |
| Explore further | Select columns, sort exact values, browse local pages, and copy saved data |
| Read and revisit | Save and browse immutable versions and their history |

## Installation

### Prerequisites

- Node.js `^22.19.0 || >=24.0.0`: version 22.19.0 or later in the 22.x series, or version 24.0.0 and above. Version 23.x is not supported.
- DeepSeek Harness `>=0.2.1-rc.2`, launched with `npx @deepseek-ai/dsh web` and configured.
- `pnpm` available on the command line for Harness to install the plugin.
- Python 3.10+, available as `python3` (`python` on Windows), with `venv`/`ensurepip` support. Some Linux distributions require the additional `python3-venv` package.

You do not need to install Marivo beforehand. The analysis environment is prepared automatically on first launch.
An internet connection is required to download dependencies; wait for setup to finish.

### Install and launch

The commands below run Harness through `npx`; no global installation or `dsh` command on PATH is required.

Install the plugin into the Web Profile:

```bash
npx @deepseek-ai/dsh plugin --profile web add @chengxianglibra/dsh-data-analysis
```

If pnpm reports `ERR_PNPM_IGNORED_BUILDS`, set `@openuidev/lang-core` to `false` under `allowBuilds`
in `$DSH_HOME/profiles/web/pnpm-workspace.yaml` (under `~/.dsh/` by default), then retry the installation.
That package's postinstall sends installation telemetry and is not required by the plugin. pnpm may report
missing Harness peers; the Host provides them at runtime, so do not install another copy of Harness or React
to silence the warning.

Start the Web Profile after installation. If it is already running, exit and restart it:

```bash
npx @deepseek-ai/dsh web
```

In the Web interface, select a Workspace, create a session, and send a message.
Data Sources (数据源), Semantic Layer (语义层), and Reports (报告) appear beside the session title and open in tabs on the right.
The examples below use the Web interface; Chinese labels are included to help you locate the controls.

## How to use

### 1. Prepare your data

**Local files**: Upload a file and ask a question, or specify a file already in your workspace.
No data source configuration or business definitions are required first.
CSV, JSON, Parquet, and Excel `.xlsx` files are supported. Reading `.xlsx` for the first time requires an internet connection to download an extension.
Convert older `.xls` files to `.xlsx`, CSV, or Parquet first.
To view or deliver a CSV, TSV, or XLSX file, ask the assistant to use native `present`, then open the read-only DSH spreadsheet preview on the right. Tables you want to inspect in an analysis view use the report reader. The plugin does not write XLSX or analyze older `.xls` files.

**Databases**: Open Data Sources (数据源) beside the session title to view connections and their configuration status in the current workspace:

1. Select Add Data Source (新增数据源), choose an engine, and enter a name and connection details.
2. If authentication is required, enter the username, password, or token under Connection Credentials (连接凭证).
3. Save and test the connection. Use the result to check the address, credentials, or access permissions.

Use Edit Configuration (编辑配置) to update an existing connection. Its name and engine stay fixed; test the connection again after saving.
Saved credential values are not displayed; leave them blank to keep using them. Submit passwords and tokens through the credential form, not in chat messages.

If a data source needs to be added or repaired during analysis, the assistant can open the configuration page.
Enter a new connection or choose Use Existing Data Source (使用已有数据源), then select Save and Test, Continue on Success (保存并测试，成功后继续).
The assistant resumes analysis after verifying the connection and access to the target data.

### 2. Ask questions in natural language

Describe the data, time range, metric definitions, and results you want. For example:

> Using the order data, analyze revenue and order count for August 2026, compare them with July, break them down by channel, and explain the sources and metric definitions.

> Check query duration over the last seven days. Identify the slowest query types and provide the daily trend and a detailed table.

If you have not yet defined your business metrics, start by asking the assistant to help:

> First, find order-related tables in the current data source. Confirm the definitions of revenue and paid order count with me, then save them as reusable business definitions.

When you need a report, describe its contents:

> Turn this analysis into a report with explanations, key single values, and sortable tables of exact results.

### 3. Browse and reference business definitions

Open Semantic Layer (语义层) to find metrics, dimensions, and other objects by category or keyword,
and inspect their definitions and relationships. Open objects separately to compare them side by side.

Type `@` in the chat input to search for and select objects in the current workspace.
For a multiword search, use `@"monthly revenue"`. Ask questions about the selected objects to keep the analysis aligned with your business definitions.

### 4. Read analysis views and reports

Ordinary results appear as separate chat entries outside folded work steps. Explicit reports and dashboards open in a right-side tab.
Present an existing Frame or captured DataFrame without repeating the analysis. `DatasetView` supports tables, single values and explicit column mappings for line, area, bar and heatmap charts. Charts require complete snapshots; they do not aggregate data or infer analysis semantics. Use Reports (报告) to reopen saved results and versions.

Analysis reports and dashboards use `marivo_present` to combine conclusions, explanations, limitations, and data in one document,
preferring `AnalysisFrameView` for Frame data. After successful delivery, the assistant aims to reply with one short summary sentence; explicit output-format requests still apply.

- **Inspect data**: Select columns, sort exact values, browse local pages, and copy saved data. Previews disclose their range and cannot become complete single-value metrics.
- **Check sources**: Frame views show structure and source identity. DataFrame views explicitly mark SQL, datasource and file provenance that was not captured.
- **Switch location**: Open in report tab reads the same saved version. Closing the original connection does not prevent reading.

The unified analysis UI supports tables, complete single values, Native generation previews, and updates to an exact saved version.
Updates reuse saved snapshots; failures and cancellation preserve the previous successful version.
Frame views support charts selected from their structure. Analysis views do not provide global filters, in-page editing, offline HTML export or publishing.
Report history requires current v4 pointers and the current Catalog build; earlier Catalog builds have no compatibility reader. Current v2/v3 pointers (including earlier analysis UI saves) and Frame v1 are no longer readable or updatable. Files stay on disk; capture a current snapshot and create a new report to continue.

## Analysis timeout

Go to Settings → Plugins → Plugin Configuration → Data Analysis (设置 → 插件 → 插件配置 → 数据分析)
to adjust the default timeout for Python analysis. The default is 120 seconds, and changes apply to the next analysis call after saving.
The actual execution limit is still subject to Harness execution policies.

## License

This project is licensed under the [MIT License](LICENSE).
