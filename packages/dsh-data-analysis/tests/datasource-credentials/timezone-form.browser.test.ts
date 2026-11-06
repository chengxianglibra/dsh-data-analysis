import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('timezone choices remain available with a prefilled or custom value and without Intl timezone enumeration', async () => {
  const compiled = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {CreateDatasource} from './packages/dsh-data-analysis/src/client/credentials/create-datasource.tsx';
import {HostCopyProvider} from './packages/dsh-data-analysis/src/client/i18n/context.tsx';
import {translator} from './packages/dsh-data-analysis/src/client/i18n/copy.ts';
window.__saved=[];
const schema={generation:'g',fingerprint:'f',backends:[{name:'duckdb',fields:[{name:'name',type:'string',required:true},{name:'wall_clock_timezone',type:'string'}]}]};
const model={async authoring(){return schema},async configuration(){return {name:'warehouse',backend:'duckdb',version:'v1',fields:{name:'warehouse',wall_clock_timezone:'Custom/Existing'}}},async saveConfiguration(_workspace,_schema,input){window.__saved.push(structuredClone(input.fields))}};
createRoot(document.getElementById('app')).render(<HostCopyProvider t={translator('zh-CN')}><CreateDatasource model={model} workspaceId="workspace" close={()=>{}} name="warehouse"/></HostCopyProvider>);
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
    for (const withoutEnumeration of [false, true]) {
      const page = await browser.newPage()
      await page.goto(`http://127.0.0.1:${address.port}`)
      if (withoutEnumeration)
        await page.evaluate(() => {
          Object.defineProperty(Intl, 'supportedValuesOf', { value: undefined })
        })
      await page.addScriptTag({ content: compiled.outputFiles[0]!.text })
      const input = page.getByLabel('wall_clock_timezone', { exact: true })
      const selector = page.getByRole('button', { name: '选择时区' })
      await input.waitFor()
      assert.equal(await input.inputValue(), 'Custom/Existing')
      await selector.click()
      const options = await page
        .getByRole('listbox', { name: '选择时区' })
        .locator('option:not([disabled])')
        .allTextContents()
      for (const zone of [
        'UTC',
        'America/New_York',
        'Europe/London',
        'Asia/Tokyo',
        'Australia/Sydney',
      ])
        assert(options.includes(zone), `Missing timezone option: ${zone}`)
      await page.getByLabel('搜索时区').press('Escape')
      const save = page.getByRole('button', { name: '保存配置' })
      await save.click()
      await selector.click()
      await page.getByRole('listbox', { name: '选择时区' }).selectOption('America/New_York')
      await page.getByRole('button', { name: '使用所选时区' }).click()
      assert.equal(await input.inputValue(), 'America/New_York')
      await save.click()
      await selector.click()
      await page.getByLabel('搜索时区').fill('Tokyo')
      assert.deepEqual(
        await page
          .getByRole('listbox', { name: '选择时区' })
          .locator('option:not([disabled])')
          .allTextContents(),
        ['Asia/Tokyo'],
      )
      await page.getByRole('listbox', { name: '选择时区' }).selectOption('Asia/Tokyo')
      await page.getByRole('listbox', { name: '选择时区' }).press('Enter')
      assert.equal(await input.inputValue(), 'Asia/Tokyo')
      await input.fill('+05:45')
      await save.click()
      await input.fill('')
      await save.click()
      const saved = await page.evaluate(() => (window as any).__saved)
      assert.equal(saved[0].wall_clock_timezone, 'Custom/Existing')
      assert.equal(saved[1].wall_clock_timezone, 'America/New_York')
      assert.equal(saved[2].wall_clock_timezone, '+05:45')
      assert.equal(saved[3].wall_clock_timezone, undefined)
      await page.close()
    }
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
