# DSH rc.1 升级与分析体验优化设计

## 状态与目标

状态：S1 rc.1 基线已于 2026-09-11 完成，验收见[验证指南](../validation.md#dsh-rc1-基线验收)。S2 普通文件交付与 S3 引导入口仍待实施。编写日期：2026-09-11。

目标是利用 DeepSeek Harness `0.1.5-rc.1` 的公开能力，完善普通分析文件交付，改善已有分析入口的可发现性，并保持报告、引用和执行的身份边界。

首期包含三个依次验收的步骤：兼容适配、普通文件原生交付、右侧引导入口。全局分析面板、自定义 CSV 预览和 Agent Teams 仅记录后续方向，不纳入首期实现。

## 事实基线

| 对象 | 核对基线 |
| --- | --- |
| 插件源码 | `7b06354693d251af37e6e52401ffd197ba0883c8`；编写时工作区另有 Python 工具界面相关未提交工作，不作为本设计交付内容 |
| Harness 起点 | `dsh-v0.1.5-alpha.1`，`5dda764ed3aa172535a7967b06ff95d9cbfe536a` |
| Harness 目标 | `dsh-v0.1.5-rc.1`，`183f08e9c6dde7e36cd2318eaee70b0da08fb35e` |
| 插件兼容声明 | 设计编写时 `peerRange` 为 `^0.1.5-alpha.1`；当前为 `>=0.1.5-rc.1`；rc.1 已完成隔离实测 |

rc.1 发布说明汇总的是从 `0.1.2-rc.1` 以来的变化。本设计依据[两个准确 tag 的差异](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.5-alpha.1...dsh-v0.1.5-rc.1)，避免将通用文件上传、Session V3、原生 reference 和右侧多标签基础重复算作新增能力。

本次可利用的增量包括 `present` 显式文件交付、可扩展文档预览、文件原生打开动作、右侧栏交互完善以及全局面板扩展点。右侧 `guide` 扩展在 alpha.1 已存在，补充插件入口是利用已有接缝，不能归因于 rc.1 新增 API。

当前插件已有原生附件文件分析、Report/Build 保存、固定快照阅读器、语义引用和 `# Cell 名称` Ask DSH。相关事实以[文件分析](../modules/file-analysis-skill.md)、[展示交付](../modules/presentation-delivery.md)、[报告阅读器](../modules/presentation-reader.md)及对应实现为准。

## 责任边界与不变量

| 所有者 | 本设计中的责任 |
| --- | --- |
| Harness | 附件路径、Session 文件系统、原生 `present` 与持久事件、文件卡片和预览、Tab 布局、输入框、模型选择及 Agent 编排 |
| Marivo | 分析语义、Artifact、Evidence、Quality、lineage 和有效性契约 |
| 本插件 | Runtime/Workspace binding、受控 Python 执行、分析 Skill 路由、报告保存与阅读、已有目录的入口注册、集成验证 |

- 不新增上传工具、通用文件交付 wrapper、文件内容仓库或 Harness 事件副本。
- `present` 与 `marivo_present` 分别负责普通文件声明和报告快照保存；普通文件声明不获得 Report/Build、Evidence 或来源有效性。
- Harness `present` 打开当前源文件，不复制或保留内容版本；源文件被修改、移动或删除后，卡片不能承诺历史内容仍可读取。
- shared Runtime、per-Workspace binding、Session 操作和 Tab occurrence 保持各自生命周期。迟到结果不能写入新 Workspace、Tab 或草稿。
- 语义目录仍然只读元数据，不因展示入口而 observe、测试连接或读取凭据。
- 不改默认模型，不增加依赖安装、服务重启、现有状态清理或公开发布操作。后续实施的环境操作按其实际授权执行。

## 方案一：rc.1 兼容适配

### 依赖与契约

将开发和验收使用的 Harness distribution 及直接使用的 DSH 包统一到精确 `0.1.5-rc.1`，通过 Node.js 22.19.0 与 `npm install` 更新 lockfile，检查实际解析图，避免 alpha／rc 混装造成虚假通过。

首期以 rc.1 为唯一新增验收目标，插件 DSH peer 与 compatibility 的最低基线已同步调整为 `>=0.1.5-rc.1`。不保留未经验证的 alpha.1 兼容承诺；该范围内未来版本也不视为自动通过验收。Marivo 版本、Runtime marker 和 presentation-kit 不因 Harness 升级而顺带变更。

检查当前导入和实际使用的 Agent、Tool、Session、Workspace、Shell、reference、locale、slot、Tab 接缝。根据 tag 差异适配，不把 rc.1 汇总说明中的早期破坏性变更一律当成此次迁移任务。根 `conversation` slot 的变化与 `conversation.chat.*` 子 slot 分别核对，禁止全局文本替换。

### 回归重点

原生右侧 Tab 已承载报告和目录。rc.1 调整页面去重、关闭、分栏、布局和预览行为，需要证明：同一目录在目标 pane 内按 Host 规则复用；资源 Tab 仍显示正确 Report/Build；关闭、重连、切换 Session 与语言不会丢失身份或复活旧请求。窄屏、全屏进出和滚动用真实 Web 操作验证。

Ask DSH 沿用现有 reference 与 codec，显示友好 Cell 名称，提交展开完整上下文；保留已有正文、附件、语义引用与撤销行为。默认模型可能随 Host 升级变化，兼容验收应显式固定模型并记录实际路由，避免把模型变化混入适配结果。

## 方案二：普通分析文件原生交付

### 用户流程

用户上传文件或指定 Workspace 文件，要求分析并导出结果时，Agent 使用已有 `marivo_python(datasources: [])` 或声明所需 datasource 的执行路径生成文件，再调用 Harness `present` 声明用户要求接收的最终文件。用户从原生卡片预览或使用 Host 提供的文件动作打开。

首期主要修改[文件分析 Skill](../../packages/dsh-data-analysis/skills/dsh-data-analysis-files/SKILL.md)及其按需示例，复用实际可用的工具，不注册插件版 `present`。不向常驻 system prompt 增加完整文件交付协议。

| 用户目标 | 交付方式 |
| --- | --- |
| 只问一个数据结论 | 文字回答，不为答案额外创建文件 |
| 要求 CSV、JSON、PNG 等普通文件 | 执行成功并生成可读文件后调用原生 `present` |
| 要求交互图表、表格、报告或看板 | 按现有展示 Skill 调用 `marivo_present`，打开固定 Build 的报告 Tab |
| 在阅读器下载或发布 HTML | 保留已有下载／发布流程；浏览器内生成的下载内容不伪装成 Session 文件 |

只有用户另行要求交付实际文件、且该文件已存在于 Session 文件系统可访问位置时，才对报告相关文件使用原生 `present`。不把内部 `presentation.json`、computed 数据和 receipt 一并作为默认附件，也不制造重复成功卡片。

### 能力、身份与失败

遵循上游 [present 契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/fs/tool-present/README.md)，由原生工具验证路径和文件类型；不在插件中复制其 schema 或路径授权逻辑。优先在任务 Workspace 内生成最终文件，不猜测附件缓存或 Shell 私有临时目录。

自定义 profile 可能未挂载 `present`。Agent 根据当前实际工具能力选择路径：缺失时明确说明文件生成与原生交付状态，提供准确路径供手动使用，不声称已有卡片，不自动安装或改写 profile。

执行失败不声明生成成功；声明失败要区分“文件已生成”和“交付未完成”，修复路径或可见性问题后再声明，无需为补卡片重跑分析。原生打开动作不可用时复用 Host 提供的预览或错误反馈，不绕过文件系统权限。

原生持久事件由 Harness 拥有，包括 PTC 嵌套调用。已成功声明后外层程序失败，不由插件撤销该声明；响应不确定时先核对已有调用结果和事件，不以盲目重试制造重复交付。

子代理产物属于其调用 Session。若父会话需要交付，由父 Agent 在确认自己能访问文件后显式 `present`；本插件不自动跨 Session 转投递。文件 fork、恢复和源文件变化语义直接采用 Harness 契约。

## 方案三：右侧引导入口

在[现有目录 Tab 注册](../../packages/dsh-data-analysis/src/client/right-tabs/install.tsx)中为数据源、语义层、报告增加 `guide` 元数据，复用现有 title、icon、kind 和页面内容。保留现有顶栏入口，不新增一套导航状态。

| 入口 | 引导说明 |
| --- | --- |
| 数据源与凭据 | 管理当前工作区的数据源和连接凭据 |
| 语义层 | 浏览对象定义并加入提问 |
| 报告 | 打开已保存的分析报告 |

标题和说明订阅 Harness locale；报告正文继续使用固定报告语言。引导页可能省略说明，所以标题应能独立表达用途。仅显示引导页时不得触发目录读取、Runtime 初始化、凭据请求或分析。

上游 guide 根据 Tab kind 打开页面，不能假设它携带顶栏入口显式传入的 `workspaceId`。实施时检查该打开路径：首次创建页面从所属 Session 的已就绪 Workspace 成员关系解析并绑定身份；绑定后始终核验该身份，不随前台 Workspace 静默重定向。未就绪时等待公开状态，无法解析时显示可操作错误。顶栏与 guide 汇合到同一身份解析入口。

关闭或卸载撤销注册及页面请求，语言切换不重复注册或读取数据。采用上游页面去重规则，避免 guide 与顶栏打开两个逻辑不同的同名目录。

## 后续方向

| 方向 | 可能收益 | 纳入实施前的条件 |
| --- | --- | --- |
| 全局数据分析面板 | 为大量报告和对象提供更宽的管理界面 | 明确 Workspace 选择、无活跃 Session 的读取规则与 Ask DSH 目标会话；避免将现有 Session 状态直接搬到全局 |
| CSV 文档 renderer | 无需下载即可查看普通文件样本 | 实测原生文本预览不足；定义字节／行预算、编码与列数限制、样本提示和取消规则，不执行完整分析 |
| `deepseek-flash` 模型评估 | 图像理解、分析路由与生成效果可能改善 | 用相同输入和工具环境比较正确性、调用数、耗时和失败率；不预先承诺提速或替用户切换模型 |
| Agent Teams | 多个独立分析任务并行 | 用户有明确场景，Runtime 并发预算与 Session 交付责任清楚；编排仍归 Harness |

普通 HTML、PDF、图片优先使用 Harness [文档预览](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/client/ui-sidebar-documentpreview/README.md)。复杂报告仍使用插件 reader；不默认注册通配 JSON renderer 来拦截无关文件。

全局面板应使用上游 [main 与 layout 契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.1/packages/client/ui-layout/README.md)，在独立设计中处理全局与 Session 作用域转换。

## 实施顺序与验收

每步形成可独立检查的变更，保留工作区无关内容。前一步未通过时先修复其接缝，不叠加后续功能掩盖失败。

| 步骤 | 修改范围 | 必需证据 |
| --- | --- | --- |
| S1：rc.1 基线 | 根／包 manifest、lockfile、compatibility、实际受影响接缝和说明 | 依赖解析一致；相关测试、`npm run check`、build 和包验证；打包插件的真实隔离 Web 核心流程回归 |
| S2：普通文件交付 | 文件分析 Skill、示例、相关模块文档与集成验收 | 真实模型从文件任务自主生成并调用 `present`；原生卡片可读；失败、缺失工具和 PTC 情况有独立证据 |
| S3：引导入口 | right-tabs 注册、身份解析、locale、相关测试 | 真实 guide 点击正确目录；与顶栏去重；中英文、无就绪 Workspace、切换与关闭无身份串用 |

具体命令复用[验证指南](../validation.md)和根 `package.json`，新增用例扩展相关现有入口；表中所需覆盖不表示现有脚本已全部提供。

### 验收用例

| 场景 | 通过条件 |
| --- | --- |
| 上传两个同名文件并导出汇总 CSV | 模型使用正确完整路径；卡片指向生成结果；结果内容与输入相符 |
| Python 生成图片 | 使用原生 `present`；图片在原生预览可见；不额外生成报告 |
| Native 与 PTC 文件交付 | 两种调用都持久记录正确 Session／Turn；重连或重开后无插件重复投递 |
| 文件生成失败、路径不可读或已删除 | 无虚假成功；诊断可区分生成、声明和后续打开失败 |
| 自定义 profile 缺少 `present` | 明确交付能力缺失；不自动安装、无虚构卡片 |
| 自定义报告新建、更新、重开 | 固定 Build 与冲突语义保留；不将报告 JSON 当普通最终文件展示 |
| Ask DSH 与已有附件混合 | chip 友好；模型提交仍含正在显示的 Build／Cell 和完整上下文；草稿与撤销保留 |
| guide／顶栏入口交替点击 | 在 Host 规定的目标 pane 内复用同一目录；正确绑定所属 Workspace |
| 语言切换与页面生命周期 | 标题和说明更新；报告语言不变；关闭／切换／重连不写入旧页面 |
| 窄屏与全屏阅读 | 报告和原生文件预览可操作，滚动区域正常，无关键操作被遮挡 |

验收记录包含候选 commit 或 diff 指纹、打包产物摘要、实际 DSH／Node／Runtime 身份、profile 和模型路由、所用固定数据、断言结果与跳过项。真实模型自主选择、脚本强制工具调用、组件 fixture 分开记录，不能相互代替。

文档阶段仅检查相对链接、Markdown 渲染结构和 `git diff --check`。实施后再同步模块文档中的当前行为，并在 `docs/validation.md` 记录实际验收；不提前把上述待验收用例写成通过。

## 完成边界

首期完成意味着 rc.1 候选通过规定验证，普通文件具备原生交付闭环，三个分析目录可从 guide 正确打开。发布、重装用户 profile、重启当前服务、清理状态及未来能力不属于该完成条件。升级失败时保留证据并修复候选，不通过降级或删除用户 Session 来规避问题。
