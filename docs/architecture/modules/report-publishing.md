# 分析视图 HTML 导出与发布

## 离线下载

对象存储发布关闭时，分析视图 Tab 的三点菜单显示「导出 HTML」，可将当前显示的已保存 `dsh.analysis-ui/v3` 文档下载为单个 HTML 文件。导出使用已读取并校验的固定 Build，包括历史版本；不重新查询数据源、执行 Python 或更新视图。生成和下载发生在浏览器中，不创建 Workspace 或 Session 文件，也不自动通过 Harness `present` 交付。

浏览器发起下载后显示短暂提示；生成或发起下载失败时显示可关闭的错误提示。下载提示不代表文件已成功保存。

文件内嵌渲染所需的代码、样式、图片、已保存数据快照，可在支持 JavaScript 的浏览器中离线打开。布局、图表、Tabs、表格及无需 Host 的本地交互复用分析文档 reader；具体视图和数据范围仍以保存的快照为准，已截断的快照不会因导出而变完整。文件包含保存的快照，即使其中某些数据当前未显示，分享前应检查内容。为减少不必要的身份披露，导出投影不保留 Host Workspace、Session、调用及图片路径等绑定身份；它不是对业务数据或语义元数据的脱敏。

离线筛选复用保存的声明与默认值；导出不携带阅读时的临时选择，打开后可在完整已保存快照上本地筛选、清除或恢复默认，不访问 Host 或业务来源。

离线页面不连接 Harness：就此提问、语义定义导航和 Host 侧 Python 源码读取不可用。独立文件不保证访问浏览器的剪贴板权限，实际复制能力取决于浏览器。HTML 依赖 JavaScript；禁止 JavaScript 时显示提示。导出文件为生成时的独立副本，不跟随视图后续更新或插件卸载变化。

保存和读取契约分别见[展示交付](presentation-delivery.md)与[分析文档 reader](presentation-reader.md)。

## 对象存储发布

在当前 Harness profile 的插件配置中开启 `reportPublishing`，并预先配置 Bucket 和浏览器访问地址。配置只保存 Harness 凭据引用。

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
    # sessionTokenRef: REPORT_AWS_SESSION_TOKEN
  pathPrefix: reports
  publicBaseUrl: https://reports.example.com
```

默认关闭。`endpoint` 用于上传，`publicBaseUrl` 指向 Bucket 根目录对应的浏览器访问地址，可包含 CDN 映射路径。对象键包含 `pathPrefix`，默认为 `reports`，可显式设为空字符串。三个凭据引用必须互异。配置了 `sessionTokenRef` 时，发布也需要解析到对应值。每次上传由 Host 从 Harness Credentials 解析这些引用。Bucket 的访问权限由管理员管理。

Web 用户在「数据源与凭证 → 凭证管理 → 报告发布凭证」录入凭据。「凭证管理」与「数据源」是同一页面的标签。表单显示目标存储、Bucket 和已声明引用的配置状态、来源及可写性，通过 Harness Credentials 新增、更换或确认删除值。密钥输入随提交或离开标签清空。配置更新后先刷新状态，再重新填写。补齐凭据后可再次发起发布。

开启发布后，报告三点菜单显示「发布到对象存储」以替换「导出 HTML」。菜单每次打开时读取发布配置和凭据状态。选中发布会上传当前显示的固定 Build，成功后提供访问链接。缺少凭据时，「前往凭证管理」直接打开「数据源与凭证」页面内的对应标签。补齐后返回报告，从菜单重新发起发布。

开启后注册 `marivo_publish_report({ ref })`，接受当前 Session 所属 Workspace 的准确 saved ref。Agent 仅在用户明确要求发布时调用。服务端从已保存历史读取指定 Build，验证 Workspace、文件摘要和文档契约，再用离线下载的同一渲染器生成自包含 HTML。可发布当前版本及可读的历史版本。结构化回执包含 URL、对象键、Workspace/Report/Build ID、HTML SHA-256、字节数和上传时间。

认证 RPC channel `/dsh-report-publishing` 使用 Harness 精确 POST 路由。请求载荷和返回值如下。

| 操作 | 载荷 | 成功返回 |
| --- | --- | --- |
| `describe` | `{ workspaceId }` | 开启状态；开启时附 `configId`、存储名称、Bucket、已声明凭据的状态 |
| `set` | `{ workspaceId, configId, field, value }` | 更新后的状态 |
| `unset` | `{ workspaceId, configId, field }` | 更新后的状态 |
| `publish` | `{ workspaceId, configId, ref }` | 上传回执 |

`field` 限于插件配置中的 `accessKeyId`、`secretAccessKey` 或可选 `sessionToken`。Web 凭证管理标签调用 `describe`、`set` 和 `unset`。凭据值经认证请求送入 Harness Credentials，返回的状态包含引用名、来源、配置状态和可写性。更新配置后需要重新获取 `configId`。`publish` 中的 saved `ref` 必须属于请求指定的 `workspaceId`。

对象路径为 `{pathPrefix}/{workspaceName}/{reportName}/{publicationId}/index.html`。名称经 NFKC 规范化，保留字母、数字、下划线和连字符，其他连续字符替换为连字符。每段最多 48 个 Unicode 字符，空名称回退为 `workspace` 或 `report`。URL 逐段编码。`publicationId` 取 Workspace、Report、Build 和 HTML SHA-256 所组成的 JSON 数组摘要前 32 位。相同名称和内容可重试同一键，重新构建渲染器也可能生成新的 HTML 和对象键。

发布只读取固定 Build 并上传 HTML。上传结果未确认时对象可能已经写入。Agent Tool 给出对象键，先核对该对象再决定是否重试。成功回执只确认 S3 上传，浏览器访问取决于 Bucket 或 CDN 配置。报告 HTML 包含保存的数据快照，发布前应确认分享范围。
