import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const source = fileURLToPath(new URL('../../../../marivo/dist/pypi/', import.meta.url))
const candidates = await Promise.all(
  (await readdir(source))
    .filter((name) => /^marivo-.*-py3-none-any\.whl$/.test(name))
    .map(async (name) => ({ name, modified: (await stat(path.join(source, name))).mtimeMs })),
)
candidates.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name))
const selected = candidates[0]
if (!selected) throw new Error('No Marivo wheel found in sibling marivo/dist/pypi')
const version = /^marivo-(.+)-py3-none-any\.whl$/.exec(selected.name)?.[1]
if (!version) throw new Error('Invalid Marivo wheel name')
const bytes = await readFile(path.join(source, selected.name))
const sha256 = createHash('sha256').update(bytes).digest('hex')
const destination = path.join(packageRoot, 'python/marivo/dist')
await mkdir(destination, { recursive: true })
await copyFile(path.join(source, selected.name), path.join(destination, selected.name))
await writeFile(path.join(destination, '.npmignore'), '')
const filename = path.join(packageRoot, 'package.json')
const metadata = JSON.parse(await readFile(filename, 'utf8'))
metadata.dshDataAnalysisCompatibility.marivo = {
  version,
  packageSpec: `marivo[duckdb,trino,clickhouse]==${version}`,
  wheelFilename: selected.name,
  wheelSha256: sha256,
}
metadata.files = metadata.files.map((/** @type {string} */ name) =>
  name.startsWith('python/marivo/dist/') ? `python/marivo/dist/${selected.name}` : name,
)
const output = `${JSON.stringify(metadata, null, 2)}\n`
if ((await readFile(filename, 'utf8')) !== output) await writeFile(filename, output)
process.stdout.write(`Prepared Marivo ${version} from dist/pypi (${sha256})\n`)
