// @ts-nocheck -- validation adapter for the actual Harness module table.
export const inject = ['connection', 'uiWorkspace', 'sidebarRight']
export function apply(ctx) {
  window.__p2 = {
    call: (endpoint) => ctx.connection.rpc.call('/api', `unified-ui-p2/${endpoint}`, {}),
    open: (sessionId) => ctx.uiWorkspace.openSession(sessionId),
  }
}
