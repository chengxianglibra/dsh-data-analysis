# 刷新分析视图的数据

用户要求更新已保存视图的数据时，使用 `mode:"refresh-data"`。需要修改正文或布局时使用明确的 edit 操作。

## 审阅与执行

按缺口调用 `marivo_report_read({ref,version:"current",includeCode:true})`，读取结构化 definition、准确资源和来源。用户指定历史版本时读取 exact，并处理它与 current 的冲突。按准确引用复用组核对哪些别名属于本次更新，不自动扩大目标范围。

需要持续计算时，以 saved ref 开始 refresh-data preview；结果已准备好可直接 save。显式读取原来源或准确固定输入，计算并持久化所需结果，通过 `project:"required"` 的 Python 调用导出。缺脚本不授权猜测或重放；来源记录只说明导出执行，需审阅其真实输入和口径。

结果就绪后原样提交 `results[name].resource`。同次请求内的资源必须全部通过校验；任何失败均拒绝整批，不筛选成功项保存。可以显式提交已就绪子集，尚未计算的资源保留旧数据，答复说明未更新范围。已失败目标不能自动改称 pending。

```javascript
const definition = (await tools.marivo_report_read({
  ref: savedRef, version: "current", includeCode: true,
})).definition;
let draft = await tools.marivo_report_write({
  stage: "preview", ref: definition.ref, mode: "refresh-data",
});
const execution = await tools.marivo_python({
  project: "required", datasources: datasourceNames,
  code: reviewedCompleteScript, resultVariables: { result: "result_ref" },
});
if (execution.execution.reason !== "succeeded" || !execution.results?.result) {
  throw new Error("Inspect execution/export state; do not replay successful code.");
}
draft = await tools.marivo_report_write({
  stage: "preview", ref: draft.ref,
  resourcePatch: { put: { result: execution.results.result.resource } },
});
const saved = await tools.marivo_report_write({stage:"save", ref:draft.ref});
```

实际资源名、输入、计算和范围按本次任务填写；示例不能代替分析脚本。

## 工具强制边界

refresh-data 只允许已有资源名的 put，禁止 remove、program、title、locale 和 labels。完整页面和所有受影响视图必须通过；auto 解析为不同图形类型时拒绝。页面定义与字段映射保留，但行数变化可改变图形内部尺寸，不承诺几何不变。

相同声明返回 reused，不代表新计算。准确引用共享的其他别名不会自动更新。冲突时先审阅当前视图和草稿，再通过 onto 预览；不自动换基准或重算。

静态正文不会随数据刷新。需要改正文时，以保存后的 ref 进入明确 edit，按实际结果修改。

最终答复说明已更新、复用及尚未更新范围，保留来源与静态结论的限制。不要把数据保存成功说成完整分析正确性已得到证明。
