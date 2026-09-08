# Runtime 与 Workspace 模块架构

## 作用

本模块解决两个不同层级的问题：在一个 DSH Web profile 内提供一套可复用的 Marivo 安装，并为
每个 Agent 所在 Workspace 建立独立的 zero-init binding 与 Environment。它只准备运行条件，不拥有
Marivo 项目语义和分析状态。

总体关系见[总体架构](../architecture.md)。实现集中在：

- `packages/dsh-data-analysis/src/environment/runtime.ts`
- `packages/dsh-data-analysis/src/environment/workspace.ts`
- `packages/dsh-data-analysis/src/environment/types.ts`

## 组件与职责

| 组件 | 职责 |
| --- | --- |
| `ensureSharedMarivoRuntime()` | 验证、复用或安装一套 profile 级 Runtime |
| `SharedMarivoRuntime` | 暴露已验证的 Runtime root、Python、Marivo、presentation-kit、package 与 Skill 身份 |
| `MarivoWorkspaceEnvironmentManager` | 按 canonical project root 缓存 binding Promise，不创建 Workspace 文件 |

## 共享 Runtime 生命周期

默认 Runtime 位于：

```text
$DSH_HOME/dsh-data-analysis/runtimes/marivo/
├── .venv/
├── skills/
│   ├── marivo-analysis/
│   └── marivo-semantic/
└── installation.json
```

`installation.json` 使用 `dsh-data-analysis-runtime/v3`，记录实际 `marivoVersion`、`pythonExecutable`、`packagePath`、`presentationKitVersion`、
`presentationKitPackagePath` 和 `skillsRoot`。它是安装完成标记，不替代 Marivo 项目 manifest。

启动时先读取 marker 并验证：

1. Python 文件存在且可执行；
2. Python 实际导入的 Marivo 版本与 marker 一致；
3. `marivo.__file__` 与记录的 package path 一致；
4. Marivo 版本严格等于 `0.5.4`；
5. presentation-kit 版本、package path、distribution metadata、实际模块位置与公开 `write_dataset` 与 pandas 范围一致；
6. 两个内置 Skill 的 `SKILL.md` 均存在，frontmatter `name` 与目录名精确一致。

验证通过则直接复用，不在每次启动时联网升级。验证失败后进入安装锁，在锁内再次检查以避免并发
重复安装；仍无有效 Runtime 时，将旧目录移动为 `.invalid-*` 诊断备份并创建新安装。

当前 presentation-kit 精确版本为 `1.1.0`，包括 `write_dataset(..., labels=..., dataset_id=...)`。
helper 的 API 或实现变化必须同步提升 Python distribution、模块版本和插件的 Runtime 版本约束，
并更新随包 wheel 与分发校验；不能用同一个版本号发布不同实现。npm 插件重装与会话状态清理不会
刷新已通过版本检查的 shared Runtime。旧 `1.0.0` marker 会触发上述重建流程，新版随后直接复用；
管理员解释器的旧 helper 则返回明确的版本错误与修复命令，不自动修改解释器。

### 安装模式

| 模式 | 输入 | 行为 |
| --- | --- | --- |
| 插件管理 | 未配置 `pythonExecutable` | 使用 `uv` 准备 Python 3.10+、创建 `.venv`，安装精确 Marivo 与随包 presentation-kit wheel |
| 管理员提供 | 绝对 `pythonExecutable` | 不创建 venv；验证该解释器已提供精确 Marivo、presentation-kit 与 pandas，随后同步 Skill 和发布 marker |

两种模式都要求通过 pip 安装精确的 Marivo 0.5.4；marker 记录版本与 package identity。其他版本或 schema
不匹配的 Runtime 都视为无效安装，不读取或迁移其 marker；插件管理模式会先保留 `.invalid-*` 诊断备份再重新安装，
管理员解释器则明确失败。普通 Workspace 或 Session 启动不会仅为追逐新版本联网升级。

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
时，Marivo 0.5.4 doctor 的 `project.marivo_toml=info` 可通过 admission；显式存在但无效的 manifest 仍在其他
写入前 fail closed。后续 datasource authoring 或 Session 操作按需创建的文件归 Marivo 对应操作所有，不能把
“插件 install 零写入”解释为“分析永不写入”。

## 隔离模型

| 范围 | 共享内容 | 隔离内容 |
| --- | --- | --- |
| Web profile | Python、Marivo package、presentation-kit、内置 Skill 副本 | — |
| Workspace | 共享 Runtime 引用 | project root、manifest、models、state、doctor admission、binding fingerprint |
| Agent | 解析同 Workspace 时可复用 binding Promise | Help 可见性、Skill 激活、Tool 生命周期 |

manager 只在进程内缓存 Promise。binding rejection 也保留在该 key 上，防止一次运行中静默
切换身份；显式重建 plugin/manager 才会重新解析。

## 失败边界

- 非绝对 Runtime、Python 或显式 `uvExecutable` 配置直接拒绝。
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

开发包不随包分发 Marivo wheel；Compatibility manifest 的 `packageSpec` 是 pip 安装使用的精确版本约束
`marivo[duckdb,trino,clickhouse]==0.5.4`，不使用 editable checkout。管理员 Python 的修复命令同样通过 pip
安装该精确版本。普通 npm build/prepack 不会重新打包或构建 Marivo。

S2 的 Python helper 合同由 `tests/runtime-workspace/presentation-kit-contracts.test.ts` 纳入持续检查，
包括相同 fixtures 的 Python、Node 与 browser 读取。managed 安装失败和 administrator 缺 helper、版本错误、
同名模块遮蔽均明确失败，不切换解释器；真实验证见 [S2 验收记录](../plan/marivo-analytics-presentation-s2-acceptance.md)。
