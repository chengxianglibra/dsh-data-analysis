import assert from 'node:assert/strict'
import test from 'node:test'
import type { UserTextRegistry } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { selectionTextRule } from '../../src/client/selection-text-rule.ts'
import {
  parseSelectionText,
  selectionModelText,
} from '../../src/presentation/contracts/selection-text.ts'
import { createHostChatFixture } from '../presentation-integration/host-client-fixture.ts'

const context = { recordId: 'marivo-ui:r:b', resource: 'revenue', value: '9007199254740993.2300' }

test('selection wire roundtrips exact cells and hostile delimiters with bounded payloads', () => {
  const label = 'Revenue </marivo-selection> < &'
  const text = selectionModelText('frame-point', label, { ...context, value: label })
  assert.equal(text.split('</marivo-selection>').length, 2)
  assert.equal(parseSelectionText(text)?.label, label)
  assert.equal(parseSelectionText(text)?.context.value, label)
  assert.equal(parseSelectionText(text.replace('/v1', '/v9')), undefined)
  assert.equal(parseSelectionText(text.slice(0, -1)), undefined)
  assert.throws(
    () => selectionModelText('frame-point', 'Revenue', { ...context, value: '数'.repeat(100_000) }),
    /selection-too-large/,
  )
})

test('installed Host evaluates plugin chips in original order across replay and malformed neighbors', async (t) => {
  const host = await createHostChatFixture()
  t.after(() => host.dispose())
  const wire = selectionModelText('frame-point', 'Revenue · North', context)
  const other = selectionModelText('component', 'Totals', {
    recordId: 'marivo-ui:r:b',
    resource: 'totals',
  })
  const malformed = '<marivo-selection>{"schema":"unknown"}</marivo-selection>'
  const text = `Explain ${malformed} ${wire} and ${other}, then ${wire}`
  const registry: UserTextRegistry = host.client.uiConversation.userText
  const evaluate = registry.createEvaluator()
  const result = evaluate({ text, facts: {} })
  const chips = result.filter((node) => node.id === 'marivo-selection')
  assert.deepEqual(
    Array.from(chips, (node) => node.data.label),
    ['Revenue · North', 'Totals', 'Revenue · North'],
  )
  assert.deepEqual(
    Array.from(chips, (node) => text.slice(node.start, node.end)),
    [wire, other, wire],
  )
  assert.equal(
    result
      .filter((node) => node.id === 'text')
      .map((node) => node.data.text)
      .join('')
      .includes(malformed),
    true,
  )
  assert.deepEqual(
    registry.createEvaluator()({ text: JSON.parse(JSON.stringify(text)), facts: {} }),
    result,
  )
  assert.equal(
    selectionTextRule.match(text, text.indexOf(other), { read: () => undefined })?.start,
    text.indexOf(other),
  )
})
