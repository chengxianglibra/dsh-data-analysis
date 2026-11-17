# 仓库协作约定

`dsh-data-analysis` 是将 Marivo 接入 DeepSeek Harness 的 TypeScript 插件。实现和测试位于 `packages/dsh-data-analysis/`。

## 责任与事实来源

- Harness 管理 Agent 编排、Session、Tool/Skill 生命周期、Workspace、凭据和 profile。
- Marivo 定义分析语义、Catalog、固定结果、Evidence、质量和 lineage 契约。
- 插件负责 Runtime/Workspace binding、受控执行、实时 Help 披露、语义引用、报告投影与交付，以及打包验证。

按任务从[架构总览](docs/architecture/README.md#模块导航)进入模块文档，核对相关实现、测试和上游公开契约。
以当前代码为准，交付时报告发现的文档偏差。

## 工作范围与授权

- 修改前识别已有工作并保留无关变更。改动和提交限于任务范围，遵循现有实现风格。
- 跨模块变更先说明责任边界、取舍和可验证的完成标准。
- 审查默认只读。修改本文件或 `packages/dsh-data-analysis/skills/` 下的随包 Skill 需要用户明确授权。
  发布、推送、清理运行状态和重启服务按用户授权执行。

## 集成约束

- 保持 Harness 原生生命周期，区分 shared Runtime 与 per-Workspace 配置和状态。
  通过 Marivo 公开接口使用上游 schema、注册表和语义行为，相关操作保持 Runtime identity。
- 凭据由 Harness 管理，使用限定于当前操作。Agent 参数、结果、日志和 telemetry 必须排除 secret 值。
- 在信任边界校验外部输入与绑定身份，失败时终止操作并明确报错。
  公开接口使用具体类型，新增 `any`、宽泛断言或类型检查抑制须有局部理由。
- API 事实由 Marivo live Help 披露，运行状态和修复信息由返回值与结构化错误提供，Skill 负责流程与判断。
  接口变化时同步受影响的 Tool、提示、UI、示例、契约测试及已获授权的随包 Skill，并报告待同步项。
- 标识符、代码注释与测试名称使用英文。界面文案遵循 locale 词典，报告语言遵循 `AnalysisDocument.locale`。

## 文档归属

- `docs/` 下只有 `docs/architecture/` 纳入 Git，记录长期契约。行为或责任变化时更新所属模块及本地验收记录。
- 设计、实施计划、验证、发布记录和文章分别放在本地的 `docs/design/`、`docs/implementation/`、`docs/testing/`、
  `docs/releases/` 和 `docs/articles/`。临时运行产物可放在 `artifacts/`。架构文档的必要链接应在检出后可用。
- 文档用中文并保留 canonical English identifiers，使用相对链接、描述性 ATX 标题和小写 kebab-case 文件名。
  修改用户文档时同步受影响的中英文版本。

## 验证与交付

Node.js 兼容范围见[插件包的 `engines`](packages/dsh-data-analysis/package.json)，本地开发版本见 [`.nvmrc`](.nvmrc)。
验证命令以[根 `package.json`](package.json) 为准。

- 可执行变更复用现有 fixtures 和 helpers，运行相关测试及 `npm run check`。涉及 exports、client、包元数据或分发内容时，
  另运行 `npm run build` 与 `npm run verify:plugin-package`。
- 文档检查链接、标题锚点、渲染和 `git diff --check`。Skill 另检查 frontmatter、资源引用和相关契约测试。
- Python helper 的构建与验证复用仓库现有 npm/uv 入口。真实执行验证使用明确选择并核验身份的 Python/Runtime。
- 影响真实环境或模型边界时，按授权和环境前提补充对应验证。交付时区分静态检查、模块测试、真实 Runtime、Host/UI 与模型证据，并说明跳过或阻塞项。
