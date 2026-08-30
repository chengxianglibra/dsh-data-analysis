# HTML 分析报告最小实现设计

## 文档状态

`ReportDocument v1`、统一数据源目录、computed snapshot、checked Artifact projection、不可变发布和 Web/Code Mode
轻量交付已经实现。当前确定性入口为 `npm run test:html-report-rendering`；真实 runner 为
`npm run validate:html-report-rendering:real`。

这是 clean-slate 实现：v1 是唯一当前输入契约，不保留其他版本 alias、迁移器或旧产物复用逻辑。整体集成仍遵循
[总体架构](../architecture.md)、[HTML 报告渲染模块](../modules/html-report-rendering.md)、
[Marivo operators and frames](../../../marivo/docs/specs/analysis/operators-and-frames.md) 与
[Harness Tool contract](../../../deepseek-harness/docs/cookbook/adding-a-tool.md)。本设计只定义 DSH 集成与展示接缝，
不复制 Marivo 分析契约。

## 决策摘要

- Agent 每次提交一份完整的 `dsh-data-analysis-report/v1`，不提交 patch，也不读取上一份文档。
- `document.data` 是统一数据源目录；每个 source 只能是 `{ id, artifact_ref }` 或 `{ id, computed }`。
- `chart`/`table` 只通过 `data_ref` 引用 source。同一个 source 可以被多个 chart/table 复用。
- computed 是调用方提供的 `dsh-computed-data/v1` JSON 快照。Python 对象、代码、handle、registry 和额外持久化服务不在 MVP 内。
- Artifact 仍由 Marivo 拥有并通过 checked bridge 校验；computed 不进入 Marivo Session DAG。
- Artifact 和 computed 最终都映射为统一 `DisplayDataset`，共享 line/bar/table 的列、行、排序、校验和截断逻辑。
- 只支持 `line`、`bar` 和 `auto`；不支持 scatter、area、heatmap、多序列聚合、sampling、Top-N 或自定义图表。
- 报告是内容寻址的不可变目录。computed 数据直接写入 `report-document.json`，不另建 `report-data.json`。

## 所有权与非目标

| 参与方 | MVP 职责 |
| --- | --- |
| 用户 | 指定问题、受众、重点和是否需要耐久报告 |
| Agent | 生成完整文档，决定标题、章节、数据源注册、文字和视觉映射 |
| Marivo | 拥有 Artifact、Quality、Lineage、有效性和 Session 语义 |
| DSH 插件 | 校验 v1 文档，读取 Artifact 展示投影，合并 computed，渲染并发布 HTML |
| DSH | 保存 Tool call/result 历史，提供 Web Tool View 与本机打开能力 |

明确不做：Report registry/current state、create/update/patch API、分析 planner、自然语言 entailment、业务建议审查、
实时刷新、在线筛选、下钻、任意 Vega/ECharts、自定义 JavaScript、分享权限、远程下载、PDF 导出、GC 或产物删除。

## v1 文档契约

```ts
interface ReportDocument {
  version: 'dsh-data-analysis-report/v1'
  title: string
  subtitle?: string
  locale: 'zh-CN' | 'en-US'
  data?: ReportDataSource[]
  sections: ReportSection[]
}

type ReportDataSource =
  | { id: string; artifact_ref: string }
  | { id: string; computed: ComputedTable }

interface ComputedTable {
  version: 'dsh-computed-data/v1'
  columns: ComputedColumn[]
  rows: Array<Array<string | number | boolean | null>>
}

interface ComputedColumn {
  name: string
  type: 'string' | 'number' | 'boolean' | 'datetime'
  role?: 'time' | 'dimension' | 'measure' | 'value'
  unit?: string
  nullable?: boolean
}

type ReportBlock =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'chart'; id: string; title: string; data_ref: string; view: 'auto' | 'line' | 'bar'; x?: string; y?: string; subtitle?: string }
  | { kind: 'table'; id: string; title: string; data_ref: string; columns?: string[]; max_rows: number }
```

`data` 中每个 ID 必须是唯一的 ASCII kebab-case；每个 Artifact ref 只能注册一次；source 必须且只能声明一种
类型。`data_ref` 必须命中已注册 source。`session_id` 仅在至少存在一个 Artifact source 时必填；computed-only 请求可省略。

computed 的要求是“可重放的结果快照”，而不是 Python 执行记录：

- Python/其他计算必须在调用 Tool 前转换为 `columns + rows`，不得把 DataFrame、对象 repr、代码或 handle 直接传入；
- 单元格只能是 string、有限 number、boolean 或 null；日期使用 ISO 字符串并把列类型声明为 `datetime`；
- 每行必须与 columns 等宽；列名唯一；未知字段、非法类型、非有限数值、非法日期、重复 ID/ref 和超出总 payload 均阻断；
- `role`、`unit`、`nullable` 是可选元数据，不要求调用方构造额外复杂 schema。未提供 `nullable` 时由快照内容归一化推断；
- 当前上限：20 个数据源、100 个 computed 列、2,000 行 computed 数据、16 MiB 单表/总 computed payload、20 个 section、
  100 个 block、`table.max_rows` 1–100、HTML 10 MiB。

Parser 对 root、section、block、source、computed table 和 computed column 递归执行 closed-shape 校验。解析结果是
规范化 v1 文档：computed `version` 固定为 v1，未显式给出的 nullability 会写入归一化列定义。解析失败只返回结构化
`document` check，不尝试解释为旧版本或自动迁移。

## Tool 和执行流程

```text
marivo_report_render({ session_id?, document })
```

执行顺序：

1. 解析完整 v1 文档，收集 source/data_ref、文档问题和安全 inspection；
2. 没有 Artifact source 时，构造空 Session DAG，并把已校验 computed 直接转为 `ReportComputedProjection`；
3. 有 Artifact source 时，要求 `session_id`，只把去重 Artifact refs 传给固定 bridge；bridge 结果与 computed projection 合并；
4. source 阶段验证 bridge payload/identity。visual 阶段将两类 source 映射为 `DisplayDataset`，执行共享图表和表格准入；
5. document/source/visual 全部 passed 后才生成 HTML，并由 publisher 原子写入不可变目录；任何可修复错误都返回 blocked checks。

Artifact bridge 保持现有所有权边界：复用当前 Environment binding，在同一 Session 中 revalidate 显式 Artifact，读取公共
列、行和受控 Session DAG；不发现 backing Artifact，不调用 Finding compatibility/finding/render，不把 rows 重新送回
Marivo Intent，也不重新查询 datasource。bridge 只接收 Artifact refs；computed-only 完全不调用 bridge。

blocked 输出固定为 `document`、`source`、`visual`、`publish` 四个 check。Environment identity 漂移、子进程失败、取消、
超时和本地 I/O 仍是 Tool error，不伪装成文档问题。ready 输出保留 `artifact_refs`，并增加 `data_refs`、
`computed_data_refs`；presentation metadata 只携带标题、路径、digest 和 disclosures，不携带完整 computed payload。

## 统一视觉编译

`createReportComputedProjection()` 把 computed 列类型映射到共享显示列：`datetime` 映射为时间列，number 默认 measure，
其他类型默认 dimension；显式 `role`、`unit` 和 nullability 被保留。Artifact projection 使用相同的显示列接口。

line/bar/table 因而不需要知道 source 的来源：

- line：x 是 time 或有序 numeric dimension，y 是 numeric；按稳定 instant/数值排序，拒绝重复 x、空值、结构化值和非有限 y；
- bar：x 是 categorical dimension，y 是 numeric，数值轴包含零；类别较多或标签较长时使用横向布局；
- table：按全部公开列或显式列选择展示，始终给出 displayed/total/omitted；
- 不自动聚合、抽样、Top-N、补 denominator 或混合额外 grain；`auto` 仅接受唯一 line/bar 映射。

Renderer 在 computed chart/table 附近显示“计算结果快照”说明，明确它不是 Marivo Artifact，不声明 Python execution、
freshness 或 lineage。computed-only 页脚不创建伪造 Session/Job/Artifact 节点，只显示不生成 Marivo Session DAG 的说明。

## HTML 与发布身份

HTML 是无 I/O 纯函数，使用 semantic HTML、内联 CSS、SVG、fallback table 和固定交互脚本。所有文档文字、computed 值、
Artifact 值、SQL 和审计字段先 escape；页面不包含 Python 代码、内部对象、远程 URL、iframe 或外部字体，并使用精确 CSP hash。

目录结构保持三文件：

```text
$DSH_HOME/dsh-data-analysis/reports/<environment-fingerprint>/<report-digest>/
├── index.html
├── report-document.json
└── manifest.json
```

`report-document.json` 保存归一化后的完整 v1 文档，包括 computed `columns + rows`。report identity 包含完整文档、环境
fingerprint、Marivo version、renderer version 和统一 projection；computed 行/列变化一定改变 digest。当前版本为：

- `dsh-data-analysis-html/v1`
- `dsh-data-analysis-report-digest/v1`
- `dsh-data-analysis-report-manifest/v1`

manifest 的 `computed_data` 保存每个 computed source 的内容 hash；不加入未解析 Python 对象、handle、registry 或独立数据文件。
相同输入复用已完整校验的目录；其他版本产物不迁移、不复用。Publisher 使用 staging、目录 `0700`、文件 `0600` 和最终 rename，
不覆盖损坏目录。

## 触发与交付

`marivo-analysis` 激活不等于报告调用授权。普通分析、对话内表格和图表默认直接回答；只有用户明确请求耐久 HTML、接受
Agent 提议，或要求修改本对话中生成的报告时才调用 Tool。每次修订都重新提交完整 v1 文档并生成新 digest。

ready 结果通过标准 `tool/result.meta` 和 Code Mode 耐久 card 投影轻量交付信息。Web replay 不读取 HTML、不访问 Marivo、
不依赖最终回答文字；用户点击后才调用 `host.openPath(path)`。旧版本、畸形、blocked 或失败结果不显示可打开报告卡片。

## 验收与后续扩展

确定性测试必须覆盖：

- v1 closed parser、其他版本拒绝、source exactly-one-of、重复 ID/ref、未知字段、行列匹配、非法数值/日期和 payload bounds；
- computed-only 不要求 session_id 且不触发 bridge；mixed 只把 Artifact refs 传给 bridge；同一 computed source 复用 chart/table；
- computed line/bar 的 x/y 推断、显式列选择、日期排序、数值校验、截断、fallback table 和来源说明；
- computed 行或列变化改变 document/report digest，相同输入仍幂等复用；manifest 不产生 `report-data.json`；
- HTML escaping、CSP、无 Python 代码/内部对象、无远程依赖，以及轻量 presentation metadata；
- `npm run check`、`npm run build`、`npm run verify:plugin-package` 全部通过。

后续若要支持超大结果、跨调用复用、Python 执行证明、完整 lineage 或更多图表，应另行设计 host-owned materialization/handle
契约，不把这些语义偷偷塞入当前 v1 inline JSON。
