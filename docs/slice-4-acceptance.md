# Slice 4 验收：真实模型与 Counterfactual

状态：通过 MVP contract；未证明相对基线的可靠性增益

日期：2026-08-26

规格来源：[MVP 设计](mvp-design.md#slice-4真实模型验收)

前置验收：[Slice 1](slice-1-acceptance.md)、[Slice 2](slice-2-acceptance.md)、
[Slice 3](slice-3-acceptance.md)

Runner 按需将详细结果写入本地 `artifacts/slice-4-real-model.json`；该文件包含易变的真实模型
输出和本机环境信息，不作为仓库长期证据，也不纳入 Git。

## 独立范围

本 Slice 只增加真实模型验收 runner 和结果，不改变 Slice 1–3 的 runtime contract，也没有增加
planner、cache、target registry 或 API usage checker。

验收使用：

- DeepSeek Harness `deepseek-official` adapter；
- `deepseek-v4-flash`，thinking disabled；
- `~/.dsh/.credentials.yaml` 的 Harness credential provider；
- 当前项目 `.venv/bin/python`；
- editable `../marivo` 源码，版本 `0.4.13.dev0`；
- 当前源码 package path
  `/Users/lichengxiang/source/oss/marivo/marivo/__init__.py`；
- 同一份 `marivo-analysis` Skill 和同一个受限 `bound_python` validation Tool。

runner 不读取、复制或记录 credential value。结果文件权限为 `0600`，敏感值模式扫描通过。

## 开发结果

`npm run validate:slice4:real` 顺序执行六条协议旅程：

1. 已知分析规划任务：先取 `analysis.observe` current help，再用绑定解释器复核 Marivo
   version，并给出包含 current `time_scope` 的最小调用骨架；
2. 多次 help：分两个 model step 请求 `analysis.observe` 和 `analysis.compare`；
3. `targets=[]`：明确声明不需要 Marivo API 信息；
4. invalid target：先让 Marivo 拒绝 `analysis.not_a_real_target`，再由模型从 inventory 自行改为
   `analysis.observe`；
5. missing declaration：以明确标注的 system-level fault injection 让真实模型持续不调用 Tool，
   稳定验收 2 次 steering 后的明确终止；
6. missing datasource credentials：绑定到 `../marivo` project root。该项目 doctor 因
   `MARIVO_CDN_REPLICA_USER` 和 `MARIVO_CDN_REPLICA_PASSWORD` 缺失而整体 `fail`，但
   Environment Binding 仍成立，`datasource` live help 成功。

missing-declaration fault injection 是测试条件，不代表模型在普通 prompt 下自然违反协议。

## 独立审查

验收前审查修正了两处证据边界：

- “已知分析 task”从纯 API 问答改为具体的季度 revenue-by-country 分析规划，要求 current
  `observe` call skeleton 和 live constraint，同时明确不虚构业务数据；
- missing-credential 由一个仅声明不存在的测试变量，改为真实 `../marivo` doctor failure。
  验收脚本一次性确认 doctor 的两个 secret check 为 `fail`；Doctor report 不进入 Environment
  或 artifact，同一 binding 仍成功渲染 raw inventory 和 focused help。

审查还确认：

- 六条 journey 都使用真实 provider usage，而不是 scripted adapter；
- known/multiple journey 的结果正文分别包含 current `observe`/`time_scope` 和
  `observe`/`compare` 事实；
- invalid target 第一次 Tool Result 为 error，Plugin 没有改写 target，第二次由模型明确选择；
- missing declaration 恰好 3 个模型 step、2 次 repair、0 次 help，最终错误码为
  `missing-declaration-limit`；
- help text 只有 bytes/codepoints 是 runtime 精确值；报告中的 `helpTextTokens` 明确标记为估算，
  方法是 `ceil(codepoints / 4)`，没有把它冒充 provider tokenizer 的精确分项；
- provider 的总 input/output/cache usage 为实际返回值；
- 报告不保存 raw help body、完整 environment 或 credential value。

## 六条真实模型验收

| Journey | 结果 | 关键证据 |
| --- | --- | --- |
| known analysis | 通过 | `analysis.observe` success；随后绑定 Python success；3 steps |
| multiple help | 通过 | `analysis.observe`、`analysis.compare` 两次独立 success；3 steps |
| `targets=[]` | 通过 | empty declaration success；2 steps |
| invalid repair | 通过 | invalid error 后 `analysis.observe` success；3 steps |
| missing limit | 通过预期失败 | 2 repairs；`missing-declaration-limit`；3 steps |
| missing credentials | 通过 | doctor overall `fail`；`datasource` help success；2 steps |

这六条全部满足 disclosure protocol。任务完成的判定由固定 marker、Tool/Session 事件、controller
telemetry 和 current-contract 文本断言共同完成，不只依赖模型自报完成。

## Counterfactual

比较范围是同一模型、同一 Skill、同一 Python Tool 下的两项同题任务：known analysis 和
multiple help。

| 指标 | Skill + disclosure + Python | Skill + Python baseline |
| --- | ---: | ---: |
| 完成 | 2/2 | 2/2 |
| 实际读取 current help | 2/2 | 2/2 |
| invalid help | 0 | 0 |
| stale/unsupported signature summary | 0 | 0 |
| retry/repair | 0 | 0 |
| model steps | 6 | 4 |
| billed input tokens | 54,227 | 19,111 |
| output tokens | 893 | 1,104 |
| total tokens | 55,120 | 20,215 |
| wall latency | 19,363 ms | 17,924 ms |

本次单次运行中，协议侧 step 是基线的 `1.50x`，billed input token 是 `2.84x`，总 token 是
`2.73x`，wall latency 是 `1.08x`。延迟是易波动的单次测量，不应外推为稳定性能差异。

两侧在这个最小样本中可靠性相同：均完成 2/2，均读取 current help，没有 invalid、stale 或
repair。协议因此证明了“强制 disclosure 会发生”，但没有证明相对直接 Skill 基线的任务可靠性
提升；它付出了明确的 inventory context 和额外 step 成本。

## 结论

Slice 4 的六条真实模型 contract 和 counterfactual 退出条件均满足，MVP 可以按设计口径验收。

但本次结果不支持继续增加 checkpoint、cache 或 planner。按照 MVP 的停止规则，后续扩展应先有
更广的真实任务样本证明增量可靠性，或继续验证 Marivo 精简 discovery index 的实际收益；不能把
“协议执行成功”解释成“产品方向已经证明”。
