# 报告编辑、删除与全图形联动筛选验收

## 范围与责任

本次实现稳定 reportId、不可变 build、schema v2 文档／receipt／delivery、Workspace current 指针、
宿主阅读器的呈现编辑与 cell 删除，以及全部 18 种 chart 的同 dataset 临时联动筛选。
Draft 与 typed dataset 保持 v1；旧协议不读取、不迁移，旧文件保留。

参考本机 Data Analytics 0.2.10 的 `analytics-app/App.tsx` 编辑草稿、取消、保存、稳定 cell ID 和删除组织方式，
及 `runtimeEnvironment.ts` 的保存适配边界；实现代码独立编写。保存由插件 trusted-host RPC 与 Workspace
文件提交服务完成。Marivo 的数据、来源、代码快照与分析语义继续保持原权威边界。

实现说明见[展示交付](../modules/presentation-delivery.md)、[展示 reader](../modules/presentation-reader.md)、
[展示投影](../modules/presentation-projection.md)和[展示 Skill](../modules/presentation-skill.md)。

## 可重复验证入口

```sh
npm run check
npm run build
npm run verify:plugin-package
npm run validate:presentation-integration:real
git diff --check
```

[保存与并发测试](../../packages/dsh-data-analysis/tests/presentation-integration/report-editing.test.ts)覆盖：

- 身份与字段限制、排序和删除、零 cell 保存，datasets／sources／Python 和 SQL 快照完整保留。
- 两个独立进程基于同一 build 保存，只能一个成功；指针提交前失败不改变旧 current，未知锁等待超时后仍保留。
- 文档篡改、非法指针、Workspace 不可用、撤销／重做／取消、冲突保留草稿、成功提交后响应丢失恢复。

[真实浏览器旅程](../../packages/dsh-data-analysis/scripts/presentation-s4/editing.ts)使用实际安装包和 DSH Web：

- 标题、正文、metric 标签、图形类型、表格列选择／顺序、键盘移动、删除／撤销／重做、保存及从原卡片重开。
- 图表预备视图选择、同／不同 dataset 筛选隔离、预备视图编辑的撤销／重做及保存。
- 所有 18 种 chart 的实际绘图行身份、数据源预览、空集；特殊图形的原始值和已有占比区间不变。
  null 不绘制为零，显式 `showPoints: never` 保持作者设置。
- 两图一表联动、精确数字、截断范围与固定指标；过滤后的 HTML 下载字节仍与保存文件相同，打印仍包含完整保存行。
- 编辑冲突保留草稿、关闭时继续编辑、全部删空、390px 窄屏、已保存内容的离线与禁用脚本阅读。
- Workspace 脱离后清除编辑与已加载文档；同一路径上的不同 Workspace 身份不能读取旧报告。
- 同一隔离 Profile 的 Host 进程重启后，从原卡片打开最近保存结果，卡片数与 durable Agent 事件保持不变。

隔离 Host 使用只记录方法名的 Node 子进程入口探针；初始 Tool 阶段确认探针有记录，
随后对编辑旅程前后的日志逐字节比较。探针不记录命令参数、环境变量或凭据。
真实保存旅程同时比较 durable Session 文件，确认保存不产生 Agent/Tool 事件。

## 实际结果

2026-09-08 完成验证：

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 375 项测试全部通过；质量、依赖及类型检查通过 |
| 构建与安装包 | `npm run build`、`npm run verify:plugin-package` 通过；24 个 DSH peer 使用当前 compatibility range |
| 实际 DSH Web | Chrome 152.0.7977.77；所有旅程通过，页面错误 0 |
| 全图形联动 | 宿主与 portable 各覆盖全部 18 种 chart、原始 rowIndex、数据预览、空集及预计算值保留 |
| 编辑保存 | 标题／正文／指标标签／图形／表格配置、cell 移动删除、撤销重做、预备视图保存、冲突与空报告全部通过 |
| 保存执行边界 | 编辑期间 durable Session 字节不变，子进程入口新增调用 0 |
| 重连与重启 | 同一隔离 Profile 重启后，原卡片打开最新保存结果；卡片仍为 4 张，Agent/Tool 事件不变 |
| 安装包代码一致性 | 实际 Host 加载的 65 个 JS 模块 SHA-256 与最终构建全部一致 |
| Skill 与文档 | frontmatter、资源引用、Markdown 链接及 `git diff --check` 通过 |

原始证据位于本机隔离目录：

```text
/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-presentation-s4-real-rBSM6c/integration-evidence.json
```

同目录保留 `editing-narrow.png`、`editing-saved-offline.png`、`editing-saved-no-script.png`、
`editing-restarted-original-card.png` 和实际下载的 `editing-saved.html`、`editing-empty-saved.html`。
子进程入口记录在 `web-attempt-GdnMrB/process-audit.log`，只记录方法名。

真实验收采用已生成的隔离 Runtime 输入及 headless 证据继续运行 `--resume-web`；本轮重新打包、启动 DSH Web，
实际执行初次 Tool 交付、所有 reader／portable 旅程、相反插件加载顺序和同 Profile 重启。


## 验证边界

初始报告通过实际 Harness ToolRuntime 的 Native／both／Code 路径交付，模型适配器是确定性的测试 adapter；
本次没有执行新的真实 LLM 分析，不将其声明为真实模型路由验收。
保存与读取只使用报告服务，未重新投影数据；故障注入验证提交边界，不模拟机器断电。

本次仅在工作区实施并使用临时 Workspace/Profile 验证；没有发布、推送、重装用户 profile 或重启用户服务。
