# Evidence 来源交付模块

## 作用

本模块把用户明确选择的 Marivo Artifact-owned Finding 投影为所有 client 可读的 Tool transcript，并在 Web
以同一 closed result 增强为折叠来源面板。它只拥有跨 DSH Turn/client 的交付，不是 Evidence 分析读取 API，也不判断 Finding 是否蕴含
Agent 的句子、计算或建议。

## Tool contract

```text
marivo_evidence_sources({
  session_id,
  sources: [
    { artifact_ref, finding_id }
  ]
})
```

`sources` 必须包含 1–20 个唯一精确 pair；每个字段是有界非空字符串。不接受 `finding_ids`、
`artifact_id` alias、Session-wide Finding lookup 或其他输入版本。

## Bridge 流程

```mermaid
sequenceDiagram
  participant A as Agent
  participant T as marivo_evidence_sources
  participant B as MarivoEvidenceBridge
  participant M as Marivo public API
  participant D as DSH Turn/Web
  A->>T: session_id + exact Artifact/Finding pairs
  T->>B: checked read
  B->>M: session.resume(..., use_datasources=False)
  loop each pair
    B->>M: session.artifact(artifact_ref)
    B->>M: artifact.finding(finding_id)
    B->>B: verify Session and Artifact ownership; project public revalidation
  end
  B-->>T: bounded faithful projection
  T-->>D: Tool result meta / durable Code block
```

Bridge 使用当前 binding 的 checked runner。找不到精确 Artifact/Finding 时返回 `missing`；读取到的 Finding
仍必须精确属于请求 Session/Artifact，identity mismatch fail closed。它不回退到 Session-wide 搜索，不尝试
compatibility、自动组合或替代 Finding。

## 输出与 Web 投影

每个 source 保留：

- Environment fingerprint；
- Session ID、Artifact ref、Finding ID；
- `available`、`missing` 或 `unsupported` 状态；
- 有界人类可读 title、精确 locator 与最多 4096 UTF-8 bytes 的 excerpt；
- Finding/epistemic kind、canonical item、commit time 与公开 `source_refs`；
- `truncated` 标志和公开 `session.revalidate(artifact_ref)` 状态；无法取得时明确 `unavailable`。

输出字段使用 `artifactRef`，不保留旧 `artifactId` alias。Tool text 是权威交付，包含每个来源及“来源 identity
不证明整个结论正确”的边界。Native 成功结果把同一结构化值附在本 Turn；Code Mode 子调用把相同 meta 放到
durable `marivo-evidence-sources-card`。Web 严格解析 v2 closed shape、去重 identity，按 Environment + Session +
Artifact 分组并默认折叠。未知 metadata version 安全忽略，不重放 v1。

## 调用策略

只在用户明确请求来源、出处、citation、provenance 或审计时调用。普通含数字、表格或 Finding 的回答不
自动调用。若没有精确持久化 Finding，应说明 unsupported boundary，不能制造来源。

成功投影只证明来源 identity：

- 不证明整句话、计算、图表或业务判断正确；
- headless、remote 或不识别 metadata 的 client 仍可仅凭 Tool transcript 完整回答来源问题；
- Web 不重新读取 Evidence，也不产生第二套事实；
- 不要求 HTML 报告调用该 Tool。

## 验证

```bash
npm run test:evidence-sources
npm run validate:evidence-sources:real
```

确定性测试覆盖输入闭合、pair identity/order、跨 Artifact fail-closed、missing/unsupported/truncated/
revalidation、headless transcript、Code Mode durable metadata 和 Web progressive enhancement。真实 runner 必须
使用精确支持的 Marivo 0.5.3 及真实 Agent；版本或 identity 不匹配时应
记录为发布阻断，而不是沿用旧 Session Evidence namespace。
