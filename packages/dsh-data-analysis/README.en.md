# @chengxianglibra/dsh-data-analysis

[简体中文](README.md) | English

Analyze data with natural language in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
Explore and reuse business metric definitions, then turn your findings into interactive charts, reports,
and dashboards that you can also read offline. Semantic analysis is powered by [Marivo](https://github.com/chengxianglibra/marivo).

This is an independently maintained community plugin. It is not an official DeepSeek product.

## Capabilities and features

| What you want to do | What the plugin offers |
| --- | --- |
| Answer business questions | Analyze metric trends, compare periods or business segments, and explore reasons for changes using natural language |
| Analyze local files | Upload files or use files in your workspace to analyze data and create charts and reports |
| Connect to data | Configure data sources, manage credentials, and test connections; DuckDB, Trino, and ClickHouse are supported by default |
| Keep definitions consistent | Work with the assistant to define and reuse metrics and dimensions, and explore their relationships |
| Specify what to analyze | Search for and reference existing semantic objects with `@` in the chat input |
| Present findings | Create reports and dashboards with conclusions, metric cards, charts, tables, and source information |
| Explore further | Filter interactively, adjust the presentation, and reference report content in follow-up questions |
| Read and share | Save and browse previous versions, and download HTML for offline reading and sharing |

## Installation

### Prerequisites

- Node.js `^22.19.0 || >=24.0.0`: version 22.19.0 or later in the 22.x series, or version 24.0.0 and above. Version 23.x is not supported.
- DeepSeek Harness `>=0.1.5-rc.1`, installed and configured.
- `pnpm` available on the command line for Harness to install the plugin.
- Python 3.10+, available as `python3` (`python` on Windows), with `venv`/`ensurepip` support. Some Linux distributions require the additional `python3-venv` package.

You do not need to install Marivo beforehand. The analysis environment is prepared automatically on first launch.
An internet connection is required to download dependencies; wait for setup to finish.

### Install and launch

Install the plugin into the Web Profile:

```bash
dsh plugin --profile web add @chengxianglibra/dsh-data-analysis
```

Start the Web Profile after installation. If it is already running, exit and restart it:

```bash
dsh --profile web
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

> Check query duration over the last seven days. Identify the slowest query types and provide a trend chart and a detailed table.

If you have not yet defined your business metrics, start by asking the assistant to help:

> First, find order-related tables in the current data source. Confirm the definitions of revenue and paid order count with me, then save them as reusable business definitions.

When you need a report, describe its contents:

> Turn this analysis into a report with conclusions, key metrics, trend charts, a channel comparison table, and source information. Provide a downloadable HTML file.

### 3. Browse and reference business definitions

Open Semantic Layer (语义层) to find metrics, dimensions, and other objects by category or keyword,
and inspect their definitions and relationships. Open objects separately to compare them side by side.

Type `@` in the chat input to search for and select objects in the current workspace.
For a multiword search, use `@"monthly revenue"`. Ask questions about the selected objects to keep the analysis aligned with your business definitions.

### 4. Read, edit, and ask follow-up questions about reports

When the current session delivers a new report, it opens automatically on the right.
Use the Reports (报告) catalog to find reports by title and read different reports or versions side by side.
The page notifies you when a new version is available, so you can choose when to switch.
You can also read workspace reports from the Reports sidebar entry without an active session.

- **Explore data**: Filter charts and tables, and adjust supported chart types and displayed fields. Interactions use data already saved in the report; ask in chat to fetch fresh data or recalculate results.
- **Check sources**: Inspect the source information attached to report content to review the basis of the analysis.
- **Edit the presentation**: On the latest version page, select Edit Report (编辑报告) to change titles, text, metric labels, and chart or table settings. Move or remove content, undo or redo changes, and save your edits.
- **Ask follow-up questions**: Choose Add to Question (加入提问) from a supported report content menu to insert a reference into the chat input, then add your question and send it.
- **Browse history**: After saving edits, use the history sidebar to view and download saved versions. Historical versions are read-only.

Page filters do not recalculate metric cards or change the saved report. To preserve the current filtered view, use Export Current View (导出当前视图).

### 5. Download and share

The export menu at the top right of a report offers two options:

| Option | Use it to |
| --- | --- |
| Download Full Report (下载完整报告) | Download the complete HTML report for the version you are viewing and read it offline |
| Export Current View (导出当前视图) | Capture the current filters, charts, and table sorting in HTML, with the source version and export time, to share what you see |

You can also ask the assistant to export a report as an HTML file. Open downloaded files in a browser to read and interact with them offline, without connecting to the original data source.
If you are editing a report, save or cancel your edits before exporting.

## Analysis timeout

Go to Settings → Plugins → Plugin Configuration → Data Analysis (设置 → 插件 → 插件配置 → 数据分析)
to adjust the default timeout for Python analysis. The default is 120 seconds, and changes apply to the next analysis call after saving.
The actual execution limit is still subject to Harness execution policies.

## License

This project is licensed under the [MIT License](LICENSE).
