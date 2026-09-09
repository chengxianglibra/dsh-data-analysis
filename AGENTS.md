# 仓库协作约定

## 责任与事实来源

`dsh-data-analysis` 是将 Marivo 接入 DeepSeek Harness 的 TypeScript 插件。

- Harness 拥有 Agent 编排、Session、Tool/Skill 生命周期、凭据和 profile。
- Marivo 拥有分析语义、Artifacts、Evidence、质量、lineage 及有效性契约。
- 本项目只拥有接缝：Runtime/Workspace binding、实时能力披露、凭据安全接入、打包与验证。

以当前代码及检出的 Marivo、Harness 源码为准；历史 Slice 与计划文档不能证明功能已实现。
实现和测试在 `packages/dsh-data-analysis/`；架构见 [docs/architecture.md](docs/architecture.md)
及 [docs/modules/](docs/modules/)，用户与分发入口分别是根目录和包目录的 README。

## 工作范围与授权

- 跨层变更先说明责任边界、实施范围和验收证据，再实施；已明确的任务按已有授权推进。
  常规实现选择自行判断，只在缺失信息影响范围、正确性或授权时询问。
- 在系统及开发者约束内，用户明确指令优先于本仓库和 Skill 的工作流建议。
  已获授权的操作无需重复确认；Skill 被加载本身不授权发布、推送、删除状态或重启服务。
  因文件规则暂停时，指出文件、具体条款及尚缺的授权或事实。
- 修改前识别已有工作，只修改本任务范围；提交仅含相关变更，不为获得干净工作区清理他人内容。
  发布、重装等操作按对应 Skill 的授权范围执行。

## 集成约束

- 使用 Marivo 的公开、实时契约，相关操作保持 Runtime identity；不复制上游 schema、注册表或语义行为。
- 区分 shared Runtime 与 per-Workspace 配置、状态；未经明确要求，不改变 Harness 的原生行为。
- 凭据由 Harness 管理，使用保持 operation-scoped；secret 值不进入日志、结果、Agent 参数或 telemetry。
- 信任边界失败须明确报错，不静默切换解释器、安装、项目或能力来源。

## 验证与交付

Node.js 兼容范围与 DeepSeek Harness 一致，为 `^22.19.0 || >=24.0.0`；本地开发与发布构建使用 22.19.0（见 `.nvmrc`），需要安装依赖时运行 `npm install`。根 `package.json` 定义验证入口：

- 可执行变更运行相关测试及 `npm run check`。
- exports、client、包元数据或分发内容变化时，运行 `npm run build` 与 `npm run verify:plugin-package`。
- 仅文档变更检查链接、渲染和 `git diff --check`；Skill 另检查 frontmatter、资源引用和相关契约测试。
  所需检查通过后，仅因新变更、失败或未解风险扩大或重复验证。
- 改变真实环境或模型边界时，在前提具备且操作已获授权的情况下补充对应验证；报告跳过或阻塞项，
  不把静态检查、路径或日志当作真实运行验收。

文档用清晰中文并保留 canonical English identifiers，采用相对链接、描述性 ATX 标题和小写 kebab-case 文件名。
行为或责任变化时同步架构与验收记录；引用上游契约，避免复述。交付时先说明结果，再说明修改、验证及限制。
