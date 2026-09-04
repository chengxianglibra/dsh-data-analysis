import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {
  MARIVO_DATASOURCE_ACCESS_TOOL_NAME,
  type MarivoDatasourceAccessOptions,
  type MarivoDatasourceAccessValue,
  type MarivoDatasourceBridgePort,
  type MarivoShellLeaseReceipt,
  marivoCredentialStorageRef,
  registerMarivoDatasourceAccessTool,
} from '../../src/datasource/index.ts'

class FakeCredentials {
  readonly values = new Map<string, { value: string; source: string }>()
  readonly resolved: string[] = []
  readonly failures = new Map<string, string>()

  async resolve(ref: CredentialRef) {
    this.resolved.push(ref)
    const failure = this.failures.get(ref)
    if (failure !== undefined) throw new Error(failure)
    return this.values.get(ref)
  }
}

function leaseReceipt(refs: readonly string[]): MarivoShellLeaseReceipt {
  const token = 'l'.repeat(43)
  const bash = [`# dsh-marivo-credential-lease:${token}`]
  const pwsh = [`# dsh-marivo-credential-lease:${token}`]
  for (const ref of refs) {
    const storageRef = marivoCredentialStorageRef(ref)
    bash.push(`export ${ref}="\${${storageRef}}"`, `unset ${storageRef}`)
    pwsh.push(`$env:${ref} = $env:${storageRef}`, `Remove-Item Env:${storageRef}`)
  }
  bash.push('export MARIVO_PERSIST_CREDENTIALS=0')
  pwsh.push("$env:MARIVO_PERSIST_CREDENTIALS = '0'")
  return {
    token,
    expires_in_ms: 1_800_000,
    max_uses: 64,
    usage: 'bounded-foreground-shell-lease',
    bash_prelude: bash.join('\n'),
    pwsh_prelude: pwsh.join('\n'),
  }
}

async function fixture(refs: readonly string[]) {
  const calls = { describe: 0, test: 0, revoked: [] as string[], issued: [] as string[] }
  const bridge: MarivoDatasourceBridgePort = {
    binding: {
      projectRoot: '/workspace/access',
      pythonExecutable: '/runtime/python',
      marivoVersion: '0.5.3',
      packagePath: '/runtime/marivo/__init__.py',
      subprocessPolicyId: 'fixture',
      fingerprint: 'a'.repeat(64),
    },
    async describe(name) {
      calls.describe++
      return { name, refs: [...refs] }
    },
    async inventory() {
      return []
    },
    async test(name) {
      calls.test++
      return { name, ok: true, latency_ms: 1, failure: null, repair: null }
    },
  }
  const credentials = new FakeCredentials()
  const options: MarivoDatasourceAccessOptions = {
    revokeShellLease: (_resolved, name) => calls.revoked.push(name),
    issueShellLease: (_resolved, name, describedRefs) => {
      calls.issued.push(name)
      return leaseReceipt(describedRefs)
    },
  }
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  registerMarivoDatasourceAccessTool(ctx, bridge, credentials, options)
  return { bridge, calls, credentials, ctx }
}

let sequence = 0
async function execute(ctx: Context, name = 'warehouse') {
  sequence++
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`marivo-access-${sequence}`),
    name: MARIVO_DATASOURCE_ACCESS_TOOL_NAME,
    arguments: { name },
  })
}

test('missing access credentials return original deduplicated refs without testing or issuing', async () => {
  const f = await fixture(['CDN_CH_USER', 'CDN_CH_PASSWORD', 'CDN_CH_PASSWORD'])
  f.credentials.values.set(marivoCredentialStorageRef('CDN_CH_USER'), {
    value: 'readonly-user',
    source: 'memory',
  })

  const result = await execute(f.ctx)

  assert.equal(result.isError, false)
  if (!result.isError) {
    assert.deepEqual(result.value as unknown as MarivoDatasourceAccessValue, {
      status: 'needs-credentials',
      name: 'warehouse',
      refs: ['CDN_CH_PASSWORD'],
    })
  }
  assert.deepEqual(f.calls, {
    describe: 1,
    test: 0,
    revoked: ['warehouse'],
    issued: [],
  })
})

test('configured access resolves only mapped storage and returns the bounded lease contract', async () => {
  const f = await fixture(['DEEPSEEK_API_KEY'])
  f.credentials.values.set('DEEPSEEK_API_KEY', {
    value: 'host-canary-must-stay-unread',
    source: 'env',
  })
  f.credentials.values.set(marivoCredentialStorageRef('DEEPSEEK_API_KEY'), {
    value: 'mapped-secret',
    source: 'memory',
  })

  const result = await execute(f.ctx)

  assert.equal(result.isError, false, JSON.stringify(result))
  if (!result.isError) {
    const value = result.value as unknown as MarivoDatasourceAccessValue
    assert.equal(value.status, 'ok')
    if (value.status === 'ok') {
      assert.deepEqual(value.shell_lease, leaseReceipt(['DEEPSEEK_API_KEY']))
    }
    const rendered = JSON.stringify(result.content)
    assert.match(rendered, /Copy every line/)
    assert.match(rendered, /required control marker/)
    assert.match(rendered, /run_in_background=false/)
    assert.match(rendered, /never read DSH credential files/)
  }
  assert.deepEqual(f.credentials.resolved, [marivoCredentialStorageRef('DEEPSEEK_API_KEY')])
  assert.deepEqual(f.calls, {
    describe: 1,
    test: 0,
    revoked: ['warehouse'],
    issued: ['warehouse'],
  })
  assert.doesNotMatch(JSON.stringify(result), /host-canary-must-stay-unread|mapped-secret/)
})

test('renewing access revokes the current scope before each lease issuance', async () => {
  const f = await fixture(['DB_PASSWORD'])
  f.credentials.values.set(marivoCredentialStorageRef('DB_PASSWORD'), {
    value: 'secret',
    source: 'memory',
  })

  await execute(f.ctx)
  await execute(f.ctx)

  assert.deepEqual(f.calls.revoked, ['warehouse', 'warehouse'])
  assert.deepEqual(f.calls.issued, ['warehouse', 'warehouse'])
  assert.equal(f.calls.test, 0)
})

test('invalid and reserved refs fail before credential resolution, connection, or issuance', async () => {
  const invalid = await fixture(['DB-PASSWORD'])
  const invalidResult = await execute(invalid.ctx)
  assert.equal(invalidResult.isError, true)
  assert.match(JSON.stringify(invalidResult), /POSIX environment name/)
  assert.deepEqual(invalid.credentials.resolved, [])
  assert.equal(invalid.calls.test, 0)
  assert.deepEqual(invalid.calls.issued, [])

  const reserved = await fixture(['DSH_SESSION_ID'])
  const reservedResult = await execute(reserved.ctx)
  assert.equal(reservedResult.isError, true)
  assert.match(JSON.stringify(reservedResult), /reserved runtime namespace/)
  assert.deepEqual(reserved.credentials.resolved, [])
  assert.equal(reserved.calls.test, 0)
  assert.deepEqual(reserved.calls.issued, [])
})

test('credential provider failures are redacted and never issue or test', async () => {
  const f = await fixture(['DB_PASSWORD'])
  const storageRef = marivoCredentialStorageRef('DB_PASSWORD')
  f.credentials.failures.set(storageRef, 'provider included secret-canary')

  const result = await execute(f.ctx)

  assert.equal(result.isError, true)
  assert.match(JSON.stringify(result), /mapped Marivo datasource credential could not be resolved/)
  assert.doesNotMatch(JSON.stringify(result), /secret-canary/)
  assert.equal(f.calls.test, 0)
  assert.deepEqual(f.calls.issued, [])
})
