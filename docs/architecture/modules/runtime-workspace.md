# Runtime 与 Workspace 模块架构

## 作用

本模块解决两个不同层级的问题：在一个 DSH Web profile 内提供一套可复用的 Marivo 安装，并为
每个 Agent 所在 Workspace 建立独立的 zero-init binding 与 Environment。它只准备运行条件，不拥有
Marivo 项目语义和分析状态。

总体关系见[总体架构](../README.md)。实现集中在：

- `packages/dsh-data-analysis/src/environment/runtime.ts`
- `packages/dsh-data-analysis/src/environment/workspace.ts`
- `packages/dsh-data-analysis/src/environment/types.ts`

## 组件与职责

| 组件 | 职责 |
| --- | --- |
| `ensureSharedMarivoRuntime()` | 验证、复用或安装一套 profile 级 Runtime |
| `SharedMarivoRuntime` | 暴露已验证的 Runtime root、Python、Marivo、package 与 Skill 身份 |
| `MarivoWorkspaceEnvironmentManager` | 按 canonical project root 缓存 binding Promise，不创建 Workspace 文件 |

## 共享 Runtime 生命周期

默认 Runtime 位于：

```text
$DSH_HOME/dsh-data-analysis/runtimes/marivo/
├── .venv/
├── skills/
│   ├── marivo-analysis/
│   ├── marivo-semantic/
│   └── marivo-service/  # only when supplied by the bound package
└── installation.json
```

`installation.json` 使用 `dsh-data-analysis-runtime/v5`，记录实际 `marivoVersion`、`pythonExecutable`、`packagePath` 和 `skillsRoot`。它是安装完成标记，不替代 Marivo 项目 manifest。

启动时先读取 marker 并验证：

1. Python 文件存在且可执行；
2. Python 实际导入的 Marivo 版本与 marker 一致；
3. `marivo.__file__` 与记录的 package path 一致；
4. Marivo 版本严格等于 `0.6.4`；
5. Marivo distribution 版本、实际导入位置以及公开 `persist_dataframe` / `read_dataframe` / Frame ref 能力一致，且 distribution 没有 pip direct URL 安装记录；
6. `marivo-analysis` 和 `marivo-semantic` 的 `SKILL.md` 均存在；若绑定包提供
   `marivo-service`，也同步并验证它。每个 Skill 的 frontmatter `name` 与目录名精确一致。

验证通过则直接复用，不在每次启动时联网升级。验证失败后进入安装锁，在锁内再次检查以避免并发
重复安装；仍无有效 Runtime 时，将旧目录移动为 `.invalid-*` 诊断备份并创建新安装。

compatibility manifest 固定版本和 pip 安装规格；Runtime 验证版本与导入身份，不记录或校验下载文件的摘要。
插件不再安装独立 presentation-kit。

### 安装模式

| 模式 | 输入 | 行为 |
| --- | --- | --- |
| 插件管理 | 未配置 `pythonExecutable` | 使用本机 Python 3.10+ 的 `-m venv` 创建 `.venv`，通过 venv Python 的 `-m pip` 从配置的包索引安装固定版本及 duckdb/trino/clickhouse extras |
| 管理员提供 | 绝对 `pythonExecutable` | 不创建 venv；验证精确版本、导入身份、没有 direct URL 安装记录及 pandas，随后同步 Skill 和发布 marker |

两种模式都要求通过 pip 安装精确的 Marivo 0.6.4；marker 记录版本与 package identity。其他版本或 schema
不匹配的 Runtime 都视为无效安装，不读取或迁移其 marker；插件管理模式会先保留 `.invalid-*` 诊断备份再重新安装，
管理员解释器则明确失败。普通 Workspace 或 Session 启动不会仅为追逐新版本联网升级。

默认使用 PATH 中的 `python3`（Windows 为 `python`），不下载 Python，也不回退到其他解释器。
可用绝对路径 `bootstrapPythonExecutable`、环境变量 `DSH_DATA_ANALYSIS_BOOTSTRAP_PYTHON`
或 CLI `--bootstrap-python` 指定创建 venv 的 Python；它不同于只验证的 `pythonExecutable`。
原 `uvExecutable`、`DSH_DATA_ANALYSIS_UV` 与 `--uv` 配置不再使用。
Python 必须支持 `venv`/`ensurepip`；缺失或版本不符时明确失败。已有有效 Runtime 继续复用。
开发时的内部 Python 展示适配器验证使用 uv；终端用户安装不需要。

### DuckDB 文件依赖

安装规格 `marivo[duckdb,trino,clickhouse]==0.6.4` 显式包含 DuckDB extra，由 Marivo 的
`ibis-framework[duckdb]` 依赖提供后端。Runtime probe 同时导入 `ibis.backends.duckdb`，
防止缺少该后端的环境通过复用校验；管理员环境缺失时给出包含 extra 的修复命令，不自动安装。

CSV、JSON、Parquet 使用 DuckDB 读取；`.xlsx` 使用 DuckDB 官方 `excel` 扩展，首次使用按
DuckDB 原生规则下载与加载，不作为 Python extra 或插件启动时的联网安装步骤。
文件流程不承诺支持 `.xls`。

### 并发与发布

Runtime 安装锁位于 `<runtimeRoot>.install-lock`。锁记录 PID 和开始时间；只有超过超时且 owner 已不
存活时才会回收 stale lock。Skill 先复制到 staging 并完整验证，再以 rename 替换；marker 通过临时
文件写入并原子 rename，避免半完成安装被当成可复用 Runtime。

## Workspace 解析与 zero-init binding

插件按以下优先级选择 project root：

1. Cordis `config.projectRoot`
2. `DSH_DATA_ANALYSIS_PROJECT_ROOT`
3. `agent.session.header.cwd`
4. `DSH_CWD`
5. 当前进程工作目录

默认行为让不同 Session、fork 或进程内 subagent 使用自己的 Workspace。显式全局 project root
会使所有 Agent 指向同一 Workspace，因此只适合管理员有意固定项目的场景。

首次 resolve 时，manager 只接受已存在目录并执行 `realpath`，以 canonical path 作为 cache key。模块不创建
`marivo.toml`、`models/`、`.marivo/`、Workspace `.venv`，也不向任何 Agent Skill 目录写链接。缺少 manifest
时，Marivo 0.6.4 doctor 的 `project.marivo_toml=info` 可通过 admission；显式存在但无效的 manifest 仍在其他
写入前 fail closed。后续 datasource authoring 或 Session 操作按需创建的文件归 Marivo 对应操作所有，不能把
“插件 install 零写入”解释为“分析永不写入”。

`marivo_python` 通过 `project: "none" | "required"` 明确项目意图，省略为 `none`。普通文件分析无需准备项目；Marivo 项目分析、持久化、非空 datasources 或 resultVariables 使用 required。插件不解析 Python 源码猜测项目需求。

required 在凭据准入前调用内部项目准备适配：固定 canonical Workspace root，以 `lstat` 检查该目录本身的 `marivo.toml`，不继承父项目；符号链接和非普通文件明确拒绝。缺少时在按 root 协调的插件内锁中复查，再通过绑定 Runtime 的公开 CLI init 初始化，不使用 `--force`、不手写 manifest。CLI 创建脚手架与上游 Skill 链接；随后经同一 bound Environment 的公开 doctor 验证根目录 manifest 和 Runtime identity。Python 的初始化写入与用户代码遵循同次调用的 Harness Shell/sandbox policy、取消与超时限制。

成功回执的 `project` 区分 `created` 与 `already-ready`。初始化中断或失败后检查实际 manifest，返回不确定状态与修复说明，不自动删除半成品或重复 init。锁只协调本插件请求，不承诺与外部编辑器或 CLI 的跨进程事务。交互式 datasource configure 同样是明确的项目准备入口，沿用其固定 authoring policy；test、安装、Help 和 binding 不因此创建项目。

## 隔离模型

| 范围 | 共享内容 | 隔离内容 |
| --- | --- | --- |
| Web profile | Python、Marivo package、内置 Skill 副本 | — |
| Workspace | 共享 Runtime 引用 | project root、manifest、models、state、doctor admission、binding fingerprint |
| Agent | 解析同 Workspace 时可复用 binding Promise | Help 可见性、Skill 激活、Tool 生命周期 |

manager 只在进程内缓存 Promise；binding rejection 会删除失败 Promise，后续 resolve 可以重新尝试相同配置与身份。成功 binding 不会被失败重试静默替换 Runtime；同进程 import identity 漂移仍使该 Environment 永久失败。

## 失败边界

- 非绝对 Runtime、Python 或显式 `bootstrapPythonExecutable` 配置直接拒绝。
- 无效 marker 被视为不可复用安装，不从不完整字段猜测身份。
- project root 不存在或显式 manifest 无效只使该 Workspace resolve 失败，不改写已有用户文件。
- Runtime 级安装或 Skill 校验失败会阻止插件启动，因为所有 Workspace 都依赖同一安装。
- 模块不解释 `marivo.toml` 的业务内容；语义校验由后续真实 `marivo doctor` 负责。

## 公共接口与验证

公共导出位于 `packages/dsh-data-analysis/src/environment/index.ts`。关键测试分别覆盖 Runtime 复用、
锁与 marker、Workspace 零写入、路径 identity、共享 Runtime/多 Workspace 集成：

```text
packages/dsh-data-analysis/tests/runtime-workspace/shared-runtime.test.ts
packages/dsh-data-analysis/tests/runtime-workspace/workspace.test.ts
```

`npm run test:runtime-workspace` 执行确定性测试；`npm run validate:runtime-workspace:real` 使用仓库真实
安装来源创建隔离 managed Runtime 与两个 Workspace，验证安装 marker、Skill 同步、Runtime 复用和项目隔离。

## 当前安装来源

managed Runtime 通过所选 Python 执行 `-m pip install --force-reinstall 'marivo[duckdb,trino,clickhouse]==0.6.4'`。
pip 默认使用 PyPI，也遵循本机配置的包索引；构建和安装均不读取邻近 checkout。probe 核验
distribution/module 版本、实际 import path、公开能力和 pip `direct_url.json` 不存在，以拒绝带 direct URL
记录的 URL、本地 wheel 或 editable 安装。该检查不证明具体包索引或下载文件摘要。版本或能力不符明确失败；
管理员 Python 只验证，不自动修改，修复命令使用相同的 pip 安装规格。

## 正式版安装与升级

启动复用同一版本的有效 marker；不匹配时 managed 模式保留旧目录并通过 pip 重建，
管理员模式报错并给出明确修复命令。测试使用隔离 Runtime，不删除用户安装、Workspace 或旧 Store。
新版本使用所属 Store generation，不自动迁移历史 Session/Artifact。
内部展示 codec 合同由 `tests/runtime-workspace/projection-contracts.test.ts` 纳入持续检查，
不构建或分发单独的 Python helper wheel。
