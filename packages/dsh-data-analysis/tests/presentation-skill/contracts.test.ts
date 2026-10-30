import assert from 'node:assert/strict'
import { readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { analysisCatalogSpec } from '../../src/presentation/contracts/analysis-catalog.ts'
import {
  analysisElements,
  analysisPresentInput,
} from '../../src/presentation/contracts/analysis-document.ts'
import {
  analysisStatements,
  mergeAnalysisProgram,
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

async function markdown(skillName: string): Promise<Array<[string, string]>> {
  const root = path.join(packageRoot, 'skills', skillName)
  return Promise.all(
    (await files(root))
      .filter((file) => file.endsWith('.md'))
      .map(async (file): Promise<[string, string]> => [file, await readFile(file, 'utf8')]),
  )
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

  test(`${skillName} does not advertise the removed report pipeline`, async () => {
    const removed = [
      /draft_path|\.draft\.json|Presentation Draft|Document v3|schemaVersion/i,
      /marivo_export_html|marivo_publish_report|reportPublishing|dsh-report-publishing/,
      /presentation-lint|write_dataset|writer receipt/,
      /marivo-report-cell|Ask DSH/,
      /references\/(?:charts|chart-examples|schema|interaction|export-html|publishing)\.md/,
      // heatmap is a current AnalysisFrameView chart; the rest belonged to the removed HTML charts.
      /\b(?:waterfall|funnel|boxplot|histogram|scatter)\b/i,
    ]
    for (const [file, content] of await markdown(skillName))
      for (const pattern of removed)
        assert.doesNotMatch(content, pattern, `${path.relative(packageRoot, file)}: ${pattern}`)
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

test('every Skill marivo_present example uses the current input and Lang contract', async () => {
  let presentInputs = 0
  let patches = 0
  let inlinePrograms = 0
  for (const skillName of skillNames) {
    for (const [file, content] of await markdown(skillName)) {
      const where = path.relative(packageRoot, file)
      for (const block of content.matchAll(/```json\n([\s\S]*?)\n```/g)) {
        const value = JSON.parse(block[1]!)
        // Native `present` file delivery examples belong to the Harness contract.
        if ('files' in value) continue
        const input = analysisPresentInput.parse(value)
        presentInputs++
        if (!input.program) continue
        if (input.basedOnRecordId) {
          // Patches are statement fragments; check they admit and merge onto a root.
          patches++
          const names = analysisStatements(input.program)
            .split('\n')
            .map((statement) => statement.slice(0, statement.indexOf('=')).trim())
          const base = `root = Stack([${names.join(', ')}]);\n${names
            .map((name) => `${name} = TextContent("base");`)
            .join('\n')}`
          parseAnalysisProgram(mergeAnalysisProgram(base, input.program))
          continue
        }
        const resources = input.resources ?? {}
        for (const node of analysisElements(parseAnalysisProgram(input.program))) {
          if (node.typeName === 'Image')
            assert.equal(resources[String(node.props.src)]?.kind, 'image-file', where)
          if (node.typeName === 'DatasetView')
            assert.equal(resources[String(node.props.ref)]?.kind, 'dataset-snapshot', where)
          if (node.typeName === 'AnalysisFrameView')
            assert.ok(
              ['frame-snapshot', 'marivo-frame'].includes(
                resources[String(node.props.ref)]?.kind ?? '',
              ),
              where,
            )
        }
      }
      for (const inline of content.matchAll(/`(root = [^`]+)`/g)) {
        inlinePrograms++
        parseAnalysisProgram(inline[1]!)
      }
    }
  }
  assert.ok(presentInputs >= 5, 'Skill examples cover reference, custom and update inputs')
  assert.ok(patches >= 1, 'Skill examples cover a statement patch')
  assert.ok(inlinePrograms >= 1, 'SKILL.md keeps an inline Lang example')
})

test('the comparison example keeps the documented reconciliation', async () => {
  const content = await readFile(
    path.join(packageRoot, 'skills/dsh-data-analysis-presentation/references/examples.md'),
    'utf8',
  )
  for (const fact of [
    'baseline `[100, 80, 20]`、current `[50, 50, 50]`',
    '"baseline": [200, 180, 20]',
    '"current": [150, 100, 50]',
    '全量 200 → 150，净变化 -50',
    '两项减少量 80，其他项增加 30',
  ])
    assert.ok(content.includes(fact), fact)
  const baseline = [100, 80, 20]
  const current = [50, 50, 50]
  const delta = current.map((value, index) => value - baseline[index]!)
  const sum = (numbers: number[]) => numbers.reduce((total, number) => total + number, 0)
  assert.equal(sum(delta), -50)
  assert.equal(sum(delta) / sum(baseline), -0.25)
  assert.equal(-(delta[0]! + delta[1]!), 80)
  assert.equal(delta[2], 30)
})
