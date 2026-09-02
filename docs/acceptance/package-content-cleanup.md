# Package 内容收窄验收

日期：2026-09-02

## 范围

- npm tarball 不分发 sourcemap；
- 构建收尾删除无法从受支持 JS 或类型入口到达的产物；
- `report-contracts/` 保留为开发期 emitter/consumer 合约测试输入，不进入 tarball；
- Runtime、公开 exports、report-kit wheel、Skill 与浏览器 assets 不变。

## 确定性证据

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `npm run build` | `passed` | clean build 后没有 `.js.map` 或列明的不可达产物 |
| `npm run check` | `passed` | Biome、依赖、source/scripts typecheck 与 124 tests 全部通过；schema 合约测试仍执行 |
| `npm run verify:plugin-package` | `passed` | 65 files、326355 unpacked bytes；wheel、公开入口与 Skill assets smoke 通过 |
| `npm pack --dry-run --ignore-scripts --json` | `passed` | 约 89.3 KB packed；sourcemap、schemas 与不可达产物均为零 |
| `git diff --check` | `passed` | 无 whitespace error |

收窄前 dry-run 为 107 files、约 118.6 KB packed、485318 unpacked bytes。本次删除 42 个仅用于调试、
开发期验证或不可达的文件；packed bytes 约减少 29.3 KB（24.7%），unpacked bytes 减少 158963（32.8%）。

本次没有改变 Runtime 代码、公开入口、wheel 或 Skill assets，因此未重复真实 Agent/Web journey，也不把本地
package smoke 描述为新的真实环境安装验收。
