import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { type Browser, chromium, type Locator, type Page } from 'playwright'
import {
  formatCell,
  type PresentationDocument,
  parsePresentationDocument,
} from '../src/presentation/contracts/index.ts'
import { prepareS0WebHost } from './presentation-s0/web-host.ts'

// This exercises the production reader through an actual isolated DSH Web module loader.
// The validation-only shell overlay supplies snapshots. It does not register present, issue
// receipts, or claim S4 Tool/RPC/download delivery or a fresh S2 Runtime execution.
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = path.resolve(packageRoot, '../..')
const outputRoot = await mkdtemp(path.join(tmpdir(), 'dsh-presentation-s3-reader-'))
process.stdout.write(`S3 reader evidence: ${outputRoot}\n`)
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const args = process.argv.slice(2)
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === '--projection-evidence'),
  'Usage: validate-presentation-reader-real.ts [--projection-evidence /path/projection-evidence.json]',
)
const cases: { name: string; document: PresentationDocument; provenance: string }[] = []
for (const name of ['artifact', 'computed', 'source-only']) {
  const document = parsePresentationDocument(
    JSON.parse(
      await readFile(
        path.join(packageRoot, `tests/presentation-s0/fixtures/${name}.document.json`),
        'utf8',
      ),
    ),
  )
  cases.push({ name: `s0-${name}`, document, provenance: 'checked-in S0 fixture' })
}
let projectionEvidence: { path: string; sha256: string; runtime: unknown } | undefined
if (args[1]) {
  const evidencePath = path.resolve(args[1])
  const bytes = await readFile(evidencePath)
  const evidence = JSON.parse(bytes.toString()) as Record<string, unknown>
  assert.equal(evidence.status, 'passed', 'S2 evidence must record a passed projection run')
  for (const [name, key] of [
    ['artifact', 'artifact'],
    ['computed', 'computed'],
    ['source-only', 'sourceOnly'],
  ] as const) {
    cases.push({
      name: `s2-${name}`,
      document: parsePresentationDocument(evidence[key]),
      provenance: 'existing S2 real Runtime output snapshot, re-read in this S3 run',
    })
  }
  projectionEvidence = { path: evidencePath, sha256: sha256(bytes), runtime: evidence.runtime }
}

const attack =
  '</script><img src="https://presentation.invalid/xss" onerror="window.__presentationXss=true">'
const interaction = parsePresentationDocument({
  schemaVersion: 1,
  workspaceId: 's3-validation-workspace',
  buildId: 's3-interactions',
  title: 'S3 交互与安全验证',
  generatedAt: '2026-09-07T00:00:00Z',
  datasets: [
    {
      id: 'values',
      origin: 'computed',
      sourceIds: ['declared', 'missing'],
      data: {
        schemaVersion: 1,
        columns: [
          { id: 'name', label: '分组', type: 'string', nullable: false },
          { id: 'amount', label: '精确金额', type: 'decimal', nullable: false, unit: 'CNY' },
          { id: 'count', label: '数量', type: 'float64', nullable: true, unit: '次' },
          { id: 'other', label: '对照', type: 'float64', nullable: false, unit: '次' },
        ],
        rows: Array.from({ length: 25 }, (_, index) => [
          index === 24 ? attack : `分组 ${String(25 - index).padStart(2, '0')}`,
          `${9007199254740992n + BigInt(24 - index)}.1000`,
          index === 2 ? null : 25 - index,
          index + 1,
        ]),
        rowCount: 25,
        limit: 25,
        truncated: false,
      },
    },
    {
      id: 'empty',
      origin: 'computed',
      sourceIds: [],
      data: {
        schemaVersion: 1,
        columns: [{ id: 'empty', label: '空数据', type: 'string', nullable: true }],
        rows: [],
        rowCount: 0,
        limit: 20,
        truncated: false,
      },
    },
  ],
  sources: [
    {
      id: 'declared',
      ref: { sessionId: 's3-session', artifactRef: 's3-artifact', findingId: 's3-finding' },
      status: 'available',
      label: '声明来源',
      facts: [{ label: '安全文本', value: attack }],
    },
    {
      id: 'missing',
      ref: { sessionId: 's3-session', artifactRef: 's3-missing' },
      status: 'unavailable',
      reason: '保存时来源不可用；仅保留声明身份。',
    },
  ],
  blocks: [
    {
      id: 'intro',
      kind: 'markdown',
      text: `## 已保存的正文\n\n**精确值**与来源保持原样。\n\n${attack}\n\n[危险链接](javascript:window.__presentationXss=true)`,
    },
    {
      id: 'amount',
      kind: 'metric',
      datasetId: 'values',
      columnId: 'amount',
      rowIndex: 0,
      label: '首行精确金额',
    },
    {
      id: 'line',
      kind: 'chart',
      datasetId: 'values',
      chart: 'line',
      x: 'name',
      y: ['count', 'other'],
      numericMode: 'exact',
    },
    {
      id: 'approximate',
      kind: 'chart',
      datasetId: 'values',
      chart: 'bar',
      x: 'name',
      y: ['amount'],
      numericMode: 'approximate',
    },
    { id: 'table', kind: 'table', datasetId: 'values' },
    { id: 'empty-table', kind: 'table', datasetId: 'empty' },
    { id: 'sources', kind: 'source', sourceIds: ['declared', 'missing'] },
  ],
  diagnostics: [],
})
cases.push({
  name: 'interactions',
  document: interaction,
  provenance: 'synthetic interaction/security fixture',
})

const { buildPresentation } = (await import(
  pathToFileURL(path.join(packageRoot, 'lib/presentation/build/index.js')).href
)) as {
  buildPresentation(document: PresentationDocument): Promise<{
    document: PresentationDocument
    documentBytes: Buffer
    htmlBytes: Buffer
  }>
}
const portableFiles = new Map<string, string>()
for (const item of cases) {
  const result = await buildPresentation(item.document)
  assert.deepEqual(result.document, item.document)
  assert.deepEqual(JSON.parse(result.documentBytes.toString()), item.document)
  const filename = path.join(outputRoot, `${item.name}.html`)
  await writeFile(filename, result.htmlBytes)
  await writeFile(path.join(outputRoot, `${item.name}.json`), result.documentBytes)
  portableFiles.set(item.name, filename)
}

const productionClient = await readFile(path.join(packageRoot, 'lib/client.js'), 'utf8')
assert.ok(productionClient.includes('HostPresentationReader'), 'Run npm run build first')
assert.ok(
  productionClient.includes('window.__ModuleLoader__.load('),
  'Build the production client module-loader bundle before this validation',
)
const overlay = await build({
  stdin: {
    loader: 'tsx',
    resolveDir: repoRoot,
    contents: `
import {useEffect,useState,version} from 'react';
import {HostPresentationReader} from '@chengxianglibra/dsh-data-analysis/client';
const cases=${JSON.stringify(cases.map(({ name, document }) => ({ name, document })))};
export const inject=['slots','theme'];
export function apply(ctx){
 ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({name:'sidebar.footer.action',id:'presentation-s3-open'},()=>
  <button type="button" onClick={()=>window.dispatchEvent(new Event('presentation-s3-open'))}>打开 S3 验证</button>));
 ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'presentation-s3-reader'},function Validation(){
  const [index,setIndex]=useState(0);
  const [open,setOpen]=useState(false);
  const [theme,setTheme]=useState(()=>ctx.theme.getTheme());
  useEffect(()=>{const show=()=>setOpen(true);window.addEventListener('presentation-s3-open',show);return ()=>window.removeEventListener('presentation-s3-open',show)},[]);
  useEffect(()=>ctx.on('theme/change',()=>setTheme(ctx.theme.getTheme())),[]);
  if(!open)return null;
  return <div role="dialog" aria-label="S3 reader 验证" style={{position:'fixed',inset:0,zIndex:10000,overflow:'auto',background:'var(--presentation-bg,#fff)'}}>
   <nav aria-label="验证样例">{cases.map((item,i)=><button type="button" key={item.name} onClick={()=>setIndex(i)}>{item.name}</button>)}</nav>
   <nav aria-label="验证主题"><button type="button" onClick={()=>ctx.theme.setTheme('light')}>Host 浅色</button><button type="button" onClick={()=>ctx.theme.setTheme('dark')}>Host 深色</button><output data-host-theme={theme.preference}>{theme.active.colorScheme}</output></nav>
   <small data-host-react={version}>Host React {version}</small>
   <HostPresentationReader key={cases[index].name} document={cases[index].document}/>
  </div>
 }));
}`,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/*', '@chengxianglibra/dsh-data-analysis/client'],
})
const client = `${productionClient}\nwindow.__ModuleLoader__.load({id:'dsh-presentation-s0',factory:(require)=>{var module={exports:{}};var exports=module.exports;${overlay.outputFiles[0]!.text};return module.exports;}});`
const host = await prepareS0WebHost(path.join(outputRoot, 'workspace'), outputRoot)
const server = await host.start(client)
let browser: Browser | undefined
let activePage: Page | undefined
const errors: string[] = []
const checks: Record<string, unknown>[] = []

async function expandDetails(reader: Locator) {
  // Exercise native details activation, including keyboard activation on the first disclosure.
  const details = reader.locator('details:not([open])')
  while (await details.count()) {
    const summary = details.first().locator(':scope > summary')
    await summary.focus()
    await summary.press('Enter')
  }
}

async function verifyReader(page: Page, document: PresentationDocument, staticMode = false) {
  const reader = page.locator(
    `[data-presentation-reader][data-mode="${staticMode ? 'static' : 'interactive'}"]`,
  )
  await reader.getByRole('heading', { name: document.title, exact: true }).waitFor()
  await expandDetails(reader)
  const snapshot: Record<string, unknown>[] = []
  for (const block of document.blocks) {
    const node = reader.locator(`[data-block-id="${block.id}"]`)
    await node.waitFor()
    if (block.kind === 'markdown') {
      const text = await node.innerText()
      if (document.buildId === interaction.buildId) {
        assert.ok(text.includes('已保存的正文'))
        assert.ok(text.includes('精确值'))
        assert.ok(text.includes(attack))
      } else assert.ok(text.includes(block.text), `markdown ${block.id} lost its body`)
      snapshot.push({ id: block.id, markdown: text.trim() })
    }
    if (block.kind === 'metric') {
      const dataset = document.datasets.find((value) => value.id === block.datasetId)!.data
      const index = dataset.columns.findIndex((column) => column.id === block.columnId)
      const text = await node.innerText()
      const value = formatCell(dataset.rows[block.rowIndex]![index]!, dataset.columns[index]!)
      assert.ok(text.includes(value), `metric ${block.id} lost ${value}`)
      if (dataset.columns[index]!.unit) assert.ok(text.includes(dataset.columns[index]!.unit!))
      snapshot.push({ id: block.id, metric: text.trim() })
    }
    if (block.kind === 'table' || block.kind === 'chart') {
      const dataset = document.datasets.find((value) => value.id === block.datasetId)!.data
      const selected =
        block.kind === 'chart'
          ? [block.x, ...block.y]
          : (block.columns ?? dataset.columns.map((column) => column.id))
      const text = await node.innerText()
      for (const id of selected) {
        const column = dataset.columns.find((value) => value.id === id)!
        assert.ok(text.includes(column.label), `${block.id}: missing label ${column.label}`)
        if (column.unit)
          assert.ok(text.includes(column.unit), `${block.id}: missing unit ${column.unit}`)
      }
      for (const row of dataset.rows.slice(0, staticMode ? undefined : 20)) {
        for (const id of selected) {
          const index = dataset.columns.findIndex((column) => column.id === id)
          const value = formatCell(row[index]!, dataset.columns[index]!)
          assert.ok(text.includes(value), `${block.id}: missing cell ${value}`)
        }
      }
      if (dataset.truncated) assert.match(text, /截断/)
      if (!staticMode && block.kind === 'chart' && dataset.rows.length) {
        await node.locator('svg.recharts-surface').waitFor()
        const marks = block.chart === 'line' ? '.recharts-line-curve' : '.recharts-bar-rectangle'
        assert.ok(await node.locator(marks).count(), `${block.chart} has no plotted marks`)
      }
      snapshot.push({ id: block.id, cells: await node.locator('tbody td').allTextContents() })
    }
  }
  for (const source of document.sources) {
    const node = reader.locator(`[data-source-id="${source.id}"]`).first()
    const text = await node.innerText()
    assert.equal(await node.getAttribute('data-source-status'), source.status)
    for (const value of Object.values(source.ref)) assert.ok(text.includes(value))
    if (source.status === 'unavailable') assert.ok(text.includes(source.reason))
    else for (const fact of source.facts) assert.ok(text.includes(fact.value))
    snapshot.push({ source: source.id, text: text.trim() })
  }
  if (!document.datasets.length) assert.equal(await reader.locator('table').count(), 0)
  assert.equal(
    await reader.locator('img,script,iframe,object,embed,a[href^="javascript:"]').count(),
    0,
  )
  assert.equal(await page.evaluate(() => '__presentationXss' in window), false)
  return snapshot
}

async function verifyInteractions(page: Page) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const reader = page.locator('[data-presentation-reader][data-mode="interactive"]')
  const table = reader.locator('[data-block-id="table"]')
  assert.equal(await table.locator('tbody tr').count(), 20)
  const sort = table.getByRole('button', { name: '按 精确金额 排序', exact: true })
  await sort.focus()
  await sort.press('Enter')
  assert.ok((await table.locator('tbody tr').first().innerText()).includes('9007199254740992.1000'))
  await sort.press('Enter')
  assert.ok((await table.locator('tbody tr').first().innerText()).includes('9007199254741016.1000'))
  await table.getByRole('button', { name: '下一页', exact: true }).click()
  assert.equal(await table.locator('tbody tr').count(), 5)
  assert.ok((await table.innerText()).includes('9007199254740992.1000'))
  await table.getByRole('button', { name: '上一页', exact: true }).click()
  assert.equal(await table.locator('tbody tr').count(), 20)
  const chart = reader.locator('[data-block-id="line"]')
  const series = chart.getByRole('button', { name: '显示系列 对照', exact: true })
  assert.equal(await series.getAttribute('aria-pressed'), 'true')
  assert.equal(await chart.locator('.recharts-line-curve').count(), 2)
  await series.focus()
  await series.press('Space')
  assert.equal(await series.getAttribute('aria-pressed'), 'false')
  assert.equal(await chart.locator('.recharts-line-curve').count(), 1)
  await series.press('Space')
  assert.equal(await chart.locator('.recharts-line-curve').count(), 2)
  const select = chart.getByLabel('选择图表数据行', { exact: true })
  await select.focus()
  // Native macOS Chromium pop-up menus are not driven by synthetic ArrowDown;
  // HTML select type-ahead remains a real keyboard path and selects row "2.".
  await select.press('2')
  await select.press('Tab')
  assert.equal(await select.inputValue(), '1')
  const tooltip = chart.locator('.pr-coordinate [data-chart-tooltip]')
  assert.ok((await tooltip.innerText()).includes('24'))
  const approximate = reader.locator('[data-block-id="approximate"]')
  await approximate.getByLabel('选择图表数据行', { exact: true }).selectOption('0')
  assert.ok(
    (await approximate.locator('.pr-coordinate [data-chart-tooltip]').innerText()).includes(
      '9007199254741016.1000',
    ),
  )
  await approximate.locator('.recharts-bar-rectangle').first().hover()
  const pointerTooltip = approximate.locator('.recharts-tooltip-wrapper [data-chart-tooltip]')
  await pointerTooltip.waitFor({ state: 'visible' })
  assert.ok((await pointerTooltip.innerText()).includes('9007199254741016.1000'))
  const copy = reader.getByRole('button', { name: '复制追问上下文', exact: true }).first()
  await copy.focus()
  await copy.press('Enter')
  await reader.getByText('已复制，可粘贴到对话中继续分析。', { exact: true }).first().waitFor()
  const clipboard = await page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText()
    } catch {
      return null
    }
  })
  const copied = clipboard ?? (await reader.getByLabel('追问上下文', { exact: true }).inputValue())
  assert.ok(copied.includes('s3-artifact'))
  assert.ok(copied.includes('s3-session'))
  return {
    sortingExactDecimal: true,
    pagination: true,
    seriesKeyboard: true,
    exactTooltip: true,
    pointerTooltip: true,
    copiedSourceIdentity: true,
  }
}

async function verifyHostTheme(page: Page) {
  const snapshots = []
  for (const [hostPreference, osPreference, label] of [
    ['dark', 'light', 'Host 深色'],
    ['light', 'dark', 'Host 浅色'],
  ] as const) {
    await page.emulateMedia({ colorScheme: osPreference })
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.locator(`[data-host-theme="${hostPreference}"]`).waitFor()
    const snapshot = await page.evaluate(() => {
      const reader = getComputedStyle(document.querySelector('[data-mode="interactive"]')!)
      return {
        darkAttribute: document.body.hasAttribute('data-ds-dark-theme'),
        hostBackgroundToken: getComputedStyle(document.body)
          .getPropertyValue('--dsw-alias-bg-base')
          .trim(),
        readerBackgroundToken: reader.getPropertyValue('--pr-bg').trim(),
        background: reader.backgroundColor,
        color: reader.color,
      }
    })
    assert.equal(snapshot.darkAttribute, hostPreference === 'dark')
    assert.equal(snapshot.readerBackgroundToken, snapshot.hostBackgroundToken)
    snapshots.push({ hostPreference, osPreference, ...snapshot })
    await page
      .getByRole('dialog', { name: 'S3 reader 验证', exact: true })
      .evaluate((node) => node.scrollTo(0, 0))
    await page.screenshot({ path: path.join(outputRoot, `host-manual-${hostPreference}.png`) })
  }
  assert.notEqual(snapshots[0]!.background, snapshots[1]!.background)
  await page.emulateMedia({ colorScheme: 'light' })
  return {
    boundary:
      'Actual Host ThemeRuntime.setTheme and theme/change through validation buttons; actual ThemePresenter applies body attributes/tokens',
    snapshots,
  }
}

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url })
  const page = await context.newPage()
  activePage = page
  page.setDefaultTimeout(15_000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(server.url)
  // The fresh isolated DSH profile's first-use notice is owned by the Host.
  await page.getByRole('button', { name: '继续', exact: true }).click({ timeout: 45_000 })
  await page.getByRole('button', { name: '稍后配置', exact: true }).click()
  await page.getByRole('button', { name: '打开 S3 验证', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'S3 reader 验证', exact: true })
    .waitFor({ timeout: 45_000 })
  const hostReact = await page.locator('[data-host-react]').getAttribute('data-host-react')
  assert.equal(hostReact, '18.3.1')
  const loaderMode = await page.evaluate(
    () => (window as unknown as { __ModuleLoader__: { mode: string } }).__ModuleLoader__.mode,
  )
  assert.equal(loaderMode, 'live')
  for (const item of cases) {
    await page
      .getByRole('navigation', { name: '验证样例', exact: true })
      .getByRole('button', { name: item.name, exact: true })
      .click()
    const hostSnapshot = await verifyReader(page, item.document)
    await page
      .getByRole('dialog', { name: 'S3 reader 验证', exact: true })
      .evaluate((node) => node.scrollTo(0, 0))
    await page
      .getByRole('dialog', { name: 'S3 reader 验证', exact: true })
      .screenshot({ path: path.join(outputRoot, `${item.name}-host.png`) })
    const offline = await browser.newContext({
      offline: true,
      viewport: { width: 1440, height: 1100 },
    })
    const offlinePage = await offline.newPage()
    const requests: string[] = []
    offlinePage.on('request', (request) => {
      if (!request.url().startsWith('file:')) requests.push(request.url())
    })
    offlinePage.on('pageerror', (error) => errors.push(error.message))
    await offlinePage.goto(pathToFileURL(portableFiles.get(item.name)!).href)
    await offlinePage.waitForFunction(
      () => document.documentElement.dataset.presentationReady === 'true',
    )
    assert.deepEqual(
      JSON.parse((await offlinePage.locator('#presentation-data').textContent())!),
      item.document,
    )
    assert.deepEqual(await verifyReader(offlinePage, item.document), hostSnapshot)
    await offlinePage.screenshot({
      path: path.join(outputRoot, `${item.name}-offline.png`),
      fullPage: true,
    })
    let interactions: unknown
    if (item.name === 'interactions') {
      interactions = {
        hostTheme: await verifyHostTheme(page),
        host: await verifyInteractions(page),
        portable: await verifyInteractions(offlinePage),
      }
      const lightBackground = await offlinePage
        .locator('[data-presentation-reader][data-mode="interactive"]')
        .evaluate((node) => getComputedStyle(node).backgroundColor)
      await offlinePage.setViewportSize({ width: 375, height: 812 })
      await offlinePage.emulateMedia({ colorScheme: 'dark' })
      const layout = await offlinePage.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        background: getComputedStyle(document.querySelector('[data-mode="interactive"]')!)
          .backgroundColor,
        color: getComputedStyle(document.querySelector('[data-mode="interactive"]')!).color,
      }))
      assert.notEqual(layout.background, lightBackground, 'dark theme did not change reader colors')
      const luminance = (color: string) => {
        const channels = color
          .match(/\d+/g)!
          .slice(0, 3)
          .map((value) => {
            const channel = Number(value) / 255
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
          })
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      }
      const fg = luminance(layout.color)
      const bg = luminance(layout.background)
      const contrast = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
      assert.ok(contrast >= 4.5, `dark body contrast is only ${contrast}`)
      assert.ok(
        layout.scrollWidth <= layout.width + 1,
        `narrow reader overflows: ${JSON.stringify(layout)}`,
      )
      await offlinePage.screenshot({
        path: path.join(outputRoot, 'interactions-narrow-dark-full.png'),
        fullPage: true,
      })
      await offlinePage.evaluate(() => window.scrollTo(0, 0))
      await offlinePage.screenshot({ path: path.join(outputRoot, 'interactions-narrow-dark.png') })
      for (const [blockId, mark] of [
        ['line', '.recharts-line-dots circle'],
        ['approximate', '.recharts-bar-rectangle'],
      ] as const) {
        const chart = offlinePage.locator(`[data-mode="interactive"] [data-block-id="${blockId}"]`)
        await chart.locator('h2').evaluate((node) => node.scrollIntoView({ block: 'start' }))
        for (const tick of await chart
          .locator('.recharts-yAxis .recharts-cartesian-axis-tick-value')
          .all()) {
          const bounds = await tick.boundingBox()
          assert.ok(
            bounds && bounds.x >= 0 && bounds.x + bounds.width <= 376,
            'narrow Y-axis tick is clipped horizontally',
          )
        }
        await chart.locator(mark).first().hover()
        const tooltip = chart.locator('.recharts-tooltip-wrapper [data-chart-tooltip]')
        await tooltip.waitFor({ state: 'visible' })
        const bounds = await tooltip.boundingBox()
        await offlinePage.screenshot({
          path: path.join(outputRoot, `interactions-narrow-dark-${blockId}.png`),
        })
        assert.ok(
          bounds && bounds.x >= 0 && bounds.x + bounds.width <= 376,
          `narrow ${blockId} tooltip is clipped horizontally: ${JSON.stringify(bounds)}`,
        )
      }
      checks.push({ narrowDark: { ...layout, contrast }, keyboard: true })
    }
    await offlinePage.emulateMedia({ media: 'print', colorScheme: 'light' })
    assert.ok(await offlinePage.locator('#presentation-fallback').isVisible())
    assert.ok(!(await offlinePage.locator('#reader').isVisible()))
    await verifyReader(offlinePage, item.document, true)
    await offlinePage.pdf({
      path: path.join(outputRoot, `${item.name}-print.pdf`),
      format: 'A4',
      printBackground: true,
    })
    assert.deepEqual(requests, [])
    await offline.close()
    const noScript = await browser.newContext({ javaScriptEnabled: false, offline: true })
    const noScriptPage = await noScript.newPage()
    const noScriptRequests: string[] = []
    noScriptPage.on('request', (request) => {
      if (!request.url().startsWith('file:')) noScriptRequests.push(request.url())
    })
    await noScriptPage.goto(pathToFileURL(portableFiles.get(item.name)!).href)
    await verifyReader(noScriptPage, item.document, true)
    assert.deepEqual(noScriptRequests, [])
    await noScript.close()
    checks.push({
      name: item.name,
      provenance: item.provenance,
      hostPortableParity: true,
      offlineRequests: requests,
      noScriptRequests,
      staticAndPrintReadable: true,
      interactions,
    })
    process.stdout.write(`S3 reader passed: ${item.name}\n`)
  }
  assert.deepEqual(errors, [])
  const evidence = {
    status: 'passed',
    outputRoot,
    browser: browser.version(),
    hostReact,
    loaderMode,
    productionClientSha256: sha256(productionClient),
    boundary:
      'Production lib/client.js loaded unchanged by actual DSH Web module loader with Host React; validation-only snapshot overlay. Production portable builder, file:// offline, no-JS and print.',
    excluded: [
      'S4 present/receipt/RPC/download delivery',
      'fresh S2 Runtime execution',
      'real Agent routing',
    ],
    projectionEvidence,
    checks,
    errors,
  }
  await writeFile(path.join(outputRoot, 'reader-evidence.json'), JSON.stringify(evidence, null, 2))
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
} catch (error) {
  await writeFile(path.join(outputRoot, 'reader-failure.txt'), String(error))
  await writeFile(
    path.join(outputRoot, 'reader-partial-evidence.json'),
    JSON.stringify({ status: 'failed', error: String(error), checks, errors }, null, 2),
  )
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: path.join(outputRoot, 'failure.png') }).catch(() => {})
    await writeFile(
      path.join(outputRoot, 'failure-dom.txt'),
      await activePage.locator('body').innerText(),
    ).catch(() => {})
  }
  throw error
} finally {
  await browser?.close()
  await server.stop()
}
