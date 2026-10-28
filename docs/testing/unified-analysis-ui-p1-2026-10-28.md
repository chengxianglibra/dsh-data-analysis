# 统一分析 UI P1 验收

日期：2026-10-28。范围：[实施计划 P1](../designs/unified-analysis-ui-implementation.md#p1打通-frame-与-dataframe-的数据入口)。
按用户最新决策，capture_dataset **只接受 pandas DataFrame**，不适配 RawSqlResult。
仅修改本插件；P2/P3 尚未完成，marivo_present 仍使用原 Draft 输入，新快照尚未接入 Build 或 Client。

## 固定身份与复现

| 项目 | 实际身份 |
| --- | --- |
| Node.js | 22.19.0 |
| Harness | 本仓库安装的 0.2.1-rc.2；真实 Tool/Shell/worker，无浏览器和模型调用 |
| Marivo | 独立 `/private/tmp/dsh-unified-ui-p1-runtime/bin/python`，Python 3.14.4；distribution 0.6.0.dev0 |
| 实际包 | `/private/tmp/dsh-unified-ui-p1-runtime/lib/python3.14/site-packages/marivo/__init__.py` |
| Marivo wheel | `/Users/lichengxiang/source/oss/marivo/dist/pypi/marivo-0.6.0.dev0-py3-none-any.whl` |
| Marivo wheel SHA-256 | `6ddc5a3dd8bc45b356936dab206c30a6373a8a0cde9f9eca77e635ea79b8c777` |
| Helper | 独立安装的 dsh-data-analysis-presentation-kit 1.2.0，与当前仓库构建 wheel 一致 |

```sh
DSH_DATA_ANALYSIS_PYTHON=/absolute/p1-runtime/bin/python \
DSH_DATA_ANALYSIS_MARIVO_WHEEL=/absolute/marivo.whl \
npm run validate:unified-analysis-ui:p1
```

入口复用 P0 小型数据集，在隔离 Workspace 中准备模型与数据库；一次 marivo_python 生成持久 Frame，
捕获两个 DataFrame 快照，再删除原数据库并使原模型不可加载。原 worker 结束后，Host 只读快照，
另一次 checked execution 合并读取 Frame 的完整小结果和单行前缀。用户 Host 未重启，用户 Runtime 未重装。

## 结果与证据

- Python 合同覆盖原 codec 与新捕获/Reader：精确整数、Decimal、NULL、空表、labels、捕获上下文、
  被原代码捕获的 helper 失败及凭据拒绝；Frame 覆盖选列顺序、坐标、身份与 layout、范围和不支持类型边界。
- Host 合同覆盖成功调用的两次捕获关联、原 codeRef、Workspace/call 身份、跨 Workspace 引用、伪造引用、
  摘要篡改，以及非零退出、超时和取消不签发引用。原执行成功但捕获失败保留 succeeded，并返回明确错误。
- 同一样例额外通过既有 Draft projection 读取 revenue 单列前缀，保留 totalRows=2/truncated=true；旧入口不再需要 Evidence digest。
- 实际 Runtime 的 DataFrame 恢复值为 `9007199254740993`、`12345678901234.5678` 和 NULL；
  totalRows=2/capturedRows=2/complete=true。另一个快照 capturedRows=1/complete=false，没有伪装完整单值。
- 实际 Frame 保留 region 完整坐标、实际字段/layout 和相同精确值；完整小结果共 2 行，单行读取为明确预览。
  完整投影 readStats 为 dataRowsRead=2、coordinateRowsRead=0、receiptBytesHashed=1157；这些不是总 I/O 或内存测量。
- 数据读取代码使用 schema/read_page/page.to_pandas；未走 Frame 全量导出或旧 Evidence digest。必要错误不返回成功快照。

本轮检查：`npm run check`、`npm run build`、`npm run verify:plugin-package`、`git diff --check`。
Python 合同由仓库现有 uv/pytest 入口执行；真实 Runtime 与以上模块测试分别记录，不上推为 UI 或模型验收。
临时机器证据为 `/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-unified-ui-p1-kniiEO/runtime-evidence.json`，不作为分发文件。

## 支持范围与后续边界

- DataFrame 创建前的精度损失无法恢复；SQL/datasource/reason/warnings 不推断，来源 details 为 not-captured，business 为 unknown。
- 沿用 64 列、5000 行、100000 单元格及 2 MiB 快照预算；完整坐标计入单元格预算。
  首次 Frame 读取一页前缀，不自动遍历全体，不提供 Client 在线续页。
- 复合 tuple 展示、duration、naive timestamp 等载体明确不支持。ns dtype 的带时区值按实际精度检查，
  整秒/微秒值可无损编码，亚微秒值拒绝。calendar/interval 的时间边界按 datetime 保存。
  Evidence/Findings/methods/semantics 在新快照中为 not-captured；旧 Draft 显式 Finding 仍保留既有读取。
- 新引用先经 Host execution 存储验证，再读取 Workspace 文件；文件篡改使引用失败。
  P2 才将引用内容纳入不可变 Build 附件生命周期，完成组件与双位置交付。
- 设计中“交付文档仍为 Document v2”和“八组件 Catalog 未生成”的记录已过时，已按当前文档/代码同步。
  旧读取程序对已移除 evidence_digest 的依赖已迁移。未修改上游仓库或随包 Skill。

## Review 修复回归

- 捕获文件写入失败、仅 manifest 写入失败、原代码异常分别验证；finalization 不替换原成功或异常。
  使用隔离安装的 helper wheel 和真实 launcher/worker（Marivo credential 协议 fixture）验证原 stdout/stderr 与退出码（含 75）保持，
  Host 测试验证捕获失败时保留 codeRef、返回 snapshotCaptureError、不签发 snapshotRef。
- 时间坐标覆盖 start/end/actual_start/actual_end、显式时区、NULL 与空页；按 datetime 编码。
- ns timestamp 覆盖 value 与完整轴键：整秒和微秒值保真，亚微秒值明确拒绝，元数据保留原 ns 单位。
- 选列只保存选中字段及完整轴键的 slots；未选中 duration 不阻断 Decimal 投影，
  选中 duration 或不支持的轴键仍拒绝。
- 修正文档中“nanosecond dtype 均超出原 codec”的描述；原 codec 的边界是实际亚微秒精度。

修复后验证使用 Node.js 22.19.0：Python 合同 98 项、相关 Python tool/launcher/捕获测试 35 项通过；
`npm run check`、`npm run build`、`npm run verify:plugin-package` 和 `git diff --check` 均通过。
分发验证为 329 files / 13641584 unpacked bytes；helper 1.2.0 的实际安装文件与当前源码逐字节一致。
隔离 Runtime 再次通过 `npm run validate:unified-analysis-ui:p1`，确认真实 Harness 工具链中的同次捕获、
进程结束和数据源关闭后的 Dataset/Frame 读取；本轮机器证据：
`/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-unified-ui-p1-G1R4I4/runtime-evidence.json`。
时间边界与 ns 精度的细分用例由 Reader 合同测试覆盖，未将该部分上推为真实 calendar 数据源验收。
用户 Host 未重装或重启；未提交、未推送。
