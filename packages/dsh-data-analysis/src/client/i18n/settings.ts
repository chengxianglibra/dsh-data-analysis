export const zh = {
  'marivo.settings.title': '数据分析',
  'marivo.settings.timeout': 'Python 默认执行超时（秒）',
  'marivo.settings.hint':
    '默认 120 秒。保存后对所有 Workspace 的下一次 Python 调用生效，不改变已开始调用的时限。单次调用可指定其他时限；仍受 Harness 执行限制约束。',
  'marivo.settings.reset': '恢复继承值',
  'marivo.settings.save': '保存',
  'marivo.settings.saving': '保存中…',
  'marivo.settings.discard': '放弃修改',
  'marivo.settings.unsaved': '未保存',
  'marivo.settings.invalid': '请输入 0.001 至 2147483.647 秒，最多三位小数。',
  'marivo.settings.read-only': '当前连接的设置只读。',
  'marivo.settings.failed':
    '保存失败或设置已被其他页面修改。草稿已保留；可放弃修改以读取最新值，再重试。',
} as const

export const en: Record<keyof typeof zh, string> = {
  'marivo.settings.title': 'Data analysis',
  'marivo.settings.timeout': 'Default Python execution timeout (seconds)',
  'marivo.settings.hint':
    'Defaults to 120 seconds. Saved changes apply to the next Python call in every Workspace; calls already started keep their timeout. Individual calls may override it. Harness execution limits still apply.',
  'marivo.settings.reset': 'Restore inherited value',
  'marivo.settings.save': 'Save',
  'marivo.settings.saving': 'Saving…',
  'marivo.settings.discard': 'Discard changes',
  'marivo.settings.unsaved': 'Unsaved',
  'marivo.settings.invalid': 'Enter 0.001–2147483.647 seconds with at most three decimal places.',
  'marivo.settings.read-only': 'Settings are read-only on this connection.',
  'marivo.settings.failed':
    'Saving failed or another page changed these settings. Your draft is preserved. Discard it to read the latest value, then retry.',
}
