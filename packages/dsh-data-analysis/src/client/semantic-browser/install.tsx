// @ts-nocheck -- browser slot contracts are provided by DSH's runtime module table.

import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { useEffect, useSyncExternalStore } from 'react'
import { WorkspaceHeaderAction } from '../workspace-header-action.tsx'
import { SemanticBrowserModel } from './model.ts'
import { SemanticBrowserPanel } from './panel.tsx'

export function installSemanticBrowser(ctx, rpc, options = {}) {
  const model = new SemanticBrowserModel(rpc)
  ctx.effect(() => () => model.dispose(), 'dsh-data-analysis: semantic browser lifecycle')
  ctx.on('connection/reset', () => model.resetConnection())
  if (options.entries !== false)
    ctx.slots.inject('conversation.session.header.actions', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.actions',
          id: 'marivo-semantic-browser',
          order: 110,
        },
        function BrowserEntry({ sessionId, useWorkspaces }) {
          const workspaces = useWorkspaces((state) => state.items)
          const selected =
            workspaces.find((item) => item.sessionIds.includes(sessionId))?.workspaceId ?? ''
          return (
            <WorkspaceHeaderAction
              label="语义层"
              icon="semantic"
              disabled={!selected}
              title={selected ? '语义层' : '当前会话未绑定工作区，无法打开语义层'}
              onClick={() => {
                if (selected) model.show(selected)
              }}
            />
          )
        },
      ),
    )
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'marivo-semantic-browser' },
      function BrowserOverlay({ useWorkspaces, useSessions }) {
        const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
        const sessionId = useSessions((state) => state.current) ?? ''
        const workspaces = useWorkspaces((state) => state.items)
        const currentWorkspace =
          workspaces.find((item) => item.sessionIds.includes(sessionId))?.workspaceId ?? ''
        // biome-ignore lint/correctness/useExhaustiveDependencies: Navigation must close the previous Workspace snapshot.
        useEffect(() => model.close(), [sessionId, currentWorkspace])
        const phase = useWorkspaces((state) => state.phase)
        const error = useWorkspaces((state) => state.state === 'error')
        return (
          <SemanticBrowserPanel
            model={model}
            onAsk={
              sessionId && currentWorkspace === state.workspaceId
                ? () => model.addToQuestion(ctx, sessionId)
                : undefined
            }
            workspaces={workspaces}
            workspacePhase={phase}
            workspaceError={error}
          />
        )
      },
    ),
  )
  return model.showObject
}
