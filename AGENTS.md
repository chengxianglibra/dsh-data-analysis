# 仓库协作约定

## 责任与事实来源

`dsh-data-analysis` 是将 Marivo 接入 DeepSeek Harness 的 TypeScript 插件。
本文件只保留稳定的仓库级规则；具体任务流程放在项目 Skill、README 或所属模块文档中。

- Harness 拥有 Agent 编排、Session、Tool/Skill 生命周期、凭据和 profile。
- Marivo 拥有分析语义、Artifacts、Evidence、质量、lineage 及有效性契约。
- 本项目拥有集成接缝：Runtime/Workspace binding、实时能力披露、凭据安全接入、报告投影、
  保存与呈现，以及打包与验证。

以当前代码及检出的 Marivo、Harness 源码为准；历史 Slice 与计划文档不能证明功能已实现。
文档与代码不一致时遵循现有代码约定，并在交付中报告差异；涉及行为变更时先明确当前责任契约。
实现和测试在 `packages/dsh-data-analysis/`；项目架构总览与模块契约见
[docs/architecture/](docs/architecture/)，用户与分发入口分别是根目录和包目录的 README。

## 工作范围与授权

- 采用满足请求的最小改动，匹配周边风格，避免推测性抽象、未来占位及过度防御的实现或验收。
- 非简单任务先说明关键假设、取舍与可验证的完成标准；跨层变更另说明责任边界、实施范围和验收证据。
  已明确的任务按已有授权推进。
  常规实现选择自行判断，只在缺失信息影响范围、正确性或授权时询问。
- 在系统及开发者约束内，用户明确指令优先于本仓库和 Skill 的工作流建议。
  已获授权的操作无需重复确认；Skill 被加载本身不授权发布、推送、删除状态或重启服务。
  因文件规则暂停时，指出文件、具体条款及尚缺的授权或事实。
- 修改前识别已有工作，只修改本任务范围；提交仅含相关变更，不为获得干净工作区清理他人内容。
  审查请求默认只读，除非用户授权编辑；发布、重装等操作按对应 Skill 的授权范围执行。
- 修改本文件或 `packages/dsh-data-analysis/skills/` 下的随包 Skill 需要用户明确授权；
  点名文件或 Skill 的编辑请求即为授权，普通实现或文档任务不隐含随包 Skill 的编辑授权。

## 按任务读取责任契约

只读取与任务有关的入口，再沿聚焦引用查阅实现、测试和上游公开契约。

| 任务 | 优先阅读 |
| --- | --- |
| 跨模块责任与数据流 | [总体架构](docs/architecture/README.md) |
| Runtime 安装、Workspace binding、解释器与执行 | [Runtime 与 Workspace](docs/architecture/modules/runtime-workspace.md)、[Environment 执行](docs/architecture/modules/environment-execution.md) |
| Help、Skill 激活与上下文恢复 | [实时 Help 披露](docs/architecture/modules/help-disclosure.md) |
| 数据源配置、凭据与执行准入 | [数据源与凭证](docs/architecture/modules/datasource-credentials.md) |
| Catalog 浏览与输入引用 | [语义浏览器](docs/architecture/modules/semantic-browser.md)、[语义对象引用输入](docs/architecture/modules/semantic-reference-input.md) |
| 报告数据与保存 | [展示数据投影](docs/architecture/modules/presentation-projection.md)、[展示交付](docs/architecture/modules/presentation-delivery.md) |
| 报告阅读、目录与版本历史 | [分析文档 reader](docs/architecture/modules/presentation-reader.md)；HTML 导出与发布已移除，见[说明](docs/architecture/modules/report-publishing.md) |
| 文件分析与展示流程 | [文件分析 Skill](docs/architecture/modules/file-analysis-skill.md)、[展示 Skill](docs/architecture/modules/presentation-skill.md)及其引用的随包 Skill |
| 生命周期、兼容与分发 | [插件集成与交付](docs/architecture/modules/plugin-integration-delivery.md)；本地验证指南放在 `docs/testing/validation.md` |

## 文档归属

| 内容 | 位置 |
| --- | --- |
| 项目架构总览、模块责任、数据流与长期契约（唯一纳入 Git 的 `docs/` 内容） | `docs/architecture/README.md`、`docs/architecture/modules/` |
| 设计提案与备选方案（本地工作材料） | `docs/design/`，Git-ignored |
| 分阶段实施计划（本地工作材料） | `docs/implementation/`，Git-ignored |
| 验收记录、验证指南与测试说明（本地工作材料） | `docs/testing/`，Git-ignored |
| 发布记录 | `docs/releases/`，Git-ignored |
| 文章与分享稿 | `docs/articles/`，Git-ignored |
| 临时计划、验收材料与原始运行产物 | `docs/plan/`、`docs/acceptance/`、`artifacts/` 或独立临时目录，Git-ignored |

- 当前契约改变时更新所属模块文档；架构文档不以临时计划或验收记录代替规范。
- `.gitignore` 仅放行 `docs/architecture/` 及其模块文档；其他 `docs/` 分类保留在本地并忽略，不将其作为架构文档的必要链接目标。
- 文档用清晰中文并保留 canonical English identifiers，采用相对链接、描述性 ATX 标题和小写 kebab-case 文件名。
  修改用户文档时同步受影响的中英文版本。

## 集成约束

- 使用 Marivo 的公开、实时契约，相关操作保持 Runtime identity；不复制上游 schema、注册表或语义行为。
- 区分 shared Runtime 与 per-Workspace 配置、状态；未经明确要求，不改变 Harness 的原生行为。
- 凭据由 Harness 管理，使用保持 operation-scoped；secret 值不进入日志、结果、Agent 参数或 telemetry。
- 信任边界失败须明确报错，不静默切换解释器、安装、项目或能力来源。
- 公开接口使用具体类型；新增 `any`、宽泛类型断言或类型检查抑制须有严格的局部理由。
  在信任边界校验外部输入后再使用，不以类型断言替代校验。
- 能力披露保持单一事实来源：Marivo live Help 拥有 API 事实，返回值与结构化错误拥有状态和修复信息，
  Skill 拥有流程边界与判断，插件只负责接入与交付。接口变化时同步受影响的 Tool、提示、Skill、UI、示例和契约测试；
  需要随包 Skill 编辑时遵循上述授权规则，并如实报告待同步项。
- 标识符、代码注释与测试名称使用英文；界面文案遵循现有 locale 词典，报告语言遵循 Draft 的 `locale`。

## 验证与交付

Node.js 兼容范围与 DeepSeek Harness 一致，为 `^22.19.0 || >=24.0.0`；本地开发与发布构建使用 22.19.0（见 `.nvmrc`），需要安装依赖时运行 `npm install`。根 `package.json` 定义验证入口：

- 可执行变更运行相关测试及 `npm run check`。
- 从最小有效检查开始，复用所属测试目录的 fixtures 与 helpers，验证当前契约；聚焦测试不能替代要求的完整检查。
- exports、client、包元数据或分发内容变化时，运行 `npm run build` 与 `npm run verify:plugin-package`。
- 仅文档变更检查链接、标题锚点、渲染和 `git diff --check`；Skill 另检查 frontmatter、资源引用和相关契约测试。
  所需检查通过后，仅因新变更、失败或未解风险扩大或重复验证。
- Python helper 的构建与验证复用仓库现有 npm/uv 入口；真实执行验证使用明确选择并核验身份的 Python/Runtime。
- 改变真实环境或模型边界时，在前提具备且操作已获授权的情况下补充对应验证；报告跳过或阻塞项，
  不把静态检查、路径或日志当作真实运行验收。
- 修复本次改动引起的失败并重跑相关检查；交付时区分静态检查、模块测试、真实 Runtime、Host/UI 与模型验收证据。

行为或责任变化时同步架构与验收记录；引用上游契约，避免复述。交付时先说明结果，再说明修改、验证及限制。
