# 引用已持久化的分析结果

本页拥有插件的结果交接流程。Marivo 的持久化与读取 API 以绑定 Runtime live Help 为准。

## 准备结果

使用 `marivo_python`，访问项目、datasource 或持久化结果时传 `project:"required"`。插件准备当前 Workspace 根项目并返回准备状态，不需要初始化脚本。纯文件检查使用 `project:"none"` 和 `datasources:[]`。

新计算在同次调用中显式读取输入、计算和持久化，不依赖前次进程内存。相同固定结果可供多个视图复用；按实际依赖组织执行，而非为每个视图重复计算。适用的 governed 分析保留 AnalysisFrame：

```python
# frame is computed earlier in this call from explicit inputs.
saved = frame.persist(description="本次分析结果")
frame_ref = saved.ref.to_dict()
```

传 `resultVariables:{"overview":"frame_ref"}`。纯文件计算得到 DataFrame 时：

```python
import marivo.analysis as mv
# table is computed earlier in this call from explicit inputs.
table_ref = mv.persist_dataframe(table).to_dict()
```

传 `resultVariables:{"detail":"table_ref"}`。变量必须持有准确的持久引用字典。stdout 只作为日志，不用于发现引用。输出容量和字段约束由工具 schema 定义。

## 原样交付

成功导出的 `results[name].resource` 是完整资源声明，原样传给 `marivo_report_write.resourcePatch.put[name]`。插件从引用确定 kind，并在同次执行来源记录成功时关联 codeRef；模型无需配对身份。

```javascript
const output = execution.results?.detail;
if (execution.execution.reason !== "succeeded" || !output) {
  throw new Error("Inspect execution/export state before continuing.");
}
draft = await tools.marivo_report_write({
  stage: "preview", ref: draft.ref,
  resourcePatch: { put: { detail: output.resource } },
  program: 'detail = DatasetView("detail"); root = Stack([detail]);',
});
```

逐项检查执行、导出、来源及 metadata 状态。来源或元数据不可用不使已导出的 resource 失效，不授权重跑业务代码。`results[name].metadata` 和 writer 的结构化 `resultMetadata` 提供配置名与覆盖范围；先据此修复视图。

codeRef 只证明该次执行导出过此引用，不能证明最初生产来源、完整 lineage 或分析正确性。外部既有结果可直接提供准确声明；缺少脚本时说明来源缺口，不为补记录执行读取脚本或重新计算。提供错误或无关 codeRef 会明确失败，不能把它当成可忽略警告。

复用结果时保留完整 resource。派生计算显式读取准确固定输入并持久化新输出，使用新执行声明。用户要求刷新数据时显式生成新结果，不能用相同引用冒充刷新。

## 展示与来源边界

Host 在绑定 Runtime 中通过 Marivo 公开 API 读取固定结果，生成并内嵌展示快照；展示不隐式 compute/persist，也不重放生产脚本。分析视图的布局与文字编辑可复用已保存快照。

投影最多 64 列、5000 行、100000 个单元格和 2 MiB；截断、精度、类型或 coverage 限制以本次结果与错误为准。`coverage.complete` 只证明输入结果被完整展示，不证明业务全量；过滤、Top N、分母及时间范围须在分析中核对。

图片继续使用 `{kind:"image-file",path:"Workspace相对路径"}`。目前不支持图片来源 codeRef；同路径声明复用原内嵌图片，更新使用新路径。普通文件交付走 Harness 原生 `present`。

执行超时、取消或非零退出不能证明没有持久结果或其他副作用。先检查已有事实，不自动重放；缺少固定结果时按原授权范围明确安排新计算。
