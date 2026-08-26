# Plugin 集成与交付模块架构

## 作用

本模块是 composition root：把共享 Runtime、Workspace Environment、Help 披露、Datasource Tool、
全局 Skill provider 和 Web Tool View 组合为一个可由 DSH/Cordis 加载的插件，并定义构建与 npm 包
边界。它不承载 Marivo 分析语义，也不在组合层复制子模块状态机。

总体关系见[总体架构](../architecture.md)。主要实现与元数据：

- `packages/dsh-data-analysis/src/plugin.ts`
- `packages/dsh-data-analysis/src/index.ts`
- `packages/dsh-data-analysis/src/client.tsx`
- `packages/dsh-data-analysis/cordis.patch.yml`
- `packages/dsh-data-analysis/package.json`
- `scripts/verify-plugin-package.mjs`
- `scripts/pack-plugin.mjs`

## Cordis 生命周期组合

插件声明依赖 `agents`、`credentials`、`skills` 和 `tools` 服务。`apply(ctx, config)` 的组合顺序是：

1. 解析显式配置与 `DSH_DATA_ANALYSIS_*` 环境变量；
2. `ensureSharedMarivoRuntime()` 创建或验证 profile 级 Runtime；
3. 通过 `dsh-skill-filesystem` 挂载隔离 provider
   `dsh-data-analysis-marivo`，只包含 Runtime Skill root，不引入默认 roots；
4. 创建一个 `MarivoWorkspaceEnvironmentManager`；
5. 为现有 Agent 安装 disclosure 与 datasource 控制器；
6. 监听 `agent/created` 安装新 scope，监听 `agent/disposed` 清理 scope；
7. plugin dispose 时先清理 Agent controllers，再释放 manager cache。

现有 Agent 的安装具有事务性：任一 scope 安装失败时，已安装 controller 全部 dispose，避免只有部分
Agent 获得 Tool。后续 Agent 的 Environment 是惰性解析的，创建 Agent 本身不会立即运行 doctor。

## Scope 与注册模型

| 资源 | 注册范围 | 生命周期 |
| --- | --- | --- |
| Shared Runtime | Cordis plugin/profile | `apply` 前半段建立，供整个 plugin 生命周期复用 |
| Marivo Skill provider | Cordis context | Runtime 成功后挂载；项目级同名 Skill 保持 Harness 优先级 |
| Workspace manager | Cordis plugin | 按 canonical root 缓存 binding Promise，dispose 时清空 |
| Disclosure controller | Agent | 观察 Session surface/Tool result，注册 `marivo_help` 和 pre-step hook |
| `marivo_test` | Agent scope | 使用同一 Agent Environment source，随 controller 清理 |
| Web Tool View | Web client context | 按 `marivo_test` Tool name 注入 slot |

插件不改变 inherited Tool registry 的可见性，也不为 native/code/both 模式维护分支逻辑。Tool 展示和
模型调用方式继续由 Harness profile 决定。

## 配置

| Cordis 配置 | 环境变量 | 默认与含义 |
| --- | --- | --- |
| `projectRoot` | `DSH_DATA_ANALYSIS_PROJECT_ROOT` | 未设置时按 Agent `session.header.cwd` |
| `pythonExecutable` | `DSH_DATA_ANALYSIS_PYTHON` | 未设置时由插件通过 `uv` 管理共享 Runtime |
| `runtimeRoot` | `DSH_DATA_ANALYSIS_RUNTIME_ROOT` | `$DSH_HOME/dsh-data-analysis/runtimes/marivo` |
| `uvExecutable` | `DSH_DATA_ANALYSIS_UV` | `uv`；显式值必须是绝对路径 |
| `installTimeoutMs` | — | `600000` ms |
| `initializeWorkspace` | — | `true` |

`cordis.patch.yml` 只把这些配置接入 Web profile 的 plugin graph。运行时默认值仍由 TypeScript 模块
解析，manifest 不成为第二套配置逻辑。

## 公共包接口

包根导出 Cordis entrypoint 和三个服务端模块：

```text
@deepseek-ai/dsh-data-analysis
@deepseek-ai/dsh-data-analysis/environment
@deepseek-ai/dsh-data-analysis/disclosure
@deepseek-ai/dsh-data-analysis/datasource
@deepseek-ai/dsh-data-analysis/client
```

命令行入口 `dsh-data-analysis-env` 复用真实 Runtime 与 binding 流程，用于 operator/deployment 检查。
`package.json` 是版本、exports、peer dependencies、client injection 和 bundle patch 的事实源。

## 服务端与客户端构建

服务端源码通过 `tsc -p tsconfig.build.json` 生成 ESM JavaScript、source maps 与 `lib/types/**/*.d.ts`。
客户端由 `scripts/build-client.mjs` 转译 TSX，并包装为 DSH 浏览器 module loader 可加载的
`lib/client.js`。`finalize-build.mjs` 同时保证 operator CLI 具有 executable mode。

构建后的职责边界为：

```text
src/*.ts, src/*.tsx
  ├── tsc ----------------------> lib/**/*.js + lib/types/**/*.d.ts
  ├── browser client builder ---> lib/client.js
  └── finalize -----------------> lib/bin/environment.js mode 0755
```

## npm 包契约

发布包只包含运行所需内容：

- `lib/**/*.js` 与 source maps；
- `lib/types/**/*.d.ts`；
- `cordis.patch.yml`；
- package README。

package verifier 使用 `npm pack --dry-run --json` 验证根入口、client、types、Cordis patch 和 executable
CLI 全部存在，并拒绝 `src/`、`tests/`、package build scripts 和 `tsconfig.build.json` 进入 tarball。
`pack:plugin` 在仓库级检查与 package verification 通过后，将 tarball 写入 `artifacts/npm/`。

## 验证分层

| 层级 | 命令 | 目的 |
| --- | --- | --- |
| 静态与确定性测试 | `npm run check` | TypeScript typecheck + 五个模块的确定性测试 |
| 构建 | `npm run build` | 生成服务端、声明、客户端和 executable CLI |
| 包内容 | `npm run verify:plugin-package` | 验证 exports 对应文件、排除开发文件、检查 CLI mode |
| 受控打包 | `npm run pack:plugin` | 重跑检查并生成安装 tarball |
| 模块集成测试 | `npm run test:plugin-integration-delivery` | 验证真实 composition root 的确定性 Web-profile 生命周期 |
| 补充真实验证 | `npm run validate:plugin-integration-delivery:real` | 通过真实 Cordis `apply` 和模型验证完整插件组合 |

其余四个模块分别提供同名 `test:<module>` 与 `validate:<module>:real` 入口。架构变更应优先补充对应
模块的确定性测试；只有真实解释器、DSH Web 或模型交互边界发生变化时，才需要相应的真实验证。

Plugin 确定性测试位于
`packages/dsh-data-analysis/tests/plugin-integration-delivery/web-profile.test.ts`。真实模型 runner 使用
`DSH_DATA_ANALYSIS_VALIDATION_MODEL` 选择模型，并将不含凭证值和 raw Help 正文的 `0600` 报告写入
`artifacts/plugin-integration-delivery-real-model.json`。

## 变更规则

- 新 profile 依赖必须进入 `inject` 并有明确 dispose 行为。
- 新 Agent Tool 应注册在 Agent scope，复用当前 Workspace Environment source。
- 新 browser UI 只投影结构化 Tool 结果，通过标准 DSH client service 写入状态。
- exports、client、package metadata 或分发内容变化时，必须同时运行 build 与 package verifier。
- 不把 upstream package 内部实现复制进 bundle patch；只声明插件装配关系。
