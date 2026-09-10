import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { localized } from '../i18n/host.tsx'
import { PythonToolCard } from './card.tsx'

export function installPythonTool(ctx: Context): void {
  const LocalizedCard = localized(ctx, PythonToolCard)
  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register(
      { name: 'tool.call.toolview', key: 'marivo_python', locale: 'marivo.python' },
      function PythonToolView(props: ToolCallViewProps) {
        return <LocalizedCard {...props} />
      },
    ),
  )
}
