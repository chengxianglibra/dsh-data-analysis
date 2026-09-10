# 本机 Python 初始化 shared Runtime

## 范围与责任

2026-09-10：插件默认用本机 Python 的标准库 `venv` 与环境内 `pip` 初始化 shared Runtime。
Marivo 的 Python 要求仍以其公开包声明为准；当前检出源码 `requires-python = ">=3.10"`。
插件在创建 venv 前检查版本，固定安装 Marivo 0.5.4 与 presentation-kit 1.1.0，保留安装锁、
失败不发布 marker、Runtime identity 验证和有效安装复用。Harness 的生命周期和凭据职责不变。
配置与安装模式见 [Runtime 与 Workspace](modules/runtime-workspace.md#安装模式)。

## 验证证据

- Node.js 22.19.0 下 shared Runtime 专项测试 26/26 通过；覆盖 Python 3.10 接受、
  3.9/2.7 与非法版本拒绝、Python 缺失、venv 失败、pip 失败、并发安装、版本重建与管理员环境只读。
- `npm run check` 的格式、依赖、源码及脚本类型检查通过；Runtime Workspace 31/31 通过。
  完整检查停在并行修改中的 `tests/presentation-surface/surface.test.ts`：期望列表包含
  `marivo_datasource_configure`，实际构造的列表未包含它。未修改该测试。
- `npm run build` 与 `npm run verify:plugin-package` 通过，wheel、公开包内容和离线 builder 校验通过。
- 本机 Python 3.14.4 在临时目录通过真实 `venv` + `pip` 安装 Marivo 0.5.4 与
  presentation-kit 1.1.0，完成 Runtime probe；再次将 bootstrap Python 指向不存在的路径仍成功
  复用同一 Runtime identity。临时目录已清理。此验证未覆盖 Windows/Linux 主机。
- `git diff --check` 通过。

## 验收边界

真实初始化验证在独立临时目录执行，不改变用户的 shared Runtime 或运行中的 DSH。
未重装、重启或发布插件；开发构建 wheel 的工具链仍使用 uv。
