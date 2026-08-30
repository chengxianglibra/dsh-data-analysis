# Evidence 按需来源模块架构

## 作用

本模块只在用户明确要求来源、出处、审计或 provenance 时，把 Marivo 已持久化的精确 `Finding` 来源附加到
当前 DSH Turn。Agent 调用：

```text
marivo_evidence_sources({ session_id, finding_ids })
```

普通分析不调用该工具，也不显示角标、Footnotes、来源卡片或固定证据附录。Web 从标准 Session 历史恢复
本轮成功附加的来源，并在 closing answer 下方显示默认折叠的“数据来源”面板。

来源只回答“这些精确事实来自哪些 Marivo Evidence Finding”。它不判断自然语言是否被 Finding 蕴含，
不验证计算或业务判断，也不提高或重定义 Marivo 的 quality/epistemic 语义。

总体关系见[总体架构](../architecture.md)。实现集中在：

- `packages/dsh-data-analysis/src/evidence/sources.ts`
- `packages/dsh-data-analysis/src/evidence/bridge.ts`
- `packages/dsh-data-analysis/src/client.tsx`

Marivo Finding 的内容与有效性契约由
[Marivo Evidence access surface](../../../marivo/docs/specs/analysis/evidence-access-surface.md) 拥有；本模块只读取
公共对象并投影按需来源。

## 读取与返回契约

一次调用接受一个非空 Marivo Session ID 和 1–20 个非空、唯一 Finding ID。`MarivoEvidenceBridge`
拥有固定 Python program 和闭合 parser，并通过 Environment checked runner 先复核 Python、Marivo
version 和 package identity，再执行：

```python
session = mv.session.resume(session_id, use_datasources=False)
finding = session.evidence.finding(finding_id)
finding.render(language="en")
finding.render(language="zh")
```

模型只提供作为 direct argv 传入的 Session/Finding ID，不提供 Python 表达式、模块名或 shell 文本。返回
payload 必须保持请求 Session、Finding ID 和顺序完全一致，且每个 Finding 自身的 `session_id` 必须一致。
任一读取、进程、identity 或 shape 校验失败时整个 Tool call 失败，不产生部分来源。

成功值包含：

- 双语 `Finding.render()` 事实陈述；
- Finding、Artifact 和 Marivo Session ID；
- `finding_type`、`epistemic_kind`、`quality_status` 和提交时间；
- canonical item、extractor/schema version 和 Environment fingerprint。

工具不再接受 `language`，也不签发 handle、marker 或 definition；没有 Session registry 或跨调用编号状态。
`finding_type`、`epistemic_kind` 和 `quality_status` 的词汇仍由已校验的 Marivo Finding 拥有，插件不复制枚举。

## 标准历史投影

顶层 Native Tool 成功后，`tool/result.meta` 写入闭合的 `marivo-evidence-sources` v1：

```text
kind + version + dshSessionId + sources
```

`sources` 只包含本次调用请求的 Finding，不携带历史 registry。Code Mode nested call 因 Harness 不保留
`presentationMeta`，插件使用 `tools/code-dispatch-log` 在耐久日志副本中追加同一 meta 的
`marivo-evidence-sources-card` ContentBlock；它不改变程序值、模型文本或原 Tool result。

Web Conversation Definition 从 `turn/start` 开始折叠同轮 `tool/call`、Native `tool/result` 和 Code Mode
`tool/code-dispatch`。只有工具名、成功状态、闭合 meta 和 Turn 归属都有效时才记录 delivery。closing answer
只读取其 seq 之前完成的 delivery，并按 Environment fingerprint、Marivo Session、Finding ID 去重。

旧 `marivo-evidence-citations` v2 metadata 不再投影 Turn-tail 卡片。历史回答中已保存的 Markdown 角标与
Footnotes 仍由 DSH Markdown renderer 原样显示，但插件不再重复来源 UI。

## 动态 Prompt 规则

短规则仅在 `marivo-analysis` 已激活后加入 system prompt：

- 不因回答包含 Finding、数字、表格或关键事实而默认调用来源工具；
- 仅在用户明确要求来源、出处、引用、审计或 provenance 时调用；
- 调用后不复述受支持事实及其数值或文本，也不把 Finding 陈述、机器 ID、角标、Footnotes 或来源附录复制进最终回答；
- 不在正文宣布 Tool 调用、描述来源面板、说明查看位置或重复标准 Evidence 机制；纯来源请求只保留一句“来源详情已附上”式简短确认；
- 没有精确 Finding 时披露无支持边界，不伪造来源；
- 普通回答只保留影响解释的口径、质量、时效和限制，不生成无实质内容的固定说明；
- 来源身份不等于验证整句话、计算或业务判断。

## Web 来源面板

来源面板默认折叠，摘要只显示分析结果数和 Evidence Finding 数。展开后按 Environment、Marivo Session、
Artifact 分组，第一层显示每组 Finding 数、原始 quality 状态，以及仅在组内一致时显示的提交时间。

每组的二级“审计详情”才显示按 Web locale 选择的事实陈述，以及 Finding/Artifact/Session ID、canonical
item、epistemic、extractor/schema 和 Environment fingerprint。Artifact 分组只减少视觉重复，不推断
Finding 等价性、兼容性或可信等级。

工具失败、metadata 非法或本轮没有成功来源调用时 selector 返回空，不显示面板，也不猜测或恢复部分来源。
Headless/CLI 仍可阅读标准 Tool result，但不新增正文来源附录。

## 明确非目标

- 不截获、重构或重写 DSH 最终回答；
- 不从回答文本推断引用关系；
- 不做自然语言 entailment、数字一致性或业务结论验证；
- 不判断 `to_pandas` 的用途；
- 不引入插件自有 Evidence、质量枚举或可信等级；
- 不改变 HTML 报告的来源入口和 canonical provenance。

## 验证入口

```sh
npm run test:evidence-sources
npm run validate:evidence-sources:real
npm run check
npm run build
npm run verify:plugin-package
```

测试覆盖 Tool 边界、批次原子性、Native/Code Mode 耐久投影、Turn/seq 隔离、重复来源去重、旧 v2 忽略、
Artifact 分组、双语面板、零 UI selector 和现有报告/凭证视图并存。
