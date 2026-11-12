<p align="center">
  <img src="packages/dsh-data-analysis/assets/logo-horizontal.svg" alt="DSH Data Analysis" width="520">
</p>

# DSH Data Analysis

[简体中文](README.md) | English

Analyze data with natural language in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
Explore and reuse business metric definitions, then save findings as analysis views with charts and exact data. Semantic analysis is powered by [Marivo](https://github.com/chengxianglibra/marivo).

This is an independently maintained community plugin. It is not an official DeepSeek product.

## Capabilities and features

| What you want to do | What the plugin offers |
| --- | --- |
| Answer business questions | Analyze metric trends, compare periods or business segments, and explore reasons for changes using natural language |
| Analyze local files | Upload files or use files in your workspace to analyze data and create analysis views |
| Connect to data | Configure data sources, manage credentials, and test connections; DuckDB, Trino, and ClickHouse are supported by default |
| Keep definitions consistent | Work with the assistant to define and reuse metrics and dimensions, and explore their relationships |
| Specify what to analyze | Search for and reference existing semantic objects with `@` in the chat input |
| Present findings | Save existing Frame/DataFrame results as exact tables, single values or charts |
| Explore further | Sort exact values, browse local pages, and ask about a data point or the whole result |
| Read and revisit | Save and browse immutable versions and their history |

## Installation

### Prerequisites

- Node.js `^22.19.0 || >=24.0.0`: version 22.19.0 or later in the 22.x series, or version 24.0.0 and above. Version 23.x is not supported.
- DeepSeek Harness `>=0.2.1-rc.2`, launched with `npx @deepseek-ai/dsh web` and configured.
- `pnpm` available on the command line for Harness to install the plugin.
- Python 3.10+, available as `python3` (`python` on Windows), with `venv`/`ensurepip` support. Some Linux distributions require the additional `python3-venv` package.

You do not need to install Marivo beforehand. The first launch uses pip to install the Marivo `0.6.6` release and prepares the analysis environment automatically. For Marivo project analysis or result persistence, the plugin prepares the exact Workspace root when the execution declares `project:"required"`. Existing projects are preserved; ordinary file inspection needs no initialization.
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
Data Sources (数据源), Semantic Layer (语义层), and Analysis views (分析视图) appear beside the session title and open in tabs on the right.
The examples below use the Web interface; Chinese labels are included to help you locate the controls.

## How to use

### 1. Prepare your data

**Local files**: Upload a file and ask a question, or specify a file already in your workspace.
No data source configuration or business definitions are required first.
CSV, JSON, Parquet, and Excel `.xlsx` files are supported. Reading `.xlsx` for the first time requires an internet connection to download an extension.
Convert older `.xls` files to `.xlsx`, CSV, or Parquet first.
To view or deliver a CSV, TSV, or XLSX file, ask the assistant to use native `present`, then open the read-only DSH spreadsheet preview on the right. Tables you want to inspect in an analysis view use the report reader. The plugin does not write XLSX or analyze older `.xls` files.

**Databases**: Ask the assistant in chat to add, change, remove, or test a data source. Supply non-secret connection details in chat; enter passwords and tokens in the credential form.

Open Data Sources (数据源) beside the session title to view the current workspace's data sources, connection properties, and credential status, and to add, replace, or delete saved credentials. Saved values are not displayed; credentials may be shared across data sources or workspaces.

When analysis or a test needs credentials, the assistant waits for you to enter them. Saving and continuing resumes the original call; saving credentials does not establish that the connection works.

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

### 4. Read analysis views

When a chart or interaction helps you understand trends, compare results, or check data, the assistant creates an analysis view. It appears in a right-hand tab with an entry in Chat.

Declare computed AnalysisFrame values, pandas DataFrames or existing fixed references with `marivo_python.resultVariables`. The plugin saves declared in-memory outputs and returns `results[name].resource` for direct use in `marivo_report_write`. Later charts and reports can reuse the same fixed outputs in the current Workspace.

The plugin derives the resource kind from the reference and adds codeRef when source recording succeeds. Stdout is for logs. codeRef only proves that this execution exported the reference; it does not guarantee original production or a script that can recompute the result. For an authorized data update, the assistant first reviews the bound script, datasource declarations and output variables, then explicitly generates fresh results and replaces resources under the same names with `mode:"refresh-data"`, preserving the layout, body and column labels through atomic batch validation. Static numbers are not rewritten automatically.

Present an existing Frame or captured DataFrame without repeating the analysis. `DatasetView` supports tables, single values and explicit column mappings for line, area, bar and heatmap charts. Charts require complete snapshots; they do not aggregate data or infer analysis semantics. Use Analysis views (分析视图) to reopen saved results and versions.

Analysis views use `marivo_report_write` to present conclusions, charts, exact values, and limitations, preferring `AnalysisFrameView` for Frame data. You can request a report or dashboard layout, text only, or a file. After saving the view, Chat typically gives a brief summary of the main finding and any material limitation.

- **Inspect data**: Sort exact values, browse local pages, and ask about a data point or the whole result. Previews disclose their range and cannot become complete single-value metrics.
- **Check sources**: Frame views show structure and source identity. DataFrame views bring together the captured range, execution script and declared datasources.
- **Ask a follow-up**: Select a chart point or supported cell in a DataFrame or Frame and add it to the question draft.
- **Read the view**: The first preview in the foreground session opens and selects a right-hand tab. Reopen it from Chat after closing it; later updates do not repeatedly open the tab. Catalog and history entries also open on the right.
- **Suggested next steps**: After analysis, Chat offers a row of temporary follow-up buttons. Clicking uses the native Harness composer to submit the question; existing drafts are preserved. Suggestions stay in Chat and disappear on reload, reconnection or session switch.
- **Export offline**: Download the displayed version as a single HTML file from the analysis view tab. It includes the saved snapshots and supports offline viewing and local interactions; review its data before sharing.
- **Delete a view**: Confirm deletion in the analysis view tab’s actions menu to permanently remove the view and all its historical versions, or ask the assistant to delete a saved view. Exported HTML and Marivo results are retained.

Initial previews, revisions and final saving update the same analysis view. Subtle chart motion indicates generation and updates, then stops after saving; reduced motion preferences use a static indicator. When analysis is ongoing, the assistant shows a draft early, updates it as results become ready, and saves one version at completion. Native generation also displays program candidates. Failures and cancellation preserve the last successful content. When refreshing a saved view, the assistant retains its layout, components and body while replacing component data sources. Static text is preserved, and the layout within an auto chart may adapt to the data. Refresh rejects changes to the chart type.

Analysis views support tables, complete single values, Native generation previews, and updates to an exact saved version.
Updates reuse saved snapshots; failures and cancellation preserve the previous successful version.
Frame views support charts selected from their structure. Analysis views do not provide global filters, in-page editing or object-storage publishing.
View history requires current v4 pointers, but the saved Catalog build need not match the current one. The current reader validates report contents and reports unsupported content as an error. Successful reading does not guarantee that component defaults or rendering semantics match the original version. Current v2/v3 pointers (including earlier saved views) and Frame v1 are no longer readable or updatable. Files stay on disk; capture a current snapshot and create a new analysis view to continue.

## Analysis timeout

Go to Settings → Plugins → Plugin Configuration → Data Analysis (设置 → 插件 → 插件配置 → 数据分析)
to adjust the default timeout for Python analysis. The default is 600 seconds, and changes apply to the next analysis call after saving.
The actual execution limit is still subject to Harness execution policies.

## License

This project is licensed under the [MIT License](packages/dsh-data-analysis/LICENSE).

This is a breaking protocol update. Analysis views use `marivo_report_read` / `marivo_report_write` and one version `ref`; every write requires an explicit stage. Previous names and inputs are rejected. The package root exposes installation and configuration; extensions use the versioned integration entry.
