import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { MarivoCheckedRunner } from '../../src/environment/types.ts'
import { resultReference } from '../../src/presentation/contracts/result-reference.ts'
import { AnalysisDrafts } from '../../src/presentation/drafts.ts'
import { MarivoPresentationFileService } from '../../src/presentation/rpc.ts'
import { createMarivoPresentTool } from '../../src/presentation/tool.ts'
import { datasetSnapshot } from '../unified-analysis-ui/dataset-fixtures.ts'

export async function resourceStreamFixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'resource-stream-')))
  const drafts = new AnalysisDrafts()
  let currentWorkspace = { id: 'workspace', path: root }
  const workspace = () => currentWorkspace
  const session = {
    id: 'session',
    snapshotEvents: () => [{ type: 'tool/call', data: { callId: 'present', turn: 1 } }],
  } as unknown as Session
  const exec = {
    agent: { session },
    callId: 'present',
    rootCallId: 'present',
    signal: new AbortController().signal,
  } as unknown as ToolRunContext
  let releaseSlow = () => {}
  let slow = new Promise<void>((resolve) => {
    releaseSlow = resolve
  })
  let reads = 0,
    active = 0,
    peak = 0
  const runner: MarivoCheckedRunner = {
    status: 'ready',
    binding: {
      projectRoot: root,
      pythonExecutable: '/python',
      packagePath: '/marivo',
      marivoVersion: '0.6.4',
      fingerprint: 'identity',
      subprocessPolicyId: 'policy',
    },
    async runChecked(request) {
      reads++
      active++
      peak = Math.max(peak, active)
      try {
        const ref = resultReference.parse(JSON.parse(request.stdin!))
        if (ref.schema !== 'marivo.dataframe_ref/v2') throw new Error('fixture-reference')
        if (ref.result_id.endsWith('1')) await slow
        request.signal?.throwIfAborted()
        if (ref.result_id.endsWith('3')) throw new Error('fixture-failed-result')
        return {
          exitCode: 0,
          signal: null,
          durationMs: 1,
          stdout: Buffer.from(
            JSON.stringify(
              datasetSnapshot([
                [
                  ref.result_id.endsWith('1')
                    ? 'Slow ready'
                    : ref.result_id.endsWith('4')
                      ? 'Replacement ready'
                      : 'Fast ready',
                  '42.0000',
                ],
              ]),
            ),
          ),
          stderr: Buffer.alloc(0),
        }
      } finally {
        active--
      }
    },
  }
  const tool = createMarivoPresentTool(workspace, session, undefined, drafts, async () => runner)
  const service = new MarivoPresentationFileService(workspace, undefined, drafts)
  t.after(async () => {
    releaseSlow()
    await service.close()
    await rm(root, { recursive: true, force: true })
  })
  const declaration = (suffix: string) => ({
    kind: 'dataframe' as const,
    ref: {
      schema: 'marivo.dataframe_ref/v2' as const,
      project_root: root,
      result_id: `df_${suffix.repeat(32)}`,
    },
  })
  return {
    root,
    drafts,
    exec,
    tool,
    service,
    declaration,
    release: () => releaseSlow(),
    reset: () => {
      slow = new Promise<void>((resolve) => {
        releaseSlow = resolve
      })
    },
    changeWorkspace: () => {
      currentWorkspace = { id: 'other', path: root }
    },
    get reads() {
      return reads
    },
    get peak() {
      return peak
    },
  }
}
