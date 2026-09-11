import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  type ConversationSnapshot,
  conversationPhase,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useState } from 'react'
import { useCopy } from './i18n/context.tsx'
import { WorkspaceHeaderAction } from './workspace-header-action.tsx'

export const workspaceDirectories = {
  datasources: 'marivo.credentials.datasources-and-credentials',
  semantic: 'marivo.navigation.semantic-layer',
  reports: 'marivo.presentation.reports',
} as const
export type WorkspaceDirectory = keyof typeof workspaceDirectories

/** Only the Host's blank phase exposes preparation actions; drafts are untouched. */
export function WorkspaceShortcuts({
  session,
  conversation,
  disabled,
  open,
}: {
  session?: SessionSnapshot
  conversation?: ConversationSnapshot
  disabled: boolean
  open: (page: WorkspaceDirectory) => void
}) {
  const t = useCopy()
  const [error, setError] = useState('')
  if (!session || !conversation || conversationPhase(session, conversation) !== 'blank') return null
  return (
    <div className="marivo-workspace-shortcuts">
      {Object.entries(workspaceDirectories).map(([page, label]) => (
        <WorkspaceHeaderAction
          key={page}
          label={t(label)}
          icon={page === 'datasources' ? 'credentials' : (page as 'semantic' | 'reports')}
          disabled={disabled}
          onClick={() => {
            setError('')
            try {
              open(page as WorkspaceDirectory)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause))
            }
          }}
        />
      ))}
      {error && (
        <p className="marivo-workspace-shortcuts-error" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  )
}
