import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'

/** A rejected configuration must not turn an unsaved password into an apparently reusable reference. */
test('credential drafts preserve existing values and reject unsafe writes before configuration', async () => {
  const compiled = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {CreateDatasource} from './packages/dsh-data-analysis/src/client/credentials/create-datasource.tsx';
import {HostCopyProvider} from './packages/dsh-data-analysis/src/client/i18n/context.tsx';
import {translator} from './packages/dsh-data-analysis/src/client/i18n/copy.ts';
const existing=window.__existing;
window.__attempts=[];
const schema={generation:'g',fingerprint:'f',backends:[window.__relational?{name:'postgres',fields:[{name:'name',type:'string',required:true,description:''},{name:'user',type:'credential',required:false,description:''}]}:{name:'duckdb',fields:[{name:'name',type:'string',required:true,description:''},{name:'secrets',type:'secrets',required:false,description:''}]}]};
const model={async authoring(){return schema},async configuration(){return {name:'warehouse',backend:'duckdb',version:'v1',fields:{name:'warehouse',secrets:[{type:'http_bearer',scope:'https://example.com/',token:'EXISTING_TOKEN'}]}}},async saveConfiguration(_workspace,_schema,input,_original,_request,changes){window.__attempts.push({input:structuredClone(input),changes:structuredClone(changes)});throw new Error('rejected for testing')}};
createRoot(document.getElementById('app')).render(<HostCopyProvider t={translator('zh-CN')}><CreateDatasource model={model} workspaceId="workspace" close={()=>{}} name={existing?'warehouse':undefined}/></HostCopyProvider>);
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
    for (const existing of [false, true]) {
      const page = await browser.newPage()
      page.setDefaultTimeout(5000)
      await page.goto(`http://127.0.0.1:${address.port}`)
      await page.evaluate((value) => {
        ;(window as any).__existing = value
      }, existing)
      await page.addScriptTag({ content: compiled.outputFiles[0]!.text })
      const form = page.getByRole('form')
      await form.waitFor()
      if (!existing) {
        await form.getByLabel('name', { exact: true }).fill('warehouse')
        await form.getByRole('button', { name: '添加 HTTP Bearer 凭证' }).click()
        await form.getByLabel('scope', { exact: true }).fill('https://example.com/')
      }
      const section = form.getByRole('group', { name: 'HTTP Bearer 凭证 1' })
      const input = section.getByLabel('Bearer Token', { exact: true })
      await input.fill('private-draft-canary')
      await form.getByRole('button', { name: existing ? '保存配置' : '确认新增数据源' }).click()
      await form.getByRole('alert').waitFor()
      await section.getByText('凭证引用 · 查看或复用').click()
      const reference = section.getByLabel('Bearer Token · 凭证引用', { exact: true })
      await page.waitForFunction(
        ({ expected }) => {
          const input = document.querySelector<HTMLInputElement>(
            'input[aria-label="Bearer Token · 凭证引用"]',
          )
          return input?.value === expected
        },
        { expected: existing ? 'EXISTING_TOKEN' : '' },
      )
      assert.equal(await input.inputValue(), '')
      assert.equal(await reference.inputValue(), existing ? 'EXISTING_TOKEN' : '')
      assert.equal(await input.getAttribute('required'), existing ? null : '')
      const attempts = await page.evaluate(() => (window as any).__attempts)
      assert.equal(attempts.length, 1)
      assert.doesNotMatch(JSON.stringify(attempts[0].input), /private-draft-canary/)
      assert.deepEqual(Object.values(attempts[0].changes), ['private-draft-canary'])
      assert.notEqual(attempts[0].input.fields.secrets[0].token, 'EXISTING_TOKEN')
      await page.close()
    }
    for (const mode of ['reuse', 'new', 'details_first', 'unsafe']) {
      const page = await browser.newPage()
      page.setDefaultTimeout(5000)
      await page.goto(`http://127.0.0.1:${address.port}`)
      await page.evaluate(() => {
        ;(window as any).__relational = true
      })
      await page.addScriptTag({ content: compiled.outputFiles[0]!.text })
      const form = page.getByRole('form')
      await form.getByLabel('name', { exact: true }).fill('warehouse')
      if (mode === 'details_first') await form.getByText('凭证引用名 · 确认或修改').click()
      if (mode !== 'reuse')
        await form.getByLabel('用户名', { exact: true }).fill('private-user-value')
      if (mode === 'reuse' || mode === 'unsafe') {
        await form.getByText('凭证引用名 · 确认或修改').click()
        await form.getByLabel('user', { exact: true }).fill('SHARED_USER')
      }
      await form.getByRole('button', { name: '确认新增数据源' }).click()
      await form.getByRole('alert').waitFor()
      const attempts = await page.evaluate(() => (window as any).__attempts)
      if (mode === 'unsafe') {
        assert.equal(attempts.length, 0)
        assert.match(await form.getByRole('alert').innerText(), /手动引用仅用于复用/)
        await form.getByRole('button', { name: '恢复自动引用名' }).click()
        await form.getByRole('button', { name: '确认新增数据源' }).click()
        await page.waitForFunction(() => (window as any).__attempts.length === 1)
        const recovered = await page.evaluate(() => (window as any).__attempts[0])
        assert.match(recovered.input.fields.user, /^DS_WAREHOUSE_USER_/)
        assert.notEqual(recovered.input.fields.user, 'SHARED_USER')
        assert.deepEqual(Object.values(recovered.changes), ['private-user-value'])
        assert.doesNotMatch(JSON.stringify(recovered.input), /private-user-value/)
      } else {
        assert.equal(attempts.length, 1)
        assert.doesNotMatch(JSON.stringify(attempts[0].input), /private-user-value/)
        if (mode === 'reuse') {
          assert.equal(attempts[0].input.fields.user, 'SHARED_USER')
          assert.deepEqual(attempts[0].changes, {})
        } else {
          assert.match(attempts[0].input.fields.user, /^DS_WAREHOUSE_USER_/)
          assert.deepEqual(Object.values(attempts[0].changes), ['private-user-value'])
        }
      }
      await page.close()
    }
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
