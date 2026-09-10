# 报告 HTML 发布

插件负责将已保存报告或浏览器当前视图上传到 S3 兼容对象存储；Harness 拥有凭据和 Workspace，Marivo 的分析与 Evidence 契约不变。发布不执行分析、不更新 Report current、不默认生成本地 HTML。

## 插件配置

在当前 Harness profile 的插件配置中添加：

```yaml
reportPublishing:
  enabled: true
  storage:
    name: 团队报告存储
    protocol: s3
    endpoint: https://s3.example.com
    region: us-east-1
    bucket: analysis-reports
    forcePathStyle: false
    accessKeyIdRef: REPORT_AWS_ACCESS_KEY_ID
    secretAccessKeyRef: REPORT_AWS_SECRET_ACCESS_KEY
    # 临时凭据才配置此引用；一旦配置，发布时必须有值。
    # sessionTokenRef: REPORT_AWS_SESSION_TOKEN
  pathPrefix: reports
  publicBaseUrl: https://reports.example.com
```

`enabled` 默认关闭。开启时验证所有发布配置；错误只返回固定诊断，不回显配置值。引用名使用 POSIX 环境变量标识符，三个引用必须互异。配置保存引用，不保存密钥。

`endpoint` 是写入服务地址，`publicBaseUrl` 是对应 Bucket 根目录的浏览器访问地址，允许包含 CDN 映射的基础路径。`pathPrefix` 是对象键前缀，不重复写入 `publicBaseUrl`。第一版支持单个目标；Bucket、访问域名及访问权限由管理员预先配置，插件不修改 ACL、不创建 Bucket、不签发临时访问链接。上传成功表示写入请求成功，不等同于验证公网可访问。

## 凭据与界面

开启后，“数据源与凭证”显示“报告发布凭证”入口，分别显示 Access Key ID、Secret Access Key、可选 Session Token 的引用、配置状态、来源及可写性。字段分别保存、替换或删除；空输入不删除。已有密钥不回显、不保存在客户端存储；关闭入口清空输入。

使用 Harness 的 `describe/set/unset/resolve` 单凭证接口，服务端只接受配置中声明的字段，不允许浏览器提交任意引用。引用是当前 Host 共享配置，所有使用该目标的 Workspace 共用。每次上传重新解析凭据并直接传入 SDK，不写进程环境，不缓存跨操作密钥。临时凭据由管理员更新，不自动刷新 Token。

在线报告三点菜单在开启时替换两项：

- “下载完整报告”替换为“发布 HTML 报告到〈storage.name〉”，发布当前查看的已保存 Build，包括历史版本。
- “导出当前视图”替换为“发布当前视图 HTML 到〈storage.name〉”，冻结当前筛选、排序与图形，上传浏览器现有导出器生成的快照。

两项均不触发本地下载；编辑时先保存或取消，上传中禁止重复触发。成功显示可打开的链接，失败保留阅读状态。上传期间编辑并保存了新 Build 时，旧上传的成功或失败只结束忙碌状态，不覆盖新版本的链接、错误或保存提示。关闭配置保留原下载行为；已存在的独立 HTML 不连接 Host，也不会随插件配置更新。

数据源页面标题为“数据源与凭证”。报告发布凭证在数据源区块下方独立展示，沿用数据源凭证的引用名称、字段与来源、配置状态徽标、新增/更换和确认删除交互；不回显保存值。报告右上角操作菜单不再重复展示 Build 短版本号，正文元信息与历史版本仍保留版本标识。

## 发布协议与生命周期

`marivo_publish_report({ report_id, build_id })` 只在开启时注册，用户明确要求发布后调用，返回含 URL、对象键、Workspace/Report/Build、HTML SHA-256、大小和时间的回执。Agent 不接收上传凭据或任意目标路径；Tool 只发布保存版本，当前视图通过浏览器入口提交。

认证 RPC channel `/dsh-report-publishing` 提供 `describe/set/unset/publish`，沿用 Harness 精确 POST 路由。`describe` 返回当前服务实例的 `configId`；所有 `set/unset/publish` 请求必须带回该标识，配置重载或服务重建后拒绝旧标识并要求刷新。配置在实例内保持不可变，凭据刷新成功后清空旧输入。`publish` 接收 `workspaceId/configId/reportId/buildId` 和可选 `viewHtml`；服务端验证 Workspace、已确认历史和文档摘要，按配置生成对象键。视图 HTML 是浏览器提供的呈现快照，不作为 Marivo 验证过的分析证据；服务端限制 HTML 字节数，并在内容前强制无脚本、无网络资源的 CSP。完整报告使用已有可信共享 renderer。

完整报告与当前视图路径统一为 `{pathPrefix}/{workspaceName}/{reportName}/{publicationId}/index.html`。名称分别取 Harness Workspace title 和保存 Build 的报告 title：先做 NFKC 规范化，保留 Unicode 字母、数字、下划线及连字符，其余连续字符替换为 `-`，最多保留 48 个 Unicode 字符，去掉首尾 `-`；空名称回退为 `workspace` / `report`。URL 对每段分别编码。`publicationId` 为 Workspace ID、Report ID、Build ID、发布类型及 HTML SHA-256 的 JSON 数组摘要前 32 位十六进制字符，同名对象仍相互隔离；名称不变时相同发布可重试同键，Workspace 改名后使用新路径，旧链接保留。此规则只作用于后续上传。HTML 使用 `text/html; charset=utf-8` 和 `inline`。不同内容不会覆盖；同字节重试写同键。报告保存与上传独立，上传不回写不可变 Build 或 current。回执随 Tool 输出或当前页面返回，不新增发布历史数据库。

操作设定超时并关联调用方及插件生命周期的取消信号，停止后等待在途操作结束。上传响应丢失或超时报告结果未确认，可能已有对象，不删除或回滚未知结果；可重新发布。关闭功能不撤销已上传对象。

## 验证

确定性测试覆盖开关、配置校验、单字段读写和脱敏、凭据轮换、历史 Build、名称规范化与长度上限、同名 Workspace/Build 隔离、发布重试、当前视图路径、取消，以及真实 AWS SDK 对本地 HTTP fixture 的签名 PUT。该 fixture 验证协议请求，不代表真实 S3 服务的权限、持久性、CDN 或公网验收。

运行 `npm run check`、`npm run build`、`npm run verify:plugin-package`；浏览器验收脚本为 `npm run validate:report-publishing`，使用合成报告与本地上传 fixture，不调用模型或真实业务数据。

2026-09-10 路径与凭证界面调整后 `npm run check`：613 通过、4 跳过、0 失败；`npm run validate:report-publishing`、`npm run build`、`npm run verify:plugin-package` 均通过。未连接真实对象存储、重装插件或重启 Harness。
