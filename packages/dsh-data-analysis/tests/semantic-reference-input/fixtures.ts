import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import type { MarivoCheckedRunner, MarivoCheckedRunRequest } from '../../src/environment/types.ts'
import type { Candidate, Envelope, Projection } from '../../src/semantic-reference/contracts.ts'
export function candidate(
  path: string,
  kind = 'metric',
  businessDefinition: string | null = null,
): Candidate {
  return {
    ref: { schema: 'marivo.semantic_ref/v1', kind, path },
    refKey: `${kind}:${path}`,
    name: path.split('.').at(-1)!,
    businessDefinition,
  }
}
export function projection(items = [candidate('sales.revenue')]): Projection {
  return { kinds: ['entity', 'metric', 'measure', 'dimension'], items }
}
export function envelope(sessionId = 'a', fingerprint = 'fp-a'): Envelope {
  return {
    schema: 'dsh-data-analysis-semantic-reference/v1',
    sessionId,
    environmentFingerprint: fingerprint,
    ref: candidate('sales.revenue').ref,
  }
}
export function fakeRunner(fingerprint = 'fp-a') {
  let data = projection(),
    failure = false
  const requests: MarivoCheckedRunRequest[] = []
  const runner: MarivoCheckedRunner = {
    binding: {
      fingerprint,
      projectRoot: `/work/${fingerprint}`,
      pythonExecutable: '/runtime/python',
      packagePath: '/runtime/marivo',
      marivoVersion: '0.5.4',
      subprocessPolicyId: 'test',
    },
    status: 'ready',
    async runChecked(request) {
      requests.push(request)
      if (failure) throw new Error('/private/secret-password')
      return output(data)
    },
  }
  return {
    runner,
    requests,
    setData(value: Projection) {
      data = value
    },
    fail() {
      failure = true
    },
  }
}
export function output(value: Projection) {
  return {
    exitCode: 0,
    signal: null,
    durationMs: 0,
    stdout: Buffer.from(JSON.stringify(value)),
    stderr: Buffer.alloc(0),
  }
}
export async function installStorage(ctx: Context, root: string) {
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
}
/** In-process transport fixture for non-Web integration tests, not Web acceptance evidence. */
export function installConnectionFixture(ctx: Context): Map<string, ConnectionRpcHandler> {
  const channels = new Map<string, ConnectionRpcHandler>()
  ctx.provide('connection', {
    rpc: {
      handle(channel, handler) {
        channels.set(channel, handler)
        return async () => {
          channels.delete(channel)
        }
      },
      intercept() {
        throw new Error('unexpected api interceptor')
      },
    },
  })
  return channels
}
