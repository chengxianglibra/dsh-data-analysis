// @ts-nocheck -- browser contracts are supplied by the DSH module table at runtime.
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { installCredentials } from './client/credentials/install.tsx'
import { installPresentation } from './client/presentation/install.tsx'
import { installSemanticBrowser } from './client/semantic-browser/install.tsx'
import { installSemanticReferenceSource } from './client/semantic-reference-source.ts'

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

export const inject = [
  'connection',
  'slots',
  'locale',
  'conversationEvents',
  'inputTriggers',
  'sessions',
  'workspaces',
  'conversation',
]

export function apply(ctx: Context): void {
  const connection = ctx.get('connection')
  installSemanticReferenceSource(ctx, connection.rpc)
  const openSemanticObject = installSemanticBrowser(ctx, connection.rpc)
  installCredentials(ctx, connection.rpc)
  installPresentation(ctx, connection.rpc, openSemanticObject)
}
