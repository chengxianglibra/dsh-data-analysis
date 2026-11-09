# 引用已持久化的分析结果

本页属于插件的展示交付契约；持久化、读取、标量类型与修复操作以绑定 Marivo live Help 为准。

## 确认工作区项目

首次 Marivo 分析或结果持久化前，在当前绑定 Workspace 根目录检查 `marivo.toml`，不要把父目录的项目识别为本工作区项目。缺少时单独调用 `marivo_python(datasources:[])` 完成初始化；这次调用是环境准备，不产生报告组件：

```python
from pathlib import Path
import subprocess
import sys

root = Path.cwd().resolve()
manifest = root / "marivo.toml"
if not manifest.exists() and not manifest.is_symlink():
    subprocess.run(
        [sys.executable, "-m", "marivo", "init", "--project-root", str(root)],
        check=True,
    )
if not manifest.is_file():
    raise RuntimeError("Workspace marivo.toml is not a readable project file")
print(f"Workspace project: {root}")
```

使用绑定解释器，不运行 PATH 或 Workspace .venv 中的其他 Marivo。初始化成功后再执行组件脚本，核对生成引用仍指向当前 Workspace。已有无效 manifest 按实际错误处理；不使用 `--force`，不覆盖原项目或手写 manifest 规避校验。`marivo init` 创建项目脚手架，包含 models、状态目录及上游 Skill 链接；它不建立 datasource 或业务语义。普通文件预览无需初始化。

## 单个组件的持久化出口

每个报告数据组件单独调用 `marivo_python`，脚本包含输入读取、计算和以下一种持久化出口。下面两段是不同组件类型的出口示意，不是把多个组件放进同一调用的模板；具体分析代码按当前 Runtime Help 编写。

优先保留 governed 分析得到的 AnalysisFrame：

```python
import marivo.analysis as mv

# frame is computed from this component's inputs earlier in this same call.
saved = frame.persist(description="本次分析结果")
frame_ref = saved.ref.to_dict()
```

该调用传 `resultVariables:{"overview":"frame_ref"}`。纯文件或合法外部计算得到 DataFrame 时，使用另一份独立脚本：

```python
import marivo.analysis as mv

# table is read and computed earlier in this same component call.
table_ref = mv.persist_dataframe(table).to_dict()
```

该调用传 `resultVariables:{"detail":"table_ref"}`。脚本结束后包装层返回结构化 `resultRefs`，取得引用后立即更新对应组件的草稿。stdout 可以是任意日志，不用于发现引用。变量必须是准确的持久引用字典，不是表达式、内存 DataFrame 或未持久化 Frame。未声明 resultVariables 的普通脚本照常执行。

`marivo_present.resources` 的每个资源使用准确的引用字典：

- AnalysisFrame：`{ "kind": "analysis-frame", "ref": <saved.ref.to_dict()>, "codeRef": <同次 marivo_python 回执中的 codeRef> }`。
- DataFrame：`{ "kind": "dataframe", "ref": <reference.to_dict()>, "codeRef": <同次 marivo_python 回执中的 codeRef> }`。
- 图片继续使用 `{ "kind": "image-file", "path": "Workspace相对路径" }`。

Frame 引用含 `schema: "marivo.frame_ref/v2"`、`store_id`、`session_id`、`artifact_id`。
DataFrame 引用含 `schema: "marivo.dataframe_ref/v2"`、`project_root`、`result_id`。
不得拼造、补写或改换引用中的身份；DataFrame 的 `project_root` 必须属于当前 Workspace。
从返回的 resultRefs 按名称取准确引用，并同时保留 codeRef。工具容量是至多 16 个输出、32 KiB 结构化导出；报告流程每次只导出目标组件的结果。变量缺失、非法引用或导出失败时返回 resultCaptureError，原执行成功状态保持不变，不重放代码来补导出。
提供 `codeRef` 时，Host 核验同一 Workspace 的执行记录确实登记了该引用；无关或不可读的记录明确失败。

Host 在绑定 Python Runtime 中使用 Marivo 公开 API 恢复固定结果并生成展示投影；
不需要 HTTP 服务、原分析进程、当前模型或数据源凭据。展示不会隐式 compute/persist。
持久引用可以在后续调用中复用；页面编辑复用未变化资源，用户要求刷新数据时则独立重算指定组件，不能用旧引用冒充刷新。
报告保存后内嵌展示快照，布局与文字更新不依赖原 Store。
Marivo 引用自身不提供 Harness 脚本身份。脚本和 `codeRef` 来自 Host 执行回执，不能拼造，也不能拿其他调用的 codeRef 关联。
已有外部结果或脚本记录失败时可省略 codeRef，但须说明无法追溯脚本，不为补记录重跑分析。
关联证明该次执行导出过引用；若代码只读取已有结果，不能把它称为最初的计算脚本。新组件脚本将读取输入、计算、持久化放在同次调用中，并用 resultVariables 声明该组件的引用变量。

分析生成的图片使用自己的完整脚本，成功后交付 image-file 路径；目前图片声明不支持 codeRef。刷新图片时使用新路径，同路径声明会复用原内嵌图片。已有外部图片按实际来源使用，不补造生成脚本。

## 展示预算与覆盖范围

每份投影最多 64 列、5000 行、100000 个单元格、2 MiB。行数超限保留总行数并明确标记截断；
列数、单元格文本、字节或不支持的展示类型超限会失败，不改变原持久结果。
DataFrame 读取 API 会完整读取保存结果，展示预算只限制投影，不限制其内存或文件 I/O。

整数与 Decimal 保留精度；datetime 需要明确时区且精度不超过微秒。duration、复合值等
当前展示 codec 不支持的值明确失败，不为通过展示猜时区、截掉精度或转换成文本。
列展示名通过 `marivo_present.labels` 设置；不改写值或列身份。

`coverage.complete` 只证明输入结果被完整展示，不证明业务全量。过滤、Top N 和业务范围须在分析中说明；
不要把截断数据用于全量总计、完整单值或要求 complete 的图表。

## 失败处理

Frame 或 DataFrame 的展示读取失败，以 `marivo_present` 错误为准。核对完整引用、当前 Workspace、
Runtime 和保存结果的可访问性。缺失或损坏不授权重跑分析；优先使用已有报告内嵌的资源。
确需重新计算时，将其作为明确的新执行，遵守原授权、范围和预算。

`marivo_python` 的 `execution.reason` 描述原 Python 的真实退出结果，`codeRef` 仅在脚本来源成功保存时返回。
超时、取消和非零退出不能证明没有保存结果或其他效果；按实际状态检查，避免自动重放。
插件不再提供 `capture_dataset`、`capture_frame` 或捕获回执协议。
