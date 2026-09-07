# 展示交付模块

## 责任与入口

`marivo_present({ draft_path })` 将一次分析展示闭合为两个文件和一个 receipt。
Marivo 拥有分析、Artifact/Finding 与来源事实；Harness 拥有 Session/Turn、Workspace 成员关系和事件存储；
插件拥有固定快照投影、文件完整提交、receipt 与只读打开/下载。

实现为 `src/presentation/{tool,commit,files,receipt,delivery,rpc}.ts`，生产接线在 `plugin.ts`、
`bridges.ts` 和 `client.tsx`；客户端使用 `src/client/presentation/` 的共享 reader 与交付 adapter。
数据契约见[展示投影](presentation-projection.md)，图形和离线行为见[展示 reader](presentation-reader.md)。
Agent 的展示路由、Draft 编写与结果解释见[展示 Skill](presentation-skill.md)；已有数据可直接进入此交付流程。

## 单次调用与文件身份

1. 从 Harness `workspaceRegistry` 的 `sessionIds` 取得唯一当前 Workspace，核对 bound Runtime 的 project root。
2. 有界读取 Workspace 相对 Draft，使用同一个 checked Runtime 公开恢复 Artifact 和来源，读取 computed typed JSON。
3. 生成独立 UUID build ID，调用共享 builder 得到完整 JSON 和自包含 HTML 字节。
4. 在同一 Workspace 的新临时目录写入两个文件并同步，检查归属和目录身份后以一次 rename 提交。
5. 重读校验两份完整文件，再返回 receipt。取消、写入失败或身份变化不会生成成功 receipt；清理仅针对本次拥有的目录。

每次交付的路径固定为：

```text
<workspace>/.dsh-data-analysis/presentations/<buildId>/presentation.json
<workspace>/.dsh-data-analysis/presentations/<buildId>/index.html
```

receipt 保存 Workspace/build 身份、标题、摘要及两份文件的精确路径、SHA-256 和字节数。
重复调用生成独立产物；没有 report ID、revision、latest、CAS、持久 operation 索引或旧协议读取。

## Native、Code 与 headless

纯 `PresentationDelivery` envelope 使用 `kind: "marivo.presentation.delivery"`、`schemaVersion: 1`、
`dshSessionId`、`turn` 和同一个 `PresentationReceipt`。Native/both 使用 Tool metadata；Code 子调用通过
Harness `tools/code-dispatch-log` 写入同一种 durable envelope，即使代码丢弃返回值也保留交付。
登记只保存有界的临时 dispatch 关联，持久事实仍在 Harness 事件中。

客户端要求 Native receipt 对应同一 Turn 的实际 `marivo_present` call；Code 对应同一 Turn 的 root call。
卡片再核对当前 Session，按 Session/Turn/Workspace/build 去重，不解析模型正文或旧 Evidence metadata。
文本输出始终包含摘要、Workspace/build 和两个文件的路径/digest/大小；headless 不依赖 Web 卡片取得产物。

## 只读 RPC 与 reader

trusted-host channel 为 `/marivo-presentation`，唯一 endpoint 为 `files/read`，输入为
`{ sessionId, receipt, asset }`，asset 只能是 `presentation.json` 或 `index.html`。
服务端从当前 Session 的 Harness Workspace 成员关系推导路径；receipt 中的路径只用于一致性核对。

读取拒绝符号链接、非普通文件、越界、超预算和读取期间身份变化，校验 JSON 的 Workspace/build/title 与
receipt，以及请求文件的字节数和 SHA-256。读取结束再核对 Workspace；缺失、变化或 digest 不符明确失败。
RPC 不调用 Python、投影、数据源或凭据，也不接受任意路径。插件卸载会取消读取并移除 RPC。

卡片通过 RPC 加载固定 `PresentationDocument` 到共享 reader overlay；来源展开仅访问文档快照。
下载取得实际 HTML 字节，客户端复核身份、大小和 digest 后生成浏览器下载。切换 Session/Workspace 或关闭
当前读取会取消旧请求，迟到结果不能恢复旧内容。新分析继续通过普通对话开展。

## 验证

```sh
npm run test:presentation-integration
npm run test:plugin-integration-delivery
npm run check
npm run build
npm run verify:plugin-package
npm run validate:presentation-integration:real
```

确定性测试覆盖原子提交、取消、读取预算/路径/摘要、Workspace 变化、统一 receipt 和事件去重；
隔离真实验证覆盖 Native/both/Code、实际 Web 卡片打开/下载与离线文件。实际结果见
[S4 验收记录](../plan/marivo-analytics-presentation-s4-acceptance.md)。展示 Skill 的真实 Agent 自动路由和最终旅程状态见
[S5 验收记录](../plan/marivo-analytics-presentation-s5-acceptance.md)。
