import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type PresentationReceipt,
  parsePresentationReceipt,
} from '../../src/presentation/contracts/index.ts'
import { presentationReceiptText } from '../../src/presentation/receipt.ts'

const receipt: PresentationReceipt = {
  schemaVersion: 2,
  kind: 'marivo.presentation',
  workspaceId: 'workspace',
  reportId: 'report',
  buildId: 'build-1',
  title: 'Revenue by region',
  summary: 'Monthly revenue compared with the prior period.',
  files: {
    document: {
      asset: 'presentation.json',
      path: '/workspace/.dsh-data-analysis/presentations/report/builds/build-1/presentation.json',
      sha256: 'a'.repeat(64),
      bytes: 1024,
    },
  },
}

test('model-facing receipt text keeps identity and omits Workspace paths and digests', () => {
  const parsed = parsePresentationReceipt(receipt)
  for (const [surface, label] of [
    ['tool', 'chat'],
    ['tab', 'tab'],
  ] as const) {
    const text = presentationReceiptText(parsed, surface)
    assert.match(text, /^Revenue by region\n/)
    assert.match(text, /Monthly revenue compared with the prior period\./)
    assert.match(text, /Record: marivo-ui:report:build-1/)
    assert.match(text, /Build: build-1/)
    assert.ok(text.includes(`Surface: ${label}`))
    for (const forbidden of ['/', 'sha256', 'Workspace:'])
      assert.ok(!text.includes(forbidden), forbidden)
  }
})

test('HTML assets are rejected rather than admitted as optional receipt files', () => {
  assert.throws(() =>
    parsePresentationReceipt({
      ...receipt,
      files: {
        ...receipt.files,
        html: {
          ...receipt.files.document,
          asset: 'index.html',
          path: receipt.files.document.path.replace('presentation.json', 'index.html'),
        },
      },
    }),
  )
})
