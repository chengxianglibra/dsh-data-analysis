# 只更新报告数据

仅在用户要求更新数据时执行。先调用 `marivo_ui_read({recordId, current:true, includeCode:true})`，解析 `definitionJson`，保留返回的准确 recordId、program、资源声明和列标签。sources 按 codeRef 去重，一次执行可能为多个资源生成结果。

核对可用脚本、输入文件、datasource 声明、过滤范围、时间参数和当前 Runtime 的 Session 生命周期。脚本是当次提交的代码，不会打包导入模块或输入文件。资源无 codeRef、脚本 unavailable 或输入失效时，说明缺口，先使用已有可核验的计算定义；不得猜造原查询。历史执行未保存 datasource 声明时，也不得猜测访问范围。

将需要刷新的一组资源对应的脚本通过 `marivo_python` 执行，使用 `code.datasources` 中的精确名称和 `code.resultVariables` 中保存的输出变量声明；新记录的空 datasource 数组表示无需 Marivo datasource。遵守当前授权和范围，不因为同份脚本包含其他操作而无审阅重放。读取输入、计算、持久化在同次调用完成。成功后从结构化 resultRefs 取得新引用，与该次 codeRef 逐一对应原资源名；不从 stdout 猜引用。旧脚本缺少输出声明时需显式补齐对应引用变量的导出声明，不推测局部变量。相同引用会复用旧快照，不能当作刷新成功。

以读取的 recordId 为 `basedOnRecordId`，保持资源名，提交完整 resources 映射：刷新项使用新 ref 和新 codeRef，未刷新项保留原 declaration，图片也保留。省略 program、title、locale 和 labels，保留原布局、正文、语言、标题及同 ID 列的显示标签；资源字段、类型、轴及完整性须继续满足原视图。明确要求的报告使用 `surface:"tab"`。可直接 save，也可 preview 后统一 save。新版本不会覆盖历史；冲突时按恢复参考处理，不自动覆盖其他修改。

```javascript
// definition 来自 marivo_ui_read 的 definitionJson；newRef/newCodeRef 来自新的成功执行。
const resources = Object.fromEntries(
  Object.entries(definition.resources).map(([name, resource]) => [name, resource.declaration]),
);
resources.sales = { kind: "dataframe", ref: newRef, codeRef: newCodeRef };
await tools.marivo_present({
  surface: "tab",
  basedOnRecordId: definition.recordId,
  resources,
});
```

正文中的静态数字和结论保持原文，不会自动按新数据改写；需要调整结论时另按用户要求编辑。auto 视图可能随数据形状改变。完成后说明已更新的数据范围与保留正文的事实，不声称重新验证过原结论。
