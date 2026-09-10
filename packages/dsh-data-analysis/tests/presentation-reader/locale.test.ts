import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { en, message, translator, zh } from '../../src/client/i18n/copy.ts'
import { errorMessage } from '../../src/client/presentation/delivery-model.ts'
import { metricText, snapshotDate, sortedRowIndices } from '../../src/client/presentation/model.ts'
import { buildPresentation } from '../../src/presentation/build/index.ts'
import {
  applyPresentationEdits,
  presentationEdits,
} from '../../src/presentation/contracts/editing.ts'
import {
  parsePresentationDocument,
  parsePresentationDraft,
} from '../../src/presentation/contracts/index.ts'
import type { PresentationLocale, TypedDataset } from '../../src/presentation/contracts/types.ts'
import { interactionFixture } from './interaction-fixture.ts'

const locales: PresentationLocale[] = ['zh-CN', 'en-US']
test('both dictionaries have identical keys and interpolation parameters', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  const parameters = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort()
  for (const key of Object.keys(zh) as (keyof typeof zh)[])
    assert.deepEqual(parameters(zh[key]), parameters(en[key]), key)
})
test('stored notices resolve against the current language without changing their parameters', () => {
  const notice = message(
    'marivo.credentials.value-credential-inputs-have-been-cleared-enter-them-again',
    {
      p0: 'marivo.credentials.create-failed',
    },
  )
  const before = structuredClone(notice)
  assert.match(translator('zh-CN')(notice), /新增数据源失败.*已清空/)
  assert.match(translator('en-US')(notice), /creation failed.*cleared/)
  assert.deepEqual(notice, before)
  assert.equal(translator('en-US')('用户编写的业务定义'), '用户编写的业务定义')
})
test('new Draft and Document require an explicit supported language; old versions are rejected', async () => {
  const draft = JSON.parse(
    await readFile(
      new URL('../presentation-s0/fixtures/computed.draft.json', import.meta.url),
      'utf8',
    ),
  )
  const { document } = await interactionFixture()
  for (const locale of locales) {
    assert.equal(parsePresentationDraft({ ...draft, locale }).locale, locale)
    assert.equal(parsePresentationDocument({ ...document, locale }).locale, locale)
  }
  for (const [parse, value, oldVersion] of [
    [parsePresentationDraft, draft, 1],
    [parsePresentationDocument, document, 2],
  ] as const) {
    for (const locale of [undefined, '', 'zh', 'en', 'fr-FR', null])
      assert.throws(
        () => parse({ ...value, locale }),
        (error) => {
          assert.equal(
            translator('en-US')(errorMessage(error)),
            'The report version or language is invalid. Ask DSH to regenerate the report.',
          )
          return true
        },
      )
    assert.throws(() => parse({ ...value, schemaVersion: oldVersion }), /Regenerate/)
  }
})
test('editing, static fallback and portable HTML preserve each report language', async () => {
  const { document: original } = await interactionFixture()
  for (const locale of locales) {
    const document = { ...original, locale }
    const edits = presentationEdits(document)
    edits.title = 'Authored title / 用户标题'
    const saved = applyPresentationEdits(document, edits)
    assert.equal(saved.locale, locale)
    const built = await buildPresentation(saved)
    assert.equal(JSON.parse(built.documentBytes.toString()).locale, locale)
    const html = built.htmlBytes.toString()
    assert.match(html, new RegExp(`<html lang="${locale}">`))
    assert.ok(html.includes('Authored title / 用户标题'))
    const fallback = html.slice(
      html.indexOf('<div id="presentation-fallback">'),
      html.indexOf('<script id="presentation-data"'),
    )
    assert.ok(fallback.includes(locale === 'zh-CN' ? '生成于' : 'Generated'))
    assert.doesNotMatch(fallback, /marivo\.(?:presentation|credentials|semantic|navigation)\./)
  }
})
test('both report locales retain exact decimals, stable null ordering and the UTC timezone', () => {
  const column = { id: 'value', label: '金额', type: 'decimal' as const, nullable: true }
  const data: TypedDataset = {
    schemaVersion: 1,
    columns: [column],
    rows: [['9007199254740993.00001'], [null], ['9007199254740992.99999']],
    rowCount: 3,
    limit: 3,
    truncated: false,
  }
  for (const locale of locales) {
    assert.equal(metricText(locale, data.rows[0]![0]!, column), '9,007,199,254,740,993.00001')
    assert.deepEqual(
      sortedRowIndices(locale, data, { columnId: 'value', direction: 'ascending' }),
      [2, 0, 1],
    )
    assert.match(snapshotDate(locale, '2026-09-10T12:30:00+08:00'), /04:30 UTC$/)
  }
})

test('plugin Finding diagnostics follow report language and upstream diagnostics retain their text', async () => {
  const { document } = await interactionFixture()
  document.diagnostics = [
    {
      code: 'finding_unavailable',
      path: '/sources/0/ref/findingId',
      message: 'Artifact is available; its requested Finding is unavailable.',
    },
    { code: 'upstream_notice', path: '/sources/0', message: 'Original upstream diagnostic 原文' },
  ]
  for (const locale of locales) {
    const html = (await buildPresentation({ ...document, locale })).htmlBytes.toString()
    const fallback = html.slice(
      html.indexOf('<div id="presentation-fallback">'),
      html.indexOf('<script id="presentation-data"'),
    )
    assert.ok(fallback.includes(translator(locale)('marivo.presentation.finding-unavailable')))
    assert.doesNotMatch(fallback, /Artifact is available; its requested Finding is unavailable/)
    assert.ok(fallback.includes('Original upstream diagnostic 原文'))
  }
})
