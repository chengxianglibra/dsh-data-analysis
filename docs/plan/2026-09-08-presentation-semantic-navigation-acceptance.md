# 报告语义导航验收

## 范围与责任

插件仅连接报告来源中已有的公开语义引用与现有只读语义层卡片。Marivo Catalog 仍是当前语义定义的事实来源，
报告数据与来源仍是生成时快照。Host 按报告所属 Workspace 调用导航，reader 不根据标签猜测对象、不重新查询或保存。

## 验收入口

```sh
npm run check
npm run build
npm run verify:plugin-package
npm run validate:presentation-semantic-navigation
```

模型测试覆盖精确引用、目标分页、清除旧筛选、跨 Workspace、迟到响应、关闭/卸载与失败后的快照隔离。
来源渲染测试覆盖 Host 可点击引用、全部语义对象类型（包括 `entity`）、无效引用保留文本与离线入口无导航按钮。
类型中文名称复用语义层标签，不作为导航白名单；新增 Catalog kind 保留其名称并沿用精确引用跳转。

Chromium 验收使用生产 `installSemanticBrowser`、`installPresentation`、共享 reader 和真实报告文件服务，
Catalog 使用合成目录；不接入运行中的 Harness Profile 或真实 Agent。检查键盘点击、同路径不同类型、全部 13 种现有类型及一个新增类型的导航与返回焦点、
对象不存在、空目录、读取失败、窄屏详情、三层 modal 的 Escape 与焦点恢复、未保存标题和全局筛选保留、
会话切换关闭语义层并使报告内容失效、离线交互 HTML 和无脚本阅读。RPC 审计仅允许读取 Catalog、报告指针和文件。

## 执行结果

2026-09-08，Node.js `v24.18.0`：

- `npm run check` 通过：格式、依赖、类型检查及 392 个测试，0 失败、0 跳过；reader 测试入口中的 `npm run build` 通过。
- `npm run validate:presentation-semantic-navigation` 通过；浏览器无 page error，目标项滚动进入列表可视区域。
  已检查桌面、390px 窄屏、实体详情和来源链接截图，来源中的有效引用显示为可点击路径。
- `npm run verify:plugin-package` 通过，包含分发包 contracts、presentation kit 和离线 builder 验证。
- 文档相对链接与 `git diff --check` 通过。

本机 Chromium 输出目录如下，包含 `result.json`、`source-links.png`、`semantic-desktop.png`、
`semantic-mobile.png`、`semantic-entity.png` 和离线 `report.html`：

```text
/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-semantic-navigation-rTL9KP
```

本次未重装插件、重启服务或发起真实 Agent 会话；上述浏览器结果证明生产客户端连接与交互，
不作为运行中 Harness 的部署或真实 Agent 验收。
