# Marivo 分析展示 S0 接缝验收记录

## 状态与范围

2026-09-07，实施[路线图 S0](marivo-analytics-presentation-roadmap.md#s0先验证四个真正的阻塞点) 的最小契约、固定样例和隔离验证程序。S0 已完成：Runtime 恢复读取、fixtures、Host Native/both/Code dispatch、真实 DSH Web 加载/受控文件读取/下载与离线浏览器均有实际通过证据。

本阶段没有登记生产 `marivo_present`，没有删除现有 Tool/Skill，没有切换 Python helper 或改造凭据执行准入。验证 Tool `marivo_present_s0_probe` 只注册到隔离 Context/profile。S0 不代表 S1–S5 已实施；当前验证程序也不是可向现有用户 profile 重装的完整展示系统。

职责保持为：Marivo 提供 Artifact、行、来源和质量的公开事实；Harness 提供 Agent/Turn、Tool/Code dispatch、Workspace、持久化和 UI 接缝；插件只定义展示数据、文件身份和受控读取。computed 来源是作者声明，不构成计算正确性或转换过程的证明。

## 起点与环境身份

| 项目 | 本次读取的实际值 |
| --- | --- |
| 本仓库 HEAD | `fb0408ad84150535f174c6157101ef15a8194a8c` |
| sibling Marivo HEAD | `e936a3433e2bfaae9db6c54423cd65b0a0310826`；初检工作树无改动 |
| sibling DeepSeek Harness HEAD | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`；初检工作树无改动 |
| Node.js | `24.18.0` |
| 实际安装的 Harness | `@deepseek-ai/dsh`、`dsh-agent-loop`、`dsh-tools`、`dsh-code-runtime-worker-thread`、`dsh-session-persistence-jsonl` 均为 `0.1.1-rc.2` |
| bound Python | `/Users/lichengxiang/.dsh/dsh-data-analysis/runtimes/marivo/.venv/bin/python`，Python `3.10.20` |
| 实际导入 Marivo | `0.5.4`；该 Runtime 的 `site-packages/marivo/__init__.py` |
| pandas | `2.3.3` |
| React / React DOM / React Is | `18.3.1` |
| Recharts | `3.8.1` |
| esbuild / Playwright | `0.28.2` / `1.63.0` |

sibling checkout revision 与已安装 Python/package identity 分别记录，不把 checkout 的源码当作 bound Runtime 已经安装的内容。Runtime 验证通过现有 `bindMarivoEnvironment` 与 `runChecked`，每次在执行代码的同一进程核对解释器、Marivo 版本与导入路径；没有调用 Runtime installer、切换解释器或修改用户 profile/凭据。

开始实施时已有以下五个未提交文件；本任务按原状态保留，没有借机回退或清理：

- `.agents/skills/dsh-plugin-rebuild/SKILL.md`
- `.agents/skills/dsh-plugin-rebuild/scripts/rebuild-reinstall-restart.mjs`
- `AGENTS.md`
- `docs/modules/plugin-integration-delivery.md`
- `packages/dsh-data-analysis/skills/dsh-data-analysis-report/SKILL.md`

## 已固定的最小展示契约

事实入口为 [contracts/types.ts](../../packages/dsh-data-analysis/src/presentation/contracts/types.ts) 与[契约测试](../../packages/dsh-data-analysis/tests/presentation-s0/contracts.test.ts)，详细字段与数值规则见 [S0 最小展示契约](marivo-analytics-presentation-s0-contracts.md)。契约只包含展示字段，不复制 Marivo schema、能力目录或语义 registry。

| 结构 | 固定职责 |
| --- | --- |
| `PresentationDraft` | `schemaVersion: 1`、标题、dataset 声明、精确 source refs、有序 blocks；Artifact 指向来源，computed 指向 Workspace 内纯数据文件 |
| `PresentationDocument` | Workspace/build ID、生成时间、已恢复 typed datasets、已取得来源快照与定位诊断 |
| `TypedDataset` | 列 ID/显示名/类型/nullable/可选单位、纯值行、总行数、行限制与截断标记 |
| `SourceRef` / `SourceSnapshot` | owning Session + ArtifactRef + 可选 FindingRef；公开事实或明确 unavailable，不保存推断的历史定义 |
| `PresentationReceipt` | `kind: marivo.presentation`、Workspace/build ID、标题/摘要、`presentation.json` 与 `index.html` 的精确路径、SHA-256、字节数 |

DSH Session/Turn 归属由 Host delivery envelope 承担，不混入文件身份。build ID 标识本次完整文件组，不是长期 report ID、revision、latest 或持久 operation 索引。

预算为：draft 256 KiB、单 dataset 2 MiB、document 4 MiB、HTML 8 MiB；最多 16 datasets、64 columns、5,000 rows、100,000 cells、64 sources、64 blocks，单段文本 32,768 字符。非法结构、引用、预算和数值以 `PresentationContractError` 返回 `code`、字段路径及修复提示。

`int64` 和 `decimal` 使用精确字符串；`date` 使用 ISO 日期；`datetime` 带明确时区。`null` 保留缺失含义。精确绘图拒绝不可安全转为 JS number 的值，近似绘图需要显式 `numericMode: approximate`；表格仍保留原始精确文本。metric 用列与明确 `rowIndex` 定位一个已有值，不默认取首行或求和。

## 固定样例与期望值

[fixtures](../../packages/dsh-data-analysis/tests/presentation-s0/fixtures/) 包含三个 document、对应 Artifact/computed draft、computed typed dataset、[期望值](../../packages/dsh-data-analysis/tests/presentation-s0/fixtures/expected.json)及[真实 Runtime 快照](../../packages/dsh-data-analysis/tests/presentation-s0/fixtures/artifact.runtime-snapshot.json)。快照去除了本机临时路径，保留实际引用、公开结果和执行边界证据。

| 样例 | 数据与来源 | 固定期望 |
| --- | --- | --- |
| [Artifact document](../../packages/dsh-data-analysis/tests/presentation-s0/fixtures/artifact.document.json) | 从实际 persisted Artifact 恢复的 `region`、`revenue` | `A → 12.5`、`B → 8.25`、`C → null`；总 4 行、保留 3 行、已截断 |
| [computed document](../../packages/dsh-data-analysis/tests/presentation-s0/fixtures/computed.document.json) | 纯数据；两个真实 Artifact 声明来源与一个实际不可恢复来源 | Decimal `12345678901234.5678` / `0.1000`、int64 `9007199254740993`、int64 上下界、null；总 5 行、保留 3 行 |
| [source-only document](../../packages/dsh-data-analysis/tests/presentation-s0/fixtures/source-only.document.json) | 没有 dataset，保留精确 unavailable 来源与解释 | `datasets.length === 0`；不伪造 metric 或表格数据 |

固定样例的 Session 为 `sess_b8826bb02a1e4da22572b38b`。主 Artifact 为 `art_131d63e9328690a9903ba484`，Finding 为 `fnd_dad7ce96e4a20d043c758b99`；第二 Artifact 为 `art_f9f0db95c4d8ec143c2b9570`，Finding 为 `fnd_ac9a23e52811f2dbc6ec0392`。它们来自同一次隔离 Workspace 的实际 `session.observe`，不是手写 Artifact metadata。

快照中的主 Artifact 公开事实包括：`kind=metric_frame`、`evidenceStatus=complete`、`findingCount=5`、`nullRate=0.25`、`sampleSize=4`、4 项检查、0 项失败、2 项 warning；issues 为 `sample_size_low` 和 `null_rate_high`。这些状态属于该 Artifact，不作为 computed 输出的质量状态。

## bound Runtime 的实际恢复读取

实现入口为 [runtime.ts](../../packages/dsh-data-analysis/scripts/presentation-s0/runtime.ts)、[生成程序](../../packages/dsh-data-analysis/scripts/presentation-s0/runtime-generate.py)和[公开读取程序](../../packages/dsh-data-analysis/scripts/presentation-s0/runtime-read.py)。生成阶段在临时 Workspace 使用进程内 DuckDB 数据，经公开 `session.observe` 持久化三个 Artifact；生成进程关闭后，输入内存数据库已经不存在。

恢复阶段在不同进程执行 `mv.session.resume(..., use_datasources=False)`、`session.artifact`、`artifact.contract`、`artifact.to_pandas`、`artifact.finding` 和 `finding.render`。程序核对 owning Session、Artifact/Finding identity、公开列顺序、总行数与实际行数；用公开 `md.credential_scope` 安装拒绝 resolver，并监视意外 `observe` / `revalidate` 调用。

已观察到并断言：

- 三次 Artifact 恢复均在新进程完成，`observe=0`、`revalidate=0`、`credentialResolve=0`。
- 第二 Artifact 的独立 BIGINT metric 保留 `int64`；首值 `9007199254740993` 按字符串完整传输。
- 不存在的 `art_000000000000000000000000` 由公开 API 抛出 `ArtifactNotFoundError`。source-only 请求返回 unavailable；直接 dataset 请求以 exit code 70 明确失败，没有新 observe 或补查询。
- `use_datasources=False` 仍读取当前 Workspace 的 semantic/datasource 声明，以恢复 Catalog；它不意味着跳过定义文件。有效声明是恢复前提，本次恢复不建立数据源连接，也不索取凭据。
- 当前程序未取得 persisted Artifact 对应的历史 metric 定义，来源快照明确标为 unavailable；未调用 revalidation，也没有用当前定义冒充历史口径。

机器证据保留在本机临时验证目录，不将 SQLite、Parquet、大型 bundle 或完整临时 Workspace 放入仓库：

| 用途 | 证据文件 |
| --- | --- |
| 固定 fixture 的原始读取记录 | `/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-presentation-s0-runtime-dKGkFT/runtime-evidence.json` |
| 最终脚本重复运行，包含直接缺失 dataset 失败断言 | `/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-presentation-s0-runtime-xlZMNQ/runtime-evidence.json` |

每次复跑产生新的临时 Workspace/Session；fixture 固定的是一次已记录的结果快照，不要求后续运行复用该 Session ID。

### 已确认的上游数值限制

实际输入 `DECIMAL(20,4)` 的 `12345678901234.5678`，在当前 Marivo 0.5.4 的 observation 输出已为 `float64` 值 `12345678901234.568`；混合 Decimal/BIGINT 的多 metric Artifact 中，输入整数 `9007199254740993` 也已成为 `float64` 值 `9007199254740992`。独立 BIGINT metric 则仍保留精确 int64，不能泛化为所有 Artifact 都丢失大整数精度。

该变化发生在展示读取之前。S0 保留 [precision probe 期望值](../../packages/dsh-data-analysis/tests/presentation-s0/fixtures/expected.json)，契约测试拒绝其中不安全的 `float64` 整数，不把它重新标记为精确 `decimal` / `int64`。computed fixture 独立证明精确文本编码；本阶段没有修改 Marivo 或补造原值。

## Harness dispatch 与受控文件读取

[Host 探针](../../packages/dsh-data-analysis/scripts/presentation-s0/host.ts)使用实际安装的 Harness `AgentLoop`、`ToolRuntime`、worker `CodeRuntime` 和 `JsonlSessionPersistence`。模型侧使用 deterministic scripted adapter；这里证明实际 Host dispatch / 持久化接缝，不宣称真实 LLM 自动路由验收。

| 模式 | 实际经过的接缝 | 已通过断言 |
| --- | --- | --- |
| Native | `tool/call` → `tool/result` 的 presentation metadata | 同一 receipt 两个 Turn，flush/load 后事件一致 |
| both | Host 同时具备 Native/Code 能力，本用例选择 Native 调用 | 两个 Turn 均持久保存同一种 receipt |
| Code-only | 实际 worker `run_code` → nested Tool → `tools/code-dispatch-log` | 两次真实 `tool/code-dispatch`；用户代码丢弃 nested 返回值，receipt 仍持久化 |

三种模式均核对 Session/Turn 归属、重复全量事件重放去重、错误 Session 不显示，以及 headless 文本包含标题、摘要、Workspace/build ID、两文件精确路径/digest/字节数。Code 用例只输出完成标记，未手工向 Session 插入最终卡片。

[只读文件接缝](../../packages/dsh-data-analysis/scripts/presentation-s0/files.ts)固定 RPC `/marivo-presentation-s0`，只接受 Workspace ID、build ID、固定 asset 名与 receipt digest。文件位置由 Host Workspace 推导，不接收任意路径。已通过正确字节读取，以及 caller path、目录穿越、未知 Workspace/build、缺失文件、digest 改变、文件/父目录 symlink、超大文件、Workspace 变化与取消的拒绝测试。

文件检查拒绝已观测到的身份与字节变化。Node `fs` 没有 `openat`，本阶段不据此宣称已提供抵御敌对进程瞬时替换再恢复目录的完整文件系统沙箱。

Web 联合验证保留 `host-evidence.json`、`receipts.json` 和三份实际 `session.jsonl`，路径见下节。Native/both 各记录 44 个事件，Code 记录 48 个事件；每种模式均保留两个 Turn 的 receipt，Code 包含两条实际 dispatch 事件。

## Web 与 portable 构建

当前 [S0 构建入口](../../packages/dsh-data-analysis/scripts/presentation-s0/build.ts)使用同一 [reader 源码](../../packages/dsh-data-analysis/scripts/presentation-s0/reader.tsx)。Host bundle 只将 `react`、`react-dom`、`react/jsx-runtime` 作为 external，打包 Recharts 及其余依赖；portable bundle 将 React/Recharts 一并打包，不依赖 Host module loader。纯 contracts 可进入 browser，输入白名单拒绝 Node/凭据模块。

这是 S0 的独立构建探针，生产 `scripts/build-client.mjs` 的切换仍属于 S3。已验证的接线选择是移除该入口的全局 `packages: external`，改为仅外置 Host 的 React/React DOM，普通图表依赖直接 bundle；将纯 contracts 加入本地输入白名单，Node/凭据模块仍拒绝进入 browser。双入口不代表两套 renderer。

Recharts `3.8.1`、React DOM / React Is `18.3.1` 与 Playwright `1.63.0` 本阶段固定为开发依赖；没有新增 Markdown 或文档框架。构建根据实际 metafile 保留捆绑依赖的 LICENSE/NOTICE，HTML 内保存非执行的 `third-party-notices` JSON，Host JS 保存对应注释；`victory-vendor@37.3.6` 的 npm 包缺少根许可证，使用[固定上游许可证副本](../../packages/dsh-data-analysis/scripts/presentation-s0/third-party/victory-vendor-37.3.6-LICENSE.txt)，并在 notice 中记录精确版本来源。生产分发切换与依赖归属在 S3/S5 接入时再验证。

[Web 验证程序](../../packages/dsh-data-analysis/scripts/presentation-s0/web.ts)通过实际 DSH CLI 启动独立 `DSH_HOME` / Web profile，并由真实 `WorkspaceRegistry.create` 登记临时 Workspace。临时插件通过 `shell.overlay`、sidebar slot、真实 module loader 和 `/api` RPC 打开三个文件快照。验证正常经过首次启动说明和“稍后配置”，没有填写 API Key 或创建真实模型请求。两个自有 DSH 进程均在验证结束后关闭；没有重装或重启用户现有 profile。

Chrome `152.0.7977.77` 中已通过：

- `__DSH_BOOT__` 含临时插件，`__ModuleLoader__.mode === live`，reader 复用 Host React `18.3.1`；两份 bundle 的 metafile 均指向同一 `reader.tsx`，Host 无第二份 React，portable 无 external imports。
- Artifact 的 line、computed 的 bar 在实际 overlay 中呈现；表格单元格、单位、null、截断、Artifact/Finding 身份和 unavailable 原因可核对。
- 三次实际浏览器下载的 SHA-256 均等于 receipt，随后以 `file://` 在新的断网 browser context 打开；每份文档的非文件网络请求为 0，内嵌 JSON 与 `presentation.json` 深度相等。
- 三份文件禁用 JavaScript 后仍有正文、metric 标签/精确值/单位、必要表格与来源；打印 media 使用 fallback。所有页面的 `pageerror` 为 0。Web 与离线截图已实际查看。

S0 验证了资源和数据接缝；只读 Markdown 目前按安全纯文本显示。完整 Markdown、排序/分页、系列显隐、窄屏/键盘/主题/tooltip 的产品验收仍属于 S3。生产 receipt 卡片和正式 present 的一次目录提交仍属于 S4；本次 Web 通过验证入口按钮打开已生成文件，不冒充生产卡片旅程。

## 最终机器证据

本次 Web 验证目录为 `/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-presentation-s0-web-wtdm5R/`；保留隔离 profile、普通文件和截图，进程已停止。

| 文件 | 实际证明的内容 |
| --- | --- |
| `web-evidence.json` | 真实 DSH boot roster、browser/React identity、三种文档的下载/离线/无脚本/打印检查 |
| `receipts.json` | 三次构建的 Workspace/build ID、两份文件路径/字节数/digest |
| `bundle-evidence.json` | esbuild 实际输入与 external 列表；共享 reader、Host 无第二份 React、portable 无 Host 依赖 |
| `host-evidence.json`、`dispatch/sessions/*/.../session.jsonl` | Native/both/Code 的实际持久事件、Turn 归属、去重与 headless 文本 |
| `artifact-web.png`、`computed-web.png`、`source-only-web.png` | DSH overlay 的实际呈现 |
| `artifact-offline.png`、`computed-offline.png`、`source-only-offline.png` | 实际下载文件在断网浏览器的呈现 |
| `s0-artifact.html`、`s0-computed.html`、`s0-source-only.html` | 浏览器实际下载并核对 digest 的文件 |
| `web-host.log` | 只属于本次验证的 CLI 启动地址；不能单独作为验收结果 |

最终验证 Workspace 为 `2574c053-1b51-4bab-a02d-d1adb4502663`。Host JS 为 418,325 bytes，portable JS 为 522,129 bytes；两者数据解释共用源码，依赖选择以记录的 esbuild metafile 为准。

## 复现与检查记录

要求 Node.js 24+、已安装的 Google Chrome，并具备已有的可绑定 Marivo Runtime。以下命令从仓库根目录运行；Runtime 命令使用默认 shared Python，也可通过 `DSH_DATA_ANALYSIS_PYTHON` 显式指定已有解释器，不自动安装或 fallback。

```sh
npm run validate:presentation-s0:runtime
npm run validate:presentation-s0:web
npm run test:presentation-s0
```

全仓 `npm run check` 已通过，包括 Biome、依赖树、source/scripts TypeScript 与测试；`npm run build`、`npm run verify:plugin-package`、真实 Runtime 与 Web 验证也已通过。最终测试数及证据文件见下方检查表。

S0 四类接缝证据齐全，可以退出本阶段。恢复探针对固定四行 Artifact 调用 `to_pandas()` 后截断；这不证明 S2 已实现大数据的有界读取。后续仍需 S1 执行准入、S2 生产投影/helper、S3 完整 reader/构建、S4 正式 present 接线、S5 删除旧公共面与真实 Agent 旅程；本记录不提前替它们验收。

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 通过；175 tests，0 failed、0 skipped，其中 22 项 S0 测试 |
| `npm run build` | 通过；生产入口保持既有注册面 |
| `npm run verify:plugin-package` | 通过；101 files，572,753 unpacked bytes，23 个 DSH peers；这是未发布开发包，不是目标 MVP 安装验收 |
| `npm run validate:presentation-s0:runtime` | 通过；新进程恢复、来源失败、数值限制与零凭据调用 |
| `npm run validate:presentation-s0:web` | 通过；三种文档的真实 DSH 打开/下载、断网、无脚本与打印 fallback |
| 文档与 whitespace | 本次涉及文档的本地链接存在，`git diff --check` 通过 |
