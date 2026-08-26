# Slice 1 验收：Environment Binding

状态：通过

日期：2026-08-25

规格来源：[MVP 设计](mvp-design.md#slice-1environment-binding)

## 独立范围

本 Slice 只实现 Environment Binding：

- `projectRoot` 和解释器解析，不扫描 PATH、父目录或系统 Python；
- doctor subprocess policy、JSON 解析和 disclosure admission matrix；
- binding identity、fingerprint 和 bounded doctor diagnostics；
- 后续 inventory/focused help 共用的 import identity assertion；
- timeout、cancel、stdout/stderr 上限和跨平台子进程树终止；POSIX 使用独立进程组，Windows
  使用 direct-argv `taskkill /t /f`。

本 Slice 没有注册 `marivo_help` Tool，没有解析 target inventory，也没有实现 checkpoint、
telemetry 或真实模型轨迹。这些职责分别留给 Slice 2–4。

## 开发结果

实现位于 `packages/dsh-data-analysis/src/environment/`。关键契约如下：

- doctor 即使非零退出也先解析完整 JSON；
- admission 只依赖 `installation.python`、`installation.marivo`、
  `project.marivo_toml` 和请求 identity，不以 top-level status 代替；
- datasource、secret、skill、semantic 和 state 诊断不会单独阻断 disclosure；
- subprocess policy 在 binding 时固定 `cwd` 和环境投影，所有调用使用 direct argv；
- fingerprint 不包含 doctor overall status、credential 或环境变量值；
- import identity 一旦不一致，旧 binding 永久进入 `failed`，必须显式 rebind。

## 独立审查

审查发现并在验收前修复了三项问题：

1. 环境变量快照最初是 public field，存在被上层误序列化的风险；现已改为 private field。
2. doctor JSON 无效时最初没有携带 bounded stderr；现返回 exit code 和最多 2,000 字符 stderr。
3. timeout 测试最初只覆盖直接子进程；现增加 descendant marker，证明 POSIX 整个进程组被终止。

审查同时确认：实现未导入 Marivo private registry，未缓存 doctor/help，未添加 system Python
fallback，也未提前实现 objective-to-API 规则。

## 确定性验收

```text
npm run typecheck   -> pass
npm run test:slice1 -> 12 passed, 0 failed
```

测试覆盖默认/显式解释器、缺失 root/解释器、非准入 doctor failure、三类 admission failure、
无效 JSON、fingerprint、固定 cwd/environment、identity fail-closed，以及 timeout/cancel/output
上限。

## 本地 Marivo 源码验收

项目 `.venv` 由 `../marivo/.venv/bin/python` 创建，并使用：

```sh
.venv/bin/python -m pip install -e ../marivo
npm run validate:slice1:real
```

验收绑定：

```text
Marivo source commit: 219337844187384514dc3736430fc9fecbc50004
Python: /Users/lichengxiang/source/oss/dsh-data-analysis/.venv/bin/python
Marivo version: 0.4.13.dev0
Package: /Users/lichengxiang/source/oss/marivo/marivo/__init__.py
Doctor overall status: warning
Target inventory stdout: 15,560 bytes
analysis.observe stdout: 6,732 bytes
```

doctor 的 warning 只来自本设计仓库没有 `models/`、`models/datasources/` 和
`models/semantic/`；installation 与 `project.marivo_toml` admission checks 均成功。真实
inventory 和 focused help 在同一 binding policy 下运行，并在渲染前核对 interpreter、version
和 package path。

## 结论

Slice 1 退出条件满足，可以进入 Slice 2。Slice 2 必须复用本 Slice 的 binding 和 subprocess
policy，不得另选解释器、解析 inventory 或把 partial multi-target stdout 当成成功结果。
