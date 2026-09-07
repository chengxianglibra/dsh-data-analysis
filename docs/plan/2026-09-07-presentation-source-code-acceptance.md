# 数据源代码页验收

## 实施范围

报告数据源弹窗增加“代码”Tab，展示当前 cell 所绑定 dataset 的 Python 执行快照，以及关联 Artifact
生产记录中的 SQL。支持原文复制、键盘切换、复制失败提示；代码作为文本呈现，不执行 HTML 或脚本。
原文不做字面量脱敏。Host reader 与离线 HTML 消费同一份文档，禁用脚本时通过原生折叠区读取代码。

实现见[来源代码组件](../../packages/dsh-data-analysis/src/client/presentation/source-code.tsx)、
[投影](../../packages/dsh-data-analysis/src/presentation/projection/index.ts)和
[Python 执行记录](../../packages/dsh-data-analysis/src/python-execution.ts)。

## 来源事实与责任

- `marivo_python` 成功后保存精确提交的 Python，返回 `codeRef: {executionId, sha256}`。
  记录保存在 Host 的 DSH home，按规范化 Workspace 隔离；Workspace 自报文件不能发放执行引用。
  记录保存失败只增加 `codeCaptureError`，不改写真实执行结果，不要求重放；非零退出、取消或超时不发放成功引用。
- dataset 的 `codeRefs` 由作者显式关联。投影核验 Host 记录、Workspace、execution ID 和完整文件摘要，
  缺失或不匹配明确失败。执行过脚本与正确生成数据是不同事实；不审计外部导入文件或计算正确性。
- SQL 通过 Marivo 公开 producer Run 和上游 Artifact 读取，核验确切产出及 Workspace。
  不重新编译、不枚举无关 Run、不执行数据查询。每个来源最多 64 个上游 Artifact、32 条 SQL、单条 32768 UTF-16 code units；
  缺失及超限明确说明，不截断 SQL 后假称完整原文。
- 已生成报告使用冻结快照；旧报告缺失代码时明确展示“未保存生成代码”，不从当前文件或当前定义补写历史。

## 验收证据

针对性回归覆盖：

- [Python 捕获](../../packages/dsh-data-analysis/tests/datasource-credentials/python-capture.test.ts)：
  原文、摘要、Host 存储、Workspace 伪造记录拒绝、跨 Workspace 复制拒绝、文件替换与符号链接、
  输入在异步边界被修改、保存失败保留结果及失败/取消不重放。
- [契约](../../packages/dsh-data-analysis/tests/presentation-s0/code-contracts.test.ts)与
  [投影](../../packages/dsh-data-analysis/tests/presentation-projection/projection.test.ts)：
  草稿只能引用执行记录，不能手填执行原文；精确恢复关联代码，排除无关记录，缺失/错误摘要定位到具体 `codeRefs`。
- [SQL 来源](../../packages/dsh-data-analysis/tests/presentation-projection/sql-code.test.ts)：
  直接及祖先 SQL、产出/身份核验、去重、空白 SQL、原文和 Unicode、读取预算。
  当前环境的真实 Marivo 测试在新进程恢复持久化 SQL，逐字匹配公开 Run，并禁止分析执行、编译和 revalidation。
- [reader](../../packages/dsh-data-analysis/tests/presentation-reader/sources.test.ts)与
  [离线构建](../../packages/dsh-data-analysis/tests/presentation-reader/code-build.test.ts)：
  当前 cell/选中视图关联、纯 computed 无来源场景、HTML 转义、原文复制所需文本及静态内容、内嵌 JSON 与文档一致。

真实 Python 检查通过生产 `marivo_python` 工具、实际 launcher/worker 和当前安装的 Marivo 0.5.4 执行；
成功只运行一次，失败不返回 `codeRef`。随后将实际生成的 computed 数据及引用交给投影和 builder，
确认 Python 原文在执行记录、生成文档和离线 HTML 中一致，投影阶段没有再次执行 Python。
此检查使用最小 Harness Shell 适配器，不代表真实 Agent 编排验收。

真实 Chrome 检查生产数据源组件的三个 Tab、方向键/Home/End、Escape 焦点恢复、实际剪贴板复制与失败提示、
禁用 JavaScript 的原生展开和打印隐藏长代码。未重装插件、未重启已有 DSH Web 服务。

实际 Python 生成的 portable HTML 另经 Chrome 检查：metric → 数据源 → 代码的 DOM 与真实剪贴板逐字符匹配
文档代码；禁用脚本后仍可展开阅读。无脚本 HTML 解析按浏览器规则将 CRLF 规范为 LF，交互代码和复制保留原始 CRLF。
`codeRef.sha256` 校验完整执行记录字节，不是代码文本摘要。

## 验证命令

```sh
npm run check
npm run build
npm run verify:plugin-package
```

展示 Skill 的 frontmatter、资源引用及新增 `codeRefs` 用法随 Skill validator 和契约测试检查。

本轮完整 `npm test`、`npm run check`、`npm run typecheck`、`npm run build`、`npm run verify:plugin-package`、
Skill validator、依赖检查及 `git diff --check` 均通过。
