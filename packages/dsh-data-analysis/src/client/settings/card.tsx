import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { useCopy } from '../i18n/context.tsx'

export interface PythonSettingsValue {
  pythonTimeoutMs: number
}

/** Seconds in the form, exact integer milliseconds at the Host boundary. */
export function timeoutMilliseconds(text: string): number | undefined {
  if (!/^\d+(?:\.\d{1,3})?$/.test(text.trim())) return undefined
  const value = Math.round(Number(text) * 1000)
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647 ? value : undefined
}

export function PythonSettingsCard({ scope }: { scope: SettingsScope<PythonSettingsValue> }) {
  const t = useCopy()
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [draft, setDraft] = useState<{
    text: string
    revision: number
    reset: boolean
  }>()
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  if (snapshot.status !== 'ready' || !snapshot.value) return null
  const text = draft?.text ?? String(snapshot.value.pythonTimeoutMs / 1000)
  const timeoutMs = timeoutMilliseconds(text)
  const disabled = !snapshot.writable || saving
  const edit = (text: string, reset = false) => {
    if (snapshot.revision === undefined) return
    setDraft({ text, revision: draft?.revision ?? snapshot.revision, reset })
    setFailed(false)
  }
  const save = async () => {
    if (!draft || disabled || timeoutMs === undefined) return
    setSaving(true)
    setFailed(false)
    try {
      await scope.mutate(
        draft.reset
          ? [{ op: 'unset', path: ['pythonTimeoutMs'] }]
          : [{ op: 'set', path: ['pythonTimeoutMs'], value: timeoutMs }],
        draft.revision,
      )
      // A refused Host write can settle normally after the scope recovers its snapshot.
      const latest = scope.getSnapshot()
      const user = latest.user as Partial<PythonSettingsValue> | undefined
      const overridden = user != null && Object.hasOwn(user, 'pythonTimeoutMs')
      const landed =
        latest.status === 'ready' &&
        latest.value !== undefined &&
        (draft.reset
          ? !overridden
          : overridden &&
            user?.pythonTimeoutMs === timeoutMs &&
            latest.value.pythonTimeoutMs === timeoutMs)
      if (landed) setDraft(undefined)
      else setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }
  const reset = () => {
    const base = snapshot.base as Partial<PythonSettingsValue> | undefined
    edit(String((base?.pythonTimeoutMs ?? 120_000) / 1000), true)
  }
  return (
    <li className="marivo-settings-card">
      <style>{styles}</style>
      <details>
        <summary>{t('marivo.settings.title')}</summary>
        <div className="marivo-settings-body">
          <label htmlFor="marivo-python-timeout">{t('marivo.settings.timeout')}</label>
          <p id="marivo-python-timeout-hint">{t('marivo.settings.hint')}</p>
          <div className="marivo-settings-actions">
            <input
              id="marivo-python-timeout"
              type="number"
              min="0.001"
              max="2147483.647"
              step="0.001"
              value={text}
              disabled={disabled}
              aria-describedby="marivo-python-timeout-hint"
              aria-invalid={timeoutMs === undefined}
              onChange={(event) => edit(event.target.value)}
            />
            <button type="button" disabled={disabled} onClick={reset}>
              {t('marivo.settings.reset')}
            </button>
          </div>
          {timeoutMs === undefined && <p role="alert">{t('marivo.settings.invalid')}</p>}
          {!snapshot.writable && <p role="status">{t('marivo.settings.read-only')}</p>}
          {failed && <p role="alert">{t('marivo.settings.failed')}</p>}
          <div className="marivo-settings-actions">
            <button
              type="button"
              disabled={disabled || !draft || timeoutMs === undefined}
              onClick={() => void save()}
            >
              {t(saving ? 'marivo.settings.saving' : 'marivo.settings.save')}
            </button>
            <button
              type="button"
              disabled={saving || !draft}
              onClick={() => {
                setDraft(undefined)
                setFailed(false)
              }}
            >
              {t('marivo.settings.discard')}
            </button>
            {draft && <span role="status">{t('marivo.settings.unsaved')}</span>}
          </div>
        </div>
      </details>
    </li>
  )
}

const styles = `
.marivo-settings-card{list-style:none;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;color:var(--dsw-alias-label-primary,inherit);font-size:13px}
.marivo-settings-card summary{cursor:pointer;padding:16px;font-weight:600}
.marivo-settings-body{padding:0 16px 16px;display:flex;flex-direction:column;gap:12px}
.marivo-settings-body p{margin:0;color:var(--dsw-alias-label-tertiary,#777);line-height:1.6}
.marivo-settings-body label{font-weight:500}
.marivo-settings-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.marivo-settings-actions input,.marivo-settings-actions button{font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:8px;padding:7px 12px}
.marivo-settings-actions input{width:150px;max-width:100%}
.marivo-settings-actions button{cursor:pointer}
.marivo-settings-actions :disabled{opacity:.5;cursor:default}
.marivo-settings-actions :focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4682e9);outline-offset:2px}
`
