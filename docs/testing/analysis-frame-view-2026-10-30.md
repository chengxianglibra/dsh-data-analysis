# AnalysisFrameView 实施验收

日期：2026-10-30。范围：[AnalysisFrameView 设计](../designs/analysis-frame-view.md) F1–F4。只修改本插件；
未改 Marivo 或 Harness。随包 Skill 只按授权修改 `references/` 下的 `analysis-catalog.md`、`analysis-ui.md`、`examples.md`。

## 实现

| 阶段 | 结果 |
| --- | --- |
| F1 契约与捕获 | presentation-kit 1.5.0：`read_frame` 只产出 Frame schemaVersion 2，不再读取 Evidence、Findings、method_facts；新增 `capture_frame`；坐标 part 改为 Marivo 的 `nominal_start/nominal_end`。Host 签发 `marivo-frame:` snapshotRef，新声明 `frame-snapshot` 绑定 codeRef |
| F2 外壳与基础类 | `resolveFrameView` 负责分类、形状与视图，供保存校验和渲染共用；外壳由 chips、头部数字、可折叠数据表和图标行组成；观察类全部形状、广播参考线、统计符号；相关；成员 |
| F3 比较 | 端点标签、本期实线与基期虚线、Δ 细柱、哑铃、delta 发散条、小图、多 alias 切换 |
| F4 分解 | 父级小图、瀑布、效应分段、份额轨道、restricted 时末柱断开 |

图形均为本插件绘制的 SVG。`@openuidev/react-ui` 0.18.1 的入口没有导出 `Modal`，Charts 也画不出断点、空心点、斜纹和浮动柱，所以没有使用。

## 与设计的差异

- Marivo 已到 `c68567c2a2`，设计依据是 `79536a6d2c`。share、pair_statistic（含 x/y 操作数）与 alignments 已公开，
  三项都已捕获。经用户确认，另实现了份额轨道和 align 视图，分类中新增“对齐”类，位于比较之后、相关之前。
- 对 comparison 做 attribute 时会保留多个分解，`auto` 优先取变化目标（absolute、relative），其次才是 level。
- align 只按两侧 observation context 的同一 subject 配对左右值，名称和顺序不作为依据；没有唯一共同 subject 的值只进表格。
  真实 `align` Frame 两侧分别是 revenue 和 order_count，显示为表格；配对时间 align 两侧都是 revenue，画两条线。
- share 在 time × category 上、且沿类别归一时，按期间各画一条 0–100% 轨道。
- 保存的 `view` 在渲染时无法解析会显示资源不可用，不改用其他图；只有流式候选态回退到 `auto`。
- 相关图标题取 pair_statistic 捕获的 x/y 操作数（如 revenue ↔ orders）。

## 环境

| 项目 | 实际身份 |
| --- | --- |
| Node.js | 22.19.0 |
| Marivo | `../marivo/dist/pypi/marivo-0.6.0.dev0-py3-none-any.whl`，sha256 `9184268800226f174fb687b12ae7cbe99ad8d45e8fa670525b46db674042c0b5`；相关模块与 `6e464e5eec` 一致（夹具最初在 `c68567c2a2` 上生成，换新 wheel 后重新生成，内容不变） |
| Python | 临时目录中用 uv 建的隔离 venv（CPython 3.12.13），未触碰 `~/.dsh` 下的 managed Runtime |
| Helper | 本次构建的 presentation-kit 1.5.0 wheel，经 `verify_wheel.py` 校验 |

## 证据

| 层级 | 结果 |
| --- | --- |
| presentation-kit | `uv run --frozen pytest -q` 120 项通过，1 项跳过（真实 Runtime 项）；设置 `DSH_FRAME_REAL_PYTHON` 后真实 Runtime 项通过，会重新生成 21 个 Frame 并与入库夹具比对 |
| 真实 Frame 夹具 | `tests/unified-analysis-ui/fixtures/frames/` 下 21 个，覆盖 observe 四种形状、reduce、over、share、correlate、成员、read、values、calendar/ordinary 比较、level/可加/rate-mix/Shapley 分解、where 与 fix 之后的 restricted、align 与配对时间 align。全部通过 `parseAnalysisSnapshot` |
| 模块测试 | `test:unified-analysis-ui` 60 项通过，包括分类与视图解析、各视图和通用编码、21 个真实 Frame 的 auto 渲染；`test:presentation-skill`、`test:presentation-projection`、`test:python-tool`、`test:semantic-browser` 全部通过 |
| 分发 | `npm run build`、`build:presentation-kit` 与 `verify:plugin-package` 通过 |
| 静态 | typecheck、Biome、`git diff --check` 通过 |
| 浏览器渲染 | 用 Playwright 在 960px 和 390px 下渲染 21 个真实 Frame：无横向溢出，无页面错误。截图在 `artifacts/analysis-frame-view-2026-10-30/`，未做人工视觉审阅 |
| 浏览器交互 | `frame-browser.test.ts` 在 Chromium 中验证：sha256 一致时 Python 弹窗显示绑定脚本，不一致时不显示并变灰；records 的全部键列滚动时保持可见 |

## 未覆盖

- 未运行真实 Host、桌面 UI 或模型验收；`code/read` RPC 到弹窗的完整链路只分别由 RPC 授权测试和浏览器测试覆盖。
- `SKILL.md` 仍写着数据视图只有 auto/table/metric，单结果示例也还是 `marivo-frame`；这个文件不在本次授权范围内，待同步。

`npm run check` 通过（535 项通过，4 项真实执行用例默认跳过）。此前 15 项 `Cannot find package 'immer'` 的原因是
`@deepseek-ai/dsh-client-store` 在运行时导入 immer，却只把它声明为 devDependency；65bd1e6 的 lockfile 去掉了根目录提升的副本。
现已在根 `package.json` 加入精确版本 `immer@10.1.1` 的 devDependency。

## Marivo 缺口与插件侧问题

已由 Marivo 修复：

- compare 的 `current_fixed_axes`/`baseline_fixed_axes` 原先在构建时捕获，输入是未 compute 的 `fix()` 时，compute 后键字段仍为
  `UnresolvedDataType`。`6e464e5eec`（fix(analysis): resolve fixed axis types on compute）修复后，真实 Runtime 复现脚本得到已解析的
  类型与键（`web`/`app`），interpretation 节为 `captured`；夹具脚本已去掉“先 compute 再 fix”的绕行。

需要 Marivo 支持：

- align 对没有观察 subject 的值（计算列等）缺少值级对应：`FrameAlignmentSide.values` 只列出各侧的值。

可选：

- 没有公开的 backing 状态（expression/memory/stored）。`artifact_id`、`description` 只对持久 Frame 可用是文档化行为；
  插件按结构化拒绝的 `location` 识别待执行表达式和非持久 Frame，可以工作，公开状态只会让判断更稳。

插件侧问题（均已修复）：

- align 按位置配对左右值属于插件推断，已改为按同一 subject 配对。
- 外壳样式随每个 Frame 内联，已改为每个 Surface 注入一次；分解的多个父级与按期间的份额轨道改为网格排布。
- records 只冻结第一列，已改为冻结全部键列，偏移按表头实际宽度计算。
- 周粒度刻度显示 MM-DD，已改为与 Marivo 一致的 ISO 周 `YYYY-Www`。
- kit 中“`FrameAlignmentAxis` 没有 kind”的注释改为说明两个公开变体的区分方式；这不是 Marivo 缺口。
- 期间端点没有所属键字段不影响展示：UI 只用端点的 label 和边界，键只作 React key；所属轴的键按轴键 codec 编码。
- share 的上下文、correlate 的操作数已由 `c68567c2a2` 公开并已捕获，设计中这两项缺口已关闭。
