import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { chromium } from 'playwright'
import {
  assertCsvPreview,
  assertPtcOuterFailure,
  captureCandidate,
} from '../../scripts/file-analysis-real/guards.ts'

test('candidate guard detects new paths, changed HEAD, changed contents and deletion', async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'dsh-candidate-guard-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=/dev/null',
        ...args,
      ],
      { cwd, stdio: 'pipe' },
    )
  git('init')
  await writeFile(path.join(cwd, 'initial.txt'), 'initial')
  git('add', '.')
  git('commit', '-m', 'fixture')
  const clean = await captureCandidate(cwd)
  assert.deepEqual(clean.files, [])
  assert.deepEqual(await captureCandidate(cwd), clean)
  await writeFile(path.join(cwd, 'initial.txt'), 'changed after a clean start')
  const dirty = await captureCandidate(cwd)
  assert.notDeepEqual(dirty, clean)
  await writeFile(path.join(cwd, 'initial.txt'), 'changed again')
  assert.notDeepEqual(await captureCandidate(cwd), dirty)
  git('restore', 'initial.txt')
  const unusual = '新 文件\nadded.txt'
  await writeFile(path.join(cwd, unusual), 'new file')
  const added = await captureCandidate(cwd)
  assert.notDeepEqual(added, clean)
  assert.deepEqual(
    added.files.map((entry) => entry.filename),
    [unusual],
  )
  await rm(path.join(cwd, unusual))
  await rm(path.join(cwd, 'initial.txt'))
  const deleted = await captureCandidate(cwd)
  assert.deepEqual(deleted.files, [{ filename: 'initial.txt', mode: null, sha256: null }])
  assert.notDeepEqual(deleted, clean)
  git('restore', 'initial.txt')
  git('commit', '--allow-empty', '-m', 'new HEAD, same files')
  const advanced = await captureCandidate(cwd)
  assert.deepEqual(advanced.files, [])
  assert.notEqual(advanced.head, clean.head)
})

function ptcEvents(failedRoot = true): SessionEvent[] {
  // Minimal log fixture: unrelated failure first, then the root that actually declares a file.
  return [
    {
      type: 'tool/call',
      seq: 1,
      data: { turn: 1, step: 1, name: 'run_code', callId: 'unrelated' },
    },
    {
      type: 'tool/result',
      seq: 2,
      data: {
        turn: 1,
        step: 1,
        message: { source: { callId: 'unrelated' }, content: [{ isError: true }] },
      },
    },
    { type: 'tool/call', seq: 3, data: { turn: 1, step: 2, name: 'run_code', callId: 'root' } },
    {
      type: 'deliverables/presented',
      seq: 4,
      data: { turn: 1, callId: 'root:ptc:1', files: [{ path: 'done.txt' }] },
    },
    {
      type: 'tool/ptc-dispatch',
      seq: 5,
      data: {
        name: 'present',
        subCallId: 'root:ptc:1',
        parentCallId: 'root',
        rootCallId: 'root',
        isError: false,
      },
    },
    {
      type: 'tool/result',
      seq: 6,
      data: {
        turn: 1,
        step: 2,
        message: { source: { callId: 'root' }, content: [{ isError: failedRoot }] },
      },
    },
  ] as unknown as SessionEvent[]
}
function declaration(events: SessionEvent[]) {
  const event = events.find((entry) => entry.type === 'deliverables/presented')
  assert.ok(event?.type === 'deliverables/presented')
  return event
}
test('PTC guard requires failure of the same enclosing root after declaration', () => {
  const correct = ptcEvents()
  assertPtcOuterFailure(correct, declaration(correct))
  const unrelated = ptcEvents(false)
  assert.throws(() => assertPtcOuterFailure(unrelated, declaration(unrelated)), /must fail/)
  const reordered = ptcEvents()
  reordered[5] = { ...reordered[5]!, seq: declaration(reordered).seq }
  assert.throws(
    () => assertPtcOuterFailure(reordered, declaration(reordered)),
    /before its failure/,
  )
  const otherTurn = ptcEvents()
  const result = otherTurn[5]!
  assert.ok(result.type === 'tool/result')
  result.data.turn = 2
  assert.throws(() => assertPtcOuterFailure(otherTurn, declaration(otherTurn)))
})

test('CSV guard accepts only the named Session file preview, including at narrow width', async (t) => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const expected = 'rows,total\n5,371'
  const address = (session = 'owner', file = 'summary.csv') =>
    fileAddressFor(session, '/workspace', file)
  const native = (uri: string, contents = expected) =>
    `<aside data-textpreview-url="${uri}"><div data-code-preview><pre>${contents}</pre></div></aside>`
  const chat = `<main><pre>${expected}</pre></main>`
  const check = () => assertCsvPreview(page, 'owner', '/workspace', 'summary.csv', expected, 200)
  await page.setContent(`${chat}<aside>File preview failed</aside>`)
  await assert.rejects(check, /Timeout/)
  await page.setContent(chat + native(address('other')))
  await assert.rejects(check, /Timeout/)
  await page.setContent(chat + native(address('owner', 'other.csv')))
  await assert.rejects(check, /Timeout/)
  await page.setContent(chat + native(address(), 'rows,total\n5,999'))
  await assert.rejects(check, /Native CSV preview content/)
  await page.setContent(chat + native(address()))
  await check()
  await page.setViewportSize({ width: 390, height: 844 })
  await check()
  await page.addStyleTag({ content: '@media(max-width: 400px){aside{display:none}}' })
  await assert.rejects(check, /Timeout/)
})
