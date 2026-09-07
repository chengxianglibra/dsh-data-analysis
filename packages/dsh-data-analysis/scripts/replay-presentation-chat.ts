/** Read-only JSONL replay through unchanged public Host registries and the built plugin. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createHostChatFixture } from '../tests/presentation-integration/host-client-fixture.ts'

const [filename, turnText, countText, ...extra] = process.argv.slice(2)
assert.ok(
  filename && turnText && countText && !extra.length,
  'Usage: replay-presentation-chat.ts /path/to/session.jsonl expected-turn expected-card-count',
)
const turn = Number(turnText),
  count = Number(countText)
assert.ok(Number.isSafeInteger(turn) && turn > 0 && Number.isSafeInteger(count) && count >= 0)
const bytes = await readFile(filename)
const [header, ...events] = bytes
  .toString('utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
assert.equal(typeof header.id, 'string')
const cases = []
for (const order of [
  ['native', 'presentation'],
  ['presentation', 'native'],
]) {
  const host = await createHostChatFixture(order)
  try {
    const assembler = host.createAssembler()
    const selected = () => {
      const snapshot = assembler.snapshot('chat')
      const nodes = snapshot.order
        .map((key: string) => snapshot.nodes.get(key))
        .filter(
          (node: any) =>
            node.kind === 'marivo-presentation-delivery' && node.location.turn.turn === turn,
        )
      assert.equal(nodes.length, count ? 1 : 0)
      const cards = nodes.flatMap((node: any) =>
        host.presentation.presentationsForNode(node, header.id),
      )
      assert.equal(cards.length, count)
      return {
        key: nodes[0]?.key,
        anchorSeq: nodes[0]?.anchorSeq,
        builds: cards.map((card: any) => card.receipt.buildId),
      }
    }
    assembler.replaceWindow(
      events.map((event) => ({ event, view: undefined })),
      false,
    )
    assembler.flush()
    const historical = selected()
    assembler.replaceWindow([], false)
    assembler.flush()
    for (const event of events) {
      assembler.append({ event, view: undefined })
      assembler.flush()
    }
    assert.deepEqual(selected(), historical)
    assembler.rebuildRegistry()
    assembler.flush()
    assert.deepEqual(selected(), historical)
    assembler.replaceWindow(
      events.map((event) => ({ event, view: undefined })),
      false,
    )
    assembler.flush()
    assert.deepEqual(selected(), historical)
    cases.push({ order, ...historical, incremental: true, reconnect: true, registryRebuild: true })
  } finally {
    await host.dispose()
  }
}
// Deliberately omit source path, user prose, tool arguments, and document content.
process.stdout.write(
  `${JSON.stringify({ status: 'passed', inputSha256: createHash('sha256').update(bytes).digest('hex'), eventCount: events.length, turn, count, cases }, null, 2)}\n`,
)
