// @ts-nocheck -- validation client loaded by the actual Harness module table.

import { Renderer } from '@openuidev/react-lang'
import { ThemeProvider } from '@openuidev/react-ui'
import { useEffect } from 'react'
import { analysisLibrary } from '../../src/client/analysis-ui/library.tsx'
import { program } from './fixture.ts'

export const inject = [
  'slots',
  'connection',
  'sessions',
  'uiWorkspace',
  'sidebarRight',
  'sidebarRightTabs',
]
export function apply(ctx) {
  window.__p0 = {
    call: (endpoint) => ctx.connection.rpc.call('/api', `unified-ui-p0/${endpoint}`, {}),
    open: (sessionId) => ctx.uiWorkspace.openSession(sessionId),
    tab: () => ctx.sidebarRight.openTab('marivo-p0'),
    prefixes: [],
    errors: [],
  }
  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register(
      { name: 'tool.call.toolview', key: 'marivo_ui_p0_probe' },
      function ProbeView(props) {
        const prefix = props.block.args.textPrefix('program', 100_000) ?? ''
        useEffect(() => {
          window.__p0.prefixes.push({ phase: props.phase, callId: props.callId, prefix })
        }, [prefix, props.phase, props.callId])
        return (
          <section data-p0-phase={props.phase} data-p0-call={props.callId}>
            <p>P0 · {props.phase}</p>
            <ThemeProvider>
              <Renderer
                library={analysisLibrary}
                response={prefix}
                isStreaming={props.phase === 'preparing'}
                publishObservability={false}
                onError={(errors) => window.__p0.errors.push(errors)}
              />
            </ThemeProvider>
          </section>
        )
      },
    ),
  )
  ctx.sidebarRightTabs.register({
    id: 'marivo-p0',
    kind: 'marivo-p0',
    title: () => 'Analysis UI P0',
  })
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'marivo-p0' }, () => (
      <section data-p0-tab="true">
        <ThemeProvider>
          <Renderer
            library={analysisLibrary}
            response={program}
            isStreaming={false}
            publishObservability={false}
          />
        </ThemeProvider>
      </section>
    )),
  )
}
