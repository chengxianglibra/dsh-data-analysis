/** Isolated real-model UI acceptance. Neither the source Workspace nor its data is written. */
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { bindMarivoEnvironment } from '../src/environment/index.ts'
import type { CatalogSnapshot } from '../src/semantic-browser/contracts.ts'
import { browserFailure, SemanticBrowserService } from '../src/semantic-browser/service.ts'

const source = process.env.DSH_DATA_ANALYSIS_YELLOW_TAXI_ROOT
const python = process.env.DSH_DATA_ANALYSIS_TEST_PYTHON
if (!source || !python)
  throw new Error('Set DSH_DATA_ANALYSIS_YELLOW_TAXI_ROOT and DSH_DATA_ANALYSIS_TEST_PYTHON')
const output = process.env.DSH_DATA_ANALYSIS_BROWSER_OUTPUT
  ? path.resolve(process.env.DSH_DATA_ANALYSIS_BROWSER_OUTPUT)
  : await mkdtemp(path.join(tmpdir(), 'semantic-yellow-taxi-evidence-'))
await mkdir(output, { recursive: true })
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'semantic-yellow-taxi-workspace-')))
let service: SemanticBrowserService | undefined
let server: ReturnType<typeof createServer> | undefined
try {
  await cp(path.join(source, 'marivo.toml'), path.join(root, 'marivo.toml'))
  await cp(path.join(source, 'models'), path.join(root, 'models'), { recursive: true })
  const runner = await bindMarivoEnvironment({ projectRoot: root, pythonExecutable: python })
  service = new SemanticBrowserService({
    getWorkspace: (id) => (id === 'taxi' ? { id, path: root } : undefined),
    projectRoot: (item) => item.path,
    resolve: async () => runner,
  })
  const workspaces = [{ workspaceId: 'taxi', title: 'Yellow Taxi', path: root, sessionIds: [] }]
  const panel = fileURLToPath(new URL('../src/client/semantic-browser/panel.tsx', import.meta.url))
  const model = fileURLToPath(new URL('../src/client/semantic-browser/model.ts', import.meta.url))
  const app = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CopyProvider} from './packages/dsh-data-analysis/src/client/i18n/context.tsx';
import {translator} from './packages/dsh-data-analysis/src/client/i18n/copy.ts';
import {SemanticBrowserPanel} from ${JSON.stringify(panel)};
import {SemanticBrowserModel} from ${JSON.stringify(model)};
const model=new SemanticBrowserModel({call:async(_channel,_endpoint,payload,signal)=>{
 const response=await fetch('/catalog',{method:'POST',body:JSON.stringify(payload),signal});return response.json();
}});
const workspaces=${JSON.stringify(workspaces)};
createRoot(document.getElementById('app')).render(<CopyProvider t={translator('zh-CN')}><button onClick={()=>model.show('taxi')}>打开语义层</button><div style={{height:'calc(100dvh - 45px)',minWidth:0}}><SemanticBrowserPanel model={model} workspaces={workspaces}/></div></CopyProvider>);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  })
  let requests = 0
  let snapshot: CatalogSnapshot | undefined
  server = createServer(async (req, res) => {
    if (req.url === '/app.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(app.outputFiles[0]!.text)
    } else if (req.url === '/catalog') {
      requests++
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const controller = new AbortController()
      res.on('close', () => controller.abort())
      res.setHeader('Content-Type', 'application/json')
      try {
        snapshot = await service!.read(
          JSON.parse(Buffer.concat(chunks).toString()),
          controller.signal,
        )
        res.end(JSON.stringify({ ok: true, value: snapshot }))
      } catch (error) {
        res.end(JSON.stringify({ ok: false, error: { message: browserFailure(error) } }))
      }
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="app"></div><script src="/app.js"></script></html>',
      )
    }
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('listener-unavailable')
  const { chromium } = await import(process.env.DSH_DATA_ANALYSIS_PLAYWRIGHT_MODULE ?? 'playwright')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: 1613, height: 973 },
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const errors: string[] = []
  page.on('pageerror', (error: Error) => errors.push(error.message))
  const checks: string[] = []
  try {
    await page.goto(`http://127.0.0.1:${address.port}`)
    await page.getByRole('button', { name: '打开语义层' }).click()
    await page.getByLabel('搜索语义对象').waitFor({ timeout: 60000 })
    await page.getByRole('button', { name: '下一页' }).waitFor({ timeout: 60000 })
    assert.equal(requests, 1)
    await page.screenshot({ path: path.join(output, 'catalog-desktop.png') })
    const classification = page.getByRole('navigation', { name: '对象分类' })
    await classification.getByRole('radio', { name: /^指标\s*\d+$/ }).click()
    await page
      .locator('.sb-objects button')
      .filter({ hasText: 'metric:mobility.airport_fees' })
      .click()
    const definitionTab = page.getByRole('tab', { name: '定义', exact: true })
    const overviewTab = page.getByRole('tab', { name: '概览', exact: true })
    const airport = snapshot?.objects.find((item) => item.ref.path === 'mobility.airport_fees')
    assert.ok(airport?.definition)
    const overview = page.getByRole('tabpanel', { name: '概览' })
    assert.equal(await overview.locator('.sb-overview-description').innerText(), airport.definition)
    assert.equal(await overview.locator('dt[title="domain"] + dd').innerText(), airport.domain)
    assert.equal(await overview.locator('dt[title="roots"]').count(), 0)
    assert.equal(await overview.locator('dt[title="unit"] + dd').innerText(), 'USD')
    const overviewValueStarts: Array<number | null> = await overview
      .locator('.sb-overview-value')
      .evaluateAll((values: Element[]) =>
        values.map((value) => {
          const walker = document.createTreeWalker(value, NodeFilter.SHOW_TEXT)
          let text = walker.nextNode()
          while (text && !text.textContent?.trim()) text = walker.nextNode()
          if (!text?.textContent) return null
          const start = text.textContent.search(/\S/)
          const range = document.createRange()
          range.setStart(text, start)
          range.setEnd(text, start + 1)
          return range.getBoundingClientRect().left
        }),
      )
    assert.ok(overviewValueStarts.length >= 2 && overviewValueStarts.every((left) => left !== null))
    const starts = overviewValueStarts.filter((left): left is number => left !== null)
    assert.ok(
      Math.max(...starts) - Math.min(...starts) <= 1,
      'overview value text shares one left edge',
    )
    assert.deepEqual(await overview.locator('.sb-overview-guardrails > li').allTextContents(), [
      ...new Set(airport.guardrails),
    ])
    await page.screenshot({ path: path.join(output, 'airport-fees-overview.png') })
    await definitionTab.click()
    await page.waitForFunction(() => {
      const tabs = [...document.querySelectorAll('.sb-tabs [role="tab"]')]
      return tabs.some(
        (tab) => tab.textContent?.trim() === '定义' && tab.getAttribute('aria-selected') === 'true',
      )
    })
    assert.equal(await definitionTab.getAttribute('aria-selected'), 'true')
    assert.equal(await overviewTab.getAttribute('aria-selected'), 'false')
    const tabStates: Array<{
      text: string | undefined
      selected: string | null
      state: string | null
      color: string
      underline: string
      focused: boolean
    }> = await page.locator('.sb-tabs [role="tab"]').evaluateAll((tabs: Element[]) =>
      tabs.map((tab) => ({
        text: tab.textContent?.trim(),
        selected: tab.getAttribute('aria-selected'),
        state: tab.getAttribute('data-state'),
        color: getComputedStyle(tab).color,
        underline: getComputedStyle(tab, '::after').opacity,
        focused: document.activeElement === tab,
      })),
    )
    console.log(JSON.stringify({ tabStates }))
    assert.equal(tabStates.find((tab) => tab.text === '定义')?.underline, '1')
    assert.equal(tabStates.find((tab) => tab.text === '概览')?.underline, '0')
    assert.equal(tabStates.find((tab) => tab.text === '关系')?.underline, '0')
    const selectedColor = await definitionTab.evaluate(
      (node: Element) => getComputedStyle(node).color,
    )
    const inactiveColor = await overviewTab.evaluate(
      (node: Element) => getComputedStyle(node).color,
    )
    assert.notEqual(selectedColor, inactiveColor, 'selected tab has a distinct foreground')
    await page.screenshot({ path: path.join(output, 'airport-fees-design.png') })
    await page.getByRole('tab', { name: '概览', exact: true }).click()
    await classification.getByRole('radio', { name: /^全部对象/ }).click()
    const open = async (key: string, name: string) => {
      await page.getByLabel('搜索语义对象').fill(key)
      await page.locator('.sb-objects button').filter({ hasText: key }).first().click()
      await page.getByRole('heading', { name, exact: true }).waitFor()
    }
    const visibleText = (text: string) =>
      page.waitForFunction(
        (expected: string) =>
          [...document.querySelectorAll('*')].some(
            (element) =>
              element.childElementCount === 0 &&
              element.textContent?.includes(expected) &&
              element.getClientRects().length > 0 &&
              getComputedStyle(element).visibility !== 'hidden',
          ),
        text,
      )
    await open('metric:mobility.average_fare', 'average_fare')
    await page.getByRole('tab', { name: '定义', exact: true }).click()
    const averageFare = snapshot?.objects.find((item) => item.ref.path === 'mobility.average_fare')
    assert.ok(averageFare?.computation?.expression)
    const averageNulls = page
      .locator('.sb-computation .sb-calculation-node')
      .first()
      .locator('.sb-fact-row')
      .filter({ hasText: '空值规则' })
    const averageSummary = averageNulls.locator('.sb-null-rule-summary')
    assert.equal(await averageSummary.locator('li').count(), 2)
    assert.match(await averageSummary.innerText(), /计算时忽略 NULL/)
    assert.match(await averageSummary.innerText(), /按源记录计数/)
    assert.doesNotMatch(await averageSummary.innerText(), /sum\(|count\(|measure:|entity:/)
    await averageNulls.locator('.sb-null-rule-branches > summary').click()
    assert.match(await averageNulls.locator('.sb-null-rule-branches').innerText(), /sum\(|count\(/)
    await page.screenshot({ path: path.join(output, 'average-fare-null-rules.png') })
    const fareFormula = page
      .locator('.sb-computation .sb-calculation-node')
      .first()
      .locator('.sb-expression-code')
    const fareReference = fareFormula.locator(
      'button[title="metric:mobility.plausible_fare_revenue"]',
    )
    assert.equal(await fareReference.innerText(), 'plausible_fare_revenue')
    assert.equal(
      await fareReference.getAttribute('aria-description'),
      'metric:mobility.plausible_fare_revenue',
    )
    await fareFormula.getByRole('button', { name: '复制代码' }).click()
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      averageFare.computation.expression,
    )
    await fareReference.click()
    await page.getByRole('heading', { name: 'plausible_fare_revenue', exact: true }).waitFor()
    await page.getByRole('button', { name: '返回上个对象', exact: true }).click()
    await page.getByRole('heading', { name: 'average_fare', exact: true }).waitFor()
    await open('domain:mobility', 'mobility')
    await page.getByRole('tab', { name: '概览', exact: true }).click()
    const domain = snapshot?.objects.find(
      (item) => item.ref.kind === 'domain' && item.name === 'mobility',
    )
    assert.ok(domain)
    assert.deepEqual(await overview.locator('.sb-overview-guardrails > li').allTextContents(), [
      ...new Set(domain.guardrails),
    ])
    for (const field of domain.fields.filter(
      (item) => ['owner', 'default'].includes(item.name) && item.value,
    )) {
      await overview.locator(`dt[title="${field.name}"] + dd`).waitFor()
    }
    await page.getByText('Treat all timestamps as America/New_York local time.').waitFor()
    await page.getByText(/Credit-card tips are recorded automatically/).waitFor()
    await page.screenshot({ path: path.join(output, 'domain-overview.png') })
    await open('entity:mobility.yellow_trips', 'yellow_trips')
    await page.getByRole('tab', { name: '概览', exact: true }).click()
    await page.screenshot({ path: path.join(output, 'entity-overview.png') })
    await page.getByRole('tab', { name: '关系', exact: true }).click()
    const entityGroups = page.locator('.sb-relation-group')
    assert.ok((await entityGroups.count()) > 0)
    await page.screenshot({ path: path.join(output, 'entity-relations.png') })
    const entity = snapshot?.objects.find((item) => item.ref.path === 'mobility.yellow_trips')
    const fields = entity?.fields.find((field) => field.name === 'fields')
    assert.ok(fields?.structured)
    const expectedFields: unknown = JSON.parse(fields.value)
    assert.ok(Array.isArray(expectedFields) && expectedFields.length > 8)
    assert.ok(expectedFields.every((value): value is string => typeof value === 'string'))
    const renderedFields = await entityGroups.locator('.sb-relation-item-ref').allTextContents()
    assert.ok(expectedFields.every((field) => renderedFields.includes(field)))
    assert.equal(new Set(renderedFields).size, renderedFields.length)
    await page.getByRole('tab', { name: '定义', exact: true }).click()
    assert.equal(await page.locator('.sb-fields dt[title="fields"]').count(), 0)
    await page.screenshot({ path: path.join(output, 'entity-definition.png') })
    await open('time_dimension:mobility.yellow_trips.picked_up_at', 'picked_up_at')
    await page.getByRole('tab', { name: '概览', exact: true }).click()
    await visibleText('America/New_York')
    await page.getByRole('tab', { name: '定义', exact: true }).click()
    await page.screenshot({ path: path.join(output, 'time-dimension-definition.png') })
    await open('measure:mobility.yellow_trips.fare_amount', 'fare_amount')
    await page.getByRole('tab', { name: '定义', exact: true }).click()
    await visibleText('fare_amount_usd')
    await page.screenshot({ path: path.join(output, 'measure-definition.png') })
    await open('metric:mobility.airport_fees', 'airport_fees')
    await page.getByRole('tab', { name: '定义', exact: true }).click()
    const nullRules = airport?.computation?.facts.find((fact) => fact.name === 'null_rules')
    assert.ok(nullRules?.structured)
    const expectedNullRules: unknown = JSON.parse(nullRules.value)
    assert.ok(Array.isArray(expectedNullRules) && expectedNullRules.length > 0)
    assert.ok(expectedNullRules.every((rule): rule is string => typeof rule === 'string'))
    const expression = airport?.computation?.expression
    assert.ok(expression)
    const prefix = `${expression}: `
    assert.ok(expectedNullRules.some((rule) => rule.startsWith(prefix)))
    const airportNode = page.locator('.sb-computation .sb-calculation-node').first()
    const airportBindings = airportNode.locator('.sb-fact-row').filter({
      has: page.locator('.sb-fact-label', { hasText: '时间绑定' }),
    })
    const airportTime = airportBindings.locator(
      'button[title="time_dimension:mobility.yellow_trips.picked_up_at"]',
    )
    assert.equal(await airportTime.innerText(), 'picked_up_at')
    const listBounds = await page.locator('.sb-list').boundingBox()
    const detailBounds = await page.locator('.sb-detail').boundingBox()
    const identityBounds = await page.locator('.sb-detail-identity').boundingBox()
    const refBounds = await page.locator('.sb-identity-text .sb-ref').boundingBox()
    const actionBounds = await page.locator('.sb-detail-actions').boundingBox()
    const domainBounds = await page.locator('.sb-domain').boundingBox()
    const kindsBounds = await page.locator('.sb-kinds').boundingBox()
    assert.ok(listBounds && detailBounds && identityBounds && refBounds && actionBounds)
    assert.ok(domainBounds && kindsBounds)
    const listRatio = listBounds.width / (listBounds.width + detailBounds.width)
    assert.ok(listRatio >= 0.29 && listRatio <= 0.35, `unexpected column ratio ${listRatio}`)
    assert.ok(Math.abs(domainBounds.y - kindsBounds.y) < 16, 'desktop filters share a row')
    assert.ok(refBounds.width >= 180 && refBounds.height < 50, 'object reference stays readable')
    assert.ok(identityBounds.y >= detailBounds.y, 'new selection starts at the detail header')
    assert.ok(actionBounds.x > identityBounds.x, 'desktop actions sit beside the identity')
    await page.screenshot({ path: path.join(output, 'airport-fees-revisited.png') })
    const dependencies = airport?.fields.find((field) => field.name === 'dependencies')
    assert.ok(dependencies?.structured)
    const expectedDependencies: unknown = JSON.parse(dependencies.value)
    assert.ok(Array.isArray(expectedDependencies))
    assert.ok(expectedDependencies.every((value): value is string => typeof value === 'string'))
    const actualDependencies = await page.locator('.sb-relation-item-ref').allTextContents()
    assert.ok(expectedDependencies.every((value) => actualDependencies.includes(value)))
    assert.equal(await page.locator('.sb-computation details.sb-dependencies').count(), 0)
    const source = page.locator('.sb-detail details.sb-source')
    assert.equal(await source.getAttribute('open'), null)
    await source.locator(':scope > summary').click()
    assert.ok((await source.locator('.sb-source-content .sb-ref').count()) > 0)
    await page.screenshot({ path: path.join(output, 'airport-fees-source-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: path.join(output, 'airport-fees-source-mobile.png') })
    await page.setViewportSize({ width: 1613, height: 973 })
    await source.locator(':scope > summary').click()
    const airportNulls = airportNode.locator('.sb-fact-row').filter({
      has: page.locator('.sb-fact-label', { hasText: '空值规则' }),
    })
    assert.equal(
      await airportNulls.locator('.sb-fact-value').innerText(),
      '计算时忽略 NULL；没有符合条件的记录时返回 0；有记录但参与计算的值全部为 NULL 时返回 NULL',
    )
    await page.screenshot({ path: path.join(output, 'airport-fees-simplified-facts.png') })
    await airportTime.click()
    await page.getByRole('heading', { name: 'picked_up_at', exact: true }).waitFor()
    await page.getByRole('button', { name: '返回上个对象', exact: true }).click()
    await page.getByRole('heading', { name: 'airport_fees', exact: true }).waitFor()
    const referenced = page.locator('.sb-computation section.sb-referenced-definitions')
    assert.equal(await referenced.locator('details').count(), 0)
    await page.screenshot({ path: path.join(output, 'airport-fees-definition.png') })
    await referenced
      .locator('button[title="measure:mobility.yellow_trips.airport_fee_amount"]')
      .click()
    await page.getByRole('heading', { name: 'airport_fee_amount', exact: true }).waitFor()
    await page.getByRole('button', { name: '返回上个对象', exact: true }).click()
    await page.getByRole('heading', { name: 'airport_fees', exact: true }).waitFor()
    await open('metric:mobility.total_surcharges', 'total_surcharges')
    await page.getByRole('tab', { name: '定义', exact: true }).click()
    await visibleText('total_cbd_congestion_fees')
    const metric = snapshot?.objects.find((item) => item.ref.path === 'mobility.total_surcharges')
    const bindings = metric?.computation?.facts.find((fact) => fact.name === 'time_bindings')
    assert.ok(bindings?.structured)
    const expectedBindings: unknown = JSON.parse(bindings.value)
    assert.ok(Array.isArray(expectedBindings) && expectedBindings.length > 1)
    assert.ok(expectedBindings.every((binding) => typeof binding?.branch === 'string'))
    const bindingSection = page
      .locator('.sb-computation .sb-calculation-node')
      .first()
      .locator('.sb-fact-row')
      .filter({ has: page.locator('.sb-fact-label', { hasText: '时间绑定' }) })
    assert.equal(
      await bindingSection.locator('.sb-fact-value button').count(),
      1,
      'identical bindings share one dimension',
    )
    assert.equal(await bindingSection.locator('.sb-fact-value button').innerText(), 'picked_up_at')
    await page.screenshot({ path: path.join(output, 'metric-definition.png') })
    await page.getByRole('tab', { name: '关系', exact: true }).click()
    await visibleText('airport_fees')
    assert.ok(metric)
    for (const group of await page.locator('.sb-relation-group').all()) {
      if ((await group.getAttribute('open')) === null) await group.locator('summary').click()
    }
    const renderedRelations = await page.locator('.sb-relation-item-ref').allTextContents()
    assert.deepEqual(
      renderedRelations.slice().sort(),
      [
        ...new Set(metric.relations.map((relation) => `${relation.ref.kind}:${relation.ref.path}`)),
      ].sort(),
      'relation groups retain each Catalog reference once',
    )
    await page.screenshot({ path: path.join(output, 'metric-relations.png') })
    await page.getByRole('button', { name: '查看关系图' }).click()
    await page.getByRole('img', { name: '当前对象的局部关系图' }).waitFor()
    await page.screenshot({ path: path.join(output, 'metric-graph.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('tab', { name: '概览', exact: true }).click()
    await page.screenshot({ path: path.join(output, 'metric-mobile-overview.png') })
    await page.getByRole('tab', { name: '关系', exact: true }).click()
    await page.getByRole('button', { name: '收起关系图' }).click()
    await page.screenshot({ path: path.join(output, 'metric-mobile-relations.png') })
    await page.getByRole('button', { name: '查看关系图' }).click()
    await page.screenshot({ path: path.join(output, 'metric-mobile-graph.png') })
    await page.setViewportSize({ width: 1613, height: 973 })
    await open('relationship:mobility.trips_to_pickup_zones', 'trips_to_pickup_zones')
    await page.getByRole('tab', { name: '概览', exact: true }).click()
    await visibleText('pickup_location_id')
    await page.screenshot({ path: path.join(output, 'relationship-definition.png') })
    checks.push(
      'real Catalog: domain, entity, time dimension, measure, metrics and relationship; concise mixed null rules, direct references and complete grouped relationships',
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: path.join(output, 'relationship-mobile.png') })
    const bounds = await page.locator('.sb-panel').boundingBox()
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391)
    assert.equal(requests, 1, 'navigation must use the loaded Catalog')
    assert.deepEqual(errors, [])
    checks.push('narrow viewport, no page errors, and no extra Catalog reads')
    await writeFile(
      path.join(output, 'result.json'),
      JSON.stringify({ status: 'passed', checks, requests, errors }, null, 2),
    )
    console.log(JSON.stringify({ status: 'passed', output, checks }, null, 2))
  } finally {
    await browser.close()
  }
} finally {
  if (service) await service.close()
  if (server)
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    )
  await rm(root, { recursive: true, force: true })
}
