import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { Ajv2020, type AnySchema } from 'ajv/dist/2020.js'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const projectRoot = path.join(packageRoot, 'python', 'report-kit')
const script = path.join(projectRoot, 'scripts', 'emit_contract_fixtures.py')
const contractRoot = path.join(packageRoot, 'report-contracts')
const assetRoot = path.join(packageRoot, 'skills', 'dsh-data-analysis-report', 'assets')

type TestListener = (event: { key?: string }) => void

class TestElement {
  readonly childNodes: TestElement[] = []
  readonly dataset: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  className = ''
  hidden = false
  id = ''
  parentNode: TestElement | null = null
  scope = ''
  type = ''
  private ownText = ''
  private readonly listeners = new Map<string, TestListener[]>()

  get textContent(): string {
    return this.ownText + this.childNodes.map((child) => child.textContent).join('')
  }

  set textContent(value: string) {
    this.replaceChildren()
    this.ownText = String(value)
  }

  append(...children: TestElement[]): void {
    for (const child of children) {
      if (child.parentNode) {
        const index = child.parentNode.childNodes.indexOf(child)
        if (index >= 0) child.parentNode.childNodes.splice(index, 1)
      }
      child.parentNode = this
      this.childNodes.push(child)
    }
  }

  replaceChildren(...children: TestElement[]): void {
    for (const child of this.childNodes) child.parentNode = null
    this.childNodes.length = 0
    this.ownText = ''
    this.append(...children)
  }

  setAttribute(name: string, value: string): void {
    const normalized = String(value)
    this.attributes.set(name, normalized)
    if (name === 'class') this.className = normalized
    if (name === 'id') this.id = normalized
    if (name.startsWith('data-')) {
      const key = name.slice(5).replaceAll(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
      this.dataset[key] = normalized
    }
  }

  addEventListener(type: string, listener: TestListener): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  querySelectorAll(selector: string): TestElement[] {
    const result: TestElement[] = []
    const visit = (node: TestElement): void => {
      for (const child of node.childNodes) {
        if (selector.startsWith('.') && child.className.split(/\s+/).includes(selector.slice(1))) {
          result.push(child)
        }
        visit(child)
      }
    }
    visit(this)
    return result
  }
}

class TestDocument {
  createElement(): TestElement {
    return new TestElement()
  }

  createElementNS(): TestElement {
    return new TestElement()
  }
}

async function contract(name: string): Promise<AnySchema> {
  return JSON.parse(await readFile(path.join(contractRoot, name), 'utf8')) as AnySchema
}

function payload(registration: string, registry: 'ReportData' | 'ReportTrace'): unknown {
  const prefix = `${registry}.register(`
  assert.ok(registration.startsWith(prefix))
  assert.ok(registration.endsWith(');\n'))
  const argumentsText = registration.slice(prefix.length, -3)
  const separator = argumentsText.indexOf(', ')
  assert.ok(separator > 0)
  return JSON.parse(argumentsText.slice(separator + 2))
}

function isRfc3339(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

test('Python Marivo emitters satisfy the checked-in projection schemas', async (t) => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'dsh-report-kit-contracts-'))
  t.after(() => rm(outputRoot, { recursive: true, force: true }))
  const result = spawnSync(
    'uv',
    ['run', '--project', projectRoot, '--frozen', 'python', script, outputRoot],
    { cwd: packageRoot, encoding: 'utf8', timeout: 120_000 },
  )
  if (result.error !== undefined) throw result.error
  assert.equal(result.status, 0, result.stderr)

  const artifact = payload(
    await readFile(path.join(outputRoot, 'artifact.js'), 'utf8'),
    'ReportData',
  ) as Record<string, any>
  const computed = payload(
    await readFile(path.join(outputRoot, 'computed.js'), 'utf8'),
    'ReportData',
  )
  const trace = payload(await readFile(path.join(outputRoot, 'trace.js'), 'utf8'), 'ReportTrace')
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
  ajv.addFormat('date-time', { type: 'string', validate: isRfc3339 })
  ajv.addSchema(await contract('common-v1.schema.json'))
  ajv.addSchema(await contract('revalidation-v1.schema.json'))
  const validateArtifact = ajv.compile(await contract('dataset-v1.schema.json'))
  const validateTrace = ajv.compile(await contract('session-trace-v1.schema.json'))
  assert.equal(validateArtifact(artifact), true, JSON.stringify(validateArtifact.errors))
  assert.equal(validateArtifact(computed), true, JSON.stringify(validateArtifact.errors))
  assert.equal(validateTrace(trace), true, JSON.stringify(validateTrace.errors))

  const context = vm.createContext({
    console,
    document: new TestDocument(),
    Element: TestElement,
  }) as vm.Context & {
    ReportData?: { has(id: string): boolean }
    MarivoArtifact?: { render(container: TestElement, datasetId: string): TestElement }
    ReportTrace?: {
      has(id: string): boolean
      renderSessionGraphs(container: TestElement, traceIds?: readonly string[]): TestElement
    }
  }
  for (const name of ['report-data.js', 'marivo-artifact.js', 'marivo-session-dag.js']) {
    vm.runInContext(await readFile(path.join(assetRoot, name), 'utf8'), context, { filename: name })
  }
  vm.runInContext(await readFile(path.join(outputRoot, 'artifact.js'), 'utf8'), context)
  vm.runInContext(await readFile(path.join(outputRoot, 'computed.js'), 'utf8'), context)
  vm.runInContext(await readFile(path.join(outputRoot, 'trace.js'), 'utf8'), context)
  assert.equal(context.ReportData?.has('artifact'), true)
  assert.equal(context.ReportData?.has('computed'), true)
  assert.equal(context.ReportTrace?.has('trace'), true)

  const artifactContainer = new TestElement()
  context.MarivoArtifact?.render(artifactContainer, 'artifact')
  assert.match(artifactContainer.textContent, /metric_frame · 2 行 · 结果生成于/)
  assert.equal(artifactContainer.querySelectorAll('.marivo-artifact').length, 1)

  const dagContainer = new TestElement()
  context.ReportTrace?.renderSessionGraphs(dagContainer, ['trace'])
  assert.match(dagContainer.textContent, /1 个 Session · 1 个聚焦 Graph/)
  assert.equal(dagContainer.querySelectorAll('.marivo-artifact').length, 1)
})
