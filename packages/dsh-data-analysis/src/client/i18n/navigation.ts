/** Plugin-owned copy; keys are stable identifiers, never business labels. */
export const zh = {
  'marivo.navigation.semantic-layer': '语义层',
  'marivo.navigation.the-owning-session-or-workspace-changed-return-to-its':
    '所属 Session 或 Workspace 已变化，请回到所属会话重新打开。',
  'marivo.navigation.a-newer-version-exists-the-current-view-is-unchanged':
    '已有新版本，当前阅读内容保持不变。',
  'marivo.navigation.view-new-version': '查看新版本',
  'marivo.navigation.loading-report': '正在读取报告…',
  'marivo.navigation.reload-report': '重新加载报告',
  'marivo.navigation.workspace-changed-or-is-unavailable-reopen-the-page':
    'Workspace 已变化或不可用，请重新打开页面。',
  'marivo.navigation.host-connection-interrupted-reconnect-and-reopen-the-page':
    'Host 连接已中断，请重连后重新打开页面。',
  'marivo.navigation.host-connection-reset-reopen-the-page': 'Host 连接已重置，请重新打开页面。',
  'marivo.navigation.unknown-marivo-resource-address': '未知 Marivo 资源地址',
  'marivo.navigation.resource-address-is-not-canonically-encoded': '资源地址不是规范编码',
  'marivo.navigation.cannot-verify-the-new-version': '无法核验新版本',
  'marivo.navigation.report-identity-changed': '报告身份已变化',
  'marivo.navigation.open-value': '打开{p0}',
} as const
export const en = {
  'marivo.navigation.semantic-layer': 'Semantic layer',
  'marivo.navigation.the-owning-session-or-workspace-changed-return-to-its':
    'The owning Session or Workspace changed. Return to its session and reopen.',
  'marivo.navigation.a-newer-version-exists-the-current-view-is-unchanged':
    'A newer version exists. The current view is unchanged.',
  'marivo.navigation.view-new-version': 'View new version',
  'marivo.navigation.loading-report': 'Loading report…',
  'marivo.navigation.reload-report': 'Reload report',
  'marivo.navigation.workspace-changed-or-is-unavailable-reopen-the-page':
    'Workspace changed or is unavailable. Reopen the page.',
  'marivo.navigation.host-connection-interrupted-reconnect-and-reopen-the-page':
    'Host connection interrupted. Reconnect and reopen the page.',
  'marivo.navigation.host-connection-reset-reopen-the-page':
    'Host connection reset. Reopen the page.',
  'marivo.navigation.unknown-marivo-resource-address': 'Unknown Marivo resource address',
  'marivo.navigation.resource-address-is-not-canonically-encoded':
    'Resource address is not canonically encoded',
  'marivo.navigation.cannot-verify-the-new-version': 'Cannot verify the new version',
  'marivo.navigation.report-identity-changed': 'Report identity changed',
  'marivo.navigation.open-value': 'Open {p0}',
} satisfies Record<keyof typeof zh, string>
