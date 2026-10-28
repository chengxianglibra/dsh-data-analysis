# 统一分析 UI P3 验收

日期：2026-10-28。范围：[P3 实施任务](../designs/unified-analysis-ui-implementation.md#p3流式增量更新和首期交付)。
P0–P3 首期范围完成；P4/P5 未开放。只修改本插件，保留原有 AGENTS.md、统一 UI 设计及独立的 DSH 集成设计工作。
Web 验证只启动和关闭本次隔离 Host。

## 实现与责任

- marivo_present 按 surface、basedOnRecordId、resources、title、program、locale 披露参数。创建沿用单引用展开；
  更新读取准确基版本，使用固定 mergeStatements 合并完整语句。补充完整性及语句边界检查，避免上游容错跳过无效输入。
- 更新省略 resources 继承，提供则替换完整资源表；同名同声明复制基版本内嵌字节，只有改变的资源进入读取。
  title/locale 省略时继承，program 省略时保留。新 Build 独立内嵌全部资源，以基版本 buildId 执行原 current 条件保存。
- Workspace 校验与 Runtime 获取分开。纯展示更新不获取 Runtime、不启动 Python；冲突不自动重试，失败及取消不改 current。
- Native 通过公开 Chat 投影、准确 ToolCallBlock 的 PartialArguments.textPrefix 消费真实参数前缀。
  两个位置共用 AnalysisSurface/Catalog/Renderer；候选只展示解析内容、占位及已授权基版本，不读取新业务数据或执行动作。
- 报告临时 tab 按准确 Session/Turn/call、Workspace 和连接 generation 归属，成功原位转换为固定 Build。
  每个调用独立候选，tool view 不重复挂报告 Renderer；关闭候选后不被结果重新打开，历史回放不自动导航。
  字段顺序只作建议，surface 晚到时保存后交付；默认引用显示实际执行状态，不制造字符动画。
- PTC 沿用真实 dispatch/start/result 和持久交付，未解析 run_code 源码，也未宣称有子调用生成期参数流。
- 常驻提示与两个随包 Skill 已切换到引用、原进程 capture 和语句更新；默认表格功能直接由 schema 披露。
  helper 仍为 1.2.0，未改变 Python 行为。旧 Document v3 Reader、编辑和 HTML 分发边界保留。

## 环境与入口

| 项目 | 实际身份 |
| --- | --- |
| Node.js | 22.19.0 |
| Harness | 0.2.1-rc.2；未安装 Intelligent UI |
| 插件 | 0.2.4-dev.0，本地构建及打包候选 |
| OpenUI | lang-core/react-lang 1.0.1，react-headless/react-ui 0.18.1 |
| Marivo | 0.6.0.dev0；Python 3.14.4；复用 P1/P2 独立 Runtime |
| Python / 包位置 | `/private/tmp/dsh-unified-ui-p1-runtime/bin/python`；同目录 `lib/python3.14/site-packages/marivo/__init__.py` |
| Helper | presentation-kit 1.2.0，既有构建、wheel 与身份校验通过 |
| 外部模型 | 官方 deepseek-v4-pro，第二轮 reasoningEffort=low |
| 浏览器 | ego-browser；桌面 1440×795（最终冷重开 1428×817）、窄容器 390×844 |

复用现有 driver，不建设新验收框架：

```sh
DSH_DATA_ANALYSIS_PYTHON=/absolute/p1-runtime/bin/python \
node --experimental-strip-types packages/dsh-data-analysis/scripts/unified-analysis-ui/web.ts --p3 --model

# 关闭该隔离 Host 后，使用同一 outputRoot 冷重启：
DSH_DATA_ANALYSIS_PYTHON=/absolute/p1-runtime/bin/python \
node --experimental-strip-types packages/dsh-data-analysis/scripts/unified-analysis-ui/web.ts --p3 --reuse /absolute/outputRoot
```

--model 只在启动进程中读取已有 Harness 凭据引用并传给隔离 Host，不写入用户 profile、模型参数或证据。
准确 Runtime 的本地 wheel 身份沿用 [P2 记录](unified-analysis-ui-p2-2026-10-28.md#固定身份与入口)。

## 自动化、Host 与浏览器证据

| 验证 | 结果与边界 |
| --- | --- |
| 增量模块 | 覆盖快照继承/替换、无 Runtime resolver、capture 删除、不可变版本、过期基版本、非法/半截 patch、仍被引用的删除；原冲突/取消/文件安全用例保留 |
| 客户端投影 | 覆盖原位增长的 PartialArguments、surface 晚到/未闭合、未完成基版本 ID、Session/Workspace/call 隔离、PTC 子调用、取消和撤销 |
| Native tool 真实前缀 | Host adapter 在完整参数前停留，实际 tool view 显示 `P3 streamed Native prefix before`，两个数据区为占位；release 前无成功 delivery |
| Native tab 真实前缀 | 同一真实 Harness 传输在参数完整前打开候选 tab、显示相同前缀；tool view 仅显示状态，保存后原位转为准确 Build，候选 Renderer 消失 |
| 保存与交互 | Frame/Dataset 保留 9007199254740993、12345678901234.5678、2.3400 和 NULL；此前 P2 的选列/排序/分页功能继续复用 |
| 关闭与失败 | 手动关闭候选后 release，tab 数仍为 2，未被成功事件重新打开；非法删除导致保存失败，旧成功正文和精确数据仍可读 |
| PTC | 实际 run_code 调用 tools.marivo_present，准确子调用产生报告并转为固定 Build，可显示保存的 45 行 Dataset |
| 源消失后更新 | 删除隔离 Workspace 的 captures、.marivo、models 和 sample.png，再发一条说明修改，成功生成新 Build；前后 resources 深度相等 |
| 冷重启 | 同一目录重新启动 Host，准确版本重开仍显示 Frame/Dataset 的精确值；四类原输入仍不存在，未重跑 producer |
| 旧格式与 Headless | 旧 Document v3 仍由旧 Reader 打开；后台真实模型的成功 receipt 只确认保存及文件身份，不声称 UI 已打开 |
| 窄容器 | 390px 页面 scrollWidth=390；失败说明及旧正文可读，宽表在自身区域滚动 |
| 错误观察 | 修复后代表路径 audit.errors、data-slot-error 及初始化后收集的 console.error/window.error 均为空；未据此宣称完整初始控制台无警告 |

Native 前缀验收使用 scripted adapter 在 **AgentLoop 上游** 暂停真实参数流，走生产 Tool/Client、持久化和 Web 传输；
它证明真实 Host 接线，不是外部模型自由生成自定义报告的资格证明。外部模型使用策略单独验证如下。

最终准确重开版本：
`marivo-ui:258b0bd0-9a98-4098-900d-73b0ad6313b3:5a5f193b-0b83-4ba7-9fd8-5c16f68e89af`。

## 真实模型使用策略与修复

第一轮默认结果触发了模型对 UI 能力的多余 Help 查询及 Python 内省尝试。已在工具与常驻提示明确默认表格具备
选列、精确排序和本地分页，Marivo live Help 不拥有 UI 签名；没有新增目录工具或强制 Skill 步骤。

第二轮新会话实际轨迹：

- 简单 `2 + 2`：直接回答，0 工具。
- 查看已有快照：仅 1 次 marivo_present，只有资源引用；无 Skill、Help、Python 或 UI 回读。
- 已知基版本与签名的修改：仅使用 marivo_present；首次将位置参数写成命名参数，Host 拒绝且未改 current，
  模型按结构化错误修正为一条 root 语句并成功。无 Help、Python、Catalog 或 UI 回读，资源字节保持不变。
  随后在 program 说明补充位置参数示例，避免同类歧义；不将这次有修复的轨迹描述成首次更新即成功。

实际模型请求中没有 marivo_ui_catalog；该轮 marivo_present schema 为 2358 bytes，无完整 Catalog 回灌。
模型生成了 2 个成功版本与 1 个明确拒绝的候选。模型验收仅代表上述模型、范围和样例。

## 文档差异及实现中发现的问题

- 架构正文、文件 Skill、部分模块及历史示例仍将 Draft/writer 和已移除的更新参数写成新流程；已同步引用/capture/Lang，
  旧说明标为 Document v3，旧 Reader 的既有呈现编辑继续保留。
- 设计状态仍称领域组件占位、marivo_ui_read 未新增、默认引用未接通；已更新 P0–P3 状态，保留初稿审阅段落的历史语境。
- 固定版 mergeStatements 对无效片段宽容，且按换行拆源；增加必要的完整性和语句边界检查，仍由官方函数执行合并。
- 首次 tab 浏览器验收发现原生 Workspace 订阅方法脱离对象时导致 slot 渲染失败；已修复调用方式并重跑 tab 预览、保存及冷重开。
- 中途复用旧综合 runner 的导入会携带相对 package.json 依赖；已改用纯交付解析函数，最终隔离 Host 不依赖该旧 runner。

## 最终检查与产物

- npm run check：702 项，698 通过、4 项按原真实运行条件默认跳过，0 失败；包含 helper/wheel 合同、生成 Catalog、全部模块测试及构建。
- npm run build、npm run verify:plugin-package 通过：349 files / 20544618 unpacked bytes；37 DSH peers，helper、contracts 和旧离线 builder 校验通过。
- 两个 Skill 的 quick_validate、资源可达性与体积测试通过。修改文档的相对链接/锚点及 git diff --check 通过。
- 原始机器证据位于 `/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-unified-ui-p2-web-oIfBLT`：
  host-events.json、p3-model-events.json、p3-model-first-pass-events.json、p3-model-evidence.json、
  p3-patch-evidence.json、p3-source-removal.json、p3-cold-source-state.json、p3-browser-final.json 和 p3-security-evidence.json。
- 截图：`/tmp/dsh-p3-tool-stream.png`、`/tmp/dsh-p3-tab-stream.png`、`/tmp/dsh-p3-patched-tab.png`、
  `/tmp/dsh-p3-narrow-failure.png`、`/tmp/dsh-p3-cold-reopen.png`、`/tmp/dsh-p3-legacy.png`。

原始日志、截图、临时 Workspace 不进入分发。未新增数据源/浏览器/模型矩阵；新格式图表、元数据扩展、离线导出和发布留在 P4/P5。

## Review 修复回归

- 候选存储与 tab 去重身份补齐 Turn，已取消调用不会阻止下一 Turn 的同名 callId；
  settled ToolResultNode 沿用公开 Chat location 的 Turn，PTC 子调用继承所属位置。
- basedOnRecordId 字段已出现但尚未闭合时禁止预览；完成后等待经 RPC 核验的基版本再合并。
- 官方 mergeStatements 仍负责合并；重复语句名及合并后被丢弃的非删除修改明确拒绝。
  回归覆盖未知组件、无效属性、不可达新增、有效新增及删除，并验证失败不改 current。
- 修正 projection 文档中 snapshotRef 和双位置 UI 尚未开放的遗留描述。
- 修复后 npm run check：705 项，701 通过、4 项按原条件跳过、0 失败；
  npm run build、npm run verify:plugin-package 与 git diff --check 通过。
  此次未重跑真实模型或 Host/浏览器验收，以上新增边界由自动化回归验证。
