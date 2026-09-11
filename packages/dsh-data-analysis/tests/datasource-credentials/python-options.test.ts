import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { registerMarivoPythonTool } from '../../src/datasource/python.ts'
import {
  type MarivoPythonOptions,
  resolvePythonOptions,
} from '../../src/datasource/python-options.ts'
import type { MarivoEnvironment } from '../../src/environment/index.ts'
import { apply, Config, installMarivoPlugin } from '../../src/plugin.ts'
import { fixture } from './fixtures.ts'

test('Python configuration defaults agree with the loader and accept the timer boundary', () => {
  const defaults = resolvePythonOptions({})
  assert.deepEqual(defaults, { pythonTimeoutMs: 120_000 })
  const config = Config({})
  assert.equal(config.pythonTimeoutMs, defaults.pythonTimeoutMs)
  assert.deepEqual(resolvePythonOptions({ pythonTimeoutMs: 2147483647 }), {
    pythonTimeoutMs: 2147483647,
  })
})

test('invalid timeout configuration fails before installation, Host access or registration', async (t) => {
  const f = fixture()
  t.after(() => f.service.close())
  const ctx = new Proxy({} as Context, {
    get() {
      assert.fail('invalid config accessed Host services')
    },
  })
  const invalid: MarivoPythonOptions[] = []
  for (const value of [0, -1, 1.5, NaN, Infinity, 2147483648, null, 'unsafe-value']) {
    invalid.push({ pythonTimeoutMs: value as number })
  }
  for (const options of invalid) {
    assert.throws(() => registerMarivoPythonTool(ctx, f.bridge, f.service, options), /python.*Ms/)
    assert.throws(() => installMarivoPlugin(ctx, {} as MarivoEnvironment, options), /python.*Ms/)
    await assert.rejects(apply(ctx, options), /python.*Ms/)
  }
  assert.equal(f.store.calls.resolve, 0)
})
