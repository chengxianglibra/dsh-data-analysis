# Marivo 0.5.5 依赖升级验收

2026-09-10：Compatibility manifest 将 Marivo 精确版本从 `0.5.4` 升级为 `0.5.5`，
安装规格为 `marivo[duckdb,trino,clickhouse]==0.5.5`。同步当前契约文档、测试夹具与包验证断言。
Runtime 安装、Workspace binding 和凭据责任边界保持不变，见 [Runtime 与 Workspace](modules/runtime-workspace.md)。

## 真实 Runtime 验收

Node.js `22.19.0`、Python `3.14.4`，在隔离临时目录执行：

```sh
TMPDIR=/private/tmp DSH_DATA_ANALYSIS_KEEP_VALIDATION=1 npm run validate:runtime-workspace:real
```

通过真实 pip 安装 Marivo `0.5.5` 与 presentation-kit `1.1.0`，验证安装复用、
两个 Workspace 的独立 binding 与零隐式写入、checked presentation writer，
以及 Workspace 遮蔽、管理员 Python 遮蔽和缺包时的明确拒绝。

本机默认临时目录的 `/var` 与 `/private/var` 别名曾导致 Python identity admission 失败；
改用规范路径 `/private/tmp` 后通过，未修改 identity 校验。

## Catalog 兼容性

Marivo `0.5.5` 在空 Workspace 中公开 `datasource:default`。两组真实 Catalog 测试已更新
此断言并通过，覆盖全部 13 类对象、引用候选、失败读取及零 Workspace 写入；
浏览器测试继续禁止 observe、preview、readiness、数据源测试等数据操作。

## 仓库与分发验证

- `npm run build` 与 `npm run verify:plugin-package` 通过；产物确认 Marivo `0.5.5`。
- `npm run check` 与 `git diff --check` 通过。全量检查使用 `DSH_DATA_ANALYSIS_TEST_PYTHON` 指向上述隔离 Runtime；本机原 shared Runtime
  为 `0.5.4`，不能作为本次升级的测试环境。
- 本次未重装正在使用的插件、重启 DSH、运行真实模型或外部数据源验收。
