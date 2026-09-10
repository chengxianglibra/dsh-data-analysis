# 展示数据投影

## 责任与入口

本模块将已存在的数据和声明来源投影为 reader 可消费的纯数据。Marivo 拥有 Artifact、Finding、字段、Quality、
issues 与语义引用；Harness 拥有 Workspace 和 Runtime identity。插件不审查 computed 转换、不复算，
也不把来源存在解释为计算正确性。

实现入口为 [contracts](../../packages/dsh-data-analysis/src/presentation/contracts/index.ts)、
[projection](../../packages/dsh-data-analysis/src/presentation/projection/index.ts)和
[Python writer](../../packages/dsh-data-analysis/python/presentation-kit/src/dsh_data_analysis_presentation/_dataset.py)。
结构、数值编码和预算见下文[展示数据契约](#展示数据契约)。
这些是内部展示接口；[共享 reader 与离线 builder](presentation-reader.md)消费其输出，[展示交付](presentation-delivery.md)通过 `marivo_present` 保存报告。

## 展示数据契约

纯展示结构以 [types.ts](../../packages/dsh-data-analysis/src/presentation/contracts/types.ts) 和
[校验入口](../../packages/dsh-data-analysis/src/presentation/contracts/index.ts)为准，不复制 Marivo 的领域 schema。
Document 使用 schemaVersion 3，Draft 使用 schemaVersion 2，两者均要求 `locale: "zh-CN" | "en-US"`。Receipt 仍使用 schemaVersion 2，computed `TypedDataset` 仍使用 schemaVersion 1。旧报告不自动迁移，需由 DSH 重新生成。
current 指针与 Host delivery envelope 的版本由[展示交付](presentation-delivery.md)独立定义。

| 结构 | 职责 |
| --- | --- |
| `PresentationDraft` | 标题、声明来源、dataset 输入、有序 blocks 与可选交互；作者不能填入生成时来源事实 |
| `SourceRef` | 精确 `sessionId`、`artifactRef` 和可选 `findingId`，在同一绑定 Workspace/Runtime 下恢复 |
| `TypedDataset` | 列定义、按列顺序的 rows、完整 rowCount、写入 limit 与 truncated |
| `PresentationDocument` | Workspace/Report/Build 身份、物化 datasets、来源与代码快照、blocks 和诊断 |
| `PresentationReceipt` | 保存结果、身份、摘要与文件路径/字节数/SHA-256；HTML 可选，Session/Turn 归属由 delivery envelope 提供 |

五类 block 为 `markdown`、`metric`、`chart`、`table`、`source`；图形配置和交互见[reader](presentation-reader.md)。
metric 精确绑定已有单元格或已准备的筛选切片，不隐式求和；source 只展示保存快照。
Artifact dataset 必须有可恢复的必要来源和数据；computed 可声明零到多个来源，source-only 保持 `datasets: []`。
available/unavailable 表达来源读取结果，不能解释为分析正确性状态。

### 数值与行数

列类型为 `string`、`boolean`、`float64`、`int64`、`decimal`、`date`、`datetime`，属于 JSON 展示编码。

- `int64` 使用 signed 64-bit 范围的精确十进制字符串；`decimal` 保留尾随零及可选指数，不允许 NaN/Infinity。
- `float64` 必须是有限 JSON number；超出 JavaScript safe integer 范围的整值拒绝接收，不能把已舍入值改成字符串冒充精确值。
- `date` 使用有效 `YYYY-MM-DD`，`datetime` 使用带 `Z` 或 offset 的 ISO 字符串，最多六位秒小数；不猜时区。
- `null` 只出现在 nullable 列，不替换成零或空字符串；精确表格保留原值。

图形 `numericMode` 明确区分 `exact` 与 `approximate`。exact 不接受 decimal 或无法精确转换的 int64；
approximate 才允许将其转成有限 JavaScript number，显示近似提示并保留原始表格值。reader 不静默聚合、缩放或重算指标。

`rows.length` 必须等于 `min(rowCount, limit)`，`truncated` 必须等于 `rowCount > rows.length`。
空结果保留列定义；截断数据不能用于推导全量总计、KPI 或排名。插件无法恢复上游已经丢失的精度。

### 预算与错误

| 项目 | 上限 |
| --- | --- |
| Draft / 单 TypedDataset / Document / HTML | 256 KiB / 2 MiB / 4 MiB / 8 MiB |
| datasets / sources / blocks | 16 / 64 / 64 |
| 单 dataset 列 / 行 / 单元格 | 64 / 5,000 / 100,000 |
| 代码片段 / 单段文本 | 32 / 32,768 字符 |

预算由 `PRESENTATION_BUDGETS` 定义，JSON 按 UTF-8 字节计算；读取前限制原始文件字节。
`PresentationContractError` 提供 `code`、RFC 6901 `path`、`message` 与修复 `hint`；
身份、路径、摘要及实际文件授权由 Host 检查，纯 schema 校验不代替文件边界。

## 数据流程

`MarivoPresentationProjection` 只接受 ready、携带 presentation-kit identity 的 bound runner。
`readDraft(relativePath)` 从绑定 Workspace 有界读取草稿；
`project(draft, { workspaceId, reportId, buildId, generatedAt?, signal? })` 返回校验过的 `PresentationDocument`。
Workspace/report/build identity 由 Host 提供，Draft 不允许自行填写生成文档的来源事实。

| 输入 | 处理 | 失败边界 |
| --- | --- | --- |
| Artifact dataset | 固定程序恢复 Session/Artifact，核对公开字段顺序和完整行数，再按声明列与行预算编码 | 来源、必要字段或数据不可恢复时失败 |
| computed dataset | 读取 Workspace 相对路径的 typed JSON，保持原值及 Draft 的零到多个 source refs | 文件、数值或预算不合法时失败；来源 unavailable 可以保留 |
| source-only | 只恢复声明来源，保存 available/unavailable 快照 | 保持无 dataset，不生成占位表格 |

计算文件先限制原始字节再解码 UTF-8/JSON，拒绝目录、FIFO、符号链接、越界及读取期间身份变化。
每个异步边界检查取消和 runner 状态。错误位置使用 RFC 6901 pointer，关联回 Draft/dataset；
上游异常原文不进入生成文档，防止路径、SQL 或 secret 混入诊断。

## 公开来源快照

固定程序通过 `mv.session.resume(..., use_datasources=False)`、`session.artifact`、`artifact.contract`、
`artifact.to_pandas` 和可选 `artifact.finding` / `finding.render` 读取持久化事实。
恢复仍需要有效 Workspace 声明；不执行 `observe`、`revalidate` 或数据源准入，并安装拒绝凭据读取的 resolver。

available 来源保存读取时间、Artifact 内容身份、公开语义引用、Quality/issues 及选定 Finding。
可选 Finding 不可读取时保留 Artifact 来源并明确 Finding unavailable；身份不一致直接失败。
当前公开契约不能提供历史 metric 定义时明确 unavailable，不用当前定义冒充历史口径。
来源面板只读取这些快照，不再次执行 Python。

来源 `code` 快照通过公开 `artifact.meta.produced_by_job`、`session.get_run(...)` 与 Run 的
`input_artifact_refs` 读取当前 Artifact 及其上游的实际 SQL；核验生产记录的输出身份和 Workspace，
不枚举其他 Run、不重新编译 SQL。每个来源最多读取 64 个上游 Artifact、保存 32 条 SQL，单条最多 32768 UTF-16 code units；
无查询、缺失记录及超限保留明确说明，不把截断 SQL 当作原文。

dataset 可通过 `codeRefs` 引用成功 `marivo_python` 的执行记录。投影只从 Host 管理的执行存储按精确 Workspace、execution ID 和
完整记录字节的 SHA-256 读取 Python 原文，再保存到 dataset 的 `code`；不接受 Workspace 自报记录。
引用不可恢复时构建失败，不读取同名脚本补齐。
执行记录证明提交的 Python 成功执行，作者仍负责它与 dataset 的关联；不审计外部导入文件或计算正确性。
代码以原文保存，不做字面量脱敏，不从凭据 payload 提取内容。生成 JSON 与离线 HTML 均包含同一份代码快照。

## Python helper 与 Runtime

`dsh_data_analysis_presentation.write_dataset(frame, path, *, row_limit=5000, labels=None)` 只接受 pandas DataFrame，
原子写入 computed typed JSON，并返回路径、字节数、完整/写入行数和截断信息的有界 receipt。

computed writer 可通过 `labels={列名: 展示名}` 显式设置列 `label`，未映射列沿用列名；
列 `id` 和 Draft 绑定保持原样。typed JSON 继续使用现有 schemaVersion 1，展示名不改变分析语义。
writer 不接收来源或转换说明；来源只写在 Draft。
行和单元格预算确定实际 limit，超出字节预算明确失败；空结果保留列，未指定的展示标签使用列名。

分发 wheel 为 `dsh_data_analysis_presentation_kit-1.1.0-py3-none-any.whl`，只依赖 pandas。
Runtime marker v3 同时检查模块版本、distribution 版本、实际导入位置和公开 writer；
每次 shared checked execution 再核验 helper，避免 Workspace 同名模块遮蔽。管理员 Python 失败时提供修复信息，
不自动安装或切换解释器；managed 模式通过唯一新 wheel 安装路径准备环境。

## 验证

```sh
npm run test:presentation-projection
npm run test:runtime-workspace
npm run test:presentation-surface
npm run validate:runtime-workspace:real
npm run validate:presentation-projection:real
npm run validate:presentation-browser:real
```

Python 合同测试随 `npm run check` 持续执行；真实脚本使用隔离目录，保留机器证据。
Artifact 验证先通过 Marivo 公开分析生成并持久化，再在另一进程恢复；
该 Chromium 验证只证明 Python/Node/browser 数据解释一致；reader、离线 HTML、Host 交付和真实 Agent 路由需分别验证。

## 草稿静态预检

在 Workspace 根目录运行 `dsh-data-analysis-presentation-lint analysis/presentation.draft.json`，
或通过 `--project-root PATH` 显式指定 Workspace。CLI 复用 present 的草稿与 TypedDataset 校验及文件边界，
检查草稿结构和引用的 computed JSON；不启动 Runtime、不执行分析、不生成报告文件。
输出 JSON 的 `ok` 仅表示这些静态检查通过；`deferredChecks` 列出仍由 `marivo_present` 完成的
Artifact 可用性与数据、codeRefs、投影后文档与渲染检查。退出码为 0（通过）、1（校验失败）、2（参数错误）。
草稿结构通过后逐份检查 computed 文件，每份保留首个错误，修正后可再次预检。

int64 单元格必须是精确整数字符串，例如 `"42"`；JSON number `42` 也不接受。
诊断保留 JSON pointer，并显示 `column query_count type=int64`、原因与修复建议。
超过 JS 安全整数范围的 number 可能已舍入，不能转成字符串来恢复精度；应从原始精确数据重写，
或使用绑定 Runtime 中的 `write_dataset`。预检通过不等于成功交付，仍需 present 的成功 receipt。

### 预检与诊断验证

[presentation-projection 回归测试](../../packages/dsh-data-analysis/tests/presentation-projection/lint.test.ts)
覆盖 JSON number 拒绝、精确 int64 边界保真、跨 computed 文件错误收集、CLI 退出码与无写入、符号链接和无效 JSON 拒绝；
[projection 测试](../../packages/dsh-data-analysis/tests/presentation-projection/projection.test.ts)
验证 present 使用的投影路径保留列级诊断且不重复拼接 pointer。
分发检查验证 CLI 声明、可执行权限和安装包内启动。上述验收不代表真实 Agent 或完整报告渲染验收。
