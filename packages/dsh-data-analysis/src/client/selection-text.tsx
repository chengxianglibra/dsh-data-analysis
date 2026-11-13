import type { Context } from '@deepseek-ai/cordis'
import type { UserTextNodeProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ReferenceChip } from '@deepseek-ai/dsh-client-ui-primitives'
import { selectionTextRule } from './selection-text-rule.ts'
import { semanticReferenceTextRule } from './semantic-reference-text-rule.ts'

export function SelectionReference({
  node,
}: UserTextNodeProps<'marivo-selection' | 'marivo-semantic-ref'>) {
  return (
    <ReferenceChip appearance="command" label={node.data.label} title={`@${node.data.label}`} />
  )
}

export function installSelectionText(ctx: Context): void {
  for (const rule of [selectionTextRule, semanticReferenceTextRule]) {
    ctx.uiConversation.userText.register(rule)
    ctx.slots.inject('conversation.user.text.node', function* () {
      yield ctx.slots.register(
        { name: 'conversation.user.text.node', key: rule.id, priority: 100 },
        SelectionReference,
      )
    })
  }
}
