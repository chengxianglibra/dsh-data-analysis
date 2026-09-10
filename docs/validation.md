# 项目验证指南

## 验证原则

根目录 [package.json](../package.json) 是验证命令入口。模块文档描述应验证的契约；测试通过记录必须绑定实际代码、安装包和环境，不能由设计文档、旧截图或脚本路径推断。

本地构建使用 `.nvmrc` 指定的 Node.js 22.19.0。可执行变更运行相关测试及 `npm run check`；exports、client、包元数据或分发内容变化时，再运行 `npm run build` 与 `npm run verify:plugin-package`。纯文档变更检查相对链接、标题锚点、Markdown 渲染和 `git diff --check`。

## 按模块验证

下表列出常用入口；完整参数、前提和失败边界见对应[模块文档](architecture.md#模块导航)及脚本。

| 范围 | 确定性测试 | 真实环境入口 |
| --- | --- | --- |
| Runtime/Workspace | `test:runtime-workspace` | `validate:runtime-workspace:real` |
| Environment | `test:environment-execution` | `validate:environment-execution:real` |
| Help | `test:help-disclosure` | `validate:help-disclosure:real` |
| Datasource/Credentials | `test:datasource-credentials` | `validate:datasource-credentials:real`、`validate:datasource-execution:real`、`validate:credentials:web` |
| 数据源配置与删除 | `test:datasource-credentials` | `validate:datasource-configuration:real`、`validate:datasource-configuration:web`、`validate:datasource-configuration:model`、`validate:datasource-removal:web` |
| 语义引用与浏览 | `test:semantic-reference-input`、`test:semantic-browser` | `validate:semantic-ask-dsh:web`、`validate:semantic-browser:web` |
| 展示契约与投影 | `test:presentation-s0`、`test:presentation-projection` | `validate:presentation-projection:real`、`validate:presentation-browser:real` |
| reader 与交互 | `test:presentation-reader`、`test:right-tabs` | `validate:presentation-reader:real`、`validate:presentation-interaction`、`validate:presentation-export`、`validate:right-tabs:web` |
| 报告导航与引用 | `test:presentation-integration` | `validate:report-catalog:web`、`validate:presentation-semantic-navigation`、`validate:presentation-ask-dsh` |
| 展示与文件 Skill | `test:presentation-skill`、`test:plugin-integration-delivery` | `validate:presentation-agent:real`、`validate:file-analysis:real` |
| 插件交付与关闭 | `test:plugin-integration-delivery`、`test:presentation-surface`、`test:presentation-integration` | `validate:plugin-integration-delivery:real`、`validate:presentation-integration:real`、`validate:plugin-lifecycle:real` |
| 报告对象存储发布 | `test:presentation-integration` | `validate:report-publishing` |

表中名称均通过 `npm run <名称>` 执行。`test:presentation-s0` 是仍由 package.json 使用的历史命令名，负责纯展示契约测试，不表示项目仍处于该阶段。

## 证据与环境边界

- 契约与确定性测试证明输入、身份、状态转换和失败处理；模拟 transport 或固定数据不证明真实服务可用。
- Runtime 验证应记录实际解释器和包身份、隔离 Workspace、生成与恢复过程；跨进程恢复不能以同一进程缓存代替。
- Web 验证应记录实际加载的 client、Host 接线及用户操作结果。生产组件加 fixture 不等于已安装 profile 验收；HTML 需要覆盖离线、无脚本、打印和数值保真。
- 模型验证应使用真实 Tool/Skill 路由、请求与 Session 事件，区分模型自动选择和脚本强制调用。
- 对象存储的本地签名 PUT fixture 不证明真实 Bucket 权限、服务商兼容性、持久性、CDN 或公网访问。

真实环境操作按任务授权和前提执行；重装、重启、清理状态、发布或推送不由验证命令的存在自动授权。缺失前提、跳过项和未确认结果须单独报告，不把本地检查写成已发布能力。记录不包含凭据值、完整环境或无关用户数据。
