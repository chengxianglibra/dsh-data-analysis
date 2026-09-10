# 文件分析验收

文件分析沿用 Harness 原生上传、Session 和执行环境。插件 Skill 指导读取、分析和报告交付；pandas 与原生 DuckDB 均通过 `marivo_python(datasources: [])` 执行。

## 运行

先构建当前插件，再运行 `npm run validate:file-analysis:real`。设置 `DSH_DATA_ANALYSIS_PYTHON` 指向已经验证的 Runtime；脚本不安装或升级 Runtime。模型配置沿用 `DSH_DATA_ANALYSIS_VALIDATION_MODEL`、`DSH_DATA_ANALYSIS_VALIDATION_EFFORT` 和 `DSH_DATA_ANALYSIS_VALIDATION_TURN_TIMEOUT_MS`。

在并行开发或复验时，可设置 `DSH_DATA_ANALYSIS_VALIDATION_PACKAGE` 指向此前已构建的 npm tarball，绕过重新打包。验收记录包含该 tarball 的 SHA-256，以固定实际运行的候选。

默认验证全部格式。`DSH_DATA_ANALYSIS_VALIDATION_FORMATS` 可指定逗号分隔的子集（`csv,json,jsonl,parquet,xlsx`），结果记录实际选择；子集必须包含 `csv`，供同名附件与恢复验收使用。只修改验收断言时可复核保留的实际事件与代码，不必重新消耗模型调用。

脚本从继承环境或 Harness 凭据文件只读解析 `DEEPSEEK_API_KEY`，仅向隔离 Web 子进程提供。缺少 Runtime 或模型凭据会明确记录 `blocked`，不会用模拟模型代替真实验收。Excel 读取需要相应 reader；DuckDB 的 Excel 扩展首次使用可能需要联网。

## 验收边界

- 临时目录内打包安装当前构建，独立 `DSH_HOME`、Workspace 和随机端口；不重装或重启用户 Web。
- CSV、JSON、JSON Lines、Parquet、`.xlsx` 通过原生二进制上传取得 receipt，再通过公开 `session.prompt` 提交。Prompt 不包含绝对路径、Skill 名或分析代码。
- 真实模型自然选择文件 Skill、执行本地分析并交付报告；正确汇总 dataset 必须关联本轮成功执行的代码快照，代码使用 Harness 公开附件映射中的目标文件路径。映射仅用于验收，不注入 Prompt；另检查不激活语义 Skill、root Help 或创建 models。
- 同一 Session 上传第二份同名 CSV；重启本次隔离 Web 后再次读取第一份附件，验证身份区分及恢复后的读取能力。
- 两种本地引擎的 `marivo_python` 准入、代码捕获和取消单独验证，不用模型每次选择某个引擎证明其可用性。

脚本输出临时证据目录，包含包摘要、上传 receipt、完整脱敏 Session events、报告 JSON、Web 日志及最终 `result.json`。`passed` 只在所有实际执行断言通过后写入；失败保留证据。截图用于检查隔离 Web 已正常加载，不单独证明报告 UI 验收。

## 本次记录

本地工具层已验证 pandas 与原生 DuckDB 都可通过 `datasources: []` 分析、捕获原文 codeRef；DuckDB 同次执行内可使用临时表与多条 SQL，取消后 worker 退出，且没有 datasource describe、连接测试或凭据请求。证据位于 `artifacts/dsh-file-analysis/plugin-smoke-evidence.json`；示例执行证据位于同一目录。

第一次原生 CSV 上传已由真实模型自然选择文件 Skill，以 pandas 完成全量读取并返回 3 条记录、总和 71，执行使用 Harness `workspace-write` / `full` sandbox，返回 codeRef。该轮“简短报告”被模型合理处理为文字答案，因此未通过阅读器交付断言。保留这次记录作为普通问答路径证据，后续报告验收明确请求“可在右侧报告阅读器打开”，不修改 Skill 强制普通问答生成报告。

2026-09-10 的真实链路已通过，汇总见[本机验收证据](../artifacts/dsh-file-analysis/real-summary.json)。固定候选 tarball SHA-256 为 `afd2dfd84bd4bec0100eaebd380b41d352c697a9918fa52d052d4b4868d194a6`，模型为 `deepseek-v4-pro` / `high`。

CSV、JSON、JSON Lines 和 Parquet 实际使用 pandas；`.xlsx` 使用原生 DuckDB 参数化 `read_xlsx`，并在 `finally` 关闭连接。全部通过原生附件上传、自然 Skill 选择、正确的 3 条记录 / 总和 71、报告 receipt 和当前执行 codeRef 验证。第二份同名 CSV 得到 2 / 300；重启隔离 Web 后恢复原 Session，重新读取第一次附件，仍得到 3 / 71。人工核对恢复代码实际调用原附件的 `read_csv`，没有复用旧汇总冒充重新读取。

JSON Lines 的第一次断言因模型使用相邻字符串拼接长路径而误报。保留实际成功执行与报告，通过静态 AST 常量和人工核对确认目标路径；修正后仅运行尚未覆盖的格式及恢复所需 CSV。摘要明确记录两轮同候选证据，没有将原失败记录改写成完整脚本通过。

本次验证覆盖实际 Web / 模型执行及报告 receipt、JSON 和代码关联。截图停留在隔离 Web 的内测说明页，未完成报告阅读器的视觉与交互验收。最终完整 `npm run check` 已通过：609 pass、0 fail、4 skip，包含最新构建；该次工作区同时包含独立开发的报告发布改动，其先前引起的中间失败已修复。最终 `verify:plugin-package` 也已通过，日志分别位于 `artifacts/dsh-file-analysis/check-final.log` 和 `artifacts/dsh-file-analysis/package-verification-final.log`。
