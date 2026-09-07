# @chengxianglibra/dsh-data-analysis

由个人维护的 DeepSeek Harness 社区插件，并非 DeepSeek 官方发行或维护的软件包。

DeepSeek Harness 的 Marivo 集成插件。当前包提供：

- 精确 Marivo 0.5.4 共享 Runtime 与 zero-init per-Workspace binding；
- `marivo_help` 实时公共 Help transport；
- 侧栏“语义层”对象浏览器：Workspace 分类搜索、只读详情与局部关系图；
- `marivo_datasource_test` 的 DSH Credentials 收集与显式 connection test；
- `marivo_python` 的本次执行准入与单次 resolver 凭证注入；
- 侧栏“数据源与凭证”管理、测试与缺失输入提交后的原调用续接；
- `marivo_evidence_sources({ session_id, sources })` 的可移植 Artifact-owned Finding 来源交付；
- `dsh_data_analysis_presentation.write_dataset(frame, path)` 的 computed typed JSON writer；
- 内部 Artifact/computed/source-only 数据投影，保存精确来源及 unavailable 状态。

当前为展示重构 S2 的未发布开发状态。旧 report-kit、report Skill 与三个经典 JS 资产已删除；
reader、`marivo_present` 与新 presentation Skill 分别在 S3–S5 接入。两个 Marivo Runtime Skill 继续挂载。

## Compatibility

包内 `dshDataAnalysisCompatibility` 是唯一运行时兼容声明：

- DSH distribution 与所有必需 peer 精确使用 `0.1.1-rc.2`；
- Runtime 通过 pip 安装已发布的 Marivo 0.5.4；版本约束为 `marivo[duckdb,trino,clickhouse]==0.5.4`；
- 项目自有 Runtime marker 为 `dsh-data-analysis-runtime/v3`；
- 子进程策略为 `direct-argv-inherited-env-snapshot-overlay-v2`。

管理员解释器的 `marivo.__version__` 与 package identity 必须精确匹配；不使用 capability/version matrix。

## Tool contracts

```text
marivo_help({ targets: string[] })
marivo_datasource_test({ name: string })
marivo_python({ code: string, datasources: string[] })
marivo_evidence_sources({
  session_id: string,
  sources: Array<{ artifact_ref: string, finding_id: string }>
})
```

`marivo_datasource_test` 只拥有缺失 Credentials 的 DSH/Web 闭环和显式连接测试；
`marivo_python` 在本次调用内等待全部数据源凭证就绪、核验身份并取得 fresh snapshot，再通过 DSH 前台
执行服务与 Marivo 公开 resolver 启动一次代码。配置齐全时不额外测试；普通 Shell 不获得凭证。
缺失输入时默认等待 Web 表单，提交测试成功后继续原调用；取消、轮换或 Workspace 变化终止旧准备，
已启动代码失败不重放。无 Web 场景配置 `credentialInteraction: 'none'`，subagent 同样不等待表单。
详见[凭证模块](../../docs/modules/datasource-credentials.md)。`md.inspect(...)`、
Session recovery、Artifact revalidation、Quality、Evidence 读取、Session Graph 与 `to_pandas()` 都直接使用
Marivo 公共 API，不增加 convenience Tool。

## 语义层对象浏览器

点击 DSH 侧栏底部“语义层”，选择 Workspace 查看对象。可按业务域和类型筛选，搜索名称、引用与业务定义，
复制对象引用、查看定义位置，并在对象关系中逐层浏览。桌面采用三栏布局，窄屏支持列表与详情切换。

页面不要求 live Agent，只读取 Marivo Catalog 元数据，不执行 `observe`、数据预览或连接测试。
打开和手动刷新重新加载；读取失败时明确标注上次成功内容。数据源连接配置、凭证值与原始源码不展示。
使用及验收边界见[模块说明](../../docs/modules/semantic-browser.md)。

## 展示数据

Python helper 只接受 pandas DataFrame，写入 `schemaVersion: 1` 的 typed JSON；int64/Decimal 保留精确字符串，
null 保留缺失含义，datetime 必须带时区。它不保存来源或转换代码；来源在展示 Draft 中声明。
固定 projection 从同一 bound Workspace 恢复 persisted Artifact 和可选 Finding，不自动 observe、revalidate 或读取凭据。
直接 Artifact dataset 缺必要数据会失败，computed 和 source-only 可以保留 unavailable 来源。

S2 不提供生产展示 Tool 或 reader。当前实现与验收见[展示数据投影](../../docs/modules/presentation-projection.md)
和[S2 验收记录](../../docs/plan/marivo-analytics-presentation-s2-acceptance.md)。

## 验证

```bash
npm run check
npm run build
npm run verify:plugin-package
```

当前架构与验收边界见仓库根目录的[总体架构](../../docs/architecture.md)、
[插件能力优化设计](../../docs/plan/plugin-capability-optimization-design.md)和
[v2 验收记录](../../docs/acceptance/plugin-capability-optimization-v2.md)。

## 语义对象引用

在 Web 输入框输入 `@` 选择当前 Workspace 的 Marivo 对象；多词检索使用 `@"monthly revenue"`。
选中后显示完整 `kind:path`，提交只携带精确 ref。最近七个自然日热度保存在 DSH profile；候选缓存为 30 秒。
对象有效性由执行时 Marivo Catalog 验证，删除对象不会被相似对象自动替换。
