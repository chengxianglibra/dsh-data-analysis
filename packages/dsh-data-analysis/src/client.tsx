// @ts-nocheck -- browser contracts are supplied by the DSH module table at runtime.
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { installPythonTool } from './client/python-tool/install.tsx'
import { inject, installRightTabs } from './client/right-tabs/install.tsx'

export {
  marivoPresentationDeliveryDefinition,
  parsePresentationDurableContent,
  presentationDeliveryFromEvent,
  presentationsForNode,
} from './client/presentation/delivery.ts'
export { PresentationDeliveryModel } from './client/presentation/delivery-model.ts'
export { HostPresentationReader } from './client/presentation/host-entry.tsx'
export {
  installPresentation,
  PresentationCards,
  PresentationOverlay,
} from './client/presentation/install.tsx'

export { inject }

export function apply(
  ctx: Context,
  options: {
    diagnostics?: boolean
    onInstalled?: (controller: ReturnType<typeof installRightTabs>) => void
  } = {},
): void {
  const controller = installRightTabs(ctx, options)
  installPythonTool(ctx)
  options.onInstalled?.(controller)
}
