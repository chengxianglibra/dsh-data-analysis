# 统一分析 UI P0 验收

日期：2026-10-28。范围：[实施计划 P0](../designs/unified-analysis-ui-implementation.md#p0确认三个关键接缝)。只修改本插件；未安装 Intelligent UI，未替换用户 Runtime 或重启用户 Host。P1–P3 尚未交付，`marivo_present` 仍使用原 Draft 输入。

## 固定身份与入口

| 项目 | 实际身份 |
| --- | --- |
| Node.js | 22.19.0 |
| Harness | npm `@deepseek-ai/dsh@0.2.1-rc.2`，位于本仓库 `node_modules/@deepseek-ai/dsh`；直接 DSH 开发依赖同版，37 个 peers 的最低范围为 `>=0.2.1-rc.2` |
| OpenUI | `lang-core` / `react-lang` 1.0.1；`react-ui` / `react-headless` 0.18.1，均为直接固定依赖 |
| React / Zod | 共用 Host React 18.3.1；Zod 4.4.3 与 Harness 对齐，避免跨次版本类型比较膨胀及不兼容 |
| Catalog | `dsh-data-analysis/analysis-ui/v1`；build 由同一声明生成，见 `analysis-catalog.ts` |
| Marivo wheel | `/Users/lichengxiang/source/oss/marivo/dist/pypi/marivo-0.6.0.dev0-py3-none-any.whl` |
| wheel SHA-256 | `6ddc5a3dd8bc45b356936dab206c30a6373a8a0cde9f9eca77e635ea79b8c777` |
| 实际解释器 | `/private/tmp/dsh-unified-ui-p0-runtime/bin/python`，Python 3.14.4 |
| 实际包 | `/private/tmp/dsh-unified-ui-p0-runtime/lib/python3.14/site-packages/marivo/__init__.py`，distribution `0.6.0.dev0`，`direct_url.json` 指向上述 wheel |

复现入口：

```sh
npm run generate:analysis-catalog
npm run test:unified-analysis-ui
DSH_DATA_ANALYSIS_PYTHON=/absolute/runtime/bin/python \
  DSH_DATA_ANALYSIS_MARIVO_WHEEL=/absolute/dist/pypi/marivo.whl \
  npm run validate:unified-analysis-ui:runtime
DSH_DATA_ANALYSIS_PYTHON=/absolute/runtime/bin/python \
  npm run validate:unified-analysis-ui:web
```

Web 入口启动隔离 profile，输出带认证参数的临时 URL；浏览器待 Session 同步就绪后打开该 Session，再通过验证客户端 `__p0.call("start")` 启动。观察 preparing 前缀后调用 `release`，它会核验两次真实工具结果均成功；`__p0.tab()` 打开同一 Catalog 样例。关闭时终止该脚本／临时 Host。它使用脚本化 LLM adapter，**没有调用真实模型**；Lang 经过真实 AgentLoop、Web 传输、Tool view 和 PTC worker。探针工具只存在于隔离验证 wrapper，不注册到生产插件。

## 结果与证据边界

| 探针 | 结果 |
| --- | --- |
| 八组件及 Host/Client 一致性 | 通过；官方 `extend` 移除其余组件并重绑 Stack/Card/TabItem，官方 `createLibrary` 设置插件身份并允许领域组件为 root；Host 只导入生成数据及 lang-core/Zod |
| 父 slot 与支持范围 | Frame/Dataset 均可作 root 或进入 Stack/Card/TabItem；Tabs 仅接受 TabItem；root/嵌套 Button、非组件子项、错误父 slot、未支持图形均拒绝 |
| 官方 patch | 同一样例一次新增 note、替换 intro、移除 root 中 tabs 引用并删除 tabs；`mergeStatements` 后完整样例通过准入 |
| 安装 Runtime | 真实 observe/persist；移除 DuckDB 文件且令语义模型加载失败后，在另一 Python 进程 resume/persisted_frame；schema 与两页 read_page 各 1 行，total=2、has_more=true/false，保留完整轴键、layout、read_stats |
| 精度与 SQL 公开字段 | Frame 和 raw_sql 均保留 Decimal `12345678901234.5678`、整数 `9007199254740993`、NULL；SQL columns/types/rows、returned_row_count=2、datasource selector、backend、SQL、reason、warnings、timeout、duration 可读；未使用 RawSqlResult.to_pandas 推断类型 |
| Native | 真实 preparing `PartialArguments.textPrefix("program", 100000)` 返回 83 字符的未结束 program，浏览器已显示“正文已到达”；后续完整 program 为 372 字符，Native 结果成功 |
| PTC | 真实 `tool/ptc-dispatch-start`（seq 24）与 `tool/ptc-dispatch`（seq 25），归属 `p0-code:ptc:1`；start 已携带完整 program，结果成功；没有子调用生成期前缀 |
| 浏览器 | Ego Lite，1920×975；tool view 与右侧 tab 使用同一 library，Frame/Dataset 明确为占位；切换“数据/说明”成功，无空白页或框架错误覆盖层。Renderer 无非空错误；CDP Runtime/Log 事件缓冲未见错误 |

临时证据（不作为分发文件）：

- Runtime：`/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-unified-ui-p0-nVioJi/runtime-evidence.json`。
- Host：`/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-unified-ui-p0-web-3prSaX/` 中的 `host-events.json`、`browser-evidence.json`、`installed-package.json`、`host.log`。
- 截图：`/tmp/dsh-p0-native-prefix.png`、`/tmp/dsh-p0-tool-and-tab.png`。

## 接缝差异与后续范围

- rc.1 只有原始参数前缀 Hook；本轮需要的 `PartialArguments.textPrefix` 不存在，故提高 Harness 基线。0.2.1 只接受 `native` / `ptc`，已同步探针的模式切换、JSONL plugin 命名导入、显式 Peer、workingDirectory 与 Tool block fixtures。
- 固定 OpenUI 的 parser 对已注册组件的单一 `$ref` slot 身份和部分嵌套 view 对象校验不足；本插件从生成 schema 检查 slot 身份，并以同一 JSON Schema 经 Zod 校验静态 props。没有手写另一份组件关系表。这不是 P2 的资源准入或完整文档提交校验。
- `RawSqlResult.datasource` 是公开 lookup selector，`str()` 不是 canonical ID；探针只记录实际值。P1 应保留原查询绑定及公开来源，不解析 repr 推断身份。
- 当前旧 projection 及旧 S0 read 仍调用已移除的 `evidence_digest()`。新 Frame Reader 在 P1 迁移，不将旧投影称为已兼容本轮 wheel。RawSqlResult 的 `to_pandas` 注释仍称 bounded，而实际 raw_sql 完整加载返回集；未改上游。
- `presentation-delivery.md` 的 Document/Receipt 版本描述已修正为 v3/v2，旧 `both` 模式说明同步为 native/ptc。参考仓库的 `scriptPublications` / `providerPublications`、旧 tab 注释差异仍仅是原设计的历史记录，未修改相邻仓库。
- P0 不证明真实模型选择 UI 的策略、SQL 快照捕获、统一文档保存/恢复、正式 marivo_present 双位置流式交付；这些分别属于 P1–P3。未做移动端或多浏览器验收。Image 只验证了省略 src 的空资源样例，合法附件绑定与图片读取在 P2 接通。

## 仓库检查

`npm run check`（quality、依赖身份、全部 TypeScript 与测试）、`npm run build`、`npm run verify:plugin-package`、文档相对链接检查及 `git diff --check` 均通过。标准 check 共 690 项测试：686 通过、4 跳过、0 失败；四项需显式 Runtime／长任务配置的既有可选测试跳过；P0 的安装 Runtime 与真实 Host 探针已按上述入口独立执行。包验证为 325 个分发文件、37 个 DSH peers，Host 不依赖 React。检查日志保留在 `/tmp/dsh-p0-check.log`、`/tmp/dsh-p0-build.log`、`/tmp/dsh-p0-package.log`。未推送或发布。
