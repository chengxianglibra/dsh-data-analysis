# Agent 同 Report 更新验收

## 问题与实施范围

此前 `marivo_present` 每次调用都创建新 reportId，Agent 合并 KPI 或修改报告后，原卡片仍解析原 Report。
本次为现有 Tool 增加成对的 `report_id`、`expected_build_id`，以完整 Draft 发布同一 Report 的新 Build。
缺省调用仍新建 Report。实现复用 Workspace 绑定、projection、不可变 Build、current 指针及锁内版本比较，
不新增上游 Marivo／Harness 契约或另一套 latest 状态。

Tool 投影前检查目标与 expected build，发布时再次检查。用户或另一 Agent 抢先保存后返回
`report-save-conflict`，不覆盖其内容、不回退新建。Agent 指引要求读取当前保存内容并合并需保留的编辑，
完整 Draft 不自动保留省略内容。

行为与责任见[展示交付](../modules/presentation-delivery.md#agent-更新契约)、
[展示 Skill](../modules/presentation-skill.md)和[架构](../architecture.md#一次展示交付)。

## 回归证据

[报告更新测试](../../packages/dsh-data-analysis/tests/presentation-integration/report-update.test.ts)通过生产
Tool、computed projection、builder、发布服务、文件 RPC 服务与 delivery model 覆盖：

- 连续合并 KPI、修改数据和标题保持同一 reportId，各 Build 有独立身份与精确数据。
- current 指向本次成功发布 receipt；最初 JSON／HTML 字节不变；原卡片重开读取新 Build。
- 缺省调用创建独立 Report；单边参数、null、非法身份、缺失目标、异 Workspace、过期版本在投影前失败。
- UI 在 Agent 投影期间保存成功后，锁内比较拒绝 Agent 发布，保留 UI 保存内容。

上述测试使用 computed 文件和模拟 Runtime identity，不执行 Python，不代表真实模型或浏览器验收。

[隔离 Harness 验证](../../packages/dsh-data-analysis/scripts/validate-presentation-report-update.ts)复用
真实 Marivo 输入准备与实际 Harness AgentLoop／ToolRuntime／事件持久化；Native、both、Code 各运行
5 轮（首次创建、随后更新同 Report），逐轮比较 current 与成功 receipt，最后核验所有历史文件的 bytes／SHA-256。
确定性模型 adapter 从前轮实际 delivery 取 reportId／buildId；这验证 Tool 契约与传输，不验证真实 LLM 自主路由。

```sh
npm run check
npm run build
npm run verify:plugin-package
node --experimental-strip-types packages/dsh-data-analysis/scripts/validate-presentation-report-update.ts
git diff --check
```

脚本使用 `DSH_DATA_ANALYSIS_PYTHON`，未设置时使用现有默认 Marivo Runtime 路径；解释器身份必须通过插件验证，
不自动切换解释器。Workspace、Harness 配置和事件存储均新建于临时目录，不需要外部模型凭据。

## 验证结果

2026-09-08 完成本轮验证：

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 419 项测试全部通过，0 失败／跳过；质量、依赖、source 和 scripts 类型检查通过 |
| 构建 | `check` 的 reader 测试前执行 `npm run build` 并通过；编译后的 Tool 包含新增参数与 current 校验 |
| `npm run verify:plugin-package` | 通过；199 个分发文件、24 个 DSH peer，打包后的 presentation kit／contracts／offline builder 验证通过 |
| Agent 更新回归 | 新增 3 个场景全部通过；含完整 Draft 更新、原卡片重开和 UI 并发冲突 |
| 实际 Harness／Marivo | Marivo 0.5.4；Native、both、Code 各 5 轮，保持各自同一 Report，合计 15 个不可变 Build |
| 持久交付 | 3 种模式的逐轮 current 均匹配实际成功 receipt；Code 更新经过 worker dispatch；所有历史 JSON／HTML 摘要保持一致 |
| Skill 与文档 | frontmatter validator、4 项 Skill 资源／示例契约测试、修改文档的本地链接与锚点检查、`git diff --check` 通过 |
| 独立审查 | 更新实现、Agent 指引与实际 Harness 验证脚本均未发现需修复问题 |

原始隔离证据：

```text
/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-presentation-report-update-NPxUlh/report-update-evidence.json
```

同目录保留 runtime 输入、每种模式的 JSONL 持久事件、`native-evidence.json`、`both-evidence.json` 和
`code-evidence.json`。本轮没有执行新的真实 LLM 或浏览器旅程；旧卡片重开行为由生产 delivery model 与文件服务回归验证。

## 交付边界

历史交付事件不改写；更新轮次仍有自己的真实 Tool receipt，所有同 Report 卡片重开解析同一 current。
已打开 reader、固定 Build 链接和下载后的离线 HTML 保持快照；没有跨窗口实时推送或自动清理历史构建。
宿主 `reports/save` 仍只接受受限呈现编辑，不执行 Agent 或重新投影；Agent 更新使用完整 Draft。
本次不发布包、不修改用户 profile，也不重启用户服务。
