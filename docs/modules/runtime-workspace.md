# Runtime 与 Workspace 模块架构

## 作用

本模块解决两个不同层级的问题：在一个 DSH Web profile 内提供一套可复用的 Marivo 安装，并为
每个 Agent 所在 Workspace 建立独立的最小项目布局与 Environment。它只准备运行条件，不拥有
Marivo 项目语义和分析状态。

总体关系见[总体架构](../architecture.md)。实现集中在：

- `packages/dsh-data-analysis/src/environment/runtime.ts`
- `packages/dsh-data-analysis/src/environment/workspace.ts`
- `packages/dsh-data-analysis/src/environment/types.ts`

## 组件与职责

| 组件 | 职责 |
| --- | --- |
| `ensureSharedMarivoRuntime()` | 验证、复用或安装一套 profile 级 Runtime |
| `SharedMarivoRuntime` | 暴露已验证的 Runtime root、Python、Marivo、report-kit、package 与 Skill 身份 |
| `initializeMarivoWorkspace()` | 幂等创建最小 `marivo.toml`、`models/` 和 `.marivo/` |
| `MarivoWorkspaceEnvironmentManager` | 按 canonical project root 缓存初始化与 binding Promise |

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

`installation.json` 记录实际 `marivoVersion`、`pythonExecutable`、`packagePath`、`reportKitVersion`、
`reportKitPackagePath` 和 `skillsRoot`。它是安装完成标记，不替代 Marivo 项目 manifest。

启动时先读取 marker，再验证：

1. Python 文件存在且可执行；
2. Python 实际导入的 Marivo 版本与 marker 一致；
3. `marivo.__file__` 与记录的 package path 一致；
4. Marivo 版本严格等于 `0.5.2`；
5. report-kit 版本、package path、公开 `emit_dataset` / `emit_session_trace` 与 pandas 范围一致；
6. 两个内置 Skill 的 `SKILL.md` 均存在。

验证通过则直接复用，不在每次启动时联网升级。验证失败后进入安装锁，在锁内再次检查以避免并发
重复安装；仍无有效 Runtime 时，将旧目录移动为 `.invalid-*` 诊断备份并创建新安装。

### 安装模式

| 模式 | 输入 | 行为 |
| --- | --- | --- |
| 插件管理 | 未配置 `pythonExecutable` | 使用 `uv` 准备 Python 3.10+、创建 `.venv`，安装精确 Marivo 与随包 report-kit wheel |
| 管理员提供 | 绝对 `pythonExecutable` | 不创建 venv；验证该解释器已提供精确 Marivo、report-kit 与 pandas，随后同步 Skill 和发布 marker |

两种模式都只支持已经正式发布的 Marivo 0.5.2；发布 marker 后按该版本稳定复用。任何版本或 schema
不匹配的 Runtime 都视为无效安装，不读取或迁移其 marker；插件管理模式会先保留 `.invalid-*` 诊断备份再重新安装，
管理员解释器则明确失败。普通 Workspace 或 Session 启动不会仅为追逐新版本联网升级。

### 并发与发布

Runtime 安装锁位于 `<runtimeRoot>.install-lock`。锁记录 PID 和开始时间；只有超过超时且 owner 已不
存活时才会回收 stale lock。Skill 先复制到 staging 并完整验证，再以 rename 替换；marker 通过临时
文件写入并原子 rename，避免半完成安装被当成可复用 Runtime。

## Workspace 解析与初始化

插件按以下优先级选择 project root：

1. Cordis `config.projectRoot`
2. `DSH_DATA_ANALYSIS_PROJECT_ROOT`
3. `agent.session.header.cwd`
4. `DSH_CWD`
5. 当前进程工作目录

默认行为让不同 Session、fork 或进程内 subagent 使用自己的 Workspace。显式全局 project root
会使所有 Agent 指向同一 Workspace，因此只适合管理员有意固定项目的场景。

首次 resolve 时，manager 对 project root 执行 `realpath`，以 canonical path 作为 cache key。启用
`initializeWorkspace` 时，它只补齐：

```text
<workspace>/
├── marivo.toml
├── models/
└── .marivo/
```

最小 manifest 仅包含基于目录名的 `[project].name`。已有文件不覆盖；manifest 必须是可读文件，
`models/` 和 `.marivo/` 必须是目录。模块不会创建 Workspace `.venv`，也不会向 `.dsh/skills`、
`.agents/skills`、`.claude/skills` 或 `.codex/skills` 写链接。

## 隔离模型

| 范围 | 共享内容 | 隔离内容 |
| --- | --- | --- |
| Web profile | Python、Marivo package、report-kit、内置 Skill 副本 | — |
| Workspace | 共享 Runtime 引用 | project root、manifest、models、state、doctor admission、binding fingerprint |
| Agent | 解析同 Workspace 时可复用 binding Promise | Help 可见性、Skill 激活、Tool 生命周期 |

manager 只在进程内缓存 Promise。初始化或 binding rejection 也保留在该 key 上，防止一次运行中静默
切换身份；显式重建 plugin/manager 才会重新解析。

## 失败边界

- 非绝对 Runtime、Python 或显式 `uvExecutable` 配置直接拒绝。
- 无效 marker 被视为不可复用安装，不从不完整字段猜测身份。
- Workspace 文件/目录冲突只使该 Workspace resolve 失败，不改写已有用户文件。
- Runtime 级安装或 Skill 校验失败会阻止插件启动，因为所有 Workspace 都依赖同一安装。
- 模块不解释 `marivo.toml` 的业务内容；语义校验由后续真实 `marivo doctor` 负责。

## 公共接口与验证

公共导出位于 `packages/dsh-data-analysis/src/environment/index.ts`。关键测试分别覆盖 Runtime 复用、
锁与 marker、Workspace 幂等初始化、路径 identity、共享 Runtime/多 Workspace 集成：

```text
packages/dsh-data-analysis/tests/runtime-workspace/shared-runtime.test.ts
packages/dsh-data-analysis/tests/runtime-workspace/workspace.test.ts
```

`npm run test:runtime-workspace` 执行确定性测试；`npm run validate:runtime-workspace:real` 使用仓库真实
Marivo Python 创建临时 Runtime 和两个 Workspace，验证安装 marker、Skill 同步、Runtime 复用和项目隔离。
