// @ts-nocheck -- browser slot contracts are provided by DSH's runtime module table.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { SemanticBrowserModel } from './model.ts'
import { SemanticBrowserPanel } from './panel.tsx'

export function installSemanticBrowser(ctx, rpc) {
  const model = new SemanticBrowserModel(rpc)
  ctx.effect(() => () => model.dispose(), 'dsh-data-analysis: semantic browser lifecycle')
  ctx.on('connection/reset', () => model.resetConnection())
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      { name: 'sidebar.footer.action', id: 'marivo-semantic-browser', order: 100 },
      function BrowserEntry({ wide, useSessions, useWorkspaces }) {
        const current = useSessions((state) => state.current)
        const workspaces = useWorkspaces((state) => state.items)
        const selected =
          workspaces.find((item) => item.sessionIds.includes(current))?.workspaceId ?? ''
        return (
          <button
            type="button"
            title="语义层"
            aria-label="打开语义层"
            onClick={() => model.show(selected)}
            style={{
              cursor: 'pointer',
              padding: '8px 10px',
              border: 0,
              background: 'transparent',
              color: 'inherit',
            }}
          >
            {wide ? '语义层' : '◇'}
          </button>
        )
      },
    ),
  )
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'marivo-semantic-browser' },
      function BrowserOverlay({ useWorkspaces }) {
        const workspaces = useWorkspaces((state) => state.items)
        const phase = useWorkspaces((state) => state.phase)
        const error = useWorkspaces((state) => state.state === 'error')
        return (
          <SemanticBrowserPanel
            model={model}
            workspaces={workspaces}
            workspacePhase={phase}
            workspaceError={error}
          />
        )
      },
    ),
  )
}
