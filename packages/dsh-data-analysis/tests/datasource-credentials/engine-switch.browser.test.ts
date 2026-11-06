import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('switching engines asks before discarding configuration and secret drafts', async () => {
  const compiled = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {CreateDatasource} from './packages/dsh-data-analysis/src/client/credentials/create-datasource.tsx';
import {HostCopyProvider} from './packages/dsh-data-analysis/src/client/i18n/context.tsx';
import {translator} from './packages/dsh-data-analysis/src/client/i18n/copy.ts';
const schema={generation:'g',fingerprint:'f',backends:[{name:'duckdb',fields:[{name:'name',type:'string',required:true},{name:'secrets',type:'secrets'}]},{name:'postgres',fields:[{name:'name',type:'string',required:true},{name:'password',type:'credential'}]}]};
const model={async authoring(){return schema},async saveConfiguration(){throw new Error('unexpected save')}};
createRoot(document.getElementById('app')).render(<HostCopyProvider t={translator('zh-CN')}><CreateDatasource model={model} workspaceId="workspace" close={()=>{}}/></HostCopyProvider>);
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const server = createServer((_request, response) => response.end('<div id="app"></div>'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address !== 'string')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${address.port}`)
    await page.addScriptTag({ content: compiled.outputFiles[0]!.text })
    const form = page.getByRole('form')
    const engine = form.getByLabel('引擎', { exact: true })
    await form.getByLabel('name', { exact: true }).fill('warehouse')
    await form.getByRole('button', { name: '添加 HTTP Bearer 凭证' }).click()
    await form.getByLabel('scope', { exact: true }).fill('https://example.com/')
    await form.getByLabel('Bearer Token', { exact: true }).fill('private-test-draft')
    await engine.selectOption('postgres')
    assert.equal(await engine.inputValue(), 'duckdb')
    assert.equal(await form.getByRole('button', { name: '确认新增数据源' }).isDisabled(), true)
    await form.getByRole('alert').getByRole('button', { name: '取消' }).click()
    assert.equal(await form.getByLabel('name', { exact: true }).inputValue(), 'warehouse')
    assert.equal(
      await form.getByLabel('Bearer Token', { exact: true }).inputValue(),
      'private-test-draft',
    )
    await engine.selectOption('postgres')
    await form.getByRole('button', { name: '清空并切换' }).click()
    assert.equal(await engine.inputValue(), 'postgres')
    assert.equal(await form.getByLabel('name', { exact: true }).inputValue(), '')
    assert.equal(await form.getByLabel('Bearer Token', { exact: true }).count(), 0)
    await engine.selectOption('duckdb')
    assert.equal(await engine.inputValue(), 'duckdb')
    assert.equal(await form.getByLabel('name', { exact: true }).inputValue(), '')
    assert.equal(await form.getByLabel('Bearer Token', { exact: true }).count(), 0)
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
