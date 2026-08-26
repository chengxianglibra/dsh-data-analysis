// @ts-nocheck -- browser contracts are supplied by the DSH module table at runtime.
import { useEffect, useMemo, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'

const TOOL_NAME = 'marivo_test'
const openedCalls = new Set<string>()

export interface NeedsCredentialsResult {
  status: 'needs-credentials'
  name: string
  refs: string[]
}

export function parseNeedsCredentials(text: string): NeedsCredentialsResult | null {
  try {
    const value = JSON.parse(text) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const candidate = value as Record<string, unknown>
    if (
      candidate.status !== 'needs-credentials'
      || typeof candidate.name !== 'string'
      || !Array.isArray(candidate.refs)
      || !candidate.refs.every(ref => typeof ref === 'string' && ref !== '')
    ) return null
    return {
      status: 'needs-credentials',
      name: candidate.name,
      refs: [...new Set(candidate.refs as string[])],
    }
  } catch {
    return null
  }
}

export function shouldAutoOpen(
  sessionId: string,
  callId: string,
  result: NeedsCredentialsResult | null,
): boolean {
  const key = `${sessionId}\u0000${callId}`
  if (result === null || openedCalls.has(key)) return false
  openedCalls.add(key)
  return true
}

export function blankCredentialValues(refs: readonly string[]): Record<string, string> {
  return Object.fromEntries(refs.map(ref => [ref, '']))
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message
  return typeof value === 'string' ? value : '凭证保存失败'
}

function redact(text: string, values: readonly string[]): string {
  let result = text
  for (const value of values) {
    if (value !== '') result = result.split(value).join('[REDACTED]')
  }
  return result
}

export class CredentialDialogController {
  readonly api: any

  constructor(api: any) {
    this.api = api
  }

  async describe(refs: readonly string[]): Promise<Record<string, { configured: boolean }>> {
    const response = await this.api.credentials.describe({ refs: [...refs] })
    if (!response.result.ok) throw new Error(response.result.error.message)
    return response.result.value.credentials
  }

  async save(values: Readonly<Record<string, string>>): Promise<{
    ok: boolean
    saved: string[]
    errors: Record<string, string>
  }> {
    const entries = Object.entries(values)
    const secretValues = entries.map(([, value]) => value)
    const saved: string[] = []
    const errors: Record<string, string> = {}
    for (const [ref, value] of entries) {
      if (value === '') {
        errors[ref] = '请输入凭证'
        continue
      }
      try {
        const response = await this.api.credentials.set({ ref, value })
        if (response.result.ok) saved.push(ref)
        else errors[ref] = redact(response.result.error.message, secretValues)
      } catch (error) {
        errors[ref] = redact(messageOf(error), secretValues)
      }
    }
    return { ok: saved.length === entries.length, saved, errors }
  }
}

function settledText(block: any): string {
  if (block === null || typeof block !== 'object' || !('kind' in block)) return ''
  return block.content
    .filter((item: any) => item?.type === 'text')
    .map((item: any) => item.text)
    .join('')
}

const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 8, minHeight: 32, padding: '4px 8px',
  borderRadius: 8, color: 'var(--dsw-alias-text-primary, inherit)',
}
const summaryStyle = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }
const fieldStyle = { display: 'grid', gap: 6, marginBottom: 14 }
const labelStyle = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }
const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-subtle, #d0d0d0)',
  color: 'inherit', background: 'var(--dsw-alias-surface-primary, transparent)',
}
const errorStyle = { color: 'var(--dsw-alias-text-error, #c22)', fontSize: 12, margin: 0 }

export function MarivoTestToolView({ sessionId, callId, block, connection }: any) {
  const text = settledText(block)
  const missing = useMemo(() => parseNeedsCredentials(text), [text])
  const refsKey = missing?.refs.join('\u0000') ?? ''
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [savedNotice, setSavedNotice] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [configured, setConfigured] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const controller = useMemo(() => new CredentialDialogController(connection.api), [connection.api])

  const openDialog = () => {
    if (missing === null) return
    setValues(blankCredentialValues(missing.refs))
    setConfigured(Object.fromEntries(missing.refs.map(ref => [ref, false])))
    setErrors({})
    setSavedNotice(false)
    setOpen(true)
  }

  useEffect(() => {
    if (shouldAutoOpen(sessionId, callId, missing)) openDialog()
  }, [sessionId, callId, refsKey])

  useEffect(() => {
    if (!open || missing === null) return
    let current = true
    controller.describe(missing.refs).then((info) => {
      if (!current) return
      setConfigured(Object.fromEntries(missing.refs.map(ref => [ref, info[ref]?.configured === true])))
    }).catch(() => {
      if (current) setConfigured(Object.fromEntries(missing.refs.map(ref => [ref, false])))
    })
    return () => { current = false }
  }, [open, refsKey, controller])

  const save = async () => {
    if (missing === null) return
    setBusy(true)
    setErrors({})
    const pendingValues = Object.fromEntries(
      missing.refs.filter(ref => configured[ref] !== true).map(ref => [ref, values[ref] ?? '']),
    )
    const outcome = await controller.save(pendingValues)
    setValues(blankCredentialValues(missing.refs))
    setConfigured(current => ({
      ...current,
      ...Object.fromEntries(outcome.saved.map(ref => [ref, true])),
    }))
    setErrors(outcome.errors)
    setBusy(false)
    if (outcome.ok) {
      setOpen(false)
      setSavedNotice(true)
    }
  }

  const summary = missing === null
    ? (text || ('kind' in block ? '连接测试已完成' : '正在测试连接…'))
    : `缺少凭证：${missing.refs.join(', ')}`

  return (
    <>
      <div style={rowStyle} data-marivo-test-call={callId}>
        <span aria-hidden="true">●</span>
        <strong>Marivo 连接测试</strong>
        <span style={summaryStyle}>{savedNotice ? '凭证已保存，请重试 marivo_test' : summary}</span>
        {missing !== null && !savedNotice
          ? <Button size="sm" variant="outline" onClick={openDialog}>配置凭证</Button>
          : null}
      </div>
      <Modal
        open={open}
        onClose={() => { if (!busy) setOpen(false) }}
        title={`配置 ${missing?.name ?? ''} 凭证`}
        description="凭证由 DSH 凭证服务保存；Marivo 插件不会写入 ~/.marivo/secrets.toml。"
        closeLabel="取消"
        footer={(
          <>
            <Button disabled={busy} onClick={() => setOpen(false)}>取消</Button>
            <Button variant="primary" disabled={busy} onClick={() => { void save() }}>
              {busy ? '保存中…' : '保存'}
            </Button>
          </>
        )}
      >
        {missing?.refs.map(ref => (
          <label key={ref} style={fieldStyle}>
            <span style={labelStyle}>
              <code>{ref}</code>
              <span>{configured[ref] ? '已配置' : '未配置'}</span>
            </span>
            <input
              style={inputStyle}
              type="password"
              autoComplete="new-password"
              value={values[ref] ?? ''}
              aria-label={ref}
              disabled={busy || configured[ref] === true}
              onChange={event => setValues(current => ({ ...current, [ref]: event.target.value }))}
            />
            {errors[ref] === undefined ? null : <p style={errorStyle}>{errors[ref]}</p>}
          </label>
        ))}
      </Modal>
    </>
  )
}

export const inject = ['connection', 'slots']

export function apply(ctx: Context): void {
  const connection = ctx.get('connection')
  const BoundMarivoTestToolView = (props: any) => (
    <MarivoTestToolView {...props} connection={connection} />
  )
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: TOOL_NAME,
  }, BoundMarivoTestToolView))
}
