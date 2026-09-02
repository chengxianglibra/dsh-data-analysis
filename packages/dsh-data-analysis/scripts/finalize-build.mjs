import { chmodSync, rmSync } from 'node:fs'
import './build-client.mjs'

// TypeScript emits these implementation-only outputs even though no supported
// runtime or declaration entrypoint can reach them.
const unreachableOutputs = [
  'lib/environment/types.js',
  'lib/types/bin/environment.d.ts',
  'lib/types/datasource/bridge-programs.d.ts',
  'lib/types/datasource/credentials.d.ts',
  'lib/types/disclosure/bridge-program.d.ts',
  'lib/types/environment/summary.d.ts',
  'lib/types/evidence/bridge-program.d.ts',
]
for (const output of unreachableOutputs) {
  rmSync(new URL(`../${output}`, import.meta.url), { force: true })
}

chmodSync(new URL('../lib/bin/environment.js', import.meta.url), 0o755)
