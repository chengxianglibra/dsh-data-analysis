/** Isolated real Harness, production packed plugin, Chromium and real Marivo; scripted model boundary. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { chromium } from 'playwright'
import { preparePresentationInputs } from './presentation-s4/runtime.ts'
import { startPresentationWebHost } from './presentation-s4/web-host.ts'

const python = process.env.DSH_DATA_ANALYSIS_PYTHON
if (!python) throw new Error('DSH_DATA_ANALYSIS_PYTHON required')
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dsh-datasource-config-web-')))
const workspace = path.join(root, 'workspace')
await mkdir(workspace)
const inputs = await preparePresentationInputs(workspace, python)
// Other local tasks may rebuild lib/. Build this acceptance candidate from an isolated source copy.
const candidate = path.join(root, 'candidate')
const candidatePackage = path.join(candidate, 'packages/dsh-data-analysis')
const sourcePackage = path.resolve('packages/dsh-data-analysis')
await mkdir(path.dirname(candidatePackage), { recursive: true })
await cp(sourcePackage, candidatePackage, {
  recursive: true,
  filter: (file) =>
    !['lib', 'node_modules', '__pycache__', '.pytest_cache'].some((part) =>
      path.relative(sourcePackage, file).split(path.sep).includes(part),
    ),
})
await cp(path.resolve('tsconfig.json'), path.join(candidate, 'tsconfig.json'))
await symlink(path.resolve('node_modules'), path.join(candidate, 'node_modules'))
await promisify(execFile)(
  process.execPath,
  [path.resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
  { cwd: candidatePackage, maxBuffer: 16 * 1024 * 1024 },
)
await promisify(execFile)(process.execPath, ['scripts/finalize-build.mjs'], {
  cwd: candidatePackage,
  maxBuffer: 16 * 1024 * 1024,
})
const host = await startPresentationWebHost(
  workspace,
  path.join(root, 'host'),
  python,
  inputs.draftPaths,
  'native-first',
  {
    rightTabsAcceptance: true,
    productionPackageRoot: candidatePackage,
    datasourceDefaults: {
      duckdb: { path: ':memory:', http_scope: '', read_only: false, extra: {} },
      trino: { host: 'defaults.example.invalid', port: 0, source: '' },
    },
  },
)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const checks: string[] = [],
  errors: string[] = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => errors.push(error.message))
  const credentialRoutes: string[] = []
  page.on('request', (request) => {
    if (/inline-web-(token|header)-canary/.test(request.postData() ?? ''))
      credentialRoutes.push(new URL(request.url()).pathname)
  })
  await page.goto(host.url)
  await page.getByRole('button', { name: '继续', exact: true }).click({ timeout: 45000 })
  await page.getByText('内测声明', { exact: true }).waitFor({ state: 'hidden' })
  const later = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await later.isVisible()) await later.click()
  await page.waitForFunction(() => !!(window as any).__rtHost)
  const select = (mode: string) =>
    page.evaluate((mode) => (window as any).__rtHost.select(`right-tabs-${mode}`), mode)
  const run = (mode: string, action: string) =>
    page.evaluate(
      async ({ mode, action }) => {
        const result = await (window as any).__s4Rpc('/presentation-s4-validation', 'prototype', {
          mode,
          action,
        })
        if (!result.ok) throw new Error('Fixture operation failed')
        return result.value
      },
      { mode, action },
    )
  await select('configure-create')
  await run('configure-create', 'credential-start')
  let form = page.getByRole('form', { name: '新增数据源' })
  await form.waitFor()
  checks.push('owning Session automatically opens create form in right tab')
  assert.equal(await form.getByLabel('引擎', { exact: true }).inputValue(), 'duckdb')
  assert.equal(await form.getByLabel('path', { exact: true }).inputValue(), ':memory:')
  assert.equal(await form.getByLabel('name', { exact: true }).inputValue(), '')
  assert.equal(await form.getByLabel('read_only', { exact: true }).inputValue(), 'false')
  assert.equal(await form.getByLabel('extra', { exact: true }).inputValue(), '{}')
  await form.getByLabel('path', { exact: true }).fill('user-choice.duckdb')
  await form.getByLabel('name', { exact: true }).fill('draft-name')
  assert.equal(await form.getByLabel('path', { exact: true }).inputValue(), 'user-choice.duckdb')
  await form.getByLabel('path', { exact: true }).fill('')
  await form.getByLabel('name', { exact: true }).fill('another-name')
  assert.equal(await form.getByLabel('path', { exact: true }).inputValue(), '')
  await form.getByLabel('引擎', { exact: true }).selectOption('trino')
  assert.equal(
    await form.getByLabel('host', { exact: true }).inputValue(),
    'defaults.example.invalid',
  )
  assert.equal(await form.getByLabel('port', { exact: true }).inputValue(), '0')
  assert.equal(await form.getByLabel('source', { exact: true }).inputValue(), '')
  await form.getByLabel('引擎', { exact: true }).selectOption('clickhouse')
  assert.equal(await form.getByLabel('host', { exact: true }).inputValue(), '')
  await form.getByLabel('引擎', { exact: true }).selectOption('duckdb')
  assert.equal(await form.getByLabel('path', { exact: true }).inputValue(), ':memory:')
  await page.screenshot({ path: path.join(root, 'creation-defaults.png'), fullPage: true })
  checks.push(
    'live schema defaults fill inputs only on creation and backend switch; edits and clearing survive rerender; unconfigured backend stays unchanged',
  )
  assert.equal(await page.getByLabel('选择已有数据源', { exact: true }).count(), 0)
  const choice = page.getByRole('group', { name: '配置方式' })
  await choice.getByRole('button', { name: '使用已有数据源', exact: true }).click()
  await page.getByLabel('选择已有数据源', { exact: true }).waitFor()
  assert.equal(await form.count(), 0)
  await choice.getByRole('button', { name: '新增数据源', exact: true }).click()
  await form.waitFor()
  assert.equal(await page.locator('.mc-request-reason').getAttribute('open'), null)
  await page
    .locator('.mc-request-status')
    .screenshot({ path: path.join(root, 'request-layout.png') })
  checks.push('create and reuse are separate choices; long request reason is collapsed')
  await select('semantic')
  assert.equal(await page.getByRole('form', { name: '新增数据源' }).count(), 0)
  await select('configure-create')
  await form.waitFor()
  const tabId = await form.locator('xpath=ancestor::*[@data-rt-tab]').getAttribute('data-rt-tab')
  await page.evaluate((id) => (window as any).__rtHost.sidebar.close(id), tabId)
  await page.getByRole('button', { name: '等待配置数据源', exact: true }).click()
  await form.waitFor()
  checks.push('closing and reopening the tab retains the original pending call')
  await page.evaluate(() => (window as any).__rtHost.reconnect())
  await page.waitForFunction(() => (window as any).__rtHost.generation())
  await page.getByRole('button', { name: '等待配置数据源', exact: true }).click()
  await form.waitFor()
  checks.push('Session switch and reconnect retain the request')
  await form.getByLabel('引擎', { exact: true }).selectOption('duckdb')
  await form.getByLabel('name', { exact: true }).fill('configured')
  assert.equal(await form.getByLabel('path', { exact: true }).inputValue(), ':memory:')
  await form.getByLabel('http_scope', { exact: true }).fill('https://example.invalid/')
  await form.getByLabel('访问令牌', { exact: true }).fill('inline-web-token-canary')
  await form.getByText('凭证引用名 · 确认或修改', { exact: true }).click()
  const autoRef = await form.getByLabel('http_bearer_token_env', { exact: true }).inputValue()
  assert.match(autoRef, /^DS_CONFIGURED_HTTP_BEARER_TOKEN_/)
  await form.getByLabel('http_bearer_token_env', { exact: true }).fill('WEB_CONFIG_TOKEN')
  await form.getByRole('button', { name: '添加 Header 凭证', exact: true }).click()
  await form.getByLabel('Header 名称', { exact: true }).fill('X-Test-Auth')
  await form.getByLabel('Header 凭证值', { exact: true }).fill('inline-web-header-canary')
  await page.screenshot({ path: path.join(root, 'inline-credentials.png'), fullPage: true })
  await form.getByRole('button', { name: '保存并测试，成功后继续', exact: true }).click()
  // The real DuckDB spec rejects combining bearer and Header auth. The form must remain editable.
  await form.getByRole('alert').waitFor()
  assert.equal(await form.getByLabel('访问令牌', { exact: true }).inputValue(), '')
  assert.equal(await form.getByLabel('Header 凭证值', { exact: true }).inputValue(), '')
  await form.getByRole('button', { name: '移除 Header', exact: true }).click()
  await form.getByLabel('访问令牌', { exact: true }).fill('inline-web-token-canary')
  await form.getByRole('button', { name: '保存并测试，成功后继续', exact: true }).click()
  checks.push(
    'Runtime rejects incompatible auth configuration; form stays open and submitted values are cleared',
  )
  await page.getByText('连接测试成功', { exact: true }).waitFor()
  const created = await run('configure-create', 'credential-idle')
  assert.ok(
    created.some(
      (entry: any) => !entry.isError && JSON.stringify(entry.content).includes('configured'),
    ),
  )
  assert.match(JSON.stringify(created), /ok/)
  checks.push(
    'create, inline scalar credential, real connection test and original Tool continuation',
  )
  assert.doesNotMatch(JSON.stringify(created), /inline-web-(token|header)-canary/)

  await select('configure-edit')
  await run('configure-edit', 'credential-start')
  form = page.getByRole('form', { name: '编辑数据源' })
  await form.waitFor()
  assert.equal(await form.getByLabel('name', { exact: true }).isDisabled(), true)
  assert.equal(await form.getByLabel('引擎', { exact: true }).isDisabled(), true)
  assert.equal(await form.getByLabel('path', { exact: true }).inputValue(), ':memory:')
  assert.equal(await form.getByLabel('访问令牌', { exact: true }).inputValue(), '')
  assert.equal(await form.getByLabel('Header 凭证值', { exact: true }).count(), 0)
  assert.equal(
    await form.getByLabel('http_bearer_token_env', { exact: true }).inputValue(),
    'WEB_CONFIG_TOKEN',
  )
  checks.push('editing preserves credential references without echoing stored values')
  assert.deepEqual(credentialRoutes, ['/api/dsh-data-analysis-credentials/start'])
  const persisted = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      state: (window as any).__rightTabs.credentials.getSnapshot(),
    }),
  )
  assert.doesNotMatch(persisted, /inline-web-(token|header)-canary/)
  checks.push(
    'credential values only cross the credential operation endpoint and are absent from persisted client state',
  )
  await form.getByLabel('path', { exact: true }).fill('/no-such-dsh-directory/configured.duckdb')
  await form.getByRole('button', { name: '保存并测试，成功后继续', exact: true }).click()
  await page.getByText('连接测试失败', { exact: true }).waitFor()
  checks.push('failed test remains pending with saved configuration')
  await page.getByRole('button', { name: '编辑配置', exact: true }).click()
  await form.waitFor()
  await form.getByLabel('path', { exact: true }).fill(':memory:')
  await form.getByRole('button', { name: '保存并测试，成功后继续', exact: true }).click()
  await page.getByText('连接测试成功', { exact: true }).waitFor()
  const edited = await run('configure-edit', 'credential-idle')
  assert.ok(
    edited.some(
      (entry: any) => !entry.isError && JSON.stringify(entry.content).includes('configured'),
    ),
  )
  checks.push('edit repair retests fresh configuration and resumes')
  await page.getByRole('button', { name: '数据源管理', exact: true }).click()
  const heading = page.locator('.mc-panel > .rt-heading-row')
  const add = heading.getByRole('button', { name: '新增数据源', exact: true })
  const refresh = heading.getByRole('button', { name: '刷新数据源', exact: true })
  assert.equal(await add.innerText(), '')
  assert.equal(await add.locator('svg').count(), 1)
  const titleBounds = (await heading
    .getByRole('heading', { name: '数据源', exact: true })
    .boundingBox())!
  const addBounds = (await add.boundingBox())!
  const refreshBounds = (await refresh.boundingBox())!
  assert.ok(addBounds.x < refreshBounds.x)
  assert.ok(
    Math.abs(titleBounds.y + titleBounds.height / 2 - addBounds.y - addBounds.height / 2) < 3,
  )
  await add.click()
  const newForm = page.getByRole('form', { name: '新增数据源', exact: true })
  await newForm.waitFor()
  await newForm.getByRole('button', { name: '取消', exact: true }).click()
  const edit = page.locator('.mc-name-row').getByRole('button', { name: '编辑配置', exact: true })
  assert.equal(await edit.innerText(), '')
  assert.equal(await edit.locator('svg').count(), 1)
  const testButton = page
    .locator('.mc-test-heading')
    .getByRole('button', { name: '测试连接', exact: true })
  assert.equal(await testButton.innerText(), '')
  assert.equal(await testButton.locator('svg').count(), 1)
  await testButton.click()
  await page.waitForFunction(() =>
    [...(window as any).__rightTabs.pages.values()].some(
      (entry: any) =>
        entry.sessionId === 'right-tabs-configure-edit' &&
        Object.values(entry.datasources.getSnapshot().outcomes).some(
          (outcome: any) => outcome.operation?.action === 'test' && outcome.operation?.result?.ok,
        ),
    ),
  )
  const remove = page.getByRole('button', { name: '删除已保存值', exact: true })
  assert.equal(
    await remove.evaluate((button) => getComputedStyle(button).backgroundColor),
    'rgb(254, 242, 242)',
  )
  await page.locator('.mc-panel').screenshot({ path: path.join(root, 'datasource-main.png') })
  checks.push(
    'main page add/edit/test icons retain their actions and alignment; delete uses a pale red background',
  )
  await page.getByRole('button', { name: '编辑配置', exact: true }).click()
  await form.waitFor()
  await form.getByLabel('read_only', { exact: true }).selectOption('true')
  await form.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByRole('button', { name: '编辑配置', exact: true }).click()
  await form.waitFor()
  assert.equal(await form.getByLabel('read_only', { exact: true }).inputValue(), 'true')
  checks.push('independent configuration editing saves and reads back typed values')
  await form.getByText('凭证引用名 · 确认或修改', { exact: true }).click()
  await form.getByLabel('http_bearer_token_env', { exact: true }).fill('')
  await form.getByRole('button', { name: '添加 Header 凭证', exact: true }).click()
  await form.getByLabel('Header 名称', { exact: true }).fill('X-Test-Auth')
  await form.getByLabel('Header 凭证值', { exact: true }).fill('inline-web-header-canary')
  await form.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByRole('button', { name: '编辑配置', exact: true }).click()
  await form.waitFor()
  assert.equal(await form.getByLabel('http_bearer_token_env', { exact: true }).inputValue(), '')
  assert.equal(await form.getByLabel('Header 名称', { exact: true }).inputValue(), 'X-Test-Auth')
  assert.equal(await form.getByLabel('Header 凭证值', { exact: true }).inputValue(), '')
  assert.match(
    await form.getByLabel('http_headers_env', { exact: true }).inputValue(),
    /^DS_CONFIGURED_X_TEST_AUTH_/,
  )
  assert.deepEqual(credentialRoutes, [
    '/api/dsh-data-analysis-credentials/start',
    '/api/dsh-data-analysis-credentials/start',
  ])
  checks.push(
    'Header credential map saves in one form and preserves its generated reference on readback',
  )
  assert.deepEqual(errors, [])
  await page.screenshot({ path: path.join(root, 'configuration.png'), fullPage: true })
  await writeFile(
    path.join(root, 'evidence.json'),
    JSON.stringify({ checks, errors, moduleDigests: host.moduleDigests }, null, 2),
  )
  process.stdout.write(JSON.stringify({ passed: true, root, checks }) + '\n')
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0]
  await page?.screenshot({ path: path.join(root, 'failure.png'), fullPage: true })
  await writeFile(path.join(root, 'failure.txt'), (await page?.locator('body').innerText()) ?? '')
  process.stdout.write(`Configuration Web evidence: ${root}\n`)
  throw error
} finally {
  await browser.close()
  await host.stop()
}
