import assert from 'node:assert/strict'
import { readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { analysisCatalogSpec } from '../../src/presentation/contracts/analysis-catalog.ts'
import {
  analysisStatements,
  parseAnalysisProgram,
} from '../../src/presentation/contracts/analysis-program.ts'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const skillNames = ['dsh-data-analysis-presentation', 'dsh-data-analysis-files']

async function files(root: string): Promise<string[]> {
  return (
    await Promise.all(
      (
        await readdir(root, { withFileTypes: true })
      ).map(async (entry) => {
        const target = path.join(root, entry.name)
        return entry.isDirectory() ? files(target) : [target]
      }),
    )
  ).flat()
}

for (const skillName of skillNames) {
  test(`${skillName} resources are reachable within the shipped folder and stay bounded`, async () => {
    const skillRoot = path.join(packageRoot, 'skills', skillName)
    const entrypoint = path.join(skillRoot, 'SKILL.md')
    const allFiles = (await files(skillRoot)).sort()
    const visited = new Set<string>()
    const pending = [entrypoint]
    let totalBytes = 0
    while (pending.length > 0) {
      const file = pending.pop()!
      if (visited.has(file)) continue
      visited.add(file)
      const actual = await realpath(file)
      assert.ok(actual.startsWith(`${skillRoot}${path.sep}`), `${file} leaves the shipped Skill`)
      const content = await readFile(file, 'utf8')
      const size = Buffer.byteLength(content)
      totalBytes += size
      assert.ok(
        size <= (file === entrypoint ? 6 * 1024 : 16 * 1024),
        `${file} needs disclosure split`,
      )
      if (!file.endsWith('.md')) continue
      for (const link of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const href = link[1]!.split('#')[0]!
        if (/^https:\/\//.test(href)) {
          assert.equal(
            new URL(href).hostname,
            'github.com',
            'Only the upstream Host contract is external',
          )
          continue
        }
        assert.ok(href && !path.isAbsolute(href) && !/^\w+:/.test(href), href)
        pending.push(path.resolve(path.dirname(file), href))
      }
    }
    assert.deepEqual([...visited].sort(), allFiles, 'Every shipped resource must be discoverable')
    assert.ok(totalBytes <= 48 * 1024, 'Keep the complete Skill bounded')
  })

  test(`${skillName} frontmatter names the shipped folder`, async () => {
    const content = await readFile(path.join(packageRoot, 'skills', skillName, 'SKILL.md'), 'utf8')
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(content)?.[1]
    assert.ok(frontmatter, 'SKILL.md needs frontmatter')
    const fields = Object.fromEntries(
      frontmatter.split('\n').map((line) => {
        const index = line.indexOf(':')
        assert.ok(index > 0, `Invalid frontmatter line: ${line}`)
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
      }),
    )
    assert.deepEqual(Object.keys(fields).sort(), ['description', 'name'])
    assert.equal(fields.name, skillName)
    assert.ok(fields.description && fields.description.length <= 1024)
  })
}

test('analysis catalog reference matches the generated component signatures', async () => {
  const content = await readFile(
    path.join(packageRoot, 'skills/dsh-data-analysis-presentation/references/analysis-catalog.md'),
    'utf8',
  )
  const documented = Object.fromEntries(
    [...content.matchAll(/^## (\w+)\n\n```text\n(.+)\n```$/gm)].map((match) => [
      match[1],
      match[2],
    ]),
  )
  assert.deepEqual(
    documented,
    Object.fromEntries(
      Object.entries(analysisCatalogSpec.components).map(([name, component]) => [
        name,
        component.signature,
      ]),
    ),
  )
})

test('custom page examples use valid OpenUI Lang and Catalog components', async () => {
  const content = await readFile(
    path.join(packageRoot, 'skills/dsh-data-analysis-presentation/references/examples.md'),
    'utf8',
  )
  const examples = content.split(/^## /m).slice(1)
  assert.ok(examples.length > 0)
  for (const example of examples) {
    const programs = [...example.matchAll(/```openui\n([\s\S]*?)\n```/g)]
    assert.ok(programs.length > 0, example.split('\n')[0])
    for (const block of programs) parseAnalysisProgram(analysisStatements(block[1]!))
  }
})

test('the comparison example reconciles its headline with the documented rows', async () => {
  const content = await readFile(
    path.join(packageRoot, 'skills/dsh-data-analysis-presentation/references/examples.md'),
    'utf8',
  )
  const rows = [...content.matchAll(/^\| [ABC] \| (\d+) \| (\d+) \|$/gm)]
  assert.equal(rows.length, 3)
  const sum = (numbers: number[]) => numbers.reduce((total, number) => total + number, 0)
  const baseline = sum(rows.map((row) => Number(row[1])))
  const current = sum(rows.map((row) => Number(row[2])))
  const deltas = rows.map((row) => Number(row[2]) - Number(row[1]))
  const decrease = -sum(deltas.filter((delta) => delta < 0))
  const offset = sum(deltas.filter((delta) => delta > 0))
  const net = baseline - current
  assert.ok(
    content.includes(
      `全量从 ${baseline} 降至 ${current}，净减少 ${net}（${(100 * net) / baseline}%）`,
    ),
  )
  assert.ok(content.includes(`A、B 合计减少 ${decrease}，C 增加 ${offset}`))
  assert.ok(content.includes(`两项减少量与全量净减少之比是 ${(100 * decrease) / net}%`))
})
