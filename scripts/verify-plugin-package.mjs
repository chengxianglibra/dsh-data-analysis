import { spawnSync } from 'node:child_process'

const root = new URL('../', import.meta.url)
const result = spawnSync(
  'npm',
  ['pack', '--workspace', '@deepseek-ai/dsh-data-analysis', '--dry-run', '--json'],
  { cwd: root, encoding: 'utf8' },
)
if (result.error !== undefined) throw result.error
if (result.status !== 0) {
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

const [manifest] = JSON.parse(result.stdout)
const paths = new Set(manifest.files.map(file => file.path))
const files = new Map(manifest.files.map(file => [file.path, file]))
const required = [
  'README.md',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/types/index.d.ts',
  'lib/bin/environment.js',
]
for (const path of required) {
  if (!paths.has(path)) throw new Error(`packed plugin is missing ${path}`)
}
for (const path of paths) {
  if (/^(?:src|tests|scripts)\//.test(path) || path.endsWith('tsconfig.build.json')) {
    throw new Error(`packed plugin contains development-only file ${path}`)
  }
}
const environmentBin = files.get('lib/bin/environment.js')
if (environmentBin === undefined || (environmentBin.mode & 0o111) === 0) {
  throw new Error('packed environment CLI is not executable')
}
process.stdout.write(
  `verified ${manifest.id}: ${manifest.entryCount} files, ${manifest.unpackedSize} unpacked bytes\n`,
)
