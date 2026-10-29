# 统一分析 UI P4 元数据验收

日期：2026-10-29。范围：[P4 实施任务](../designs/unified-analysis-ui-implementation.md#p4图表与元数据按需增加)中的 Frame 元数据部分；
line/bar 图形未开始。只修改本插件，未改 Marivo、Harness 或随包 Skill。

## 实现与责任

- presentation-kit 升至 1.3.0。`read_frame(..., metadata=True)` 只在新快照路径使用：`evidence`/`findings` 各读一页（limit 20），
  `method_facts` 保留前 20 项摘要，`lineage` 只取实际投影列及其轴。不续页、不读方法载荷、源连接或当前语义定义。
- 记录坐标经 `schema.slots` 解释；只有完整轴键与已捕获坐标精确相等才写 `rowIndex`，其余为
  `row-unmatched`、`partial`、`unscoped` 或 `unresolved`。
- 每节独立 `captured`/`unavailable`，原因封闭，不含原始异常。文本截断并标记，身份不截断；单节 64 KiB，
  整份快照超 2 MiB 时先降级最大节，数据结果不受影响。旧 Draft 投影不读元数据，旧快照的 `not-captured` 仍可解析。
- AnalysisFrameView 来源详情展示四节、已读/总数、首页提示与不可用原因。语义来源在 tool view 与报告 tab
  经现有语义浏览器打开当前定义，候选预览不提供导航。组件签名与 Catalog build 未变。

## 环境

| 项目 | 实际身份 |
| --- | --- |
| Node.js | 22.19.0 |
| Marivo | 0.6.0.dev0；Python 3.14；现有 managed Runtime，未重装 |
| Helper | 本次构建的 presentation-kit 1.3.0 wheel，经 `sys.path` 加载并核对 `__version__` 与导入位置 |

## 证据

| 层级 | 结果 |
| --- | --- |
| 静态与模块 | `npm run check` 通过（Biome、依赖、typecheck、全部 Node 测试；4 项需 `DSH_DATA_ANALYSIS_PYTHON` 的真实 Python 用例跳过）；presentation-kit `tests/test_frame.py` 23 项通过 |
| 分发 | `npm run build`、`npm run build:presentation-kit`（wheel 校验）与 `npm run verify:plugin-package` 通过 |
| 真实 Runtime | 临时 Workspace 中 `observe` 与 `correlate` 两个持久 Frame：Evidence 分别 2、3 条（均无坐标，显示为 unscoped），Findings 与方法说明为空，lineage 覆盖全部投影列；输出经 TS `parseAnalysisSnapshot` 解析通过；未传 `metadata` 时仍为 `not-captured` |

## 未覆盖与限制

- 当前 Marivo 检出中未找到会提交 Finding 的公开方法，真实样例的 Findings 为空；带坐标 Finding、行级匹配与截断仅由单元测试覆盖。
- 未运行真实 Host/浏览器与模型验收；语义导航的点击与 tab 打开只有渲染测试和类型检查。
- 已安装插件升级后，shared Runtime 会因 helper 版本变化按既有流程重建；本次未在 managed Runtime 上执行升级。
