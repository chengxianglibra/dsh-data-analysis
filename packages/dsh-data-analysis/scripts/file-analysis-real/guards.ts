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
  const source = expected.replace(/^\uFEFF/, '')
  let firstCell: string
  if (!source.startsWith('"')) firstCell = source.split(/[,\r\n]/, 1)[0] ?? ''
  else {
    let value = ''
    let closed = false
    firstCell = ''
    for (let index = 1; index < source.length; index++) {
      if (source[index] !== '"') value += source[index]
      else if (source[index + 1] === '"') {
        value += '"'
        index++
      } else {
        firstCell = value
        closed = true
        break
      }
    }
    if (!closed) throw new Error('Invalid CSV fixture: unterminated first cell')
  }
  await assertSpreadsheetPreview(page, sessionId, cwd, filename, firstCell, timeout)
}

export async function assertSpreadsheetPreview(
  page: Page,
  sessionId: string,
  cwd: string,
  filename: string,
  firstCell: string,
  timeout = 10_000,
) {
  const address = fileAddressFor(sessionId, cwd, path.join(cwd, filename))
  const preview = page.locator(`[data-textpreview-url=${JSON.stringify(address)}]`)
  const workbook = preview.locator('[data-excel-preview]')
  await workbook.waitFor({ state: 'visible', timeout })
  await workbook.locator('canvas.fortune-sheet-canvas').waitFor({ state: 'visible', timeout })
  const selected = workbook.locator('#luckysheet-functionbox-cell')
  await selected.waitFor({ state: 'attached', timeout })
  await page.waitForFunction(
    ({ address, firstCell }) => {
      const preview = [...document.querySelectorAll<HTMLElement>('[data-textpreview-url]')].find(
        (item) => item.dataset.textpreviewUrl === address,
      )
      return (
        preview?.querySelector('[data-excel-preview] #luckysheet-functionbox-cell')?.textContent ===
        firstCell
      )
    },
    { address, firstCell },
    { timeout },
  )
  assert.equal((await selected.textContent())?.trim(), firstCell, 'Native spreadsheet A1 cell')
  await page.waitForFunction(
    ({ address }) => {
      const preview = [...document.querySelectorAll<HTMLElement>('[data-textpreview-url]')].find(
        (item) => item.dataset.textpreviewUrl === address,
      )
      const canvas = preview?.querySelector<HTMLCanvasElement>(
        '[data-excel-preview] canvas.fortune-sheet-canvas',
      )
      if (!canvas) return false
      const rect = canvas.getBoundingClientRect()
      if (rect.width < 120 || rect.height < 45) return false
      const context = canvas.getContext('2d')
      if (!context) return false
      // A1's interior starts below the headers; the formula bar alone can show
      // its value while an incomplete workbook leaves the visible grid blank.
      const pixels = context.getImageData(
        Math.round((45 * canvas.width) / rect.width),
        Math.round((23 * canvas.height) / rect.height),
        Math.round((70 * canvas.width) / rect.width),
        Math.round((20 * canvas.height) / rect.height),
      ).data
      let ink = 0
      for (let index = 0; index < pixels.length; index += 4)
        if (
          pixels[index + 3]! > 0 &&
          Math.min(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!) < 160
        )
          ink++
      return ink >= 12
    },
    { address },
    { timeout },
  )
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
    result?.type === 'tool/result' && result.data.message.isError,
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
