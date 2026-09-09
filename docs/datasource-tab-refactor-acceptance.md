# 数据源 Tab 重构验收

## 范围与责任

数据源 Tab 直接承载原管理页的新增、属性、凭证编辑、删除、连接测试、操作反馈和待办处理。
刷新图标与“数据源”标题右侧对齐；列表沿用图标、名称和配置状态，改为顶部横向排列，选中项自动滚入可见区。
移除数据源 dialog 及其入口，等待中的凭证请求定位到所属 Session 的原生数据源 Tab。

Harness 继续拥有 Tab、Session 和凭证；Marivo 继续拥有数据源定义和连接语义。
插件复用原 RPC，按 Tab occurrence 隔离选择和操作句柄，刷新保留操作查询，Workspace 撤销时终止页面查询。
新增表单使用独立字段 ID，支持多个 Tab 同时存在；未提交的凭证值不持久化。
实现契约见 [Datasource Credentials](modules/datasource-credentials.md)。

## 验收证据

- `npm run check`：格式、依赖、类型与完整测试。
- `npm run build`、`npm run verify:plugin-package`：生产 client 与分发包验证。
- `npm run validate:credentials:web`：真实 Marivo 0.5.4 与 Chromium，新增数据源、非法引用拒绝、凭证保存/替换/删除、并发查询恢复、窄屏/深色布局及原 Python 调用只续接一次。此夹具直接挂载共享表单。
- `npm run validate:right-tabs:web`：隔离原生 DSH Host，验证标题刷新、顶部列表、Tab 内新增和测试、凭证待办跳转与续接、解绑失效及卸载清理。
- [数据源 Tab 截图](../artifacts/datasource-tab-refactor/datasource-directory.png)：实际原生分栏中的配置和连接测试结果。

本次只使用隔离验收 Host；未重装插件、清理用户测试状态或重启当前 DSH 服务。
