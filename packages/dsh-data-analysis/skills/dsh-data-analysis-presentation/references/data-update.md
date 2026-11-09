# 只刷新报告数据

用户要求刷新已保存报告的数据时使用本流程。保持页面程序、组件数量/类型/顺序/嵌套、资源名、view/display、正文、标题、语言和列标签；只替换指定组件的数据资源及其执行来源。更改页面或正文须有明确的编辑请求。

## 读取基版本并展示草稿

调用 `marivo_ui_read({recordId, current:true, includeCode:true})`，解析 definitionJson，保留其准确 recordId、program、资源 declaration 和字段契约。用户明确指定历史版本时读取该准确版本；它若不是 current，不能直接覆盖当前版本，按恢复参考审阅冲突。

先以该 recordId 为 basedOnRecordId 调用 `marivo_present(surface:"tab", stage:"preview")`，省略 program 和 resources，展示原报告的草稿副本。后续使用返回的 draftId/draftRevision。刷新进度在聊天中说明，不向报告增添进度组件。

## 按固定结果显式刷新

sources 按 codeRef 去重，不是重放指令。先识别哪些原有视图共享准确固定结果，刷新一次新结果后更新这些视图的同名资源。核对目标组件的计算脚本、输入文件、datasource 声明、范围、时间参数和 Runtime Session 生命周期。脚本记录不包含导入模块或输入文件。缺少 codeRef、脚本 unavailable 或输入失效时，明确缺口；可以使用已有可核验的计算定义，不猜造查询或 datasource 范围。

对请求刷新的结果运行已审阅、完整的 `marivo_python` 脚本，在同次调用内读取输入、计算、持久化并导出准确新结果。使用记录的 code.datasources 中的精确 name 和该组件的 resultVariables；空 datasource 数组表示无需 Marivo datasource，旧记录缺字段表示未知。历史脚本包含其他操作时先审阅范围与副作用；仅执行已授权的刷新，不能无审阅重放。共享同一固定结果的视图无需重复生产。

成功后取得结构化 resultRefs 和该次 codeRef，及时 preview 同名资源替换，不等待其他组件全部完成。同批已就绪内容可合并 preview；当前 Python 和草稿写入均按 Harness exclusive 调度，不承诺并发。提交完整 resources 映射：当前已刷新的资源保留新声明，未刷新项和图片保留原声明。省略 program/title/locale/labels，使用上一成功预览的 draftId/draftRevision。相同引用会复用旧快照，不能当作刷新；图片需要独立生成到新路径后替换原资源名下的 path。

## 完成与不兼容

新结果必须继续满足原视图的字段身份、类型、语义角色、粒度和完整性。不能通过改图形、删组件、换口径或填造数据来通过校验。旧脚本缺输出声明时，审阅并明确导出目标引用变量，不从 stdout 猜引用。

program 不变并不保证 auto 的呈现形态不变。既有 auto 或其他自适应视图须核对新数据能否保留原视图形态；不能确定时说明限制，不承诺视觉锁定。新报告可按视图参考显式选择稳定的 chart/encoding，但数据刷新时不修改旧声明。

正文静态数字和结论不会自动更新。核对可能受影响的表述，不声称重新验证过原结论；发现与新数据明显冲突时说明问题，不能偷偷改正文或把不一致报告作为完成品交付。需要正文编辑时另按明确请求处理。

所有请求的组件已刷新并核对后，以最新草稿标识调用一次 stage:"save"。单组件展示失败不阻塞其他无依赖计算；保留已有草稿，处理或说明该组件问题。部分失败时说明哪些仍是旧数据，不以保留旧快照冒充刷新完成。冲突、草稿失效与不确定结果按[恢复参考](recovery.md)处理；结束 Turn 前明确是否保存，草稿不能跨 Turn 接续。

## 调用时序

以下为一个组件刷新成功的调用示例。先审阅 definition 和目标组件脚本，再运行其独立调用；替换脚本与 resourceName 为实际内容。保持完整资源映射，后续组件继续同一循环。

```javascript
const definition = JSON.parse((await tools.marivo_ui_read({
  recordId, current: true, includeCode: true,
})).definitionJson);
const resources = Object.fromEntries(
  Object.entries(definition.resources).map(([name, resource]) => [name, resource.declaration]),
);
let draft = await tools.marivo_present({
  surface: "tab", stage: "preview", basedOnRecordId: definition.recordId,
});
// reviewedCode/declaredDatasources/outputVariable are reviewed for this component only.
const result = await tools.marivo_python({
  code: reviewedCode,
  datasources: declaredDatasources,
  resultVariables: { [resourceName]: outputVariable },
});
if (result.execution.reason !== "succeeded" || result.resultCaptureError || !result.resultRefs?.[resourceName] || !result.codeRef) {
  throw new Error("Inspect execution and capture status before continuing; do not replay blindly.");
}
resources[resourceName] = {
  kind: resources[resourceName].kind,
  ref: result.resultRefs[resourceName], codeRef: result.codeRef,
};
draft = await tools.marivo_present({
  stage: "preview", draftId: draft.draftId, draftRevision: draft.draftRevision, resources,
});
// Save once after all requested components have been refreshed and checked.
const saved = await tools.marivo_present({
  stage: "save", draftId: draft.draftId, draftRevision: draft.draftRevision,
});
```
