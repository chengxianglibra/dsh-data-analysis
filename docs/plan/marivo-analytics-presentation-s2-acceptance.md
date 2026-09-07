# Marivo 分析展示 S2 验收记录

## 结论与范围

2026-09-07，[路线图 S2](marivo-analytics-presentation-roadmap.md#s2数据投影与最小-python-帮助库)已完成。
Artifact、computed、source-only 三类输入可生成校验过的纯数据文档；新 Python helper 已接入 wheel 构建、
Runtime 安装与每次 checked execution 的身份核验。旧 report-kit、report Skill、经典 JS 和旧 transport 合同同步删除。

Marivo 仍拥有分析数据及语义，Harness 仍拥有 Runtime/Workspace 与生命周期；插件只负责展示编码和来源投影。
computed 的来源是 Draft 中的作者声明，不要求转换分类、转换代码、复算或证明。

本阶段没有生产 reader、离线 HTML builder、`marivo_present` 或新 presentation Skill；这些分别属于 S3–S5。
旧 Evidence Tool/交付协议仍保留至 S4。当前是未发布开发状态，本次没有向现有用户 profile 重装或发布插件。

## 代码与删除范围

以下路径相对 `packages/dsh-data-analysis/`，另行注明的除外。

| 范围 | 实际结果 |
| --- | --- |
| `src/presentation/contracts/` | 复用 S0 纯数据契约，补齐 Python/JavaScript 日历、时钟、offset 和 Unicode 一致性 |
| `src/presentation/projection/` | 新增固定公开读取程序、受限 Workspace 文件读取、`MarivoPresentationProjection` |
| `python/presentation-kit/` | 新增 `write_dataset`、内部共享编码器、46 项 Python 回归、相同 fixtures emitter 和 wheel verifier |
| `src/environment/`、`src/compatibility.ts` | Runtime marker v3、唯一新 wheel 安装路径、module/distribution/version 检查、shared binding/helper fingerprint 与执行前复核 |
| `src/plugin.ts` | 删除报告 prompt 和随包报告 Skill 挂载；继续挂载两个 Runtime Skill，保留 Harness 自有及 Workspace Skill 覆盖 |
| 包清单、根脚本和 `scripts/verify-plugin-package.mjs` | 仅分发新 helper wheel，校验 compiled contracts/projection，删除旧命令与无消费者的直接 Ajv 依赖 |
| 测试与真实脚本 | 新增 projection/surface，替换 report-kit 合同测试，扩展 Runtime 验证；新增真实 Artifact 和 Chromium 验证入口 |
| 删除 | `python/report-kit/` 已跟踪源码、旧 build script、`report-contracts/`、report Skill 及三个 JS、旧 assets/形态测试 |

旧 helper 的既有本地虚拟环境、构建缓存和用户文件未主动清理；根 `.gitignore` 保持 Python 构建缓存忽略规则。
它们不属于新包内容，也不参与新 Runtime 安装、测试或路由。
开始时已有 S1、凭据文档、AGENTS 和 rebuild 工作；实现期间 S1 由并行任务提交为 `2e2cf51`，本阶段基于当前文件继续，
未回退这些工作。现有 report Skill 中的改动随本阶段授权的旧 Skill 删除退出。

## 数据与失败边界

直接 Artifact dataset 从同一 bound Workspace 的 owning Session 恢复；核验 Session、Artifact、可选 Finding、
Artifact 所属 project root、公开字段顺序、完整行数及声明列/行预算。必要来源或数据缺失时明确失败。
可选 Finding 无法恢复时，Artifact 来源保留 available，Finding 单独标 unavailable；身份不同直接失败。

来源只保存公开读取事实：读取时间、内容身份、公开语义引用、Quality/issues 与 Finding excerpt。
历史 metric 定义无法从公开契约取得时明确 unavailable，不以当前定义代替，不自动 revalidate。
固定读取程序使用 `resume(use_datasources=False)` 并安装拒绝凭据读取的 resolver；上游异常原文不进入诊断。

computed 从 Workspace 内有界读取 typed JSON；支持零到多个声明来源和 unavailable。source-only 保持 `datasets: []`。
文件读取先限制原始字节，再严格解码 UTF-8/JSON；拒绝 traversal、symlink、目录、FIFO、超限和并发身份变化。
取消或失败 binding 不继续读取，不把 subprocess stderr 中的 canary 传到结果。

`write_dataset(frame, path, *, row_limit=5000)` 只接受 pandas DataFrame，原子写 JSON，返回路径/字节数/行数/截断 receipt。
int64 与 Decimal 使用精确字符串，Decimal 尾零保留；NaN/NA/NaT 按缺失值写 null，无限值和不安全 float 整数失败。
datetime 要求显式 offset，拒绝无效日历、24 点时钟、超过微秒的精度；字符串保留完整 Unicode，拒绝孤立 surrogate。
行和单元格预算决定有效 limit，文本或总字节超限明确失败，不缩短单元格。

## 实际运行身份

| 项目 | 实际值 |
| --- | --- |
| 本仓库验收基线 | `2e2cf51`，包含当前 S2 工作区改动 |
| sibling Marivo checkout | `e936a3433e2bfaae9db6c54423cd65b0a0310826`；已有 lazy-analysis 设计文档改动，未修改 |
| sibling Harness checkout | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`；检查时无改动 |
| Node.js / DSH peers | `24.18.0` / `0.1.1-rc.2` |
| 隔离安装 | Marivo `0.5.4`、Python `3.10.20`、presentation-kit `1.0.0` |
| Python module | `dsh_data_analysis_presentation`，唯一 wheel `dsh_data_analysis_presentation_kit-1.0.0-py3-none-any.whl` |
| 浏览器 | 本机 Chrome `152.0.7977.77`，Playwright，offline context |

checker 分别核验 checkout 与实际安装，未把 sibling 源码当作 Runtime 安装证据。
managed Runtime 在独立临时根首次安装并复用；administrator 模式指定同一已安装 Python，另外验证空 venv 缺包、
模块遮蔽、版本及 public import 失败，不执行修复安装或解释器 fallback。
shared checked execution 在 Workspace cwd 再核验 helper；同名模块遮蔽返回 identity failure 并使 binding 失败。

最终 helper 安装文件与 wheel 内四个文件逐一哈希相等，`_dataset.py` SHA-256 为
`e291dcb39d513a0fc30f617d2da0d7071f3eeed8fefd52ea06403f8f474f6f6e`。
wheel 重新打包可能改变 ZIP 容器 digest，因此此处以内部文件字节一致性连接实际安装与最终包验证。

## 真实 Artifact 与 computed 证据

验证先在隔离 Workspace 通过公开 `session.observe` 创建 persisted Artifacts，然后关闭生成进程。
输入 DuckDB 为进程内数据库；恢复过程不依赖原数据连接。使用最终 helper wheel 的 7 个恢复进程，
每个均断言并记录 `observe=0`、`revalidate=0`、`credentialResolve=0`。

本次 Session 为 `sess_fa269ebbc4f7ed167abeee56`，主要 Artifact 为
`art_d305f79631f803948546a8e9`，int64 Artifact 为 `art_1429dea908e0d1b48d71aada`。
这些身份由真实生成程序返回，没有人工编写 metadata 代替持久化读取。

| 用例 | 实际结果 |
| --- | --- |
| 直接 revenue Artifact | `region/revenue`；`A → 12.5`、`B → 8.25`、`C → null`；完整 4 行，写入 3 行，truncated |
| 独立 int64 Artifact | 保留 `9007199254740993`、`9007199254740995`、`9007199254740997`、`9007199254740999` |
| computed writer → projection | Decimal `12345678901234.5678` / `0.1000`，int64 `9007199254740993` / signed upper bound；带时区微秒时间、日期、boolean、null；3 行写入 2 行 |
| 多来源 | 两个 available Artifact 与一个实际不存在的 unavailable Artifact；computed 原值保持不变 |
| source-only | 保留三项来源，`datasets: []` |
| 缺 Finding | Artifact available，Finding unavailable 诊断明确 |
| 缺直接 Artifact / 不安全 float | 分别以 `artifact_data_unavailable` / `numeric_precision` 失败 |

## 检查与机器证据

- `npm run check` 通过，包含 Python 合同持续检查；随后新增边缘回归分别复验，最终 Runtime 24、projection 13、S0 contracts 23 项通过。
- Python 最终 46 项通过；wheel metadata、文件清单、public import 和来源字节校验通过。
- `npm run build`、`npm run verify:plugin-package` 通过；实际 tarball 101 个文件，23 个 DSH peers，只有新 Python wheel；旧 Skill/JS/schema/wheel 被显式排除。
- 最终 TypeScript source/scripts、Biome 和 `git diff --check` 通过。
- Chromium offline 读取 Python emitter 生成的三份 typed JSON，逐值对比 Node 的解析、列、行数与格式化值；没有页面脚本错误。此项是 S2 数据解释证据，不是 S3 reader 验收。

大型 Runtime、数据库、wheel 与证据留在本机临时隔离目录，不加入仓库：

| 证据 | 本机文件 |
| --- | --- |
| 首次 managed 安装与复用 | `/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-runtime-workspace-nAJXYv/evidence.json` |
| 最终 Runtime / administrator / shadow 验证 | `/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-runtime-workspace-rtiMkp/evidence.json` |
| 安装与最终 helper 内容一致性 | `/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-runtime-workspace-pQQsYw/helper-wheel-identity.json` |
| 最终 persisted Artifact / computed / source-only | `/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-presentation-s2-real-awYRmC/projection-evidence.json` |
| 最终 Node/Chromium 数据一致性 | `/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-presentation-s2-browser-IZwmmY/browser-evidence.json` |
| check / build / package 输出 | `/tmp/dsh-s2-check.log`、`/tmp/dsh-s2-build.log`、`/tmp/dsh-s2-package.log` |

模块入口与可重复执行命令见[展示数据投影](../modules/presentation-projection.md)。

## 限制与后续边界

- Marivo 当前公开 `to_pandas()` 不接受 row limit，会先物化全量 DataFrame；展示输出有界不等于上游读取内存有界。
- public float64 已丢失的 Decimal/整数位不能恢复；投影拒绝不安全整值 float，不虚构精确编码。
- 当前 Artifact schema 不提供展示 unit/label 或历史 metric 定义；使用公开字段名和实际 terminal 值，缺少的历史定义明确 unavailable。
- reader、离线 HTML、present receipt/RPC、Native/Code/Web/真实 Agent 自动路由尚未在生产入口实现，仍按 S3–S5 验收。

以上限制没有通过新增 observe、凭据读取、旧格式 fallback 或 computed 转换要求绕过。
