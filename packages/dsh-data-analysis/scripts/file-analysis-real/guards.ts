/** Assertions shared by real acceptance and adversarial regression fixtures. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile, readlink } from 'node:fs/promises'
import path from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { Page } from 'playwright'

export async function captureCandidate(cwd = process.cwd()) {
  const git = (args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
  const head = git(['rev-parse', 'HEAD']).trim()
  const filenames = [
    ...new Set([
      ...git(['diff', '--name-only', '-z', 'HEAD']).split('\0'),
      ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
    ]),
  ]
    .filter(Boolean)
    .sort()
  const files = await Promise.all(
    filenames.map(async (filename) => {
      const target = path.resolve(cwd, filename)
      const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (!info) return { filename, mode: null, sha256: null }
      const contents = info.isSymbolicLink() ? await readlink(target) : await readFile(target)
      return {
        filename,
        mode: info.mode,
        sha256: createHash('sha256').update(contents).digest('hex'),
      }
    }),
  )
  return { head, files }
}

export async function assertCsvPreview(
  page: Page,
  sessionId: string,
  cwd: string,
  filename: string,
  expected: string,
  timeout = 10_000,
) {
  const address = fileAddressFor(sessionId, cwd, path.join(cwd, filename))
  const preview = page.locator(`[data-textpreview-url=${JSON.stringify(address)}]`)
  const code = preview.locator('[data-code-preview] pre')
  await code.waitFor({ state: 'visible', timeout })
  const normalize = (text: string) => text.replaceAll('\r', '').trim()
  assert.equal(normalize(await code.innerText()), normalize(expected), 'Native CSV preview content')
}

export function assertPtcOuterFailure(
  events: SessionEvent[],
  declaration: Extract<SessionEvent, { type: 'deliverables/presented' }>,
) {
  const dispatch = events.find(
    (event) =>
      event.type === 'tool/ptc-dispatch' &&
      event.data.name === 'present' &&
      event.data.subCallId === declaration.data.callId,
  )
  assert.ok(
    dispatch?.type === 'tool/ptc-dispatch' && !dispatch.data.isError,
    'Successful present dispatch required',
  )
  const root = events.find(
    (event) => event.type === 'tool/call' && event.data.callId === dispatch.data.rootCallId,
  )
  assert.ok(
    root?.type === 'tool/call' && root.data.name === 'run_code',
    'Matching run_code root required',
  )
  const result = events.find(
    (event) =>
      event.type === 'tool/result' && event.data.message.source.callId === dispatch.data.rootCallId,
  )
  assert.ok(
    result?.type === 'tool/result' && result.data.message.content[0].isError,
    'The run_code that executed present must fail',
  )
  assert.equal(root.data.turn, declaration.data.turn)
  assert.equal(result.data.turn, root.data.turn)
  assert.equal(result.data.step, root.data.step)
  assert.ok(
    root.seq < declaration.seq && declaration.seq < dispatch.seq && dispatch.seq < result.seq,
    'Declaration must complete inside the matching root before its failure',
  )
}
