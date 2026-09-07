# 当前 Workspace 卡片交互验收

日期：2026-09-08。

## 变更范围

- 语义层、数据源与凭证卡片仅由当前会话所属 Workspace 打开，移除 Workspace 选择器；会话或绑定变化关闭旧内容。
- Metric 计算口径与时间折叠直接显示公开函数名，保留引用链接、参数与 Marivo 时间语义。
- 数据源表单读取当前 Runtime 的公开 Spec 字段，通过 `md.register()` 新增；拒绝已存在的同名定义。
- 凭证字段内新增、更换直接保存；连接测试独立发起；等待中的调用仍使用保存、验证、续接流程。

## 验证入口

`npm run check` 已通过，覆盖类型、质量、依赖和 378 项测试（0 失败、0 跳过）；`npm run build`、`npm run verify:plugin-package` 已通过。
新增回归覆盖单项凭证保存不测试未配齐配置、Host/Runtime 变化拒绝写入和新增结果迟到不覆盖其他 Workspace。

`npm run validate:semantic-browser:web` 已通过，使用真实 Marivo 0.5.4 Catalog 和 Chromium，验证无 Workspace 选择器、函数名、切换会话、旧快照隔离及窄屏。
`npm run validate:credentials:web` 已通过，使用真实 Marivo 0.5.4、生产 RPC/凭证服务和隔离 DSH 槽位，验证新增数据源、凭证、同名拒绝、连接测试、原 Python 调用只续接一次，以及窄屏与深色布局。

## 边界

浏览器验收使用临时 Workspace、隔离凭证 provider 和本机 Chromium；未重装插件、重启现有 DSH Web 或使用外部数据库账户。
Marivo 拥有 Spec 校验与文件写入，DSH 拥有凭证存储；插件新增操作的串行区间不承诺与外部编辑器同时写入的跨进程事务。
