# 第四阶段：安装、卸载与依赖兼容验收

## 结果与范围

2026-09-09。实现[设计第四阶段](dsh-alpha-refactor-design.md#第四阶段收紧接线与维护成本)的安装失败回滚、
可等待卸载与依赖兼容检查。`plugin.ts` 保持 profile 组合入口，Agent 安装拆到 `plugin-agents.ts`，
任务跟踪与全量清理分别由 `lifecycle.ts`、`tool-lifecycle.ts` 支撑。未实施编辑迁移、上传分析、RPC transport
更换或构建提速；未发布、推送、重装用户插件或重启已有 Web。第三阶段调研与设计改动保留。

## 安装和关闭契约

- 已有 Agent 的批量安装任一失败，回滚本批全部注册；后续新 Agent 失败只清理自身。多步 installer
  在返回 disposer 前失败也清理前序资源，包括 PTC 第二个 hook 注册失败。
- profile 创建共享 credential service 并独占关闭责任。Agent 只结束自身 operation；credential RPC
  只撤入口、取消并等待其请求。独立 installer 自建的 credential service 仍由它关闭。
- `dispose()` 同步停止新工作，controller 增加 `close(): Promise<void>`；`installMarivoPlugin` 返回值仍可调用，
  调用后同步停止并返回可等待 Promise。重复关闭复用同一完成过程。顶层 Cordis 卸载等待它完成。
- 先停止新 Agent 安装、撤下入口和发送取消；再等待 Help、present、Python、凭据、RPC、Catalog、usage
  的实际任务；最后释放 binding manager 与 shell fact。清理失败不跳过其他资源，最后汇总抛错。
- 取消包装 Promise 提前拒绝不代表底层已结束，因此 Catalog 与环境解析分别跟踪原始任务。
  本地进程终止不代表远端数据库查询取消。保存已提交后仍保留 Build/current 与 receipt，不删除或重放成果。

实现职责见[插件集成模块](modules/plugin-integration-delivery.md#生命周期)。

## 依赖声明与已验收版本

| 项目 | 结果 |
| --- | --- |
| Compatibility schema / 常量 | 保持 v2 与原公开常量 |
| DSH peerRange 与直接 DSH peers | `^0.1.5-alpha.1` |
| 开发 distribution / 本次真实验收 | `0.1.5-alpha.1`；Node.js `22.19.0` |
| Marivo / helper 身份 | 精确身份契约保持现状 |
| 更高已发布匹配版本 | 本次 npm registry 查询未找到，最高匹配仍为 `0.1.5-alpha.1` |

`semver.satisfies` 使用[npm 默认预发布匹配规则](https://github.com/npm/node-semver#prerelease-tags)，
不启用全局 `includePrerelease`。接受 `0.1.5-alpha.2`、`0.1.5-rc.1` 和 `0.1.x` 稳定版，
拒绝旧基线、`0.1.6-alpha.*`、`0.2.x`。这些版本 fixture 仅证明匹配规则，不能证明未来真实版本兼容。
开发 distribution 保留明确版本，lockfile 保留实际解析结果；不额外锁死所有开发依赖。

`deps:check` 与包验证共用 `scripts/dependency-policy.mjs`：逐项检查插件直接消费的 28 个 DSH peers，
并核验 Host、插件与相关服务解析的 Cordis/DSH 物理身份。不要求所有不同名称 DSH 包的版本字符串相同，
不对无关传递依赖施加同版限制。隔离解析 fixture 接受正常 workspace 链接及不同的兼容服务版本，
拒绝第二份 Host 实例和越界服务版本。生产源码的 AST 导入检查阻止 SessionPersistence、验证脚本、
绝对路径和通过 symlink 进入邻近 checkout；Host client external/metafile 与 portable 自带 React 检查保留。

## 故障与卸载证据

`tests/plugin-integration-delivery/lifecycle.test.ts` 覆盖首个、第二个已有 Agent 和后续新 Agent 在 Tool、
hook、prompt 阶段失败；包含 PTC 第二个 hook。检查自身注册全部撤回，普通插件资源保留，其他 Agent 保持可用。
另外覆盖清理异常、重复关闭、停止后的拒绝、Tool 实际任务 barrier、Catalog 原始任务 barrier、
presentation identity resolver barrier 和 credential service 借用所有权。

RPC 回归用 barrier 检查已准入请求收到取消，路由同步撤回，旧 handler 拒绝新请求，关闭等待实际处理结束。
语义引用回归确认调用者取消后，即使不再等待 resolver，service close 仍等待该 resolver。
报告编辑回归在提交前阻塞 identity resolver，证明关闭等待且 current 不变；在提交后阻塞并丢失响应，
证明关闭等待、保存只调用一次、current 与完整 Build 保留。原有冲突、响应丢失恢复和提交取消回归继续执行。

## 隔离真实生命周期

`npm run validate:plugin-lifecycle:real` 使用实际 Cordis、Agent、Tool、Connection、Credentials、StorageDomain、
Shell/Subprocess 及本机已安装的 Marivo Python；home、Workspace、Runtime marker 均隔离，结束后删除该测试目录。
scripted adapter 不调用远端模型或业务数据库。

故障注入真实 prompt section 后验证安装失败与同一 Agent 重装；普通 Agent 请求与 focused Help 成功。
实际 Connection Fetch 验证 `200 → 卸载后 404 → 重装后 200`。启动真实 `marivo_python` 写 PID 再 sleep，
卸载后确认执行已取消且 Python 已退出，然后再次重装/卸载。进程状态证据区别进程消失与 OS 待回收的 zombie，
不把 PID 尚存在直接解释为仍在执行。此脚本的 Fetch 在进程内调用，不独立宣称 HTTP 认证验收。
本地机器证据输出 `artifacts/dsh-stage-four-lifecycle-real.json`，不纳入 npm 分发。

## 验证入口

- `npm run check` 通过：536 项中 532 通过，4 项真实 Python 默认 opt-in；后补全注册点故障注入的
  `test:plugin-integration-delivery` 66 项全部通过，增补后 quality/typecheck 也通过。
- `npm run build`、`npm run verify:plugin-package` 通过：244 个分发文件，28 个 DSH peers，
  Host/portable 构建、wheel、离线 builder 与隔离消费者加载通过。
- `npm run validate:plugin-lifecycle:real` 通过；进程状态改为区分 zombie 后连续两次通过，
  两次关闭时 Python PID 均已消失。此前一次仅检查 PID 的断言失败，未将其计为通过证据。
- `npm run validate:presentation-integration:real` 的 Native/both/PTC 与持久化 headless 部分通过；
  Web 部分在旧“分析快照”dialog 定位超时，未计为完整通过。当前 client 已迁移到原生 Tab，
  改跑现有 `npm run validate:right-tabs:web` 44 项全部通过，包含真实客户端加载、离线下载、延迟响应、
  断线重连、Workspace 撤销与 client unload。旧脚本迁移不纳入本轮。

- 显式指定真实 Runtime 后，Python 超时、调用者取消与 Code Mode deadline 3 项通过；121 秒长执行单独开启 opt-in 后也通过，执行与 code capture 均仅一次。
- 修改文档的 76 个相对链接可解析，GFM 渲染无横向溢出，`git diff --check` 通过。

未来出现更高匹配发布版本时，应在隔离安装树补做公开 API、生命周期
及客户端加载验收，并记录实际版本；不能把此次范围声明或模拟版本号作为该版本的运行证据。
