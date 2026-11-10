import type { Context } from '@deepseek-ai/cordis'
import type { UserTextNodeProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ReferenceChip } from '@deepseek-ai/dsh-client-ui-primitives'
import { selectionTextRule } from './selection-text-rule.ts'

export function SelectionReference({ node }: UserTextNodeProps<'marivo-selection'>) {
  return (
    <ReferenceChip appearance="command" label={node.data.label} title={`@${node.data.label}`} />
  )
}

export function installSelectionText(ctx: Context): void {
  ctx.uiConversation.userText.register(selectionTextRule)
  ctx.slots.inject('conversation.user.text.node', function* () {
    yield ctx.slots.register(
      {
        name: 'conversation.user.text.node',
        key: 'marivo-selection',
        priority: 100,
      },
      SelectionReference,
    )
  })
}
