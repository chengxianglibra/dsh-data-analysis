# 凭证服务集成验收

日期：2026-09-07。范围：插件源码集成、随包 Marivo Runtime、确定性回归、真实 Python、真实模型和隔离浏览器。
当前契约见 [Datasource Credentials](../modules/datasource-credentials.md)，实施计划见
[凭证服务集成](../plan/2026-09-07-credential-service-integration.md)。

## 实现结果

- DSH Credentials 负责值；管理页只展示字段引用、配置状态、来源、可写性和测试结果。
- test/access 缺失输入时保持原调用，表单提交验证后续接；已有配置的失败直接交还 Agent。
- 新 `marivo_python` 通过 DSH Shell 服务执行，stdin snapshot 注入公开 resolver，普通 Shell 不获得值。
- 授权绑定 Agent、环境和定义，30 分钟、64 次；每次 fresh-resolve，轮换撤销后续授权。
- 操作 ID 去重、终态查询、响应丢失恢复、取消、外部更新与插件关闭清理均有回归覆盖。

## Runtime 来源

随包 wheel 为 `marivo-0.5.3.dev0-py3-none-any.whl`，从 Marivo 已提交源码
`ca4d0fe59f47d0c967414abdbe2d433b43dc395a` 的 `git archive` 构建，未纳入 sibling 工作区的未提交变更。

SHA-256：`b888584da24ecbfbf8be6bc02d7d99cca22f83a21e065f8b1bee4319cfbd1717`。
包内 [source.json](../../packages/dsh-data-analysis/python/marivo/source.json) 和兼容声明记录相同身份。
本次构建产生的本地忽略文件已清除；包清单显式包含 wheel 与来源记录，验证器检查二者一致。

真实 Python 使用该 wheel 安装的独立虚拟环境，未替换用户正在运行的 DSH profile。

## 确定性与包检查

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 通过；quality、依赖、源码与脚本类型检查、154 个测试 |
| datasource suite | 33 个通过；包括真实 DSH Code Mode worker 的预算内续接和外层超时取消 |
| `npm run build` | 通过 |
| `npm run verify:plugin-package` | 通过；真实 npm 包共 99 个文件，wheel 哈希、来源记录和导入检查通过 |
| `git diff --check` | 通过 |

覆盖的关键竞争包括：提交去重、保存部分成功、测试失败后重填、Agent/外层取消、定义变更、解析中轮换、
已接受 snapshot 的稳定性、管理操作取消不回滚已保存字段、外部更新刷新待办、dispose 等待清理。
这些测试不宣称已经穷举所有 provider 或数据库驱动。

## 真实 Python 与 Agent

`validate:datasource-credentials:real` 组装实际 Harness Tool/Shell 与 Marivo，读取需要 bearer token 的
本地 HTTP 数据源。结果：真实聚合为 30；授权外 datasource 被拒绝；默认同名环境 canary 未被使用；
原始 fd 输出和 Python traceback 中的 fixture value 被脱敏；项目文件扫描未发现值。

`validate:datasource-access:real` 使用真实 DeepSeek 模型，从缺失凭证开始调用 access。设置
`DSH_CREDENTIAL_WAIT_MS=66000`，待办保持超过 65 秒，随后 Host 提交、测试成功，同一 Agent 轮次继续
调用 `marivo_python`，读取实际 HTTP 数据并完成聚合。Session events 和项目扫描未发现 fixture value。
模型分支自身不重复声称验证 fd 脱敏；该项由上一项独立验证。

可复现命令：

```bash
export DSH_DATA_ANALYSIS_PYTHON=/absolute/path/to/isolated/bin/python
npm run validate:datasource-credentials:real
DSH_CREDENTIAL_WAIT_MS=66000 npm run validate:datasource-access:real
```

模型验证需要现有 DSH `DEEPSEEK_API_KEY`。缺失时脚本报告 blocked，不算通过；fixture datasource 使用
单独的测试 credential store，不修改用户的数据源值。

## 浏览器

真实 Chromium 加载构建后的插件 client，通过真实 Host service/RPC 和 Marivo 进行：

- Workspace 管理页填写、保存、测试、删除；
- 原调用等待期间刷新页面，恢复待办且未提交字段为空；
- 提交成功后原调用继续；
- 桌面与窄屏渲染、浏览器错误和页面/sessionStorage 泄漏检查。

截图已人工查看，表单、状态和窄屏布局可用。运行命令：

```bash
export DSH_DATA_ANALYSIS_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
npm run validate:credentials:web
```

该验证使用隔离的 DSH Slot 和 HTTP transport 夹具；不是当前安装 profile 的完整 DSH Web 端到端验收。
真实模型续接由上一节单独验证。本次未执行 profile 重装、服务重启、提交或发布。

## Review 修复复验

针对本地 review 的三个问题补充了修复与回归：

1. 固定 test bridge 必须接收原始 description；变化后的定义不能成为新的授权。真实 Marivo 在 datasource
   文件变化后返回 `credential_denied`，未使用旧 grant 连接新定义。
2. 直接 test 的解析与连接阶段均跟踪使用中的引用；即使没有管理上下文或 lease，外部更新也会触发
   `credentials-changed`。混合新旧字段的 snapshot 不进入连接测试，过期测试结果不写入历史。
3. Client 独立保留每个 operation 的查询、取消目标与恢复句柄；A 的晚到响应不终止 B 的查询。新增
   跨 Workspace 交错、多个句柄刷新恢复、后台操作不可恢复提示的回归。

复验包含完整 check/build/package、真实 Python 定义漂移拒绝，以及隔离浏览器中两个同时进行的连接
测试在刷新后的独立状态恢复。本次没有重新调用模型；真实模型长等待续接的证据仍为上文原始验收。
