# 当前视图 HTML 导出验收

## 结果与范围

2026-09-09：Reader 的导出图标提供“下载完整报告”和“导出当前视图”。前者保持当前显示 Build 的已保存 HTML，
后者冻结当前筛选、图表展示和表格排序，生成带来源 Build、筛选条件及导出时间的无脚本 HTML。
具体行为和来源边界见[Reader 模块](modules/presentation-reader.md#当前视图导出)。

插件只处理浏览器中的已保存数据与呈现，不新增 Marivo 分析、Harness 生命周期或报告版本协议。
未新增打印、PDF、CSV 或单图导出；未重装插件、重启 DSH、运行真实 Agent 或查询真实数据源。

## 验证结果

| 验证 | 结果与证据范围 |
| --- | --- |
| `npm run check` | 通过：quality、依赖树、source/scripts typecheck，以及 441 项测试，零失败 |
| `npm run build` | 通过；完整检查中的 Reader 测试也重新构建分发产物 |
| `npm run verify:plugin-package` | 通过：209 个分发文件，packed presentation kit、contracts 与 offline builder 校验通过 |
| `npm run validate:presentation-export` | 通过：生产 portable reader 的实际下载文件、离线与禁用脚本阅读、18 类图形和窄屏验证 |
| `npm run validate:presentation-interaction` | 通过：生产 Host overlay、file-service、筛选／编辑与现有交互回归；当前视图导出不增加 RPC |
| `npm run validate:report-catalog:web` | 通过：历史完整报告的下载字节保持一致，历史当前视图保留所选来源 Build |

新增单元测试覆盖组合筛选解析、图表探索、已保存文档不被修改，以及 int64 精确排序、稳定同值排序和 null 置后。
浏览器验收使用显式合成 fixture，经生产 builder 和实际下载路径生成文件，不将它描述为真实 Runtime／Harness 安装验收。

## 浏览器与文件检查

- 多字段选择共同作用于动态 KPI、图形和表格；固定正文、固定 KPI 及区域说明保留。
- 图形类型切换、系列显隐、跨 dataset 的 `preparedViews` 与原始行 identity 在导出后保持一致。
- 18 类图形在无脚本、断网环境下保留内联 SVG；空 slice 正确显示空结果。
- 表格保留显示列及列顺序、升降序和全部分页；66 行截断样例保留 int64、Decimal、null 及截断提示。
- 用未选中行、未绑定列和任意来源事实的 sentinel 检查文件内容，均未被嵌入；没有完整 datasets JSON、脚本或交互控件。
- 标题中的 HTML 文本保持转义；必要来源概要保留语义路径、已有问题及不可解析的历史时间原文。
- 文件附来源 Build 和导出时间；导出后继续改变筛选不会改变已下载文件，完整报告重新打开仍恢复默认选择。
- 编辑模式禁用当前视图导出并说明原因；菜单支持方向键、Escape、焦点恢复及窄屏布局。
- 已查看桌面图形和窄屏菜单截图；窄屏导出文件没有页面级横向溢出，图内可滚动。

本次也修正了旧响应式验收的过时假设：Host 独立预览已按当前实现使用 80vw／窄屏全宽，
隐藏图形恢复后的宽度会受图表换列影响。验收现在检查实际容器变化，不要求宽度只能减小；未改变布局实现。

## 可复查产物

各命令打印临时输出目录，保留下载的 HTML、截图和 `evidence.json`：

- 当前视图：`/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-presentation-export-nu3NU7/`
- Host 联动：`/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-global-filters-24cwTH/`
- 历史版本：`/private/var/folders/cx/bmfg_x3j0qsfvgsb2v8s2x5m0000gn/T/dsh-report-catalog-3q3Ppp/`

临时目录不属于分发内容，清理后可通过上述命令重新生成。
