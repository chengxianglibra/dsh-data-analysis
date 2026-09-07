# 展示数据投影

## 责任与入口

S2 将已存在的数据和声明来源投影为 reader 可消费的纯数据。Marivo 拥有 Artifact、Finding、字段、Quality、
issues 与语义引用；Harness 拥有 Workspace 和 Runtime identity。插件不审查 computed 转换、不复算，
也不把来源存在解释为计算正确性。

实现入口为 [contracts](../../packages/dsh-data-analysis/src/presentation/contracts/index.ts)、
[projection](../../packages/dsh-data-analysis/src/presentation/projection/index.ts)和
[Python writer](../../packages/dsh-data-analysis/python/presentation-kit/src/dsh_data_analysis_presentation/_dataset.py)。
五项结构、数值编码和预算以 [S0 契约记录](../plan/marivo-analytics-presentation-s0-contracts.md)为准。
这些是内部展示接口；S3 的[共享 reader 与离线 builder](presentation-reader.md)消费其输出，`marivo_present` 在 S4 注册。

## 数据流程

`MarivoPresentationProjection` 只接受 ready、携带 presentation-kit identity 的 bound runner。
`readDraft(relativePath)` 从绑定 Workspace 有界读取草稿；
`project(draft, { workspaceId, buildId, generatedAt?, signal? })` 返回校验过的 `PresentationDocument`。
Workspace/build identity 由 Host 提供，Draft 不允许自行填写生成文档的来源事实。

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

## Python helper 与 Runtime

`dsh_data_analysis_presentation.write_dataset(frame, path, *, row_limit=5000)` 只接受 pandas DataFrame，
原子写入 computed typed JSON，并返回路径、字节数、完整/写入行数和截断信息的有界 receipt。
writer 不接收来源或转换说明；来源只写在 Draft。
行和单元格预算确定实际 limit，超出字节预算明确失败；空结果保留列，未指定的展示标签使用列名。

新 wheel 为 `dsh_data_analysis_presentation_kit-1.0.0-py3-none-any.whl`，只依赖 pandas。
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
该 Chromium 验证只证明 Python/Node/browser 数据解释一致；reader/离线 HTML 另由 S3 验证，Host 交付留在 S4/S5。
本次结果见 [S2 验收记录](../plan/marivo-analytics-presentation-s2-acceptance.md)。
